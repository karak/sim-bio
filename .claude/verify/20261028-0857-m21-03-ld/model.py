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

2026-10-28 追記 (LD §10「長さの走査」):
- 係数は型つきの表 Params に集めた。LEGACY は上の §5 の値 (引数なしの出力は model-output.txt と 1 字も違わない)。
  CALIBRATED は本体の信仰の式 (src/simulation/faith.ts updateFaith: 足し引きの後に ×(1 − FAITH_DECAY)) に合わせた版。
- 使い方 (どれも依存なし・決定論):
    python3 -I model.py              # §5 の出力 (= model-output.txt)
    python3 -I model.py calibrate    # 4 本の trace との突き合わせ (calibration-output.txt)
    python3 -I model.py sweep        # 長さと星の並びの走査 (sweep-output.txt・sweep.tsv を書く)
    python3 -I model.py check        # 回帰: 上の 3 つが置いてあるファイルと同じか
"""
from __future__ import annotations

import io
import math
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass, field, fields, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Params:
    """シナリオの形と係数の表。各欄の metadata に (出所, 何がこの値を縛るか, 確かめ方) を置く。"""

    years: int = field(default=150, metadata={"src": "scenarios.json intercept-tower years", "check": "走査で動かす"})
    stars: tuple[int, ...] = field(default=(60, 100, 140), metadata={"src": "scenarios.json schedule の meteor", "check": "走査で動かす"})
    window: int = field(default=12, metadata={"src": "K1 の窓 W (2026-10-28 ユーザーが 12 に決めた)", "check": "W±2 を走査"})
    fear: float = field(default=0.05, metadata={"src": "K3 の怯え (新規、窓の間の年あたり)", "check": "K3 あり/なしを走査"})
    star_year: int = field(default=25, metadata={"src": "trace 4 本とも 25 年目に段階 7 (備蓄 0.36 が 25 年目の行に出る)", "check": "calibrate の段階 7 の年"})
    star_faith: float = field(default=0.8, metadata={"src": "civilization.ts STAR_FAITH", "check": "応えだけの 24 年目の信仰 0.84 ≥ 0.8"})
    works: float = field(default=0.36, metadata={"src": "works.ts WORKS_RATE", "check": "trace の備蓄の傾き 0.36/年"})
    need: float = field(default=3.0, metadata={"src": "works.ts INTERCEPT_NEED", "check": "trace の撃った年に備蓄 −3"})
    pool0: float = field(default=22.3, metadata={"src": "儀式だけの trace: 尽きるまでに積んだ 13.28 + 撃った 9.0", "check": "calibrate の累計採掘"})
    sand_at: float = field(default=3.0, metadata={"src": "儀式だけの trace の「星の砂を」の初出", "check": "calibrate の初出年"})
    sand_every: int = field(default=6, metadata={"src": "trace: 84・90・96… に無視", "check": "calibrate の無視の年"})
    sand_faith: float = field(default=0.15, metadata={"src": "faith.ts FAITH_IGNORE", "check": "trace 84 年目 1.00 → 0.89"})
    sand_cap: float = field(default=0.1, metadata={"src": "faith.ts FAITH_CAP_IGNORE", "check": "trace の上限 0.1 刻み"})
    gate: float = field(default=0.6, metadata={"src": "works.ts WORKS_FAITH・edict.ts EDICT_FAITH", "check": "応えだけの工事が止まる年"})
    faith0: float = field(default=0.5, metadata={"src": "scenarios.json start.civilization.faith", "check": "trace 0 年目"})
    decay_law: str = field(default="linear", metadata={"src": "LEGACY=linear (§5)、CALIBRATED=mult (faith.ts ×(1−0.01))", "check": "calibrate"})
    decay_idle: float = field(default=0.01, metadata={"src": "linear のときの放置の減り", "check": "-"})
    decay_answer: float = field(default=0.0056, metadata={"src": "linear のときの応えだけの減り (trace 36→140 の傾き)", "check": "-"})
    decay_rate: float = field(default=0.01, metadata={"src": "faith.ts FAITH_DECAY (mult のとき)", "check": "放置の trace 0.5×0.99^y"})
    ritual_up: float = field(default=0.03, metadata={"src": "LEGACY 0.03、本体は faith.ts FAITH_UP 0.05 (2 年ごとの儀式で毎年かかる)", "check": "儀式の trace 5〜16 年目の傾き"})
    ritual_from: int = field(default=1, metadata={"src": "本体は 0・2・4 年目の 3 回で連続が成り、5 年目の行から上がる", "check": "儀式の trace 4→5 年目 0.48→0.52"})
    answer_bumps: tuple[tuple[int, float], ...] = field(
        default=((10, 0.15), (11, 0.15), (19, 0.15), (36, 0.15)),
        metadata={"src": "応えだけの trace の跳ねる年。19 年目は疫病が 10 年に 3 回で FAITH_UP +0.05 が重なる", "check": "trace 18→19 年目 0.69→0.88"},
    )
    unrest_faith: float = field(default=0.3, metadata={"src": "unrest.ts UNREST_FAITH", "check": "-"})
    unrest_years: int = field(default=3, metadata={"src": "unrest.ts UNREST_YEARS", "check": "-"})
    unrest_after: float = field(default=0.4, metadata={"src": "unrest.ts UNREST_FAITH_AFTER", "check": "-"})

    def bump(self, y: int) -> float:
        return dict(self.answer_bumps).get(y, 0.0)


LEGACY = Params()
CALIBRATED = replace(
    LEGACY,
    decay_law="mult",
    ritual_up=0.05,
    ritual_from=5,
    answer_bumps=((10, 0.15), (11, 0.15), (19, 0.20), (36, 0.15)),
)
# sand_at は 3.0 のまま: モデルは年の頭 (その年の工事の前) の池で見る。儀式だけで 79 年目の頭の池は 22.3 − 54 × 0.36 = 2.86 < 3.0、
# 78 年目の頭は 3.22 なので初出 79 年目・初の無視 84 年目で本体と合う (calibration-output.txt の「砂の初出」「無視の初」)

# §5 の旧来の名 (main の出力が変わらないように残す)
STARS = LEGACY.stars
YEARS = LEGACY.years
STAR_YEAR = LEGACY.star_year
WORKS = LEGACY.works
NEED = LEGACY.need
POOL0 = LEGACY.pool0
SAND_AT = LEGACY.sand_at
SAND_EVERY = LEGACY.sand_every
GATE = LEGACY.gate
ANSWER_YEARS = dict(LEGACY.answer_bumps)
ANSWER_DECAY = LEGACY.decay_answer


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


@dataclass
class Outcome:
    """1 回の通しの結末と余裕。margin の定義は LD §10.3。"""

    status: str
    year: int
    why: str
    rows: list
    years: list = field(default_factory=list)  # 毎年の (年, 段階, 信仰, 上限, 備蓄, 池, 砕いた)
    fires: list = field(default_factory=list)  # (星の年, 撃った年)
    stock_at_fall: float = 0.0  # 落ちた星の年の備蓄 (星で dead のとき)
    min_window_faith: float = 9.0  # 窓の間の信仰の最小 (段階 7 の年)
    sand_year: int | None = None


def faith_step(prm: Params, pol: P, faith: float, cap: float, y: int) -> float:
    """信仰の 1 年分 (怯え・星の砂を・クランプの前まで)。"""
    if prm.decay_law == "linear":
        if pol.ritual:
            faith = min(cap, faith + prm.ritual_up)
        elif pol.answer:
            faith += prm.bump(y) - prm.decay_answer
        else:
            faith -= prm.decay_idle
        if pol.answer and pol.ritual:
            faith = min(cap, faith + prm.bump(y))
        return faith
    # mult: faith.ts updateFaith と同じ順 (足し引き → ×(1 − decay))
    if pol.ritual and y >= prm.ritual_from:
        faith += prm.ritual_up
    if pol.answer:
        faith += prm.bump(y)
    return faith * (1 - prm.decay_rate)


def simulate(prm: Params, rule: str, pol: P, trace: bool = False) -> Outcome:
    faith, cap, stage = prm.faith0, 1.0, 6
    pool, stock, shot, cancelled = prm.pool0, 0.0, 0, set()
    stopped = False
    low, sand_t = 0, 0
    rows: list = []
    out = Outcome("running", 0, "", rows)
    for y in range(1, prm.years + 1):
        nxt = next((s for s in prm.stars if s not in cancelled and s >= y), None)
        window = nxt is not None and nxt - prm.window <= y < nxt
        # 信仰
        faith = faith_step(prm, pol, faith, cap, y)
        if rule == "K1+K3" and window and stage == 7:
            faith -= prm.fear
        if stage == 6 and y >= prm.star_year and faith >= prm.star_faith:
            stage = 7
        # 星の砂を
        if stage >= 6 and pool < prm.sand_at:
            if out.sand_year is None:
                out.sand_year = y
            sand_t += 1
            if sand_t % prm.sand_every == 0:
                cap -= prm.sand_cap
                faith -= prm.sand_faith
        faith = max(0.0, min(faith, cap))
        if window and stage == 7:
            out.min_window_faith = min(out.min_window_faith, faith)
        # 勅令 (門 0.6)
        if stage == 7 and faith >= prm.gate:
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
        if stage == 7 and faith >= prm.gate and not stopped and pool > 0:
            m = min(prm.works, pool)
            pool -= m
            if rule == "now" or window:
                stock += m
        # 撃つ
        can_fire = stage == 7 and stock >= prm.need and nxt is not None and (rule == "now" or window)
        if can_fire:
            stock -= prm.need
            shot += 1
            cancelled.add(nxt)
            out.fires.append((nxt, y))
        # 内乱
        low = low + 1 if faith < prm.unrest_faith else 0
        if low >= prm.unrest_years:
            stage -= 1
            faith = min(prm.unrest_after, cap)
            low = 0
        out.years.append((y, stage, faith, cap, stock, pool, shot))
        # 落ちる星
        if y in prm.stars and y not in cancelled:
            rows.append((y, stage, faith, cap, stock, pool, shot))
            out.status, out.year, out.why, out.stock_at_fall = "dead", y, f"{y} 年目の星が落ちた", stock
            return out
        if stage <= 0:
            out.status, out.year, out.why = "dead", y, "文明の段階 0"
            return out
        if trace and (y % 10 == 0 or can_fire):
            rows.append((y, stage, faith, cap, stock, pool, shot))
    ok = shot >= len(prm.stars) and stage >= 6
    out.status, out.year, out.why = ("alive" if ok else "dead"), prm.years, f"砕いた {shot}、段階 {stage}"
    return out


def run(rule: str, pol: P, W: int = 12, FEAR: float = 0.05, trace: bool = False, prm: Params = LEGACY):
    """§5 の旧来の呼び口。(状態, 年, 理由, 年表の行) を返す。"""
    o = simulate(replace(prm, window=W, fear=FEAR), rule, pol, trace)
    return o.status, o.year, o.why, o.rows


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


# ---------------------------------------------------------------- 校正 (本体の trace との突き合わせ)

TRACES = {
    # trace の名 → (モデルの手, 本体の結末)。結末は verdicts-*.tsv
    "idle": "放置",
    "answer-only": "応えだけ",
    "ritual-only": "儀式だけ",
    "ritual+stop9": "旧想定解(備蓄 9 で止めよ)",
}


def read_trace(name: str) -> list[dict]:
    lines = (HERE / f"trace-{name}.tsv").read_text(encoding="utf-8").splitlines()
    head = lines[0].split("\t")
    rows = []
    for ln in lines[1:]:
        r = dict(zip(head, ln.split("\t")))
        rows.append({
            "year": int(r["year"]), "stage": int(r["stage"]), "faith": float(r["faith"]), "cap": float(r["cap"]),
            "stock": float(r["stock"]), "shot": int(r["intercepted"]), "prayer": r["prayer"],
            "ignored": int(r["ignored"]), "stopped": int(r["mining_stopped"]),
        })
    return rows


def read_verdict(name: str) -> str:
    return (HERE / f"verdicts-{name}.tsv").read_text(encoding="utf-8").split("\t")[1]


def events_engine(rows: list[dict]) -> dict:
    """本体の trace から読む出来事の年。"""
    mined = [(r["year"], r["stock"] + 3 * r["shot"]) for r in rows]
    s7 = next((r["year"] for r in rows if r["stage"] == 7), None)
    last_mine = max((y for (y, m), (_, m0) in zip(mined[1:], mined[:-1]) if m > m0 + 1e-6), default=None)
    return {
        "段階 7": s7,
        "信仰<0.6": next((r["year"] for r in rows if s7 and r["year"] > s7 and r["faith"] < 0.595), None),
        "信仰<0.3": next((r["year"] for r in rows if r["year"] > 5 and r["faith"] < 0.295), None),
        "工事の最後": last_mine,
        "累計採掘": round(mined[-1][1], 2),
        "砂の初出": next((r["year"] for r in rows if r["prayer"] == "crystal"), None),
        "無視の初": next((r["year"] for r in rows if r["ignored"] > 0 and r["prayer"] != "wolves"), None),
        "結末": f"{'alive' if rows[-1]['year'] >= 149 and rows[-1]['shot'] >= 3 else 'dead'} {rows[-1]['year']}",
    }


def events_model(o: Outcome) -> dict:
    ys = o.years
    mined = [(y, s + 3 * sh) for (y, _st, _f, _c, s, _p, sh) in ys]
    s7 = next((y for (y, st, *_rest) in ys if st == 7), None)
    last_mine = max((y for (y, m), (_, m0) in zip(mined[1:], mined[:-1]) if m > m0 + 1e-6), default=None)
    ign = None
    for (y, _st, _f, c, *_r), (_, _st0, _f0, c0, *_r0) in zip(ys[1:], ys[:-1]):
        if c < c0 - 1e-9:
            ign = y
            break
    return {
        "段階 7": s7,
        "信仰<0.6": next((y for (y, st, f, *_r) in ys if s7 and y > s7 and f < 0.595), None),
        "信仰<0.3": next((y for (y, st, f, *_r) in ys if y > 5 and f < 0.295), None),
        "工事の最後": last_mine,
        "累計採掘": round(mined[-1][1], 2),
        "砂の初出": o.sand_year,
        "無視の初": ign,
        "結末": f"{o.status} {o.year}",
    }


def fit_errors(o: Outcome, rows: list[dict]) -> dict:
    """同じ年の行どうしの差。信仰は全年、累計採掘は全年、段階は段階 6 に揃う 16 年目から。"""
    eng = {r["year"]: r for r in rows}
    worst = {"faith": (0.0, None), "mined": (0.0, None), "stage": (0, None)}
    first_div = None
    for (y, st, f, _c, s, _p, sh) in o.years:
        e = eng.get(y)
        if e is None:
            continue
        df = abs(f - e["faith"])
        dm = abs((s + 3 * sh) - (e["stock"] + 3 * e["shot"]))
        ds = abs(st - e["stage"]) if y >= 16 else 0
        if df > worst["faith"][0]:
            worst["faith"] = (df, y)
        if dm > worst["mined"][0]:
            worst["mined"] = (dm, y)
        if ds > worst["stage"][0]:
            worst["stage"] = (ds, y)
        if first_div is None and (df > 0.05 or dm > 0.5):
            first_div = y
    return {**worst, "first": first_div}


def calibrate() -> None:
    print("# 校正: 縮約モデル × 本体の trace (rule=now、星 60・100・140、150 年)")
    print()
    print("差の定義: 同じ年の行で |信仰の差|・|累計採掘 (備蓄 + 3 × 砕いた) の差|・|段階の差 (16 年目から)| の最大と、その年。")
    print("「割れ始め」は |信仰の差| > 0.05 か |累計採掘の差| > 0.5 になった最初の年。")
    print("脈は trace の vein (半径の輝石の和、8.61 始まり) と池 (22.3 始まり) で量が違うので、累計採掘で比べる。")
    print()
    print("| trace | 版 | 結末 (本体 / モデル) | 信仰の差の最大 (年) | 累計採掘の差の最大 (年) | 段階の差の最大 (年) | 割れ始め |")
    print("|---|---|---|---|---|---|---|")
    for name, pol_name in TRACES.items():
        rows = read_trace(name)
        ev_e = events_engine(rows)
        for label, prm in (("LEGACY", LEGACY), ("CALIBRATED", CALIBRATED)):
            o = simulate(prm, "now", POLICIES[pol_name])
            err = fit_errors(o, rows)
            ev_m = events_model(o)
            print(
                f"| {name} | {label} | {read_verdict(name)} {ev_e['結末'].split()[1]} / {ev_m['結末']} | "
                f"{err['faith'][0]:.3f} ({err['faith'][1]}) | {err['mined'][0]:.2f} ({err['mined'][1]}) | "
                f"{err['stage'][0]} ({err['stage'][1]}) | {err['first']} |"
            )
    print()
    print("## 出来事の年 (本体 / LEGACY / CALIBRATED)")
    print()
    keys = ("段階 7", "信仰<0.6", "信仰<0.3", "工事の最後", "累計採掘", "砂の初出", "無視の初", "結末")
    print("| trace | " + " | ".join(keys) + " |")
    print("|---|" + "---|" * len(keys))
    for name, pol_name in TRACES.items():
        rows = read_trace(name)
        ev = [events_engine(rows)] + [events_model(simulate(p, "now", POLICIES[pol_name])) for p in (LEGACY, CALIBRATED)]
        print(f"| {name} | " + " | ".join(" / ".join(str(e[k]) for e in ev) for k in keys) + " |")
    print()
    print("## 応えだけの信仰 (本体 / LEGACY / CALIBRATED)。差の出所")
    print()
    print("| 年 | 本体 | LEGACY | CALIBRATED | 本体の備蓄 | LEGACY の備蓄 | CALIBRATED の備蓄 |")
    print("|---|---|---|---|---|---|---|")
    rows = {r["year"]: r for r in read_trace("answer-only")}
    oL = {r[0]: r for r in simulate(LEGACY, "now", POLICIES["応えだけ"]).years}
    oC = {r[0]: r for r in simulate(CALIBRATED, "now", POLICIES["応えだけ"]).years}
    for y in (9, 10, 11, 18, 19, 24, 25, 36, 50, 60, 70, 74, 76, 77, 80, 90, 100, 120, 140, 146, 149):
        e = rows[y]
        print(f"| {y} | {e['faith']:.2f} | {oL[y][2]:.2f} | {oC[y][2]:.2f} | {e['stock']:.2f} | {oL[y][4]:.2f} | {oC[y][4]:.2f} |")
    print()


# ---------------------------------------------------------------- 長さの走査

DEAD_ROWS = [n for n in POLICIES if not n.startswith("想定解")]
SOLUTIONS = [n for n in POLICIES if n.startswith("想定解")]


@dataclass(frozen=True)
class Layout:
    """星の並び。stars は着弾の年、years はシナリオの長さ (最後の星 + 尾)。"""

    stars: tuple[int, ...]
    years: int

    @property
    def label(self) -> str:
        return f"{len(self.stars)} 星 {'・'.join(map(str, self.stars))} / {self.years} 年"


def layouts() -> list[Layout]:
    """1〜3 星。初めの星 40〜70、間隔 30〜50、尾 5・10。長さ 45〜160。"""
    out = []
    for n in (1, 2, 3):
        for first in (40, 50, 60, 70):
            for gap in ((0,) if n == 1 else (30, 35, 40, 45, 50)):
                stars = tuple(first + i * gap for i in range(n))
                for tail in (5, 10):
                    L = stars[-1] + tail
                    if L <= 160:
                        out.append(Layout(stars, L))
    return out


@dataclass
class Cell:
    """1 つの (並び, 規則, 係数) での 8 行の結末と余裕。"""

    holds: bool
    results: dict
    alive_slack: float  # 想定解 2 つの min(着弾 − 撃った年 − 1) [年]。成り立たないとき nan
    alive_faith: float  # 想定解 2 つの窓の間の信仰の最小 − 門 0.6
    alive_pool: float  # 想定解 2 つの終わりの池の最小
    dead_margin: float  # dead の行で最も惜しいものの余裕 [年] (下の dead_margin_of)
    closest: str  # その行の名


def dead_margin_of(o: Outcome, prm: Params) -> float:
    """dead の行がどれだけ生き残りから遠いか [年]。
    星で落ちた: 足りなかった備蓄 ÷ 工事の速さ (あと何年掘れば撃てたか)。
    段階 0 で落ちた: 終わりまでの年数 (シナリオがもっと短ければ生きていた年数)。
    終わりで dead (砕いた数が足りない等): 0。alive なら −1 (行列は割れている)。"""
    if o.status == "alive":
        return -1.0
    if o.why.endswith("星が落ちた"):
        return (prm.need - o.stock_at_fall) / prm.works
    if o.why == "文明の段階 0":
        return float(prm.years - o.year)
    return 0.0


def cell(prm: Params, rule: str) -> Cell:
    res = {n: simulate(prm, rule, p) for n, p in POLICIES.items()}
    holds = all((res[n].status == "alive") == n.startswith("想定解") for n in res)
    sol = [res[n] for n in SOLUTIONS]
    if all(o.status == "alive" for o in sol):
        # 着弾の年に撃っても間に合わない (落ちる判定が先) ので、窓をあと何年縮めても撃てるか = 着弾 − 撃った年 − 1。§5 の「W 12 は 3 年の余裕」と同じ数え方
        slack = min(s - f - 1 for o in sol for (s, f) in o.fires)
        faith = min(o.min_window_faith for o in sol) - prm.gate
        pool = min(o.years[-1][5] for o in sol)
    else:
        slack, faith, pool = math.nan, math.nan, math.nan
    dm = {n: dead_margin_of(res[n], prm) for n in DEAD_ROWS}
    closest = min(dm, key=lambda n: dm[n])
    return Cell(holds, res, slack, faith, pool, dm[closest], closest)


SLACK_MIN = 2.0  # 想定解の余裕の下限 [年]: 撃てた年から着弾まで 2 年以上
DEAD_MIN = 2.0  # dead の行の余裕の下限 [年]: 最も惜しい dead でも 2 年分 (備蓄 0.72) 以上足りない


def with_margin(c: Cell) -> bool:
    return c.holds and c.alive_slack >= SLACK_MIN and c.dead_margin >= DEAD_MIN


def short(n: str) -> str:
    return n.split("(")[0]


def fmt(v: float) -> str:
    return "-" if math.isnan(v) else f"{v:.2f}"


def sweep() -> tuple[str, str]:
    buf = io.StringIO()
    tsv = ["layout\tstars\tyears\tcoef\trule\tW\tholds\twith_margin\talive_slack\talive_faith\talive_pool\tdead_margin\tclosest\t"
           + "\t".join(short(n) for n in POLICIES)]
    pr = lambda *a: print(*a, file=buf)  # noqa: E731

    def row(lay: Layout, label: str, prm: Params, rule: str) -> Cell:
        c = cell(prm, rule)
        tsv.append("\t".join([
            lay.label, "・".join(map(str, lay.stars)), str(lay.years), label, rule, str(prm.window),
            "1" if c.holds else "0", "1" if with_margin(c) else "0", fmt(c.alive_slack), fmt(c.alive_faith), fmt(c.alive_pool),
            f"{c.dead_margin:.2f}", short(c.closest),
        ] + [f"{c.results[n].status} {c.results[n].year}" for n in POLICIES]))
        return c

    pr("# 長さの走査 (M21-03 LD §10)。python3 -I model.py sweep が書く")
    pr()
    pr("行列が成り立つ = 想定解 1・2 が alive、ほかの 6 行が dead。")
    pr(f"余裕あり = 成り立ち、想定解の余裕 (着弾 − 撃った年 − 1 の最小。窓をあと何年縮めても撃てるか) ≥ {SLACK_MIN:g} 年、dead の行の余裕 (最も惜しい行) ≥ {DEAD_MIN:g} 年。")
    pr("dead の行の余裕: 星で落ちた行は (3.0 − 着弾の年の備蓄) ÷ 0.36 年、段階 0 で落ちた行は (長さ − 落ちた年)、終わりで dead は 0。")
    pr("主の係数は CALIBRATED、主の規則は K1 (W 12、K3 なし。ユーザーの決め 2026-10-28)。")
    pr()
    pr("## 1. 全部の並び (CALIBRATED、K1、W 12)")
    pr()
    pr("| 並び | 成立 | 余裕あり | 想定解の余裕 [年] | 窓の信仰 − 0.6 | 終わりの池 | dead の余裕 [年] (最も惜しい行) | 割れた行 |")
    pr("|---|---|---|---|---|---|---|---|")
    main_cells: dict[Layout, Cell] = {}
    for lay in layouts():
        prm = replace(CALIBRATED, stars=lay.stars, years=lay.years)
        c = row(lay, "CALIBRATED", prm, "K1")
        main_cells[lay] = c
        broken = [short(n) for n, o in c.results.items() if (o.status == "alive") != n.startswith("想定解")]
        pr(f"| {lay.label} | {'○' if c.holds else '×'} | {'○' if with_margin(c) else '-'} | {fmt(c.alive_slack)} | {fmt(c.alive_faith)} | "
           f"{fmt(c.alive_pool)} | {c.dead_margin:.2f} ({short(c.closest)}) | {'・'.join(broken) or '-'} |")
    pr()

    cands = [lay for lay, c in main_cells.items() if with_margin(c)]
    pr("## 2. 余裕ありの並びの頑健さ")
    pr()
    pr("各列は (係数, 規則, W) を変えた行列。○ = 余裕あり、△ = 成り立つが余裕が下限未満、× = 割れる。")
    pr("LEGACY は §5 の係数 (信仰の減りが線形) で、校正の差が結論を変えるかを見るための列。")
    pr("池 25・18・15 は脈の量を動かす係数の手 (crystalScale)。LD の方針で先に引かない手だが、走査の幅として置く。")
    pr("池 25 (+12%) は「本体の脈がモデルより多かったら dead の行が生き返るか」を見る列 (池の校正は 22.28 対 22.3 で合っているが、seed 違いの幅は測っていない)。")
    pr()
    variants = [
        ("CAL", CALIBRATED, "K1", 12), ("CAL", CALIBRATED, "K1", 10), ("CAL", CALIBRATED, "K1", 14),
        ("CAL", CALIBRATED, "K1+K3", 12), ("CAL", CALIBRATED, "K1+K3", 10), ("CAL", CALIBRATED, "K1+K3", 14),
        ("LEG", LEGACY, "K1", 12), ("LEG", LEGACY, "K1+K3", 12),
        ("CAL 池25", replace(CALIBRATED, pool0=25.0), "K1", 12), ("CAL 池18", replace(CALIBRATED, pool0=18.0), "K1", 12), ("CAL 池15", replace(CALIBRATED, pool0=15.0), "K1", 12),
    ]
    head = [f"{lab} {rule} W{w}" for (lab, _p, rule, w) in variants]
    pr("| 並び | " + " | ".join(head) + " | ○ の数 |")
    pr("|---|" + "---|" * (len(head) + 1))
    robust: dict[Layout, int] = {}
    for lay in cands:
        marks = []
        for (lab, base, rule, w) in variants:
            prm = replace(base, stars=lay.stars, years=lay.years, window=w)
            c = row(lay, lab, prm, rule)
            marks.append("○" if with_margin(c) else ("△" if c.holds else "×"))
        robust[lay] = marks.count("○")
        pr(f"| {lay.label} | " + " | ".join(marks) + f" | {robust[lay]} |")
    pr()

    pr("## 3. 星の数ごとのまとめ (CALIBRATED、K1、W 12)")
    pr()
    pr("| 星の数 | 並びの数 | 成立 | 余裕あり | 余裕ありの最短の長さ |")
    pr("|---|---|---|---|---|")
    for n in (1, 2, 3):
        ls = [lay for lay in main_cells if len(lay.stars) == n]
        ok = [lay for lay in ls if main_cells[lay].holds]
        okm = [lay for lay in ls if with_margin(main_cells[lay])]
        pr(f"| {n} | {len(ls)} | {len(ok)} | {len(okm)} | {min((l.years for l in okm), default='-')} |")
    pr()

    pr("## 4. 余裕ありの候補 (頑健さの ○ が多い順、同じなら短い順)")
    pr()
    pr("| 並び | 頑健さ (○ / 11) | 想定解の余裕 [年] | dead の余裕 [年] (最も惜しい行) | 終わりの池 |")
    pr("|---|---|---|---|---|")
    for lay in sorted(cands, key=lambda l: (-robust[l], l.years, l.stars)):
        c = main_cells[lay]
        pr(f"| {lay.label} | {robust[lay]} | {fmt(c.alive_slack)} | {c.dead_margin:.2f} ({short(c.closest)}) | {fmt(c.alive_pool)} |")
    pr()

    pr("## 5. 二つ目の星の年の閾 (CALIBRATED、K1、一つ目 60、尾 10)")
    pr()
    pr("見込み: 掘り続ける行 (儀式だけ・止めよ無し・旧想定解) は 25 + (22.3 − 3.0) ÷ 0.36 ≈ 79.6 年目の頭に池が 3 を切る。")
    pr("その後に開く窓では 3 を積めないので、二つ目の星 ≥ 79.6 + W (12) ≈ 92 で落ちるはず。応えだけは信仰が 77 年目に 0.6 を割る (本体の trace と同じ年) ので、")
    pr("窓の中で 0.6 以上の年が 9 年 (3 ÷ 0.36) より短くなる星 (一つ目の窓の残り 0.24 を足しても足りない年) から落ちる。表では 82 から。")
    pr()
    pr("| 二つ目の星 | 成立 | alive のまま残る dead の行 |")
    pr("|---|---|---|")
    for s2 in range(76, 101, 2):
        c = cell(replace(CALIBRATED, stars=(60, s2), years=s2 + 10), "K1")
        wrong = [short(n) for n, o in c.results.items() if (o.status == "alive") != n.startswith("想定解")]
        pr(f"| {s2} | {'○' if c.holds else '×'} | {'・'.join(wrong) or '-'} |")
    pr()
    return buf.getvalue(), "\n".join(tsv) + "\n"


# ---------------------------------------------------------------- 入口と回帰

def render(fn) -> str:
    buf = io.StringIO()
    with redirect_stdout(buf):
        fn()
    return buf.getvalue()


def write_all() -> None:
    (HERE / "calibration-output.txt").write_text(render(calibrate), encoding="utf-8")
    txt, tsv = sweep()
    (HERE / "sweep-output.txt").write_text(txt, encoding="utf-8")
    (HERE / "sweep.tsv").write_text(tsv, encoding="utf-8")


def check() -> int:
    """回帰: 引数なしの出力が model-output.txt と同じ、校正と走査の出力が置いてあるファイルと同じ、2 回回して同じ。"""
    fails = []
    if render(main) != (HERE / "model-output.txt").read_text(encoding="utf-8"):
        fails.append("main と model-output.txt が違う (§5 の既定値の回帰)")
    if render(calibrate) != (HERE / "calibration-output.txt").read_text(encoding="utf-8"):
        fails.append("calibrate と calibration-output.txt が違う")
    txt, tsv = sweep()
    if txt != (HERE / "sweep-output.txt").read_text(encoding="utf-8"):
        fails.append("sweep と sweep-output.txt が違う")
    if tsv != (HERE / "sweep.tsv").read_text(encoding="utf-8"):
        fails.append("sweep と sweep.tsv が違う")
    if sweep() != (txt, tsv):
        fails.append("sweep が決定論でない")
    # 表の欄が全部、出所を持つ (Explain the Number)
    for f in fields(Params):
        if not f.metadata.get("src"):
            fails.append(f"Params.{f.name} に出所が無い")
    for m in fails:
        print("NG", m)
    print("check:", "ok" if not fails else f"{len(fails)} 件の差")
    return 1 if fails else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "calibrate":
        calibrate()
    elif cmd == "sweep":
        write_all()
        print((HERE / "sweep-output.txt").read_text(encoding="utf-8"), end="")
    elif cmd == "check":
        sys.exit(check())
    else:
        sys.exit(main())
