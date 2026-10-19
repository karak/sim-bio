# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""D1 の書きの最悪の日の行数を数え、性能要件の内か検める適用度関数 (M26-20)。

性能要件 (docs/specs/2026-10-18-decisions-current.md の「D1 の書きの性能要件」):
全部の道が上限まで使われ、Cron の掃除が走る最悪の日でも、D1 の書きは無料枠 100,000 行/日の 90% 以内。

    pnpm run check:d1-writes

数えるもの (全部ソースから読む。数をここに写さない)
1. worker/src/policy.ts の BUDGETS の cap・shedAt と HARBOR_CONFIG の reportsToHide
2. worker/migrations/*.sql の主鍵・UNIQUE・索引 (部分索引を分けて数える)。1 行を書くと
   行 + 索引の数だけ行が書かれる (D1 の rows_written)
3. worker/src/ledger.ts の sweep が DELETE する表

最悪の日 = 予算の数え (通した全部の呼び出しで 1 行。合計は shedAt の最大まで) + 道ごとの cap × 1 件の行
+ Cron の掃除 (前日の分の削除と集計の書き)。取り下げの連鎖で消える通報の行は、Cron が消す行と同じ
行なので二重には足さない (1 行は 1 度だけ消える)
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

POLICY_TS = "worker/src/policy.ts"
LEDGER_TS = "worker/src/ledger.ts"
MIGRATIONS_DIR = "worker/migrations"
LIMIT_ROWS = 100_000
REQUIREMENT_PERCENT = 90

# 取り下げの余りの 1 は policy.ts の注 (1,000 × 5 行) に合わせた分。注は内訳を書いていない
WITHDRAW_EXTRA = 1
BUDGET_LANE = "daily_budget"

_BUDGET_ENTRY = re.compile(
    r"^\s*(\w+):\s*\{\s*cap:\s*([\d_]+),\s*shedAt:\s*([\d_]+)", re.MULTILINE
)
_REPORTS_TO_HIDE = re.compile(r"reportsToHide:\s*(\d+)")
_DELETE_TABLE = re.compile(r"DELETE\s+FROM\s+(\w+)", re.IGNORECASE)
_CREATE_INDEX = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(\w+)\s*\([^)]*\)\s*(WHERE\b[^;]*)?;",
    re.IGNORECASE,
)


def _num(s: str) -> int:
    return int(s.replace("_", ""))


@dataclass
class Table:
    name: str
    without_rowid: bool = False
    pk_index: int = 0  # rowid の表で INTEGER 以外の主鍵が作る自動索引
    uniques: int = 0
    indexes: int = 0
    partial: int = 0

    def partial_indexes(self) -> int:
        return self.partial

    def row_writes(self) -> int:
        """1 行の INSERT・DELETE で書かれる行 (表の行 + 索引の項目)"""
        return 1 + self.pk_index + self.uniques + self.indexes + self.partial

    def row_writes_when_hidden(self) -> int:
        """部分索引 (hidden_at IS NULL) に入っていない行の分"""
        return self.row_writes() - self.partial


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _split_top_level(body: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def _table_body(sql: str, start: int) -> tuple[str, int]:
    """start は '(' の位置。対応する ')' までの中身と、その次の位置"""
    depth = 0
    for i in range(start, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth == 0:
                return sql[start + 1 : i], i + 1
    raise ValueError("CREATE TABLE の括弧が閉じていない")


def parse_schema(sqls: list[str]) -> dict[str, Table]:
    tables: dict[str, Table] = {}
    cleaned = [_strip_comments(s) for s in sqls]
    for sql in cleaned:
        for m in re.finditer(r"CREATE\s+TABLE\s+(\w+)\s*\(", sql, re.IGNORECASE):
            body, end = _table_body(sql, m.end() - 1)
            options = sql[end : sql.index(";", end)]
            table = Table(
                m.group(1),
                without_rowid=bool(
                    re.search(r"WITHOUT\s+ROWID", options, re.IGNORECASE)
                ),
            )
            has_pk = False
            for col in _split_top_level(body):
                if re.match(
                    r"(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\b", col, re.IGNORECASE
                ):
                    if re.match(r"PRIMARY\s+KEY", col, re.IGNORECASE):
                        has_pk = True
                    elif re.match(r"UNIQUE", col, re.IGNORECASE):
                        table.uniques += 1
                    continue
                words = col.split()
                if re.search(r"\bPRIMARY\s+KEY\b", col, re.IGNORECASE):
                    has_pk = not (
                        len(words) > 1
                        and words[1].upper() == "INTEGER"
                        and not table.without_rowid
                    )
                if re.search(r"\bUNIQUE\b", col, re.IGNORECASE):
                    table.uniques += 1
            if has_pk and not table.without_rowid:
                table.pk_index = 1
            tables[table.name] = table
    for sql in cleaned:
        for m in _CREATE_INDEX.finditer(sql):
            table = tables.get(m.group(1))
            if table is None:
                raise ValueError(f"索引の表 {m.group(1)} の CREATE TABLE が無い")
            if m.group(2):
                table.partial += 1
            else:
                table.indexes += 1
    if not tables:
        raise ValueError("migrations に CREATE TABLE が無い")
    return tables


def parse_budgets(policy_ts: str) -> dict[str, tuple[int, int]]:
    block = re.search(
        r"export const BUDGETS\b.*?=\s*\{(.*?)^\};", policy_ts, re.DOTALL | re.MULTILINE
    )
    if not block:
        raise ValueError("policy.ts に BUDGETS が無い")
    budgets = {
        m.group(1): (_num(m.group(2)), _num(m.group(3)))
        for m in _BUDGET_ENTRY.finditer(block.group(1))
    }
    if not budgets:
        raise ValueError("BUDGETS の道が読めない")
    return budgets


def parse_reports_to_hide(policy_ts: str) -> int:
    m = _REPORTS_TO_HIDE.search(policy_ts)
    if not m:
        raise ValueError("policy.ts に reportsToHide が無い")
    return int(m.group(1))


def cron_deleted_tables(ledger_ts: str) -> list[str]:
    body = re.search(
        r"export async function sweep\b(.*?)^\}", ledger_ts, re.DOTALL | re.MULTILINE
    )
    if not body:
        raise ValueError("ledger.ts に sweep が無い")
    tables = _DELETE_TABLE.findall(body.group(1))
    if not tables:
        raise ValueError("sweep に DELETE が無い")
    return tables


@dataclass
class Lane:
    name: str
    cap: int
    rows_per_call: int
    worst_rows: int
    note: str = ""


@dataclass
class Result:
    lanes: list[Lane]
    cron: list[Lane] = field(default_factory=list)

    @property
    def lanes_rows(self) -> int:
        return sum(lane.worst_rows for lane in self.lanes)

    @property
    def cron_rows(self) -> int:
        return sum(lane.worst_rows for lane in self.cron)

    @property
    def total(self) -> int:
        return self.lanes_rows + self.cron_rows


def _rows_per_call(bucket: str, schema: dict[str, Table]) -> tuple[int, str]:
    chronicles, cargo, reports = (
        schema["chronicles"],
        schema["cargo"],
        schema["reports"],
    )
    match bucket:
        case "publish":
            return chronicles.row_writes(), "chronicles の INSERT (行・主鍵・部分索引)"
        case "cast_cargo":
            return cargo.row_writes(), "cargo の INSERT (行・UNIQUE・索引)"
        case "report":
            return (
                reports.row_writes() + 1 + chronicles.partial_indexes(),
                "reports の INSERT + chronicles の数の UPDATE + 隠れて部分索引から外れる分 (毎回と見る)",
            )
        case "confirm":
            return 1, "chronicles の数の UPDATE (索引に無い列)"
        case "report_outcome":
            return schema["outcomes"].row_writes(), "outcomes の UPSERT"
        case "withdraw":
            return (
                chronicles.row_writes() + WITHDRAW_EXTRA,
                "chronicles の DELETE + 注に合わせた余り",
            )
        case _:
            return 0, "D1 に書かない"


def compute(
    budgets: dict[str, tuple[int, int]],
    schema: dict[str, Table],
    cron_tables: list[str],
    reports_to_hide: int,
) -> Result:
    shed_max = max(shed for _, shed in budgets.values())
    per_budget = schema["daily_budget"].row_writes()
    lanes = [
        Lane(
            BUDGET_LANE,
            shed_max,
            per_budget,
            shed_max * per_budget,
            "通した全部の呼び出しで 1 行 (合計は shedAt の最大まで)",
        )
    ]
    for bucket, (cap, _) in budgets.items():
        rows, note = _rows_per_call(bucket, schema)
        if rows:
            lanes.append(Lane(bucket, cap, rows, cap * rows, note))
    cron: list[Lane] = []
    for table in cron_tables:
        if table == "reports":
            n, per = budgets["report"][0], schema["reports"].row_writes()
            cron.append(
                Lane("Cron: reports", n, per, n * per, "前日の通報 (上限は通報の cap)")
            )
        elif table == "cargo":
            n, per = budgets["cast_cargo"][0], schema["cargo"].row_writes()
            cron.append(
                Lane("Cron: cargo", n, per, n * per, "前日の積荷 (上限は積荷の cap)")
            )
        elif table == "daily_budget":
            n, per = len(budgets), per_budget
            cron.append(
                Lane("Cron: daily_budget", n, per, n * per, "前日の予算の行 (道の数)")
            )
        elif table == "chronicles":
            n, per = (
                budgets["report"][0] // reports_to_hide,
                schema["chronicles"].row_writes_when_hidden(),
            )
            cron.append(
                Lane(
                    "Cron: chronicles",
                    n,
                    per,
                    n * per,
                    "30 日前の隠した年代記 (通報 cap ÷ 隠す数。部分索引に入っていない)",
                )
            )
        else:
            raise ValueError(f"sweep が消す表 {table} の行数の式が無い")
    if "harbor_stats" in schema:
        per = schema["harbor_stats"].row_writes()
        cron.append(Lane("Cron: harbor_stats", 1, per, per, "集計 1 行の UPSERT"))
    return Result(lanes, cron)


def render(result: Result, out: TextIO) -> int:
    limit = LIMIT_ROWS * REQUIREMENT_PERCENT // 100
    rows = [("道", "上限", "1 件の行", "最悪の行")]
    for lane in [*result.lanes, *result.cron]:
        rows.append(
            (
                lane.name,
                f"{lane.cap:,}",
                str(lane.rows_per_call),
                f"{lane.worst_rows:,}",
            )
        )
    widths = [max(len(r[i]) for r in rows) for i in range(4)]
    for i, r in enumerate(rows):
        out.write(
            "  ".join(
                c.ljust(widths[j]) if j == 0 else c.rjust(widths[j])
                for j, c in enumerate(r)
            )
            + "\n"
        )
        if i == 0:
            out.write("  ".join("-" * w for w in widths) + "\n")
    out.write(
        f"\n道の書き {result.lanes_rows:,} + Cron の掃除 {result.cron_rows:,} = 合計 {result.total:,} 行/日\n"
    )
    out.write(
        f"無料枠 {LIMIT_ROWS:,} 行/日の {result.total / LIMIT_ROWS * 100:.1f}% (要件 {REQUIREMENT_PERCENT}% = {limit:,} 行)\n"
    )
    if result.total > limit:
        out.write(f"超えた。{result.total:,} > {limit:,}\n")
        return 1
    out.write(f"要件の内。{result.total:,} <= {limit:,}\n")
    return 0


def run(root: Path, out: TextIO) -> int:
    policy = (root / POLICY_TS).read_text(encoding="utf-8")
    ledger = (root / LEDGER_TS).read_text(encoding="utf-8")
    sqls = [
        p.read_text(encoding="utf-8")
        for p in sorted((root / MIGRATIONS_DIR).glob("*.sql"))
    ]
    result = compute(
        parse_budgets(policy),
        parse_schema(sqls),
        cron_deleted_tables(ledger),
        parse_reports_to_hide(policy),
    )
    return render(result, out)


def main() -> int:
    return run(Path(__file__).resolve().parent.parent, sys.stdout)


if __name__ == "__main__":
    sys.exit(main())
