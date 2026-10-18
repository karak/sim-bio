# 機能の地図 (verify-biotope)

面ごとに 1 つ。各ファイルは「何か・どこから入るか・どう動かすか・何が証拠か」を、使う人の目で書く。
層 (A 機械 / B LLM / C 人) は各ファイルの Sub-features に書く。地図に無い入口を 1 つだけ通した証拠は不完全。

| 機能 | 面 | 主な層 | 正本の試験 |
|---|---|---|---|
| [island-play.md](island-play.md) | 本体 `/` | A | `tests/e2e/smoke.spec.ts`、`cellHighlight.spec.ts` |
| [scenario-verdict.md](scenario-verdict.md) | 本体 `/?scenario=` | A (結末)、C (板の手触り TUR-001) | `verdict.spec.ts`、`scenarioSave.spec.ts`、`tests/unit/scenario.determinism.test.ts` |
| [save-load.md](save-load.md) | 本体 (枠・ファイル・タイトル) | A | `persist.spec.ts`、`confirm.spec.ts`、`title.spec.ts` |
| [harbor.md](harbor.md) | 本体 + Worker `/api/v1/*` | A (写し)、A (本物の D1 は `dev:acceptance`)、C (読みやすさの画) | `harbor.spec.ts`、`chronicle.spec.ts`、`worker/test/*.test.ts` |
| [observe-view.md](observe-view.md) | 観察画面 `/observe.html` と「3D で見る」 | A (入口・性能)、B (絵の採点 OBS-002)、C (造形の前後) | `observe*.spec.ts`、`tools/bench-observe.ts`、`tools/flora-shots.ts` |

受入の正本は `docs/acceptance/scenarios.jsonl` (id は `HBR-004` の形、`mode` が human/auto)。地図の機能は正本の行の集まりに当たる。行を足す・変えるのは層 C。
