import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { TICKS_PER_YEAR } from '../driver/island';
import { routeHarbor } from '../driver/harbor';
import { playScenarioToVerdict } from '../driver/verdict';

/**
 * タイトルからシナリオ選択と港へ (M24-03)。title.spec と同じく開発の印を外して素の / を開く。
 * 港は page.route() で決める (routeHarbor は港の写し、閉港は /api を落とす)。どちらも goto と操作の前に置く。各 lane の画は test の出力の置き場に m24-03-lane<n>.png で残す
 */
test.use({ storageState: { cookies: [], origins: [] } });

type Def = { id: string; title: string; prophecy: string; hidden?: boolean };
const scenarios = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as Def[];
/** 操作画面の石板 (Tablet の select) に並ぶ石板。hidden を除いた同じ順 */
const shown = scenarios.filter((d) => !d.hidden);
const sinking = scenarios.find((d) => d.id === 'sinking')!;

const menu = (page: Page) => page.getByRole('menu', { name: 'タイトルのメニュー' });
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name });
const toTitle = (page: Page) => page.getByRole('button', { name: 'タイトルへ' });
const lane = (page: Page, n: number) => page.screenshot({ path: test.info().outputPath(`m24-03-lane${n}.png`) });

function collectAutoSaves(page: Page): number[] {
  const ticks: number[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('"event":"persist.saved"')) return;
    const l = JSON.parse(t) as { slot?: string; tick?: number };
    if (l.slot === 'auto') ticks.push(l.tick ?? 0);
  });
  return ticks;
}

test('M24-03 lane1: タイトル → 新規ゲーム → 石板を選ぶ → 石板の操作画面。進めてから戻ると「続きあり」で続きから開き、操作画面の石板の選択と同じ所から始まる', async ({ page }) => {
  test.setTimeout(150_000);
  await page.context().route('**/api/**', (route) => route.abort('failed'));
  // 新規ゲームの板は自動の枠があるときに開く (無ければ seed 42 の島へ直に入る、M24-02)。先に自由モードを 1 年回して枠を作る
  const saved = collectAutoSaves(page);
  await page.goto('/?seed=42');
  await page.click('#speed-100');
  await expect.poll(() => saved.some((t) => t >= TICKS_PER_YEAR), { timeout: 30_000 }).toBe(true);
  await page.click('#speed-0');
  await toTitle(page).click();
  await expect(item(page, '続きから')).toBeFocused();

  await item(page, '新規ゲーム').click();
  await page.getByRole('dialog', { name: '新規ゲーム' }).getByRole('button', { name: /^石板を選ぶ/ }).click();
  const stones = page.getByRole('dialog', { name: '石板を選ぶ' });
  await expect(stones.getByRole('button', { name: '戻る' })).toBeFocused();
  const rows = stones.getByRole('group', { name: '石板の一覧' }).getByRole('button');
  await expect(rows.locator('.title-option-label')).toHaveText(shown.map((d) => d.title));
  // 開いたときは最初の石板を選んである。予言は石板の文そのまま
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  const detail = stones.getByRole('region', { name: '選んだ石板' });
  await expect(detail.getByRole('heading')).toHaveText(shown[0].title);
  await expect(detail.locator('.title-stone-prophecy')).toHaveText(shown[0].prophecy);

  const sky = shown.find((d) => d.id === 'sky-ship')!;
  await rows.filter({ hasText: sky.title }).click();
  await expect(detail.getByRole('heading')).toHaveText(sky.title);
  await expect(detail.locator('.title-option-note')).toHaveText('逃がす · 200 年');
  await expect(detail.locator('.title-stone-prophecy')).toHaveText(sky.prophecy);
  await rows.filter({ hasText: sinking.title }).click();
  await expect(detail.getByRole('heading')).toHaveText(sinking.title);
  await expect(detail.locator('.title-option-note')).toHaveText('耐える · 100 年');
  const begin = detail.getByRole('button', { name: 'この石板で始める' });
  await expect(begin).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('#tablet-title')).toHaveText(`${sinking.title} · 耐える`);
  await expect(page.locator('#tablet-year')).toHaveText('0 / 100 年');
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
  // 操作画面の石板の選択と同じ検索語 (seed= は石板へ持ち込まない、searchFor)
  expect(new URL(page.url()).search).toBe('?scenario=sinking');
  await lane(page, 1);

  // 石板を 1 年より先まで進めてタイトルへ。石板の板に「続きあり」が出て、札は「続きから始める」
  await page.click('#speed-100');
  await expect(page.locator('#tablet-year')).not.toHaveText('0 / 100 年', { timeout: 30_000 });
  await page.click('#speed-0');
  const left = (await page.locator('#tablet-year').textContent()) ?? '';
  const year = Number(left.split(' / ')[0]);
  await toTitle(page).click();
  await expect(menu(page)).toBeVisible();
  await item(page, '新規ゲーム').click();
  await page.getByRole('dialog', { name: '新規ゲーム' }).getByRole('button', { name: /^石板を選ぶ/ }).click();
  const row = rows.filter({ hasText: sinking.title });
  await expect(row.locator('.title-option-note')).toHaveText(`耐える · 100 年 · 続きあり · ${year} 年`);
  await row.click();
  await detail.getByRole('button', { name: '続きから始める' }).click();
  await page.click('#speed-0');
  await expect(page.locator('#tablet-year')).toHaveText(left);

  // 操作画面の石板の選択 (自由モードの島の Tablet の select) からも、同じ石板の同じ年が開く
  const other = await page.context().newPage();
  await other.goto('/?seed=42');
  await expect(other.locator('#hud-year')).toBeVisible();
  await other.selectOption('#tablet-select', 'sinking');
  await expect(other.locator('#tablet-title')).toHaveText(`${sinking.title} · 耐える`);
  await other.click('#speed-0');
  await expect(other.locator('#tablet-year')).toHaveText(left);
  expect(new URL(other.url()).search).toBe('?scenario=sinking');
});

test('M24-03 lane2: タイトル → 港。判定の出た自分の島をタイトルから出港でき、流れ着いた島の「訪れる」で訪問が開く', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page);
  await playScenarioToVerdict(page, 'test-quick', '島は滅びた');
  await toTitle(page).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '離れる' }).click();
  await expect(menu(page)).toBeVisible();
  // タイトルは港に問わない。港を押してから一覧を引く
  const atTitle = harbor.sent.length;
  await item(page, '港').click();
  const board = page.getByRole('dialog', { name: '港' });
  await expect(board.getByRole('button', { name: '戻る' })).toBeFocused();
  await expect(board.locator('.harbor-finished .harbor-sub')).toHaveText('『試し読み』で最後に判定の出た島');
  await expect(board.locator('#harbor-state')).toHaveText('まだ誰の年代記も流れ着いていない。石板の判定のあとに、自分の島を港へ出せる');
  expect(harbor.sent.slice(atTitle).some((w) => w.method === 'GET' && w.path.startsWith('/api/v1/chronicles'))).toBe(true);

  const pub = board.getByRole('region', { name: '港へ出す' });
  await pub.getByRole('radio', { name: '海が勝った' }).click();
  await pub.getByRole('button', { name: '出港する' }).click();
  await expect(pub.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const [id] = [...harbor.fake.ledger.keys()];
  // 出港すると一覧を引き直し、自分の島が並ぶ
  const card = board.locator(`.harbor-card[data-id="${id}"]`);
  await expect(card.locator('.harbor-inscription')).toHaveText('「海が勝った」');
  await expect(card.locator('.harbor-own')).toHaveText('あなたが出港した島');
  await expect(board.locator('#harbor-state')).toHaveText('港は開いている');
  await expect(board.getByRole('button', { name: '石板を選ぶ' })).toBeHidden();

  await card.getByRole('link', { name: '訪れる' }).click();
  await expect(page.getByRole('region', { name: '訪れている島' })).toBeVisible();
  expect(new URL(page.url()).search).toBe(`?scenario=test-quick&visit=${id}`);
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
  await lane(page, 2);
});

test('M24-03 lane3: 港が閉じていれば、タイトルの港の板は閉港を知らせ、メニューから遊ぶ道はそのまま', async ({ page }) => {
  await page.context().route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await item(page, '港').click();
  const board = page.getByRole('dialog', { name: '港' });
  await expect(board.locator('#harbor-state')).toHaveText('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
  await expect(board.locator('.harbor-card')).toHaveCount(0);
  await expect(board.getByRole('button', { name: '石板を選ぶ' })).toBeHidden();
  await expect(board.locator('.harbor-finished')).toBeHidden();
  await lane(page, 3);
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);
  await expect(item(page, '港')).toBeFocused();
  await item(page, '新規ゲーム').click();
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
});

test('M24-03: 空の港は「石板を選ぶ」を添え、続きの無い手元でも石板の板から石板を始められる。起動とタイトルは港に問わない', async ({ page }) => {
  const harbor = await routeHarbor(page);
  await page.goto('/');
  await expect(item(page, '新規ゲーム')).toBeFocused();
  expect(harbor.sent).toEqual([]);
  await item(page, '港').click();
  const board = page.getByRole('dialog', { name: '港' });
  await expect(board.locator('#harbor-state')).toHaveText('まだ誰の年代記も流れ着いていない。石板の判定のあとに、自分の島を港へ出せる');
  await board.getByRole('button', { name: '石板を選ぶ' }).click();
  const stones = page.getByRole('dialog', { name: '石板を選ぶ' });
  await expect(stones).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await stones.getByRole('group', { name: '石板の一覧' }).getByRole('button', { name: /^空の舟/ }).click();
  await stones.getByRole('button', { name: 'この石板で始める' }).click();
  await expect(page.locator('#tablet-title')).toHaveText('空の舟 · 逃がす');
  expect(new URL(page.url()).search).toBe('?scenario=sky-ship');
});
