# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""jitter.spec.ts の read-bg.png (文字を透明にして撮った画) と read-els.json から、要素ごとのコントラスト比を出す試し。

使い方: uv run tools/acceptance-probe/contrast.py <PROBE_OUT>
箱の中の背景の画素ごとに字を重ねた比を出し、悪い側の 10 パーセンタイルで並べる。
本番の検査は tests/e2e/lens.ts (計算は tests/e2e/lens/contrast.ts)。
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

Floats = NDArray[np.float64]
VIEW_W, VIEW_H = 1280, 720


def lin(c: Floats) -> Floats:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(rgb: Floats) -> Floats:
    c = lin(rgb)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def main(out: Path) -> None:
    bg = np.asarray(Image.open(out / "read-bg.png").convert("RGB")).astype(float) / 255
    els = json.loads((out / "read-els.json").read_text())
    rows: list[tuple[float, float, str, float, str, str, bool, bool]] = []
    for e in els:
        m = re.match(
            r"rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)", e["color"]
        )
        if m is None:
            continue
        fg = np.array([float(m.group(i)) for i in (1, 2, 3)]) / 255
        a = float(m.group(4) or 1) * e["opacity"]
        b = e["box"]
        x0, y0 = int(max(0, b["x"])), int(max(0, b["y"]))
        x1, y1 = int(min(VIEW_W, b["x"] + b["w"])), int(min(VIEW_H, b["y"] + b["h"]))
        if x1 <= x0 or y1 <= y0:
            continue
        px = bg[y0:y1, x0:x1].reshape(-1, 3)
        eff = fg * a + px * (1 - a)
        l1, l2 = lum(eff), lum(px)
        cr = (np.maximum(l1, l2) + 0.05) / (np.minimum(l1, l2) + 0.05)
        rows.append(
            (
                float(np.percentile(cr, 10)),
                e["fontSize"],
                e["fontWeight"],
                round(a, 2),
                e["text"],
                e["id"] or e["cls"],
                e["overflowX"],
                e["inView"],
            )
        )
    rows.sort()
    print("p10-contrast  px  wt  alpha  text | id/class | overflow inView")
    for r in rows[:18]:
        print(
            f"{r[0]:5.2f}  {r[1]:4.1f} {r[2]:>4} {r[3]:4}  {r[4]!r:32} {r[5]!s:28} {r[6]} {r[7]}"
        )
    print(
        "n=",
        len(rows),
        " below4.5:",
        sum(1 for r in rows if r[0] < 4.5),
        " below3:",
        sum(1 for r in rows if r[0] < 3),
        " min font:",
        min(r[1] for r in rows),
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
