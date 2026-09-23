"""地面の植生 (flora) の観察画面用アセット → assets/models/observe/flora.glb

ノード: grass_tuft (草の房、≤40 三角形、GPU インスタンス用) / moongrass_tuft (月草、細く淡い銀緑、≤40) /
moss_clump (胞子苔の塊、≤120、胞子の粒が淡く光る) / rock (苔の乗った石、≤200)。
形は assets/textures/board/sheets/flora.png、画風は creatures/ に寄せる (太めの葉・柔らかい量感)。
草の葉は両面の材質 (doubleSided)。頂点色で根元を暗く、先を明るく暖かくする (風の揺れは Three.js の頂点シェーダで高さに比例させる)。

実行: blender -b --factory-startup --python tools/blender/observe_flora.py
"""
import math
import os
import random
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Z  # noqa: E402

K.reset()

M = {
    "grass": K.material("flora_grass", "#86A84C", rough=0.9, double=True),
    "moongrass": K.material("flora_moongrass", "#BCD0B4", rough=0.8, double=True),
    "moss": K.material("flora_moss", "#88A83F", rough=0.95),
    "spore": K.material("flora_spore", "#E9F5A6", rough=0.6, emit="#DDF28A", strength=1.5),
    "rock": K.material("flora_rock", "#9C9A8D", rough=0.95),
}


def blade_shade(height, lo=0.5, warm=0.12):
    def f(co, n):
        t = min(1.0, max(0.0, co.z / height))
        v = lo + (1 - lo) * t ** 0.8
        return (v, v, max(0.0, v - warm * t))
    return f


def tuft(name, mat, blades, height, width, spread, bend, seed, lo=0.5, warm=0.12):
    n = K.Node(name)
    rnd = random.Random(seed)
    for i in range(blades):
        a = 2 * math.pi * (i + rnd.uniform(-0.25, 0.25)) / blades
        d = Vector((math.cos(a), math.sin(a), 0))
        base = d * rnd.uniform(0.2, 1.0) * spread
        h = height * rnd.uniform(0.7, 1.0)
        n.add(K.blade(base, d, h, width * rnd.uniform(0.85, 1.15), bend * rnd.uniform(0.6, 1.3), segs=2,
                      twist=rnd.uniform(-0.6, 0.6)),
              M[mat], smooth=True, recalc=False, shade=blade_shade(height, lo, warm), soft=((0, 0, -height), 0.5))
    return n


def grass_tuft():
    return tuft("grass_tuft", "grass", blades=8, height=0.45, width=0.1, spread=0.1, bend=0.55, seed=1)


def moongrass_tuft():
    return tuft("moongrass_tuft", "moongrass", blades=8, height=0.72, width=0.05, spread=0.06, bend=0.3, seed=2,
                lo=0.62, warm=0.04)


def moss_clump():
    n = K.Node("moss_clump")
    n.add(K.ico((0.34, 0.3, 0.15), subdiv=1, jitter=0.28, seed=3, flat_bottom=0.9), M["moss"], smooth=True,
          shade=K.shade_height(0.0, 0.12, 0.65, 1.0), soft=((0, 0, -0.3), 0.5))
    rnd = random.Random(4)
    for i in range(4):
        a = 2 * math.pi * i / 4 + rnd.uniform(-0.4, 0.4)
        d = Vector((math.cos(a), math.sin(a), 0))
        base = d * rnd.uniform(0.05, 0.2) + Z * 0.08
        h = rnd.uniform(0.1, 0.16)
        n.add(K.blade(base, d, h, 0.012, 0.3, segs=0), M["moss"], recalc=False, shade=K.shade_const(0.8))
        tip = base + Z * (h * (1 - 0.35 * 0.3)) + d * (0.3 * h)
        n.add(K.lathe([(0.0, 0.022), (0.02, 0.0), (0.0, -0.018)], n=4), M["spore"], matrix=K.trs(tip), smooth=True)
    return n


def rock():
    n = K.Node("rock")
    rnd = random.Random(5)
    moss = lambda c, nrm: M["moss"] if nrm.z > 0.72 and c.z > 0.2 else None  # noqa: E731
    n.add(K.ico((0.55, 0.42, 0.34), subdiv=1, jitter=0.1, seed=6, flat_bottom=0.6), M["rock"],
          matrix=K.trs((0, 0, 0.16), (0, 0, 10)), smooth=False, shade=K.shade_height(0.0, 0.4, 0.7, 1.0),
          per_face_mat=moss)
    n.add(K.ico((0.26, 0.22, 0.17), subdiv=1, jitter=0.18, seed=7, flat_bottom=0.6), M["rock"],
          matrix=K.trs((0.5, -0.2, 0.07), (0, 0, rnd.uniform(0, 360))), smooth=False,
          shade=K.shade_height(0.0, 0.25, 0.7, 0.95))
    return n


if __name__ == "__main__":
    nodes = [grass_tuft(), moongrass_tuft(), moss_clump(), rock()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "flora.glb"))
