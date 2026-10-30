"""M21-03 本体計測の trace を読み、LD §6 の 8 行と感度 3 行の表を出す (依存なし)。

使い方: python3 -I .claude/verify/20261029-0922-m21-03-impl/analyze.py <tag>   (tag は proto か impl)
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
ROWS = [
    ("idle", "放置", "dead"),
    ("answer-only", "応えだけ", "dead"),
    ("ritual-only", "儀式だけ", "dead"),
    ("no-edict", "止めよ無し", "dead"),
    ("old-solution-stop9", "旧想定解(備蓄 9 で止めよ)", "dead"),
    ("stop-only", "止めよだけ", "dead"),
    ("solution-1", "想定解 1", "alive"),
    ("solution-2", "想定解 2", "alive"),
]


def load(tag: str, name: str) -> list[dict[str, str]]:
    with (DIR / f"trace-{tag}-{name}.tsv").open() as f:
        return list(csv.DictReader(f, delimiter="\t"))


def first(rows: list[dict[str, str]], pred) -> str:
    for r in rows:
        if pred(r):
            return r["year"]
    return "-"


def main(tag: str) -> None:
    verdicts = {}
    for line in (DIR / f"verdicts-{tag}.tsv").read_text().splitlines():
        name, status, year, reason = line.split("\t", 3)
        verdicts[name] = (status, year, reason)
    print(f"## 8 行 ({tag})\n")
    print("| 行 | 期待 | 結末 | 年 | 理由 | 星に届く | 砕いた年 | 信仰 < 0.6 の初年 | 窓 2 (93〜104) の備蓄の最大 | 93 年目の脈 | 合 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    ok_all = True
    for name, label, expect in ROWS:
        rows = load(tag, name)
        status, year, reason = verdicts[name]
        star = first(rows, lambda r: r["stage"] == "7")
        shots = []
        prev = 0
        for r in rows:
            n = int(r["intercepted"])
            if n > prev:
                shots.append(r["year"])
            prev = n
        f06 = first(rows, lambda r: r["stage"] == "7" and float(r["faith"]) < 0.6)
        w2 = [float(r["stock"]) for r in rows if 93 <= int(r["year"]) <= 105]
        v93 = next((r["vein"] for r in rows if r["year"] == "93"), "-")
        ok = status == expect
        ok_all &= ok
        print(f"| {label} | {expect} | {status} | {year} | {reason} | {star} | {'・'.join(shots) or 'なし'} | {f06} | {max(w2) if w2 else '-'} | {v93} | {'○' if ok else '×'} |")
    print(f"\n行列: {'成立' if ok_all else '不成立'}\n")

    print("## 感度 3 行\n")
    # 感度 1: 窓の外の工事 (儀式だけ、星に届いてから一つ目の窓まで)
    rs = load(tag, "ritual-only")
    out = [(a, b) for a, b in zip(rs, rs[1:]) if a["stage"] == "7" and b["stage"] == "7" and a["visible"] == "0" and a["mining_stopped"] == "0" and float(a["faith"]) >= 0.6 and int(a["year"]) < 48]
    dv = [float(a["vein"]) - float(b["vein"]) for a, b in out]
    ds = [float(b["stock"]) - float(a["stock"]) for a, b in out]
    print(f"- 窓の外の工事 (儀式だけ、{out[0][0]['year']}〜{out[-1][0]['year']} 年): 脈の年の減り {min(dv):.3f}〜{max(dv):.3f}、備蓄の増え {min(ds):.3f}〜{max(ds):.3f}")
    # 感度 2: 窓の中の工事 (想定解 1、一つ目の窓)
    s1 = load(tag, "solution-1")
    win = [(a, b) for a, b in zip(s1, s1[1:]) if a["visible"] == "1" and a["mining_stopped"] == "0" and a["intercepted"] == b["intercepted"] and int(a["year"]) < 60]
    ds = [float(b["stock"]) - float(a["stock"]) for a, b in win]
    shot1 = first(s1, lambda r: r["intercepted"] == "1")
    open1 = first(s1, lambda r: r["visible"] == "1")
    dvw = [float(a["vein"]) - float(b["vein"]) for a, b in win]
    print(f"- 窓の中の工事 (想定解 1、一つ目の窓 {open1} 年から): 備蓄の年の増え {min(ds):.3f}〜{max(ds):.3f}、脈の年の減り {min(dvw):.3f}〜{max(dvw):.3f}、撃てた年 {shot1}(窓が開いて {int(shot1) - int(open1)} 年)")
    print("  (脈の列は採掘半径の陸の輝石の和で、工事が掘る脈 (霊脈の続きを含む miningPool) の一部しか見ない。窓の外と中で同じ減りなら同じ量を掘っている)")
    # 感度 3: 勅令 (想定解 1、窓の外で止めている間の脈と、窓で再開した後の工事)
    stopped = [(a, b) for a, b in zip(s1, s1[1:]) if a["visible"] == "0" and a["mining_stopped"] == "1" and a["stage"] == "7"]
    dv = [float(a["vein"]) - float(b["vein"]) for a, b in stopped]
    resumed = [a["year"] for a, b in zip(s1, s1[1:]) if a["mining_stopped"] == "1" and b["mining_stopped"] == "0"]
    print(f"- 勅令 (想定解 1): 窓の外で止めている年の脈の減り {min(dv):.4f}〜{max(dv):.4f}({len(stopped)} 年)。再開せよが効いた年の前年 {'・'.join(resumed)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "proto")
