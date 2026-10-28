import io
import re
import tempfile
import unittest
from pathlib import Path

from check_d1_writes import (
    LEDGER_TS,
    LIMIT_ROWS,
    MIGRATIONS_DIR,
    POLICY_TS,
    REQUIREMENT_PERCENT,
    compute,
    cron_deleted_tables,
    parse_budgets,
    parse_reports_to_hide,
    parse_schema,
    run,
)

REPO = Path(__file__).resolve().parent.parent


def read_schema():
    return parse_schema(
        [
            p.read_text(encoding="utf-8")
            for p in sorted((REPO / MIGRATIONS_DIR).glob("*.sql"))
        ]
    )


def real_result():
    policy = (REPO / POLICY_TS).read_text(encoding="utf-8")
    ledger = (REPO / LEDGER_TS).read_text(encoding="utf-8")
    return compute(
        parse_budgets(policy),
        read_schema(),
        cron_deleted_tables(ledger),
        parse_reports_to_hide(policy),
    )


class ParsePolicy(unittest.TestCase):
    def test_reads_caps_and_shed_levels_from_budgets(self):
        budgets = parse_budgets((REPO / POLICY_TS).read_text(encoding="utf-8"))
        self.assertEqual(budgets["publish"], (2_000, 40_000))
        self.assertEqual(budgets["cast_cargo"], (3_000, 35_000))
        self.assertEqual(budgets["report"], (500, 40_000))
        self.assertEqual(budgets["withdraw"], (500, 45_000))
        self.assertEqual(len(budgets), 11)

    def test_policy_without_budgets_is_an_error(self):
        with self.assertRaises(ValueError):
            parse_budgets("export const X = 1;")


class ParseSchema(unittest.TestCase):
    def test_counts_index_writes_per_row_from_migrations(self):
        schema = read_schema()
        self.assertEqual(
            schema["chronicles"].row_writes(), 4
        )  # 行・TEXT の主鍵・部分索引 2
        self.assertEqual(schema["chronicles"].partial_indexes(), 2)
        self.assertEqual(schema["cargo"].row_writes(), 3)  # 行・UNIQUE・索引
        self.assertEqual(
            schema["reports"].row_writes(), 2
        )  # WITHOUT ROWID は主鍵が行そのもの・索引 1
        self.assertEqual(schema["daily_budget"].row_writes(), 1)
        self.assertEqual(schema["outcomes"].row_writes(), 1)
        self.assertEqual(schema["harbor_stats"].row_writes(), 2)

    def test_integer_primary_key_and_unique_and_comments(self):
        schema = parse_schema(
            [
                "-- UNIQUE の語はコメントでは数えない\nCREATE TABLE a (id INTEGER PRIMARY KEY, k TEXT UNIQUE, v TEXT) STRICT;\nCREATE INDEX a_v ON a (v);"
            ]
        )
        self.assertEqual(
            schema["a"].row_writes(), 3
        )  # 行・UNIQUE・索引 (INTEGER PRIMARY KEY は rowid)


class ParseLedger(unittest.TestCase):
    def test_reads_tables_the_cron_deletes(self):
        tables = cron_deleted_tables((REPO / LEDGER_TS).read_text(encoding="utf-8"))
        self.assertEqual(
            sorted(tables), ["cargo", "chronicles", "daily_budget", "reports"]
        )


class Compute(unittest.TestCase):
    def test_total_matches_the_hand_calculation(self):
        result = real_result()
        lane_rows = {lane.name: lane.worst_rows for lane in result.lanes}
        self.assertEqual(lane_rows["daily_budget"], 45_000)
        self.assertEqual(lane_rows["publish"], 8_000)
        self.assertEqual(lane_rows["cast_cargo"], 9_000)
        self.assertEqual(lane_rows["report"], 2_500)
        self.assertEqual(lane_rows["withdraw"], 2_500)
        self.assertEqual(sum(lane_rows.values()), 77_000)  # policy.ts の注の最悪
        self.assertEqual(result.cron_rows, 10_345)
        self.assertEqual(result.total, 87_345)  # 注の 2026-10-28 の値

    def test_total_follows_the_policy_caps(self):
        policy = (REPO / POLICY_TS).read_text(encoding="utf-8")
        tenfold = re.sub(r"(cast_cargo: \{ cap: )3_000", r"\g<1>30_000", policy)
        self.assertNotEqual(policy, tenfold)
        budgets = parse_budgets(tenfold)
        ledger = (REPO / LEDGER_TS).read_text(encoding="utf-8")
        result = compute(
            budgets,
            read_schema(),
            cron_deleted_tables(ledger),
            parse_reports_to_hide(policy),
        )
        self.assertEqual(result.total, real_result().total + 27_000 * 3 + 27_000 * 3)


class Requirement(unittest.TestCase):
    def tree(self, policy_edit=None):
        root = Path(tempfile.mkdtemp())
        for rel in (POLICY_TS, LEDGER_TS):
            dst = root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            text = (REPO / rel).read_text(encoding="utf-8")
            if rel == POLICY_TS and policy_edit:
                text = policy_edit(text)
            dst.write_text(text, encoding="utf-8")
        mig = root / MIGRATIONS_DIR
        mig.mkdir(parents=True, exist_ok=True)
        for p in (REPO / MIGRATIONS_DIR).glob("*.sql"):
            (mig / p.name).write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        return root

    def test_requirement_is_ninety_percent_of_one_hundred_thousand(self):
        self.assertEqual(LIMIT_ROWS, 100_000)
        self.assertEqual(REQUIREMENT_PERCENT, 90)

    def test_over_the_requirement_exits_1_with_the_over_line(self):
        def before_m26_21(policy):
            for bucket, now, old in (
                ("cast_cargo", "3_000", "5_000"),
                ("report", "500", "1_000"),
                ("withdraw", "500", "1_000"),
            ):
                policy = policy.replace(
                    f"{bucket}: {{ cap: {now},", f"{bucket}: {{ cap: {old},"
                )
            return policy

        out = io.StringIO()
        code = run(self.tree(before_m26_21), out)
        text = out.getvalue()
        self.assertEqual(code, 1)
        self.assertRegex(text, r"超えた。105,679 > 90,000")
        self.assertIn("105.7%", text)
        for column in ("道", "上限", "1 件の行", "最悪の行"):
            self.assertIn(column, text)

    def test_todays_policy_is_within_the_requirement(self):
        out = io.StringIO()
        code = run(self.tree(), out)
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("87,345", out.getvalue())

    def test_within_the_requirement_exits_0(self):
        def small(policy):
            return re.sub(
                r"cap: [\d_]+",
                "cap: 100",
                re.sub(r"shedAt: [\d_]+", "shedAt: 1_000", policy),
            )

        out = io.StringIO()
        code = run(self.tree(small), out)
        self.assertEqual(code, 0, out.getvalue())
        self.assertNotIn("超えた", out.getvalue())


if __name__ == "__main__":
    unittest.main()
