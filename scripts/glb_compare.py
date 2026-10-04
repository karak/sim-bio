# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""2 つの .glb の構造を比べる (M26-06)。節点・primitive ごとの三角形数、POSITION と index の中身の一致、COLOR_0 の差を出す。

    uv run scripts/glb_compare.py <old.glb> <new.glb>
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read(path):
    b = Path(path).read_bytes()
    jl = struct.unpack_from("<I", b, 12)[0]
    doc = json.loads(b[20:20 + jl])
    off = 20 + jl + 8
    return doc, b[off:], len(b)


def accessor_bytes(doc, bin_, idx):
    a = doc["accessors"][idx]
    bv = doc["bufferViews"][a["bufferView"]]
    el = SIZE[a["componentType"]] * WIDTH[a["type"]]
    stride = bv.get("byteStride", el)
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return b"".join(bin_[start + i * stride:start + i * stride + el] for i in range(a["count"])), a


def summary(path):
    doc, bin_, size = read(path)
    rows = {}
    for n in doc["nodes"]:
        if "mesh" not in n:
            continue
        for pi, p in enumerate(doc["meshes"][n["mesh"]]["primitives"]):
            pos, _ = accessor_bytes(doc, bin_, p["attributes"]["POSITION"])
            ind, ia = accessor_bytes(doc, bin_, p["indices"])
            col = accessor_bytes(doc, bin_, p["attributes"]["COLOR_0"])[0] if "COLOR_0" in p["attributes"] else b""
            rows[(n["name"], pi)] = (ia["count"] // 3, hashlib.md5(pos).hexdigest(), hashlib.md5(ind).hexdigest(),
                                     hashlib.md5(col).hexdigest(), p.get("material"))
    return rows, size, [n["name"] for n in doc["nodes"]]


def main(old, new):
    (a, sa, na), (b, sb, nb) = summary(old), summary(new)
    print(f"size old {sa} new {sb}")
    print("node names equal:", na == nb, "| _lod1 nodes:", sum(n.endswith("_lod1") for n in nb))
    print(f"{'node/prim':40} {'tri old':>8} {'tri new':>8} pos idx color")
    for k in sorted(set(a) | set(b)):
        x, y = a.get(k), b.get(k)
        if not x or not y:
            print(f"{k[0]}/{k[1]:40} missing in {'old' if not x else 'new'}")
            continue
        print(f"{k[0] + '/' + str(k[1]):40} {x[0]:8} {y[0]:8} {'=' if x[1] == y[1] else 'DIFF'} {'=' if x[2] == y[2] else 'DIFF'} "
              f"{'=' if x[3] == y[3] else 'DIFF'}{' mat DIFF' if x[4] != y[4] else ''}")
    print("total tri old", sum(v[0] for v in a.values()), "new", sum(v[0] for v in b.values()))


main(*sys.argv[1:3])
