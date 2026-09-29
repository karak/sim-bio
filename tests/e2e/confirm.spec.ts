import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';
import { expectUncovered } from './uncovered';

/**
 * やり直しの効かない操作は確かめのダイアログを経る (M21-04)。取り消せば何も変わらず、受ければその操作をする。
 * 判定の後にも枠へ保存でき、読み戻せる。港の API と Turnstile は scenarioSave.spec.ts と同じく港の写しで答える。
 * CONFIRM_SHOTS に置き場を渡すと、画面の撮影を残す
 */
const TICKS_PER_YEAR = 360;
const data = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: data('scenarios'), species: data('species'), inscriptions: data('inscriptions') });
const FAKE_TURNSTILE = `window.turnstile = {
  render(el, o) { setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 100); return 'w'; },
  remove() {},
};`;

async function routeHarbor(page: Page) {
  const fake = createFakeHarbor(catalog);
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs',
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const r = await fake.serve({ method: req.method() as 'GET', path: url.pathname + url.search, headers: req.headers(), body: req.postData() });
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body ?? '' });
    },
  );
  await page.route('**/api/v1/logs', (route) => route.fulfill({ status: 204 }));
  return fake;
}

async function shot(page: Page, name: string) {
  const dir = process.env.CONFIRM_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function shownTick(page: Page): Promise<number> {
  const year = Number((await page.locator('#hud-year').textContent())?.replace('Year ', ''));
  const day = Number((await page.locator('#hud-season').textContent())?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

const dialog = (page: Page) => page.getByRole('alertdialog');

/** 確かめのダイアログが title と message で出ていることを確かめ、取り消す (やめる) か受ける */
async function answer(page: Page, want: { title: string; message: string }, accept: boolean) {
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading')).toHaveText(want.title);
  await expect(d).toContainText(want.message);
  await d.getByRole('button', { name: accept ? /^(?!やめる)/ : 'やめる' }).click();
  await expect(d).toBeHidden();
}

/** 自由モードの島を少し進めて止める */
async function runFree(page: Page) {
  await page.goto('/');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');
}

const NEW_ISLAND = { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)' };
const LEAVE = { title: '判定の出た島を離れる', message: '判定の出た島を離れますか。枠へ保存していなければ、この島には戻れません (港へ出す島は港に残ります)' };

test('M21-04: 確かめのダイアログは alertdialog で、開くと「やめる」に focus があり、Esc で取り消し、確かめの札に移って Enter で受ける', async ({ page }) => {
  await runFree(page);
  const year = await page.locator('#hud-year').textContent();
  const tick = await shownTick(page);

  await page.click('#new-island');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d).toHaveAttribute('aria-modal', 'true');
  await expect(d.getByRole('heading')).toHaveText(NEW_ISLAND.title);
  await expect(d.locator('p')).toHaveText(NEW_ISLAND.message);
  await expect(d.getByRole('button', { name: 'やめる' })).toBeFocused();
  // Tab は板の中を回る (後ろの画面へ抜けない)
  await page.keyboard.press('Tab');
  await expect(d.getByRole('button', { name: '新しい島を始める' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(d.getByRole('button', { name: 'やめる' })).toBeFocused();
  await shot(page, 'm21-04-confirm');

  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(page.locator('#hud-year')).toHaveText(year ?? '');
  expect(await shownTick(page)).toBe(tick);
  // 閉じたら押した札へ focus を返す
  await expect(page.locator('#new-island')).toBeFocused();

  // 「やめる」に focus があるまま Enter は取り消し
  await page.click('#new-island');
  await expect(d.getByRole('button', { name: 'やめる' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();
  expect(await shownTick(page)).toBe(tick);

  await page.click('#new-island');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.locator('#hud-season')).toHaveText(/Day 0$/);
});

test('M21-04: 枠の読込とファイルの読込は、取り消せば今の島のまま (年・日・自動の枠の一覧)、受ければ読んだ島になる', async ({ page }) => {
  await runFree(page);
  await page.selectOption('#slot-select', 'manual-1');
  await page.click('#slot-save');
  const savedAt = await shownTick(page);
  const savedYear = `Year ${Math.floor(savedAt / TICKS_PER_YEAR)}`;
  await expect(page.locator('#slot-select option[value="manual-1"]')).toHaveText(`枠 1 · ${savedYear}`);
  const download = page.waitForEvent('download');
  await page.click('#save-btn');
  const file = readFileSync(await (await download).path());

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(savedYear, { timeout: 30_000 });
  await page.click('#speed-0');
  const now = await shownTick(page);
  const auto = page.locator('#slot-select option[value="auto"]');
  const autoText = await auto.textContent();
  const read = { title: '枠の島を読み込む', message: '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)' };

  await page.click('#slot-load');
  await answer(page, read, false);
  expect(await shownTick(page)).toBe(now);

  await page.locator('#load-input').setInputFiles({ name: 'island.json', mimeType: 'application/json', buffer: file });
  await answer(page, read, false);
  expect(await shownTick(page)).toBe(now);
  await expect(auto).toHaveText(autoText ?? '');

  await page.click('#slot-load');
  await answer(page, read, true);
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  expect(await shownTick(page)).toBe(savedAt);

  await page.click('#new-island');
  await answer(page, NEW_ISLAND, true);
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.locator('#load-input').setInputFiles({ name: 'island.json', mimeType: 'application/json', buffer: file });
  await answer(page, read, true);
  // HUD は次のフレームで読んだ島を写す。写るのを待ってから日まで比べる (M21-10)
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  expect(await shownTick(page)).toBe(savedAt);
});

test('M21-04: 書いてある枠へ保存するときだけ確かめ、取り消せば枠の中身 (一覧の年) は前のまま、受ければ上書きする', async ({ page }) => {
  await runFree(page);
  await page.selectOption('#slot-select', 'manual-3');
  await page.click('#slot-save');
  // 空きの枠へはダイアログを出さない
  await expect(dialog(page)).toBeHidden();
  const first = `枠 3 · ${await page.locator('#hud-year').textContent()}`;
  const label = page.locator('#slot-select option[value="manual-3"]');
  await expect(label).toHaveText(first);

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(first.replace('枠 3 · ', ''), { timeout: 30_000 });
  await page.click('#speed-0');
  const second = `枠 3 · ${await page.locator('#hud-year').textContent()}`;
  const over = { title: '枠を上書きする', message: `「${first}」を今の島で上書きしますか (前の保存には戻せません)` };

  await page.click('#slot-save');
  await answer(page, over, false);
  await page.reload();
  await expect(label).toHaveText(first);

  await page.click('#speed-0');
  await page.selectOption('#slot-select', 'manual-3');
  await page.click('#slot-save');
  await answer(page, over, true);
  await expect(label).toHaveText(second);
});

test('M21-04: 判定の後に枠へ保存でき (判定の板に覆われない)、判定の出た島を離れる操作 (もう一度・自由モードへ・石板を選ぶ) は確かめ、取り消せば判定の島のまま。保存した枠を読むと判定の島に戻る', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 90_000 });
  const verdictTick = await shownTick(page);
  const tabletYear = await page.locator('#tablet-year').textContent();
  const timeline = await page.locator('#tablet-timeline-summary').textContent();

  // 枠へ保存は判定の板の下敷きにならない (札の真ん中の要素が札そのもの)
  const save = page.locator('#slot-save');
  await page.selectOption('#slot-select', 'manual-2');
  await expectUncovered({ 枠へ保存: save });
  await save.click();
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · 試し読み · ${Math.floor(verdictTick / TICKS_PER_YEAR)} 年`);
  await shot(page, 'm21-04-verdict-save');

  const url = page.url();
  // test-quick は一覧に出ない石板なので、石板の選びは初めの札 (自由モード) を指している
  const chosen = await page.locator('#tablet-select').inputValue();
  await page.locator('#verdict-retry').click();
  await answer(page, LEAVE, false);
  await page.locator('#verdict-free').click();
  await answer(page, LEAVE, false);
  await page.selectOption('#tablet-select', 'sinking');
  await answer(page, LEAVE, false);
  await expect(page.locator('#tablet-select')).toHaveValue(chosen);
  expect(page.url()).toBe(url);
  await expect(page.locator('#verdict')).toBeVisible();
  expect(await shownTick(page)).toBe(verdictTick);

  // 受ければ移る (もう一度 = 同じ石板の初めから)
  await page.locator('#verdict-retry').click();
  await answer(page, LEAVE, true);
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  await page.click('#speed-0');
  await expect(page.locator('#verdict')).toBeHidden();

  await page.selectOption('#slot-select', 'manual-2');
  await page.click('#slot-load');
  await answer(page, { title: '枠の島を読み込む', message: '石板を枠の時点に戻しますか (今の続きは上書きされます)' }, true);
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  await expect(page.locator('#tablet-year')).toHaveText(tabletYear ?? '');
  await expect(page.locator('#tablet-timeline-summary')).toHaveText(timeline ?? '');
  expect(await shownTick(page)).toBe(verdictTick);
});

test('M21-04: 判定の前の石板から石板を選び直すのは確かめない (続きは書き切ってから移り、戻れば続きから)', async ({ page }) => {
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-0');
  await page.selectOption('#tablet-select', 'sinking');
  await expect(page).toHaveURL((u) => u.search === '?scenario=sinking');
  await expect(page.locator('#tablet-title')).toContainText('沈む');
  await expect(dialog(page)).toHaveCount(0);
});

test('M21-04: 港から取り下げるのは確かめ、取り消せば港に残り、受ければ一覧から消える。判定の出た島から「この島を訪れる」も離れる確かめを経る', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page);
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 90_000 });
  const panel = page.getByRole('region', { name: '港へ出す' });
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const [id] = [...harbor.ledger.keys()];

  const here = page.url();
  await panel.getByRole('link', { name: 'この島を訪れる' }).click();
  await answer(page, LEAVE, false);
  expect(page.url()).toBe(here);

  await page.goto('/');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const card = page.getByRole('list', { name: '流れ着いた年代記' }).locator(`[data-id="${id}"]`);
  const name = await card.getByRole('heading').textContent();
  const withdraw = { title: '港から取り下げる', message: `${name}を港から取り下げますか (たどって確かめた人の数ごと消え、戻せません)` };
  await card.getByRole('button', { name: '取り下げる' }).click();
  await answer(page, withdraw, false);
  expect(harbor.ledger.has(id)).toBe(true);
  await expect(card).not.toHaveClass(/harbor-card-gone/);
  await expect(card.getByRole('button', { name: '取り下げる' })).toBeEnabled();

  await card.getByRole('button', { name: '取り下げる' }).click();
  await answer(page, withdraw, true);
  await expect(card).toHaveClass(/harbor-card-gone/);
  expect(harbor.ledger.has(id)).toBe(false);
});
