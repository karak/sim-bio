---
id: M27-04
title: 観察画面の view.ts (1 関数 836 行) を組み立て・更新・inspect に分ける
status: review
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-01]
evidence:
  - "8f0dbcb tests/e2e/observeCharacterization.spec.ts 'M27-04: 観察画面の inspect() (計測・小屋・小物・三角形の内訳・地形・個体) が、3 つの視点で fixture と一致する' (分けた後の 7061595 で通過、単独 2.8m)"
  - "7061595 tests/unit/architecture.test.ts '本体 150 行を超える関数は表のものだけで、表の上限を超えない' と 'ファイルは上限の内 (既定 700 行…)' が通過 (表に例外を足さずに。7c1a1c0 の赤から緑)"
  - "119748a・01158a7・97122fa・667fda0・271d9f8・9a9d491・f99e4c8・7061595 refactor(observe): 部品を 1 つずつ src/observe/view/ へ出した 8 コミット"
  - "tools/bench-observe.ts の前 (7c1a1c0) と後 (7061595): 6 画の三角形・draw call・区分ごとの内訳が数まで一致 (作業ログの表)"
  - "tests/e2e/observe.spec.ts・observeEntry.spec.ts・observeIslandSwap.spec.ts 8 本通過、SLOW=1 tests/slow/observe.scenes.test.ts 2 本通過、pnpm run check 通過 (unit 1402・worker 66・scripts 319)"
---

# 観察画面の view.ts を分ける (R2 の後半)

優先度: Could (M27-03 の後。基準画 OBS-002 と tests/slow/observe.scenes が安全網)

## What to build

`createObservationView` (src/observe/view.ts:239〜1074) を、scene の組み立て (地形・水・草・木・集落・生き物の生成)、フレームの更新 (director・daylight・fx・dynamic resolution)、`inspect()` の 3 つに分ける。振る舞いと描画は変えない。

## 受入基準

- [x] `tests/unit/architecture.test.ts` の表から `createObservationView` の 836 行の例外を消し (150 行の既定に戻し)、`src/observe/view.ts` の 1074 行の例外も既定の 700 行に戻す
- [x] 基準画 OBS-002 1〜3 と `pnpm run shots` が変わらない。`SLOW=1` の observe.scenes 通過 (親が 2026-10-11 00:50 に確かめた: shots 6/6 通過、OBS-002-1・2 は承認済みの画とバイト単位で同じ、OBS-002-3 は画素の差の最大 14/255 で 20 を越える画素 0)
- [x] `tools/bench-observe.ts` の fps・三角形・draw call が前と同じ (前後の数を作業ログに)

## 作業ログ
- 2026-10-10 23:40 安全網を先に: `tests/e2e/observeCharacterization.spec.ts` (3 視点の inspect() を `tests/e2e/fixtures/observe-characterization.json` に留める。2 回目の実行で一致、鐘樹の rng の seed を変えると落ちる)。次に柵のラチェットから view.ts と createObservationView の例外を消して赤にした (ファイル 1074 > 700、関数 836 > 150)。
- 2026-10-11 00:50 分けた (agent)。部品を 1 つずつ出し、コミットごとに typecheck・lint・柵以外の unit を緑にして特性試験を回した。
  - 置き場: `src/observe/view.ts` (入口。`ObserveHost`・`ObservationView` の型、部品を順に組む、`inspect()` をまとめる、start・stop・dispose を渡す) と `src/observe/view/` の options (URL の指定 OPT と説明)・state (`ViewState`: 組んだ後に書き換え、ほかの部品が読む値を 1 つに)・stage (描き手・場面・空・カメラ・光、合成と resize、捨て方)・layout (区域・目印・船台・踏み固め)・flora (鐘樹・森の木・下草・植え直し)・settlementBuild (集落の部品・小屋の組・蛍・跳ね返りの面・光の粒・水たまり・舟)・agentLayer (個体層)・sea (沈む海)・camera (寄せ先・自動カメラ・押した個体を追う)・weather (介入の場面・灯り・知らせの帯・fx)・frame (毎コマの loop と start・stop)。
  - 指示と違えたところ: OPT は view.ts に置かず options.ts へ (部品のどれもが読み、view.ts に置くと引数で 8 か所に通すことになる。説明の注釈ごと移した)。個体の部品は src/observe/population.ts と名が重なるので agentLayer.ts (注釈の「個体層」) にした。区域と目印は鐘樹の前に決める (林の切り開きが船台を使う) ので、集落の部品とは別の layout.ts に置いた。
  - 鐘樹の乱数 mulberry32(11) は view.ts で作って渡し、鐘樹 → 株 → 森の木 → 下草 → 蛍 → 光の粒の順で同じ 1 本を引く。組む順で変わったのは、自動カメラ (shotCamera) を組む時が知らせの帯の後になったことだけ (direct が場面と知らせを受けるため。互いに触らない)。
  - 行数 (前 → 後): view.ts 1074 → 182、createObservationView 836 → 126。新しいファイルと一番長い関数: options 53、state 23、stage 119 (createStage 47)、layout 30 (layOutSite 20)、flora 239 (plantBelltrees 78)、settlementBuild 219 (createSettlement 51)、agentLayer 75 (createAgentLayer 43)、sea 36 (createSea 27)、camera 209 (createDirector 80)、weather 107 (createWeather 66)、frame 158 (createFrameLoop 116、loop 65)。合わせて 1450 行 (型と引数の分だけ増えた)。柵の表に例外は足していない。
  - 特性試験: 2 と 3 の後の本物の spec は 180 秒の上限で落ちた (別の worktree の E2E で load average 14〜24。入るところで 120〜170 秒かかった)。同じ spec の上限だけを 900 秒にした写し (scratchpad、比べる式はそのまま) で 3〜7 の後を回して全部一致、8 の後 (7061595) は本物の spec が単独で通過 (2.8m、7c1a1c0 の前と同じ時間)。1 の後の回は、回している間に src を書き換えて Vite が読み直したので無効 (2 以降が 1 を含む)。
  - 通しの E2E (E2E_PORT=5453): 118 通過・6 飛ばし (shots.spec、ACCEPTANCE_DIR 無し)・1 失敗 = observeCharacterization (180 秒の上限。並べて回すと間に合わない。単独では通る)。この spec は単独で 168 秒かかり上限に近い。上限か直列の置き方は親で決めてほしい (spec は触っていない)。
  - 計測の台 (pnpm run bench:observe、既定、headless。M4):

| 画 | 三角形 前 | 三角形 後 | draw call 前 | draw call 後 | fps 前 | fps 後 |
|---|---|---|---|---|---|---|
| 集落 | 399,663 | 399,663 | 97 | 97 | 367 | 368 |
| 船台 | 251,152 | 251,152 | 92 | 92 | 377 | 380 |
| 群れ | 230,001 | 230,001 | 78 | 78 | 441 | 438 |
| 林 | 318,809 | 318,809 | 91 | 91 | 334 | 355 |
| 狼 | 346,901 | 346,901 | 103 | 103 | 356 | 367 |
| 海岸 | 255,397 | 255,397 | 74 | 74 | 404 | 409 |

  区分ごとの三角形の内訳 (breakdown) も 6 画すべて同じ。fps は同じ GPU で別の作業の画面が動いていたので数 % 揺れる。
  - 置き場が変わって指す先がずれた注釈 (消す・書き換えるのはユーザーの承認の後): src/observe/view/layout.ts:18 の「(小屋の位置は下の集落の一角と同じ)」(集落の一角は settlementBuild.ts の placeSettlement)・:12 の「区域と目印をここで決める。元は集落の一角の直前」、src/observe/view/settlementBuild.ts:89 の「(M22-06: 区域と目印は鐘樹の前で決めた)」(決めるのは layout.ts)、src/observe/prototype.ts:8 の「URL の指定は view.ts の先頭に書いてある」(今は view/options.ts)、src/observe/settlementLayout.ts:12 の「view.ts の worn」(layout.ts)・:51 の「view.ts の place」(settlementBuild.ts)、tests/driver/observe.ts:6 と tools/bench-observe.ts:33 の「view.ts の presets」(camera.ts)、tools/bench-observe.ts:48 の「(src/observe の view.ts・render/instancer.ts)」(時計を読むのは view.ts の nowMs と view/frame.ts)、tools/readme-shots.ts:61 の「view.ts の departCam」(camera.ts)、tests/unit/observe.fx.test.ts:104 の「view.ts と同じ式」(weather.ts)、tests/unit/observe.hutLod.test.ts:225 の「view.ts の place」(settlementBuild.ts)、tools/blender/observe_settlement.py:658 の「view.ts は地面から 0.15 m 沈めて置く」(settlementBuild.ts)、src/observe/view/weather.ts:74 の「調整用: 開発者ツールから知らせを出す (__probe.observe.notice(…))」(notice の後の注釈だが、間にあった飛び立ちの画が camera.ts へ移り、すぐ下の fx に付いて読める)、src/observe/view/frame.ts:52 の「本体の時間 (M22-08): … 進んだら区域の密度から目標頭数を引き直す …」(引き直しは view.ts の onSnapshot と agentLayer.ts の retarget)。
- 2026-10-11 01:05 親のレビュー (読むだけの opus の agent): 振る舞いの変化なし (毎フレームの順・rng の順・組む順・ViewState の読む時点・dispose・inspect の 12 の口・コメント 153 行を照合)。直した 3 つ: `AgentLayer` の `targets`・`agents` は組んだ時点の値なので `initial` に改名 (生きた値は ViewState)、`createFrameLoop` は glb 6 つでなく素材の真偽を受ける、`ObserveHost` を `view/host.ts` へ (型だけの循環を無くす)。見送り: frame の cull の呼びを flora/settle にまとめる (順が交互なので今は触らない)、`state` を引数で受ける層と閉包で持つ層の不揃い (M27-05 の後で)。特性試験の制限は 360 秒に (1 本で約 170 秒)。
- 2026-10-11 10:05 上の注釈 16 件をユーザーの承認 (2026-10-11「コメントは承認」) のもとで書き換えた。指す先を今の置き場 (view/options・layout・settlementBuild・camera・weather・frame) に直し、weather.ts の調整用の注釈は notice の上へ戻した。特性試験の上限 360 秒もユーザーが了承。
