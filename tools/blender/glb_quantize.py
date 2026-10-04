"""(M23-10) 書き出した .glb の法線と頂点色を小さい型に詰め直す (Blender の glTF の書き出しには量子化の設定が無いため)。

- NORMAL: float × 3 (12 バイト) → 正規化した int8 × 3 と詰め物 1 (4 バイト、KHR_mesh_quantization)。角度の誤差は 0.5° 以内
- COLOR_0: 正規化した uint16 × 4 (8 バイト) → 正規化した uint8 × 4 (4 バイト、glTF の本体で使える型)。値は linear のまま

POSITION・index・画像はそのまま写す。bpy に依らない (Blender の外でも走る)。
実行: python3 tools/blender/glb_quantize.py <path.glb>  (その場で書き換える)
"""
import json
import os
import struct
import sys
from pathlib import Path

FLOAT, UBYTE, BYTE, USHORT = 5126, 5121, 5120, 5123
SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
EXT = "KHR_mesh_quantization"


def read_glb(path):
    b = Path(path).read_bytes()
    magic, version, _ = struct.unpack_from("<III", b, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(f"{path}: glb 2.0 ではない")
    jlen, jtype = struct.unpack_from("<II", b, 12)
    off = 20 + jlen
    blen, btype = struct.unpack_from("<II", b, off)
    if jtype != 0x4E4F534A or btype != 0x004E4942:
        raise ValueError(f"{path}: JSON と BIN の 2 つの塊ではない")
    doc = json.loads(b[20:20 + jlen])
    return doc, b[off + 8:off + 8 + blen]


def write_glb(path, doc, bin_):
    j = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    j += b" " * (-len(j) % 4)
    bin_ += b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(j) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(j), 0x4E4F534A) + j)
        f.write(struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def elements(doc, bin_, acc):
    """accessor の要素を (tuple, ...) で読む (byteStride を守る)"""
    view = doc["bufferViews"][acc["bufferView"]]
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}[acc["componentType"]]
    n = WIDTH[acc["type"]]
    item = SIZE[acc["componentType"]] * n
    stride = view.get("byteStride", item)
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [struct.unpack_from(f"<{n}{fmt}", bin_, base + i * stride) for i in range(acc["count"])]


def raw(doc, bin_, acc):
    """accessor のバイトと byteStride (間隔は元のまま。詰め直した形をもう一度通しても同じになる)"""
    view = doc["bufferViews"][acc["bufferView"]]
    item = SIZE[acc["componentType"]] * WIDTH[acc["type"]]
    stride = view.get("byteStride")
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    end = min(base + (stride or item) * acc["count"], view.get("byteOffset", 0) + view["byteLength"])
    return bin_[base:end], stride


def snorm8(v):
    return max(-127, min(127, round(v * 127)))


def quantize_doc(doc, bin_):
    """(新しい doc, 新しい BIN) を返す。accessor ごとに bufferView を 1 つずつ作り直す"""
    kind = {}
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            for name, ai in prim["attributes"].items():
                kind[ai] = name
    out = bytearray()
    views = []

    def push(data, target=None, stride=None):
        out.extend(b"\0" * (-len(out) % 4))
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        if stride:
            v["byteStride"] = stride
        if target:
            v["target"] = target
        out.extend(data)
        views.append(v)
        return len(views) - 1

    accessors = []
    for i, acc in enumerate(doc["accessors"]):
        acc = dict(acc)
        if "bufferView" not in acc or "sparse" in acc:
            raise ValueError("bufferView の無い accessor・sparse は扱わない")
        view = doc["bufferViews"][acc["bufferView"]]
        target = view.get("target")
        name = kind.get(i)
        if name == "NORMAL" and acc["componentType"] == FLOAT:
            data = b"".join(struct.pack("<3bx", *(snorm8(c) for c in e)) for e in elements(doc, bin_, acc))
            acc.update(componentType=BYTE, normalized=True, bufferView=push(data, target, 4))
            acc.pop("min", None)
            acc.pop("max", None)
        elif name == "COLOR_0" and acc["componentType"] in (USHORT, FLOAT) and acc["type"] == "VEC4":
            scale = 1 / 65535 if acc["componentType"] == USHORT else 1.0
            data = b"".join(struct.pack("<4B", *(max(0, min(255, round(c * scale * 255))) for c in e))
                            for e in elements(doc, bin_, acc))
            acc.update(componentType=UBYTE, normalized=True, bufferView=push(data, target))
            acc.pop("min", None)
            acc.pop("max", None)
        else:
            data, stride = raw(doc, bin_, acc)
            acc["bufferView"] = push(data, target, stride)
        acc.pop("byteOffset", None)
        accessors.append(acc)
    # accessor に使われない bufferView (画像など) はそのまま写す
    used = {a["bufferView"] for a in doc["accessors"]}
    remap = {}
    for vi, view in enumerate(doc["bufferViews"]):
        if vi not in used:
            base = view.get("byteOffset", 0)
            remap[vi] = push(bin_[base:base + view["byteLength"]], view.get("target"), view.get("byteStride"))
    doc = dict(doc, accessors=accessors, bufferViews=views)
    for img in doc.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = remap[img["bufferView"]]
    doc["buffers"] = [{"byteLength": len(out)}]
    for key in ("extensionsUsed", "extensionsRequired"):
        doc[key] = sorted(set(doc.get(key, [])) | {EXT})
    return doc, bytes(out)


def quantize(path):
    doc, bin_ = read_glb(path)
    before = os.path.getsize(path)
    doc, bin_ = quantize_doc(doc, bin_)
    write_glb(path, doc, bin_)
    after = os.path.getsize(path)
    print(f"quantized {path}: {before} → {after} bytes")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        quantize(p)
