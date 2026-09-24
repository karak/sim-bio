---
id: M23-09
title: 小屋の遠距離版をつなぐ
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-02]
evidence: []
---

# 小屋の遠距離版をつなぐ

## What to build

集落の建物の作り直し(M22-06 の残り、2026-09-24)で小屋は 1 棟 10,178 三角形になった(前は 1,934)。settlement.glb には遠距離版 `hut_lod1`(766 三角形、前の小屋の形)があるが、ゲームにはつないでいない。
lodProps で距離(30〜40 m)により差し替え、影は遠距離版で描く。灯籠・炉の光だまりは近い段と同じ位置に出す。

別の worktree で進め、終わったら feat/m21 へ取り込む。

## Blocked by

M23-02

## Acceptance criteria

- [ ] 集落の画(引き)で小屋の三角形が 3 分の 1 以下
- [ ] 切り替わりが目立たない(カメラを寄せ引きした比較画)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
