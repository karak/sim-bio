---
id: M26-06
title: settlement.glb を main の 90b2031 (石垣の苔を薄く) の script から作り直して量子化する
status: review
milestone: M26
plan: null
depends_on: [M23-10]
evidence: ["14ff228 assets/models/observe/settlement.glb scripts/glb_compare.py", ".claude/localreview/m26-06-20261004-1237 (前後の画、未コミット)"]
---

# settlement.glb を作り直す

優先度: Should

## What to build

main を feat/m19 に取り込んだ merge (e7b0b88) で、`tools/blender/observe_settlement.py` には main の 90b2031 (集落の磨き上げ 2: L 字の石垣の苔を薄くし細かい斑に) が入ったが、`assets/models/observe/settlement.glb` は feat/m19 の版 (M23-10 の量子化、苔の変更なし) を残した。script と glb を合わせる。

やること:
1. `blender --background --python tools/blender/observe_settlement.py` (引数は script の docstring) で glb を出し、`tools/blender/glb_quantize.py` で M23-10 と同じ量子化を掛ける
2. 三角形の数・部品・`_lod1` の有無が M23-10 の作業ログの数字と合うことを確かめる (`tests/unit` に glb の構造を見る試験があれば通す)
3. 観察画面の集落の画を `pnpm run shots` で撮り、`pnpm run judge` の OBS-002 (3 票) が通る。前後の画を `.claude/localreview/` の回に出す (承認はユーザー待ち。共有ファイルは変えない)
4. 動物 3 種・他の部品は触らない

## Blocked by

- なし

## Acceptance criteria

- [x] glb が script から作り直され、量子化後の大きさと三角形の数が作業ログにある
- [x] OBS-002 の judge が通り、前後の画が回に出ている
- [x] `pnpm run check` と observe の E2E が通る

## 作業ログ

- 2026-10-04: 起票 (main の merge で glb の衝突を feat/m19 側で解いたため)。
- 2026-10-04: 作り直した (Blender 5.2.2、`tools/blender/observe_settlement.py`)。
  - 量子化の前を 2 回書き出して md5 が一致 (044bd52fc7cffe64cdde4c473ec1dcd5、4,419,896 バイト)。量子化 (glb_quantize.py) 後は 2,941,436 バイトで、前の glb と同じ。もう一度通しても同じ (idempotent)。
  - md5: 前 (feat/m19) 4fe6ac95044dbd7d674483f8173dc0ce → 後 6379cdcad9ac737595814cd10fd50443。
  - `scripts/glb_compare.py` (前後の三角形・POSITION・index・COLOR_0・材質): 三角形は全 primitive で同じ (合計 67,555)、節点名は同じ、`_lod1` は 7 つ。POSITION・index・材質は全部同じで、COLOR_0 が違うのは stone_wall_corner/0 と stone_wall_corner_lod1/0 だけ (意図どおり)。読み手の agent が glb のバイト差も確かめ、違うのは この 2 つの COLOR_0 の bufferView だけ (22,097 バイト)。
  - gltf-validator (npm、リポジトリの外に入れて実行): errors 0 / warnings 0 / infos 0 / hints 0。
  - OBS-002 を撮り直して `pnpm run judge`: OBS-002/2・/3・/4 とも全問 3 票 yes で合格 (9 回の claude -p、換算 0.220 USD、26 秒)。
  - 前後の画: `.claude/localreview/m26-06-20261004-1237/` (集落・群れ・海岸、前後)。集落 (OBS-002-1) と群れ (-2) の画は前後で同じ画素 (md5 一致、L 字の石垣が写っていない)。海岸 (-3) だけ変わる。承認はユーザー待ち。
  - feat/m19 を取り込み後: `pnpm run check` 通過 (vitest 1244 通過)、E2E observe.spec.ts + observeEntry.spec.ts 7 通過、shots.spec.ts -g OBS-002 通過。
