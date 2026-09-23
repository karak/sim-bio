---
id: M23-02
title: インスタンスごとの視錐台カリング
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-01]
evidence: []
---

# インスタンスごとの視錐台カリング

## What to build

three.js の InstancedMesh は丸ごとでしか視錐台で落とさないので、区域の全インスタンスを毎フレーム描いている(集落の画で草 512 千のうち画面の中は 105 千)。草と下草は区画に分けた InstancedMesh にするか、見える分だけを毎フレーム(または数フレームおきに)詰め直す。鐘樹・森の木は lodProps の振り分けに視錐台の判定を足す。群れ(VAT)は frustumCulled = false をやめ、見える個体だけ書く。どの方式にするかは draw call と CPU の時間を測って決める。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-01

## Acceptance criteria

- [ ] 集落の画の本の描画の三角形が試算(−740 千)の 8 割以上減る(M23-01 の台)
- [ ] draw call が予算 200 以内
- [ ] 画面の端でものが消える・遅れて現れることがない(カメラを振る E2E か目視の記録)
- [ ] 影は今までどおり(影のカメラの範囲のものは影を落とす)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
