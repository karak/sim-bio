# 港 (出港・訪問・照合・積荷・通報)

判定の出た島を港へ出し (年代記 + 碑文)、リンクで他人が訪れて 3D で見て、年表を読んで照合する。空の舟の積荷、通報、取り下げ。港は Cloudflare Worker + D1 (`worker/`)。

## Sub-features

- 出港: `#verdict-harbor` → 碑文を選ぶ → 港の板 (`#harbor-state`・`#harbor-dock-count`・`#harbor-toast`)。Turnstile は `fakeTurnstile`。層 A
- 訪問: `?visit=<id>` → 観察画面 → 戻って `#harbor-read-status`・`#harbor-visit-confirms`・`#harbor-visit-ending`。層 A
- 照合 (年表を読む): Web Worker の回し直し、`#harbor-read-status`、「やめる」。層 A (`chronicle.spec.ts`)
- 積荷: `#harbor-drift-status`・`#harbor-drift-items`。層 A
- 閉港と outbox (港が全部閉じても遊べ、開いたら同じ id・鍵で送り直す): 層 A
- Worker の予算・捨てる順・D1 の表: 層 A (`worker/test/*.test.ts`、`pnpm run test:worker`)。D1 の書きの最悪の行数は M26-20 の適用度関数 (予定)
- 読みやすさ (港の口の文、石板の回避率): 層 A の lens + 基準画 (HBR-006・SEL-003)、層 C の人の目 (審査台で保留のものがある)
- 課金にしない構成: 層 A (`pnpm run check:free-tier`、build の後)

## How to get to it (user POV)

判定の板の「港へ出す」。訪問はリンク (`/?visit=<id>`)。港の口は右の列の「港」の板。

## Driving it with Playwright

```ts
import { routeHarbor } from '../driver/harbor';
await routeHarbor(page);               // /api/v1/* を港の写しで答える (goto の前)
await playToVerdict(page, '/?scenario=test-ship&dev=1', { speed: 1000, timeoutMs: 120_000 });
await page.click('#verdict-harbor');   // 以後は harbor.spec.ts の M19-09 の一連
```

本物の港で試すなら `pnpm run dev:acceptance` (8787、ローカルの D1) を開き、別の人は `?player=a`・`?player=b` (`x-dev-sender` が IP の代わり。本番は読まない)。D1 の行は `pnpm run cf -- d1 execute biotope-harbor --local --command "select ..."` (`scripts/cf.py`)。

## 証拠の終わりの状態

- 出港の後、港の板に自分の島が並び、`#harbor-dock-count` が増える。写しの港なら `routeHarbor` が受けた `WireRequest` の列
- 訪問の後、`#harbor-visit-confirms` の数が書き換わる (M26-15 の引き直し)
- 閉港 (503) でも遊べ、outbox に 1 件、開いたら同じ id で再送 (INSERT OR IGNORE で 1 件のまま)
- Worker: `pnpm run test:worker` の件数と、予算の段 (`worker/src/policy.ts`) の試験

## Gotchas

- 本番の港には触らない (配備・D1 の書きは層 C、ユーザーの許可)。`pnpm run cf` は Keychain のトークンで打つ
- 秘密の値 (トークン・取り下げ鍵) はチャット・ファイル・引数に出さない。受入の画面の写しには鍵が入る (`.claude/acceptance/snapshots/` は git の外)
- 港の口の文は全体の画 (1280×720) では小さい。judge に当てるなら切り抜く (M26-18)
