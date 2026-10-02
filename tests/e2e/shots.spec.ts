import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Probe } from '../../src/dev/probe';
import { join } from 'node:path';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeRequest } from '../../src/harbor/wire';
import { settle, selection, tilt, type View } from '../driver/camera';
import { withRealFrames } from '../driver/frames';
import { routeHarbor } from '../driver/harbor';
import { advanceTo, openPaused } from '../driver/island';
import { enterObserve, lookFrom, OBSERVE_VIEWS } from '../driver/observe';
import { playToVerdict as driveToVerdict } from '../driver/verdict';
import { baselineName, CANVAS_TARGET, optionsFor, shouldCompareBaselines } from './baseline';
import { expectLegible, installLens } from './lens';
import { expectUncovered } from './uncovered';

/**
 * 人が見る画を撮る (M21-08)。題名の頭の <ID> は正本 docs/acceptance/scenarios.jsonl の human の行で、画はその行の steps の「画 n」になる。
 * ACCEPTANCE_DIR があるときだけ回り (pnpm run shots)、$ACCEPTANCE_DIR/shots/<ID>-<n>.png に書く。受入の画面は scripts/acceptance.py page が並べる。
 * 撮る前に、写すものが見えていることを内容で確かめる (文は toHaveText、グラフの目印は canvas に書いた文、3D の印は __probe.scene.selection() の view)。
 * 港は港の写し (tests/fixtures/fakeHarbor.ts)、判定は 1000x (?dev=1) と近道 (?shortcut=alive) で作る
 */
const ACCEPTANCE_DIR = process.env.ACCEPTANCE_DIR;
test.skip(ACCEPTANCE_DIR === undefined, 'ACCEPTANCE_DIR が無い (pnpm run shots で撮る)');
// 撮る状態を毎回同じにする (M25-02): 動きを減らす設定 (ピンの上下が止まる)、止めた島から始める (?paused=1)、tick で止める (probe.advanceTo)、グラフは年の境目ごとの点
test.use({ reducedMotion: 'reduce' });

/** 港の API を港の写しで答える。closed の間は網の失敗 */

/** 開発の板は人の見る画面に無いので、画から外す */
const HIDE_DEV = '.dev-panel { visibility: hidden !important; }';

/** 正本で auto の行 (M25-01)。auto の行は撮る前の確かめだけをして、人に並べる画は撮らない (受入の画面は human の行の画だけを受ける) */
const autoIds = new Set(
  readFileSync('docs/acceptance/scenarios.jsonl', 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as { kind: string; id: string; mode?: string; status?: string })
    .filter((r) => r.kind === 'scenario' && r.status === 'active' && r.mode === 'auto')
    .map((r) => r.id),
);

/** 正本で judge が llm の手順を持つ行 (M25-07)。auto の行でも、その手順の画は受入の画面の置き場に書く (pnpm run judge が読む) */
const judgedIds = new Set(
  readFileSync('docs/acceptance/scenarios.jsonl', 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as { kind: string; id: string; status?: string; steps?: unknown[][] })
    .filter((r) => r.kind === 'scenario' && r.status === 'active' && r.steps?.some((s) => (s[2] as { judge?: string } | undefined)?.judge === 'llm'))
    .map((r) => r.id),
);

/** 基準画と比べるのは手元の Mac だけ (ADR 0001 決定 1)。CI は lens の検査だけ */
const COMPARE_BASELINES = shouldCompareBaselines(process.env, process.platform);

/** 題名の <ID> の画の置き場と、その行の画を消す手段 */
function shotsDirOf(info: TestInfo) {
  const id = /^([A-Z]{3}-\d{3}): /.exec(info.title)?.[1];
  if (!id) throw new Error(`題名が <ID>: で始まらない: ${info.title}`);
  if (!ACCEPTANCE_DIR) throw new Error('ACCEPTANCE_DIR が空');
  const dir = join(ACCEPTANCE_DIR, 'shots');
  const clear = () => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) if (f.startsWith(`${id}-`)) rmSync(join(dir, f));
  };
  return { id, dir, clear };
}

/**
 * 題名の <ID> の画を 1 から順に撮る。初めに前の回のその行の画を消す (撮り直しで古い番号を残さない)。
 * 撮る前に、写すものが画面の内に切れずにあって覆われていないことを確かめる
 */
function shotsOf(info: TestInfo) {
  const { id, dir, clear } = shotsDirOf(info);
  mkdirSync(dir, { recursive: true });
  clear();
  const isAuto = autoIds.has(id) && !judgedIds.has(id);
  let n = 0;
  // pixels: false は画素の基準を持たない画 (観察画面の 3D)。ずれの基準ではなく、pnpm run judge の採点表で見る
  return async (page: Page, shown: Record<string, Locator>, canvas?: Locator, pixels = true) => {
    const targets = Object.values(shown);
    if (targets.length === 0) throw new Error('写すものを 1 つ以上渡す');
    for (const t of targets) await expect(t).toBeInViewport({ ratio: 1 });
    await expectUncovered(shown);
    await expectLegible(page, shown);
    n++;
    // 基準画 (M25-03)。auto の行も比べる。置き場は tests/e2e/baselines で、受入の画面の shots/ とは別。soft なので 1 つの画が落ちても残りの差も集まる
    if (COMPARE_BASELINES && pixels) {
      const targets = { ...shown, ...(canvas ? { [CANVAS_TARGET]: canvas } : {}) };
      for (const [name, target] of Object.entries(targets)) {
        await expect.soft(target).toHaveScreenshot(baselineName(id, n, name), optionsFor(name));
      }
    }
    if (isAuto) return;
    await page.screenshot({ path: join(dir, `${id}-${n}.png`), style: HIDE_DEV });
  };
}

test.beforeEach(({ page }) => installLens(page));

// 途中で落ちた行の画は、steps の「画 n」と数が合わないので残さない
test.afterEach(({}, info) => {
  if (info.status !== info.expectedStatus && info.status !== 'skipped') shotsDirOf(info).clear();
});

const playToVerdict = (page: Page, path: string, title: string) => driveToVerdict(page, path, { speed: 1000, title, timeoutMs: 60_000 });

const CLOSED_PUBLISH = '港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す';

test('HBR-006: 港の知らせと板の文 (回避率の行・出港のリンク・積荷を流した知らせ・閉港の出港・判定の後の港の口)', async ({ page }, info) => {
  test.setTimeout(180_000);
  const shoot = shotsOf(info);
  const harbor = await routeHarbor(page);
  await harbor.fake.serve(writeRequest({ kind: 'report_outcome', scenarioId: 'test-civ', verdict: 'dead' }));

  await playToVerdict(page, '/?scenario=test-civ&dev=1', '島は生き延びた');
  await expect(page.locator('#verdict-avoidance')).toHaveText('この予言を越えた見守り手は 50%');
  await expect(page.locator('#tablet-avoidance')).toHaveText('この予言を越えた見守り手は 50%');
  await shoot(page, { 判定の板の回避率: page.locator('#verdict-avoidance'), 石板の回避率: page.locator('#tablet-avoidance') });

  const panel = page.getByRole('region', { name: '港へ出す' });
  await panel.getByRole('radio', { name: '雨は来た' }).click();
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  await expect(panel.getByRole('textbox', { name: '訪問のリンク' })).toHaveValue(/\/\?scenario=test-civ&visit=[0-9a-f]+$/);
  await expect(panel.getByRole('link', { name: 'この島を訪れる' })).toHaveText('この島を訪れる');
  await shoot(page, { 出港の知らせ: panel.getByRole('status').first(), 訪問のリンク: panel.getByRole('textbox', { name: '訪問のリンク' }) });

  await playToVerdict(page, '/?scenario=test-ship&dev=1', '次の島へ');
  await expect(page.locator('#harbor-toast')).toHaveText('積荷を港に流した。どこかの見守り手の浜に流れ着く');
  await shoot(page, { 積荷の知らせ: page.locator('#harbor-toast') });

  harbor.state.closed = true;
  await playToVerdict(page, '/?scenario=test-quick&dev=1', '島は滅びた');
  const closedPanel = page.getByRole('region', { name: '港へ出す' });
  await closedPanel.getByRole('button', { name: '出港する' }).click();
  await expect(closedPanel.getByRole('status').first()).toHaveText(CLOSED_PUBLISH, { timeout: 20_000 });
  await expect(page.locator('#harbor-dock-count')).toHaveText('預け 1');
  await shoot(page, { 閉港の出港: closedPanel.getByRole('status').first() });

  // 判定の後に開き直した港の口 (閉港のまま)。判定の出た島が出港の板とともに並ぶ
  await page.reload();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drawer = page.getByRole('complementary', { name: '港' });
  await expect(drawer.locator('#harbor-state')).toHaveText('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
  await expect(drawer.locator('.harbor-finished')).toContainText('この石板で最後に判定の出た島');
  await shoot(page, { 閉港の港の口: drawer.locator('#harbor-state'), 判定の出た島: drawer.locator('.harbor-finished') });
});

/** 放流が効いて狼の密度が 0.3 を越える tick (止めた島から進める) */
const DRIFT_TICKS = 4;

test('CRG-005: 漂着を受け取った港の口の文、HUD のグラフの漂着の目印、着いた浜のセルの密度', async ({ page }, info) => {
  const shoot = shotsOf(info);
  const harbor = await routeHarbor(page);
  await harbor.fake.serve(writeRequest({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'wolf', amount: 0.411 }, { speciesId: 'deer', amount: 0.254 }] } }));
  await openPaused(page, '/?paused=1');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drift = page.getByRole('region', { name: '浜の漂着' });
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(drift.locator('#harbor-drift-items')).toHaveText('狼 0.411・鹿 0.254');
  await drift.getByRole('button', { name: '受け取る' }).click();
  await expect(drift.locator('#harbor-drift-status')).toHaveText('積荷を受け取った。外来種が島の浜に放たれた');
  await expect(page.locator('#cell-info')).toContainText(/^セル \(\d+, \d+\)/);
  await shoot(page, { 受け取りの文: drift.locator('#harbor-drift-status') });

  // 放流は次の刻みで島に効く (港の板は速さの列に重なるので閉じる)
  await page.getByRole('complementary', { name: '港' }).getByRole('button', { name: '閉じる' }).click();
  const density = (name: string) => page.locator('#cell-info > div', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('.mono');
  await advanceTo(page, DRIFT_TICKS);
  expect(Number(await density('狼').textContent())).toBeGreaterThan(0.3);
  expect(Number(await density('鹿').textContent())).toBeGreaterThan(0.2);
  // 目印は canvas の中の字なので、DOM では graph の aria-label の文で確かめる (字が canvas に収まるかは ui.graph.test.ts)
  await expect(page.locator('#graph')).toHaveAttribute('aria-label', /^個体数と気温の推移。Y0 から Y\d+、\d+ 点。目印: 漂着 \(狼・鹿\) Y0$/);
  await shoot(page, { 'HUD のグラフ': page.locator('#graph'), セルの詳細: page.locator('#cell-info') });
});

const dialog = (page: Page) => page.getByRole('alertdialog');

/** 確かめの板が title と message で出て、「やめる」に focus がある */
async function expectAsk(page: Page, title: string, message: string) {
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText(title);
  await expect(d.locator('p')).toHaveText(message);
  await expect(d.getByRole('button', { name: 'やめる' })).toBeFocused();
}

test('CNF-002: 確かめの板 (新しい島・枠の上書き・判定の出た島を離れる)', async ({ page }, info) => {
  test.setTimeout(120_000);
  const shoot = shotsOf(info);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await openPaused(page, '/?paused=1');
  await advanceTo(page, 400);
  await expect(page.locator('#hud-year')).toHaveText('Year 1');

  await page.click('#new-island');
  await expectAsk(page, '新しい島', '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)');
  await shoot(page, { 確かめの板: dialog(page) });
  await dialog(page).getByRole('button', { name: 'やめる' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.selectOption('#slot-select', 'manual-3');
  await page.click('#slot-save');
  const first = `枠 3 · ${await page.locator('#hud-year').textContent()}`;
  await expect(page.locator('#slot-select option[value="manual-3"]')).toHaveText(first);
  await advanceTo(page, 760);
  await expect(page.locator('#hud-year')).toHaveText('Year 2');
  await page.click('#slot-save');
  await expectAsk(page, '枠を上書きする', `「${first}」を今の島で上書きしますか (前の保存には戻せません)`);
  await shoot(page, { 確かめの板: dialog(page) });
  await dialog(page).getByRole('button', { name: 'やめる' }).click();

  await playToVerdict(page, '/?scenario=test-quick&dev=1&shortcut=alive', '島は生き延びた');
  await page.locator('#verdict-retry').click();
  await expectAsk(page, '判定の出た島を離れる', '判定の出た島を離れますか。枠へ保存していなければ、この島には戻れません (港へ出す島は港に残ります)');
  await shoot(page, { 確かめの板: dialog(page) });
});

/** 見えて選べるかの形 (screen を除く) */
const seen = (v: View | null | undefined) => v && { sea: v.sea, cellHidden: v.cellHidden, markerHidden: v.markerHidden, markerOnScreen: v.markerOnScreen };

/** 寄ったカメラ (45°) から倒して、選んだセルを手前の丘に隠す角 */
const LOW = 35;

test('SEL-003: 選んだセルの帯とピン (遠い既定のカメラ・寄ったカメラ・丘に隠れたセル)', async ({ page }, info) => {
  test.setTimeout(240_000);
  const shoot = shotsOf(info);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await openPaused(page, '/?paused=1');
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  const cellInfo = page.locator('#cell-info');
  const visible = { sea: false, cellHidden: false, markerHidden: false, markerOnScreen: true };

  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(cellInfo).toContainText(/^セル \(\d+, \d+\)/);
  await expect.poll(async () => seen((await selection(page))?.view), { timeout: 15_000 }).toEqual(visible);
  await shoot(page, { セルの詳細: cellInfo }, page.locator('#scene'));

  const far = (await selection(page))?.marker?.scale ?? 0;
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  await settle(page);
  expect((await selection(page))?.marker?.scale).toBeLessThan(far / 2);
  expect(seen((await selection(page))?.view)).toEqual(visible);
  await shoot(page, { セルの詳細: cellInfo }, page.locator('#scene'));

  // 丘に隠れたセル: 倒したカメラで、陸のセルの面が隠れ印の頭は見えるセルを探し、寄ったカメラに戻してそのセルを押し、もう一度倒す
  const size = (await selection(page))?.size ?? 0;
  expect(size).toBeGreaterThan(0);
  await tilt(page, box, LOW);
  // 手前 (画面の下) のセルほど、ピンが大きく写る
  const hidden = await page.evaluate(
    ({ n, box }) => {
      const scene = (window as unknown as { __probe: Probe }).__probe.scene;
      if (!scene) return [];
      const out: { cell: number; y: number }[] = [];
      for (let cell = 0; cell < n; cell++) {
        const v = scene.cell(cell);
        if (v && !v.sea && v.cellHidden && !v.markerHidden && v.markerOnScreen && v.screen.x > box.width * 0.3 && v.screen.x < box.width * 0.7) out.push({ cell, y: v.screen.y });
      }
      return out.sort((a, b) => b.y - a.y).map((c) => c.cell);
    },
    { n: size * size, box },
  );
  expect(hidden.length).toBeGreaterThan(0);
  await tilt(page, box, -LOW);
  const targets = await page.evaluate(
    ({ cells, box }) => {
      const scene = (window as unknown as { __probe: Probe }).__probe.scene;
      const out: { cell: number; x: number; y: number }[] = [];
      for (const cell of cells) {
        const v = scene?.cell(cell);
        if (!v || v.cellHidden || v.screen.x < box.width * 0.3 || v.screen.x > box.width * 0.7 || v.screen.y < box.height * 0.2 || v.screen.y > box.height * 0.8) continue;
        if (document.elementFromPoint(box.x + v.screen.x, box.y + v.screen.y)?.id === 'scene') out.push({ cell, ...v.screen });
      }
      return out;
    },
    { cells: hidden, box },
  );
  expect(targets.length).toBeGreaterThan(0);
  // 丘の縁のセルは、倒し直したカメラのわずかなずれで見えることがある。隠れるまで次のセルで試す (戻すときは離した所のセルが選ばれるが、次に押し直す)
  let view: ReturnType<typeof seen> = null;
  for (const target of targets.slice(0, 5)) {
    await page.mouse.click(box.x + target.x, box.y + target.y);
    await expect(cellInfo).toContainText(`セル (${target.cell % size}, ${Math.floor(target.cell / size)})`);
    await tilt(page, box, LOW);
    view = seen((await selection(page))?.view);
    if (view?.cellHidden) break;
    await tilt(page, box, -LOW);
  }
  expect(view).toEqual({ sea: false, cellHidden: true, markerHidden: false, markerOnScreen: true });
  await expect(cellInfo).not.toContainText('· 海');
  await shoot(page, { セルの詳細: cellInfo }, page.locator('#scene'));
});

test('OBS-002: 観察画面の 3 枚 (集落・群れ・海岸) を止めた時計で撮る', async ({ page }, info) => {
  test.setTimeout(420_000);
  const shoot = shotsOf(info);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await enterObserve(page);
  const bar = page.getByRole('toolbar', { name: '観察画面' });
  await expect(bar.locator('.o-stats')).toHaveText('10 年 · 春');
  for (const view of OBSERVE_VIEWS) {
    await lookFrom(page, view);
    // 撮る間だけ本物の rAF に戻す。3D の画素は基準画を持たず、採点表 O1〜O8 (rubrics.json) が見る
    await withRealFrames(page, () => shoot(page, { 帯の年と季節: bar.locator('.o-stats') }, undefined, false));
  }
});
