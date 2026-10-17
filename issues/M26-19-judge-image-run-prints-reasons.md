---
id: M26-19
title: judge の --image の回も、no と失敗の票の根拠を標準出力に出す (記録に書かない回で原因を追えるように)
status: todo
milestone: M26
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M26-18]
evidence: []
---

# --image の回の票の根拠を見えるようにする

優先度: Could (小。道具の使い勝手)

## What to build

`scripts/judge.py` は `--image` で画を替えた回を results.json にも judge.json にも書かない (M25-12 の決め)。そのため、票が no や失敗 (error) のとき、何を根拠に落ちたかが標準出力のどこにも出ず、次の手 (問いの直し・切り抜き) を決める材料が残らない。M26-18 の 1 回目 (HBR-006/6、全体の画) がそれで、Q1 の error/no/no の中身は分からなかった。

やること:
1. `--image` の回 (記録に書かない回) は、no と失敗の票の根拠 (results.json の note と同じ 1 行の形、`note_of` が作る文) を標準出力に出す。yes の票は出さない (今の形のまま)。
2. 記録に書く回の出力は変えない。
3. `scripts/test_judge.py` の MainTest に、`--image` で no の票が出たとき標準出力に根拠の文があることを見る試験 (直す前に赤)。

## Blocked by

- M26-18 (done)

## Acceptance criteria

- [ ] `--image` の回で no・失敗の票の根拠が標準出力に出る試験があり、直す前に赤
- [ ] 記録に書く回の出力は前と同じ (既存の試験が通る)
- [ ] `pnpm run test:scripts`・`ruff check`・`ruff format --check` が通る

## 作業ログ

- 2026-10-17: 起票 (M26-18 の読むだけのレビューで取り込まなかった候補から)。
