"""M21-03 迎撃の塔の縮約モデル (LD docs/design/2026-10-28-level-design-intercept-2.md §4 の証跡。製品コードではない)。

年刻みの決定論モデル。係数は本体の trace (同じ dir の trace-*.tsv、seed 42 / size 64) から読んだ値:
- 星に届く年 25 (儀式・応えのどちらでも)。工事は年 WORKS = 0.36 を脈の池から積む (src/simulation/works.ts WORKS_RATE)
- 星に届いた年の池 POOL0 = 22.3 (儀式だけの trace で、池が尽きるまでに積んだ備蓄 13.28 + 撃った 9.0)
- 「星の砂を」は池が SAND_AT = 3.0 を切ると出る (trace: 儀式だけで 80 年目。半径 5 の比が 10% を切る年)
  出ている間は 6 年ごとに無視 → 信仰と上限 −0.1 (trace: 84, 90, 96, 102 ...)
- 信仰: 儀式あり = 上限に張り付く。応えだけ = 応えの年 (10, 11, 19, 36) に +0.15 (FAITH_ANSWER)、他は年 −0.0056 (trace 36→140 の傾き)
- 工事の門 0.6、勅令の門 0.6、内乱 = 信仰 < 0.3 が 3 年で段階 −1、信仰は min(0.4, 上限)
- 迎撃 = 備蓄 ≥ 3 で次の星を消す。消していない星が落ちた年に dead (trace: 放置は 60 年目に「絶滅: deer」)

rules:
- "now": 今の本体 (備蓄はいつでも積め、いつでも撃てる)
- "K1": 見える星。工事が備蓄に積めるのは次の星の着弾 W 年前から着弾まで。窓の外でも民は掘り (灯に焚く)、池は減る
- "K1+K3": K1 に、窓の間は民が星に怯え信仰が年 FEAR 下がるを足す
"""
from __future__ import annotations

import sys
from dataclasses import dataclass

STARS = (60, 100, 140)
YEARS = 150
STAR_YEAR = 25
WORKS = 0.36
NEED = 3.0
POOL0 = 22.3
SAND_AT = 3.0
SAND_EVERY = 6
GATE = 0.6
ANSWER_YEARS = {10: 0.15, 11: 0.15, 19: 0.15, 36: 0.15}
ANSWER_DECAY = 0.0056


@dataclass
class P:
    ritual: bool = False
    answer: bool = False
    # 勅令の台本: (年 or 条件, 'stop'/'resume') を返す関数
    edict: str = "none"


POLICIES = {
    "放置": P(),
    "応えだけ": P(answer=True),
    "儀式だけ": P(ritual=True),
    "止めよ無し(儀式+応え)": P(ritual=True, answer=True),
    "旧想定解(備蓄 9 で止めよ)": P(ritual=True, edict="stop9"),
    "止めよだけ(星で止め再開しない)": P(ritual=True, edict="stop_forever"),
    "想定解 1(窓で再開・撃てば止めよ)": P(ritual=True, edict="rhythm"),
    "想定解 2(二度目の後は止めない)": P(ritual=True, answer=True, edict="rhythm2"),
}


def run(rule: str, pol: P, W: int = 12, FEAR: float = 0.05, trace: bool = False):
    faith, cap, stage = 0.5, 1.0, 6
    pool, stock, shot, cancelled = POOL0, 0.0, 0, set()
    stopped = False
    low, sand_t = 0, 0
    rows = []
    for y in range(1, YEARS + 1):
        nxt = next((s for s in STARS if s not in cancelled and s >= y), None)
        window = nxt is not None and nxt - W <= y < nxt
        # 信仰
        if pol.ritual:
            faith = min(cap, faith + 0.03)
        elif pol.answer:
            faith += ANSWER_YEARS.get(y, 0.0) - ANSWER_DECAY
        else:
            faith -= 0.01
        if pol.answer and pol.ritual:
            faith = min(cap, faith + ANSWER_YEARS.get(y, 0.0))
        if rule == "K1+K3" and window and stage == 7:
            faith -= FEAR
        if stage == 6 and y >= STAR_YEAR and faith >= 0.8:
            stage = 7
        # 星の砂を
        if stage >= 6 and pool < SAND_AT:
            sand_t += 1
            if sand_t % SAND_EVERY == 0:
                cap -= 0.1
                faith -= 0.15
        faith = max(0.0, min(faith, cap))
        # 勅令 (門 0.6)
        if stage == 7 and faith >= GATE:
            if pol.edict == "stop9" and not stopped and stock >= 9:
                stopped = True
            if pol.edict == "stop_forever" and not stopped:
                stopped = True
            if pol.edict in ("rhythm", "rhythm2"):
                if not window and not stopped and (pol.edict == "rhythm" or shot < 2):
                    stopped = True
                if window and stopped:
                    stopped = False
        # 工事
        if stage == 7 and faith >= GATE and not stopped and pool > 0:
            m = min(WORKS, pool)
            pool -= m
            if rule == "now" or window:
                stock += m
        # 撃つ
        can_fire = stage == 7 and stock >= NEED and nxt is not None and (rule == "now" or window)
        if can_fire:
            stock -= NEED
            shot += 1
            cancelled.add(nxt)
        # 内乱
        low = low + 1 if faith < 0.3 else 0
        if low >= 3:
            stage -= 1
            faith = min(0.4, cap)
            low = 0
        # 落ちる星
        if y in STARS and y not in cancelled:
            rows.append((y, stage, faith, cap, stock, pool, shot))
            return "dead", y, f"{y} 年目の星が落ちた", rows
        if stage <= 0:
            return "dead", y, "文明の段階 0", rows
        if trace and (y % 10 == 0 or can_fire):
            rows.append((y, stage, faith, cap, stock, pool, shot))
    ok = shot >= 3 and stage >= 6
    return ("alive" if ok else "dead"), YEARS, f"砕いた {shot}、段階 {stage}", rows


def main() -> None:
    print("## 判定行列 (W=12, FEAR=0.05)")
    print("| 手 | now | K1 | K1+K3 |")
    print("|---|---|---|---|")
    for name, pol in POLICIES.items():
        cells = []
        for rule in ("now", "K1", "K1+K3"):
            st, y, why, _ = run(rule, pol)
            cells.append(f"{st} {y} ({why})")
        print(f"| {name} | " + " | ".join(cells) + " |")
    print()
    print("## 窓の幅 W の走査 (K1+K3)。想定解 1・2 が alive で、ほかが dead の幅")
    for W in (8, 9, 10, 11, 12, 14, 16, 20):
        res = {n: run("K1+K3", p, W=W)[0] for n, p in POLICIES.items()}
        good = all((res[n] == "alive") == n.startswith("想定解") for n in res)
        print(f"W={W:2d} {'成立' if good else '不成立'} " + " ".join(f"{n.split('(')[0]}={res[n]}" for n in res))
    print()
    print("## 恐れ FEAR の走査 (K1, W=12)")
    for F in (0.0, 0.02, 0.03, 0.05, 0.08, 0.1):
        res = {n: run("K1+K3", p, FEAR=F)[0] for n, p in POLICIES.items()}
        good = all((res[n] == "alive") == n.startswith("想定解") for n in res)
        print(f"FEAR={F:.2f} {'成立' if good else '不成立'} " + " ".join(f"{n.split('(')[0]}={res[n]}" for n in res))
    print()
    for name in ("想定解 1(窓で再開・撃てば止めよ)", "止めよ無し(儀式+応え)", "応えだけ"):
        print(f"## 年表 K1+K3: {name}")
        print("| 年 | 段階 | 信仰 | 上限 | 備蓄 | 池 | 砕いた |")
        print("|---|---|---|---|---|---|---|")
        for r in run("K1+K3", POLICIES[name], trace=True)[3]:
            print("| " + " | ".join([str(r[0]), str(r[1])] + [f"{v:.2f}" for v in r[2:6]] + [str(r[6])]) + " |")
        print()


if __name__ == "__main__":
    sys.exit(main())
