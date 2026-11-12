# docs の目録

この文書は `docs/` の文書と `issues/README.md` を 1 行ずつ並べ、どの箱に入るか、凍結したか、今の正本はどこかを示す。箱 B (保守する) の文書で、文書を足す・消す・凍結するときは、同じ commit でこの表を直す。箱の分け方と凍結の仕方の根拠は `docs/review/2026-10-28-spec-inventory.md` の §4.1・§4.2。

## 読み方

列:

- path: リポジトリの根からの path。
- 箱: A・B・C のどれか 1 字。
- 凍結: 凍結した日 (`YYYY-MM-DD`)。凍結していなければ空。
- 今の正本: 凍結した文書の今を指す先 (`<path>#<anchor>`)。指す先が無ければ空。
- ハッシュ: 凍結した日の本文のハッシュ。凍結していなければ空。

箱:

- A 積み重ねる (append-only): 行を足すだけで、前の行は直さない。変えるときは新しい行 (新しい ADR) で前を置き換え、置き換えた旨を前の行に 1 行足す。
- B 保守する (stock): 今に合わせて書き換える。名に日付を入れない (`docs/specs/2026-10-18-decisions-current.md` だけは例外で、名の日付を起こした日と読む)。
- C 凍結する (flow): 書いた日 (または票が閉じた日) で凍結し、本文を書き換えない。足してよいのは頭の行だけ。凍結の前に結論を B へ移す。

凍結した文書の頭の行 (題の直下に 1 行) は、次の 2 つの形のどちらか。

- `> 凍結: YYYY-MM-DD。今の正本: <path>#<anchor>` (今を指す先がある文書)
- `> 凍結: YYYY-MM-DD。失効: <理由 1 句>` (今を指す先が無い文書)

本文のハッシュ: ファイルの文から `> 凍結: ` で始まる行をすべて除いた残りの sha256 (16 進) の先頭 16 桁。頭の行を足しても変わらず、本文を 1 字でも変えると変わる。

表に入れるのは `docs/` の `.md` と `.html` の全部と、`docs/` の外の `issues/README.md`。`docs/acceptance/scenarios.jsonl`・`docs/review/archive-2026-10-13.jsonl` などの jsonl・json・画像は入れない。行は path の辞書順に並べる。

## 目録

| path | 箱 | 凍結 | 今の正本 | ハッシュ |
|---|---|---|---|---|
| `docs/README.md` | B | | | |
| `docs/architecture/fitness-functions.md` | B | | | |
| `docs/architecture/overview.md` | B | | | |
| `docs/decisions/0001-acceptance-automation.md` | A | | | |
| `docs/decisions/0002-architecture-fence.md` | A | | | |
| `docs/design/2026-09-19-art-brief.md` | C | | | |
| `docs/design/2026-09-19-proposal.html` | C | | | |
| `docs/design/2026-09-19-scenarios-and-world.md` | C | | | |
| `docs/design/2026-09-20-level-design-tower.md` | C | | | |
| `docs/design/2026-09-21-level-design-faith.md` | C | | | |
| `docs/design/2026-09-22-level-design-devices.md` | C | | | |
| `docs/design/2026-09-22-level-design-faith-economy.md` | C | | | |
| `docs/design/2026-09-23-observation-view-design.md` | C | | | |
| `docs/design/2026-09-23-observation-view.md` | C | | | |
| `docs/design/2026-09-24-observe-perf.md` | C | | | |
| `docs/design/2026-09-26-cloudflare-architecture.md` | C | | | |
| `docs/design/2026-09-27-scenario-save-url.md` | C | | | |
| `docs/design/2026-09-29-acceptance-redesign.md` | C | | | |
| `docs/design/2026-10-10-architecture-review.md` | C | | | |
| `docs/design/2026-10-28-level-design-intercept-2.md` | C | | | |
| `docs/design/qa/deer-acceptance-criteria.md` | C | | | |
| `docs/design/qa/deer-remaining-issues.md` | C | | | |
| `docs/design/qa/handoff-T18-merge.md` | C | | | |
| `docs/design/qa/observe/deer.md` | C | | | |
| `docs/design/qa/observe/environment.md` | C | | | |
| `docs/design/qa/observe/keyitems.md` | C | | | |
| `docs/design/qa/observe/rabbit.md` | C | | | |
| `docs/design/qa/observe/session-2026-10.md` | C | | | |
| `docs/design/qa/observe/wolf.md` | C | | | |
| `docs/design/qa/rabbit-acceptance-criteria.md` | C | | | |
| `docs/design/qa/rabbit-remaining-issues.md` | C | | | |
| `docs/design/qa/remaining-tasks.md` | C | | | |
| `docs/design/qa/verification-workflow.md` | C | | | |
| `docs/design/qa/wolf-acceptance-criteria.md` | C | | | |
| `docs/design/qa/wolf-remaining-issues.md` | C | | | |
| `docs/operations/README.md` | B | | | |
| `docs/operations/acceptance.md` | B | | | |
| `docs/operations/cloudflare-api-token.md` | B | | | |
| `docs/operations/cloudflare-deploy.md` | C | | | |
| `docs/operations/cloudflare.md` | B | | | |
| `docs/operations/deploy-runbook.md` | B | | | |
| `docs/operations/readme-screenshots.md` | B | | | |
| `docs/review/2026-10-28-spec-inventory.md` | C | | | |
| `docs/review/archive-2026-10-13.md` | A | | | |
| `docs/specs/2026-09-19-ecosystem-sim-design.md` | C | | | |
| `docs/specs/2026-10-18-decisions-current.md` | B | | | |
| `docs/specs/plans/2026-09-19-m1-implementation-plan.md` | C | | | |
| `docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md` | C | | | |
| `docs/specs/plans/2026-09-19-m6-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-19-m8-civilization-plan.md` | C | | | |
| `docs/specs/plans/2026-09-20-m20-public-release-plan.md` | C | | | |
| `docs/specs/plans/2026-09-20-m8-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-22-m10-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-22-m9-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-23-handoff.md` | C | | | |
| `docs/specs/plans/2026-09-23-m10r-07-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-23-m10r-08-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-23-m10r-playtest.md` | C | | | |
| `docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md` | C | | | |
| `docs/specs/plans/2026-09-23-roadmap.md` | C | | | |
| `docs/specs/plans/2026-10-18-plan.md` | C | | | |
| `docs/uiux/2026-10-04-title-flow.md` | C | | | |
| `docs/uiux/README.md` | B | | | |
| `issues/README.md` | B | | | |
