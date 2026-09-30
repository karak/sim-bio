# acceptance-probe

ADR 0001 の付録 B の試しの写し (2026-09-30、feat/m19 の 8723e67 で回したもの)。
scratchpad はセッションとともに消えるので、ここに残す。
本番の検査ではなく、閾値や呼び方の根拠を再び測るための道具である。
段 1 の読みやすさの検査は `tests/e2e/lens.ts` (M25-01) に作り直した。段 2 以降の票が、ここから試験として作り直す。

| ファイル | 何を測るか | 作り直す先 |
|---|---|---|
| `probe-specs/occlusion.spec.ts` | 自由モードで島を押した後、文字の箱ごとに 5 点を elementFromPoint に当てる (付録 B の 1)。 | `tests/e2e/lens.ts` (M25-01) |
| `probe-specs/occlusionShip.spec.ts` | 同じことを `?scenario=test-ship&dev=1` で。 | 同上 |
| `probe-specs/jitter.spec.ts` | 止めた自由モードを同じページで 2 回撮る。ピンを通常と `reducedMotion: 'reduce'` で撮る。文字を透明にした画 (`read-bg.png`) と要素ごとの色・箱 (`read-els.json`) を書く (付録 B の 1・3)。 | M25-02 (撮る状態の決定論) |
| `probe-specs/fontdrift.spec.ts` | 確かめの板の要素の画を、字形・太さ・色・位置・1 字の変わりごとに撮る (付録 B の 2)。 | M25-03 (基準画の閾値の根拠) |
| `contrast.py` | `read-bg.png` と `read-els.json` から要素ごとのコントラスト比 (箱の中の 10 パーセンタイル) を出す。 | `tests/e2e/lens/contrast.ts` |
| `cmp.py` | `jitter.spec.ts` が撮った画どうしの差を数える。 | M25-02 |
| `cmp2.py` | `pnpm run shots` を 2 回撮った `shots/` のフォルダを、画ごとに比べる (付録 B の 3)。 | M25-02 |
| `judge/judge.sh`・`rubric.md`・`schema.json` | 手元の `claude -p` で画を採点表に当てる (付録 B の 4)。 | M25-06 (`pnpm run judge`) |

## 使い方

playwright の spec は `tests/e2e/` の外にあるので、`pnpm run test:e2e` には入らない。
写しを一時的に `tests/e2e/` に置いて回す。`PROBE_OUT` は結果を書くフォルダ (先に作る)。

```sh
mkdir -p "$PROBE_OUT"
cp tools/acceptance-probe/probe-specs/occlusion.spec.ts tests/e2e/zz-probe-occlusion.spec.ts
PROBE_OUT="$PROBE_OUT" E2E_PORT=5454 CI=1 pnpm exec playwright test zz-probe-occlusion --reporter=line
rm tests/e2e/zz-probe-occlusion.spec.ts        # 置いた写しは消す (コミットしない)
cat "$PROBE_OUT/occlusion.json"                # 覆われた文字の一覧。空なら覆いは無い
```

- 覆い: `occlusion.spec.ts` → `occlusion.json` (覆った要素と覆われた文字)。
- コントラスト: `jitter.spec.ts` を `PROBE_OUT` 付きで回して `read-bg.png`・`read-els.json` を書かせ、`uv run tools/acceptance-probe/contrast.py "$PROBE_OUT"`。
- 揺れ: `jitter.spec.ts` を `PROBE_RUN=1` と `PROBE_RUN=2` で回し、`uv run tools/acceptance-probe/cmp.py "$PROBE_OUT"`。`pnpm run shots` の 2 回分の比べは `uv run tools/acceptance-probe/cmp2.py <1 回目の shots/> <2 回目の shots/>`。
- 字形の揺れ: `fontdrift.spec.ts` が `drift-*.png` を書く。base との差を `cmp2.py` の形で数える。
- 採点: `tools/acceptance-probe/judge/judge.sh <画像> <out.json>`。`claude -p` が要る。1 回 10〜14 秒、0.015〜0.033 USD。採点表は `judge/rubric.md`。

python は `uv run` が依存 (numpy・pillow) を PEP 723 のヘッダーから入れる。`pnpm run lint:py` が ruff で見る。
