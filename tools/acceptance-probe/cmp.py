# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""jitter.spec.ts が同じページで撮った画どうしの差を数える試し (画の揺れの測り)。

使い方: uv run tools/acceptance-probe/cmp.py <PROBE_OUT>
"""

import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

PAIRS = [
    ("free-r1-a.png", "free-r1-b.png"),
    ("free-r1-a.png", "free-r2-a.png"),
    ("dialog-r1.png", "dialog-r2.png"),
    ("pin-no-preference-r1-a.png", "pin-no-preference-r1-b.png"),
    ("pin-no-preference-r1-a.png", "pin-no-preference-r2-a.png"),
    ("pin-reduce-r1-a.png", "pin-reduce-r1-b.png"),
    ("pin-reduce-r1-a.png", "pin-reduce-r2-a.png"),
    ("pin-reduce-r1-a.png", "pin-no-preference-r1-a.png"),
]


def load(out: Path, name: str) -> NDArray[np.int_]:
    return np.asarray(Image.open(out / name).convert("RGB")).astype(int)


def cmp(out: Path, a: str, b: str) -> str:
    img_a, img_b = load(out, a), load(out, b)
    if img_a.shape != img_b.shape:
        return f"{a} vs {b}: shape {img_a.shape} {img_b.shape}"
    d = np.abs(img_a - img_b).max(axis=2)
    n = d.size
    return (
        f"{a:28s} vs {b:28s}: diff>0 {100 * (d > 0).sum() / n:6.3f}%  "
        f"diff>16 {100 * (d > 16).sum() / n:6.3f}%  max {d.max():3d}  pixels>0 {(d > 0).sum()}"
    )


if __name__ == "__main__":
    out = Path(sys.argv[1])
    for a, b in PAIRS:
        print(cmp(out, a, b))
