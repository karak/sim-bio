# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""pnpm run shots を 2 回撮った shots/ のフォルダ 2 つを、同じ名の画どうしで比べる試し。

使い方: uv run tools/acceptance-probe/cmp2.py <1 回目の shots/> <2 回目の shots/>
差のある画素の割合・最大の差・差の外接箱を画ごとに出す。
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image


def main(a: Path, b: Path) -> None:
    for f in sorted(p.name for p in a.iterdir()):
        img_a = np.asarray(Image.open(a / f).convert("RGB")).astype(int)
        img_b = np.asarray(Image.open(b / f).convert("RGB")).astype(int)
        d = np.abs(img_a - img_b).max(axis=2)
        ys, xs = np.nonzero(d)
        bbox = f"x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}" if len(xs) else "-"
        print(
            f"{f:14s} diff>0 {100 * (d > 0).mean():6.3f}%  diff>32 {100 * (d > 32).mean():6.3f}%  max {d.max():3d}  bbox {bbox}"
        )


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
