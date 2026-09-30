import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { Probe } from '../../src/dev/probe';
import { join } from 'node:path';
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeRequest } from '../../src/harbor/wire';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';
import { expectLegible, installLens } from './lens';
import { expectUncovered } from './uncovered';

/**
 * 人が見る画を撮る (M21-08)。題名の頭の <ID> は正本 docs/acceptance/scenarios.jsonl の human の行で、画はその行の steps の「画 n」になる。
 * ACCEPTANCE_DIR があるときだけ回り (pnpm run shots)、$ACCEPTANCE_DIR/shots/<ID>-<n>.png に書く。受入の画面は scripts/acceptance.py page が並べる。
 * 撮る前に、写すものが見えていることを内容で確かめる (文は toHaveText、グラフの目印は canvas に書いた文、3D の印は __sceneSelection の view)。
 * 港は港の写し (tests/fixtures/fakeHarbor.ts)、判定は 1000x (?dev=1) と近道 (?shortcut=alive) で作る
 */
const ACCEPTANCE_DIR = process.env.ACCEPTANCE_DIR;
test.skip(ACCEPTANCE_DIR === undefined, 'ACCEPTANCE_DIR が無い (pnpm run shots で撮る)');

const data = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: data('scenarios'), species: data('species'), inscriptions: data('inscriptions') });
const FAKE_TURNSTILE = `window.turnstile = { render(el, o) { setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 50); return 'w'; }, remove() {} };`;

/** 港の API を港の写しで答える。closed の間は網の失敗 */
async function routeHarbor(page: Page) {
  const fake = createFakeHarbor(catalog);
  const state = { closed: false };
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }));
  await page.route('**/api/v1/logs', (route) => route.fulfill({ status: 204 }));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs',
    async (route) => {
      if (state.closed) return route.abort('failed');
      const req = route.request();
      const url = new URL(req.url());
      const r = await fake.serve({ method: req.method() as 'GET', path: url.pathname + url.search, headers: req.headers(), body: req.postData() });
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body ?? '' });
    },
  );
  return { fake, state };
}

/** 開発の板は人の見る画面に無いので、画から外す */
const HIDE_DEV = '.dev-panel { visibility: hidden !important; }';

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
  let n = 0;
  return async (page: Page, shown: Record<string, Locator>) => {
    const targets = Object.values(shown);
    if (targets.length === 0) throw new Error('写すものを 1 つ以上渡す');
    for (const t of targets) await expect(t).toBeInViewport({ ratio: 1 });
    await expectUncovered(shown);
    await expectLegible(page, shown);
    await page.screenshot({ path: join(dir, `${id}-${++n}.png`), style: HIDE_DEV });
  };
}

test.beforeEach(({ page }) => installLens(page));

// 途中で落ちた行の画は、steps の「画 n」と数が合わないので残さない
test.afterEach(({}, info) => {
  if (info.status !== info.expectedStatus && info.status !== 'skipped') shotsDirOf(info).clear();
});

async function playToVerdict(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-1000');
  await expect(page.locator('#verdict-title')).toHaveText(title, { timeout: 60_000 });
}

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

/** canvas に書いた文を拾う (HUD のグラフの目印は canvas の中の文で、DOM では読めない)。文ごとに最後に書いた所 */
function recordCanvasText() {
  type Drawn = { canvas: string; x: number; align: CanvasTextAlign; width: number; canvasWidth: number };
  const drawn: Record<string, Drawn> = {};
  (window as unknown as { __canvasText: () => Record<string, Drawn> }).__canvasText = () => ({ ...drawn });
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof fill>) {
    const [text, x] = args;
    drawn[text] = { canvas: this.canvas.id, x, align: this.textAlign, width: this.measureText(text).width, canvasWidth: this.canvas.width };
    return fill.apply(this, args);
  };
}

test('CRG-005: 漂着を受け取った港の口の文、HUD のグラフの漂着の目印、着いた浜のセルの密度', async ({ page }, info) => {
  const shoot = shotsOf(info);
  await page.addInitScript(recordCanvasText);
  const harbor = await routeHarbor(page);
  await harbor.fake.serve(writeRequest({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'wolf', amount: 0.411 }, { speciesId: 'deer', amount: 0.254 }] } }));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
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
  await page.click('#speed-1');
  const density = (name: string) => page.locator('#cell-info > div', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('.mono');
  await expect.poll(async () => Number(await density('狼').textContent()), { timeout: 10_000 }).toBeGreaterThan(0.3);
  await page.click('#speed-0');
  expect(Number(await density('鹿').textContent())).toBeGreaterThan(0.2);
  const label = '漂着 (狼・鹿)';
  const marker = await page.evaluate((text) => (window as unknown as { __canvasText: () => Record<string, { canvas: string; x: number; align: string; width: number; canvasWidth: number }> }).__canvasText()[text], label);
  expect(marker?.canvas).toBe('graph');
  if (!marker) throw new Error(`${label} が HUD のグラフに書かれていない`);
  const [left, right] = marker.align === 'right' ? [marker.x - marker.width, marker.x] : [marker.x, marker.x + marker.width];
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeLessThanOrEqual(marker.canvasWidth);
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
  await page.goto('/');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');

  await page.click('#new-island');
  await expectAsk(page, '新しい島', '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)');
  await shoot(page, { 確かめの板: dialog(page) });
  await dialog(page).getByRole('button', { name: 'やめる' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.selectOption('#slot-select', 'manual-3');
  await page.click('#slot-save');
  const first = `枠 3 · ${await page.locator('#hud-year').textContent()}`;
  await expect(page.locator('#slot-select option[value="manual-3"]')).toHaveText(first);
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(first.replace('枠 3 · ', ''), { timeout: 30_000 });
  await page.click('#speed-0');
  await page.click('#slot-save');
  await expectAsk(page, '枠を上書きする', `「${first}」を今の島で上書きしますか (前の保存には戻せません)`);
  await shoot(page, { 確かめの板: dialog(page) });
  await dialog(page).getByRole('button', { name: 'やめる' }).click();

  await playToVerdict(page, '/?scenario=test-quick&dev=1&shortcut=alive', '島は生き延びた');
  await page.locator('#verdict-retry').click();
  await expectAsk(page, '判定の出た島を離れる', '判定の出た島を離れますか。枠へ保存していなければ、この島には戻れません (港へ出す島は港に残ります)');
  await shoot(page, { 確かめの板: dialog(page) });
});

type View = { sea: boolean; cellHidden: boolean; markerHidden: boolean; markerOnScreen: boolean; screen: { x: number; y: number } };
type Selection = { cell: number | null; size: number; marker: { scale: number } | null; view: View | null; camera: { x: number; y: number; z: number } };

const selection = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as unknown as { __probe?: Probe }).__probe?.scene;
    return (scene ? scene.selection() : null) as Selection | null;
  });

/** 見えて選べるかの形 (screen を除く) */
const seen = (v: View | null | undefined) => v && { sea: v.sea, cellHidden: v.cellHidden, markerHidden: v.markerHidden, markerOnScreen: v.markerOnScreen };

/** カメラが止まるまで待つ (OrbitControls の damping。低い fps では数秒かかる)。3 回続けて動かなければ止まったとみる */
async function settle(page: Page) {
  let last = { x: NaN, y: NaN, z: NaN };
  let still = 0;
  await expect
    .poll(
      async () => {
        const c = (await selection(page))?.camera ?? last;
        still = Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) < 1e-4 ? still + 1 : 0;
        last = c;
        return still >= 3;
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe(true);
}

/**
 * カメラを縦に倒す (度、正で水平へ)。OrbitControls は画面の高さのドラッグで 1 回りする。
 * 角の限り (真上・水平の手前) に当てると余りの回しが後に残るので、限りに当てない角だけを使う。
 * ドラッグを離した所のセルが選ばれる (canvas の click) ので、水平へ倒すときは空 (画面の上の縁) で離し、選んだセルを変えない
 */
async function tilt(page: Page, box: { x: number; y: number; width: number; height: number }, degrees: number) {
  const x = box.x + box.width * 0.4;
  const top = box.y + 5;
  const d = (box.height * Math.abs(degrees)) / 360;
  const [from, to] = degrees > 0 ? [top + d, top] : [top, top + d];
  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.mouse.move(x, to, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}

/** 寄ったカメラ (45°) から倒して、選んだセルを手前の丘に隠す角 */
const LOW = 35;

test('SEL-003: 選んだセルの帯とピン (遠い既定のカメラ・寄ったカメラ・丘に隠れたセル)', async ({ page }, info) => {
  test.setTimeout(240_000);
  const shoot = shotsOf(info);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await page.click('#speed-0');
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  const cellInfo = page.locator('#cell-info');
  const visible = { sea: false, cellHidden: false, markerHidden: false, markerOnScreen: true };

  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(cellInfo).toContainText(/^セル \(\d+, \d+\)/);
  await expect.poll(async () => seen((await selection(page))?.view), { timeout: 15_000 }).toEqual(visible);
  await shoot(page, { セルの詳細: cellInfo });

  const far = (await selection(page))?.marker?.scale ?? 0;
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  await settle(page);
  expect((await selection(page))?.marker?.scale).toBeLessThan(far / 2);
  expect(seen((await selection(page))?.view)).toEqual(visible);
  await shoot(page, { セルの詳細: cellInfo });

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
  await shoot(page, { セルの詳細: cellInfo });
});
