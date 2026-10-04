---
id: M26-06
title: settlement.glb を main の 90b2031 (石垣の苔を薄く) の script から作り直して量子化する
status: open
milestone: M26
plan: null
depends_on: [M23-10]
evidence: []
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

- [ ] glb が script から作り直され、量子化後の大きさと三角形の数が作業ログにある
- [ ] OBS-002 の judge が通り、前後の画が回に出ている
- [ ] `pnpm run check` と observe の E2E が通る

## 作業ログ

- 2026-10-04: 起票 (main の merge で glb の衝突を feat/m19 側で解いたため)。
