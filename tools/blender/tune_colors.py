#!/usr/bin/env python3
"""材質色の補正ループ: 参照画像とパーツ別平均色の ΔE76 が全パーツで閾値未満になるまで回す。

使い方:
  python3 tools/blender/tune_colors.py [--creature rabbit|deer|wolf] [--target 1.0] [--max-iter 10] [--out <dir>]

各反復:
  1. tools/blender/<creature>.py でモデルを再ビルド (<creature>-colors.json の色を使う)
  2. compare_ref.py で参照 (assets/textures/concept/<creature>-angular.png) と同アングル撮影し
     parts.<p>.color の ref_mean_rgb / model_mean_rgb を得る
  3. 各パーツの材質色 (リニア RGB) に ref/model の比を掛けて <creature>-colors.json を更新
     (1 クラスに複数材質があるとき、例: rabbit の glow = glow + teal、は同じ比を両方に掛ける。
      対応は creature_parts.py の class_materials)
証跡 (compare.png, metrics.json, history.json) は --out に出る。採用時は docs/design/qa/<creature>-*.{png,json} へコピーする。
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creature_parts import CREATURES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUN = os.path.expanduser("~/.claude/skills/blender/scripts/run_blender.sh")


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_lin(h):
    h = h.lstrip("#")
    return [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def lin_to_hex(rgb):
    return "#" + "".join(f"{int(round(linear_to_srgb(c) * 255)):02X}" for c in rgb)


def run(args):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f"failed: {' '.join(args)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--creature", default="rabbit", choices=sorted(CREATURES))
    ap.add_argument("--target", type=float, default=1.0)
    ap.add_argument("--max-iter", type=int, default=10)
    ap.add_argument("--out", default=None)
    ap.add_argument("--az", default="45")
    ap.add_argument("--el", default="10")
    a = ap.parse_args()
    cfg = CREATURES[a.creature]
    class_materials = cfg["class_materials"]
    colors_path = os.path.join(ROOT, "tools", "blender", f"{a.creature}-colors.json")
    build_script = f"tools/blender/{a.creature}.py"
    blend = f"assets/models/{a.creature}.blend"
    ref_png = f"assets/textures/concept/{a.creature}-angular.png"
    out = a.out or os.path.join(ROOT, "docs", "design", "qa", f"tune-{a.creature}")
    os.makedirs(out, exist_ok=True)
    if not os.path.exists(os.path.join(ROOT, build_script)):
        raise SystemExit(f"{build_script} がありません (モデル生成スクリプトを先に作ってください)")

    colors = dict(cfg["base_colors"])
    if os.path.exists(colors_path):
        colors.update(json.load(open(colors_path)))

    history = []
    for it in range(a.max_iter + 1):
        json.dump(colors, open(colors_path, "w"), indent=2)
        run([RUN, build_script, "--", "assets/models"])
        run([RUN, "tools/blender/compare_ref.py", "--", blend, ref_png, out, a.az, a.el, f"creature={a.creature}"])
        m = json.load(open(os.path.join(out, "metrics.json")))
        des = {p: m["parts"][p]["color"]["delta_e76"] for p in class_materials}
        history.append({"iter": it, "colors": dict(colors), "delta_e76": des})
        print(f"iter {it}: " + "  ".join(f"{p} dE={d:.2f}" for p, d in des.items()) + "  colors=" + json.dumps(colors))
        if all(d < a.target for d in des.values()):
            print("converged")
            break
        if it == a.max_iter:
            print("max iterations reached (not converged)")
            break
        # 補正: リニア空間で ref/model の比を材質色に掛ける (ゼロ割り回避のため下限 1/255)
        for p, mats in class_materials.items():
            ref = [srgb_to_linear(max(c, 1) / 255) for c in m["parts"][p]["color"]["ref_mean_rgb"]]
            mod = [srgb_to_linear(max(c, 1) / 255) for c in m["parts"][p]["color"]["model_mean_rgb"]]
            for mat in mats:
                lin = hex_to_lin(colors[mat])
                colors[mat] = lin_to_hex([l * r / mo for l, r, mo in zip(lin, ref, mod)])

    json.dump(history, open(os.path.join(out, "history.json"), "w"), indent=2, ensure_ascii=False)
    return 0 if all(d < a.target for d in history[-1]["delta_e76"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
