import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';

/**
 * 石板の中の枠の保存・読込・初めから、と URL の舞台 (M19-17、設計 docs/design/2026-09-27-scenario-save-url.md §7)。
 * 港の API と Turnstile は harbor.spec.ts と同じく、港の写し (tests/fixtures/fakeHarbor.ts) で page.route() に答える
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

type Logged = { event: string; level: string; slot?: string; tick: number; scenario?: string };
function collectLogs(page: Page): Logged[] {
  const logs: Logged[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"persist.')) logs.push(JSON.parse(t) as Logged);
  });
  return logs;
}

async function shownTick(page: Page): Promise<number> {
  const year = Number((await page.locator('#hud-year').textContent())?.replace('Year ', ''));
  const day = Number((await page.locator('#hud-season').textContent())?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

/** IndexedDB に確定した石板の続き (M19-14) の tick と年代記の命令の数 */
const storedScenario = (page: Page, scenarioId: string): Promise<{ tick: number; commands: number } | null> =>
  page.evaluate(
    (id) =>
      new Promise<{ tick: number; commands: number } | null>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['scenarios', 'chronicles']);
          const island = tx.objectStore('scenarios').get(id);
          const chronicle = tx.objectStore('chronicles').get(id);
          tx.oncomplete = () => {
            open.result.close();
            const s = island.result as { save: { tick: number } } | undefined;
            const c = chronicle.result as { commands: unknown[] } | undefined;
            resolve(s && c ? { tick: s.save.tick, commands: c.commands.length } : null);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    scenarioId,
  );

const hasFinished = (page: Page, scenarioId: string): Promise<boolean> =>
  page.evaluate(
    (id) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('finished').objectStore('finished').get(id);
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result !== undefined);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    scenarioId,
  );

/** 島の中ほどに草を放つ (test-quick の放流は力 3) */
async function spawnGrass(page: Page) {
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.click('#spawn-grass');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
}

/** 次のダイアログの文を確かめて受ける */
const acceptDialog = (page: Page, message: string) =>
  new Promise<void>((resolve, reject) => {
    page.once('dialog', (d) => {
      const got = d.message();
      void d.accept().then(() => (got === message ? resolve() : reject(new Error(`dialog: ${got}`))));
    });
  });

test('M19-17: 石板で枠に保存し、介入して進めてから読むと、石板の年・力・年表・年代記が保存の時点に戻る。戻した島を判定まで回して港へ出すと、訪れた側の回し直しで同じ結末になる', async ({ page }) => {
  test.setTimeout(240_000);
  const harbor = await routeHarbor(page);
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-0');
  await spawnGrass(page);
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  const savedAt = await shownTick(page);
  await page.selectOption('#slot-select', 'manual-1');
  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-1"]')).toHaveText('枠 1 · 試し読み · 0 年');
  const shown = { power: await page.locator('#tablet-power').textContent(), timeline: await page.locator('#tablet-timeline-summary').textContent() };
  expect(shown.timeline).toBe('年表 (1)');

  await spawnGrass(page);
  await expect(page.locator('#tablet-power')).toHaveText('4 / 30');
  await expect(page.locator('#tablet-timeline-summary')).toHaveText('年表 (2)');
  await page.click('#speed-10');
  await expect.poll(() => shownTick(page), { timeout: 30_000 }).toBeGreaterThan(savedAt + 60);
  await page.click('#speed-0');
  await expect.poll(async () => (await storedScenario(page, 'test-quick'))?.commands).toBe(2);

  const asked = acceptDialog(page, '石板を枠の時点に戻しますか (今の続きは上書きされます)');
  await page.click('#slot-load');
  await asked;
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  await expect(page.locator('#tablet-power')).toHaveText(shown.power ?? '');
  await expect(page.locator('#tablet-timeline-summary')).toHaveText('年表 (1)');
  expect(await shownTick(page)).toBe(savedAt);
  await expect.poll(() => storedScenario(page, 'test-quick')).toEqual({ tick: savedAt, commands: 1 });

  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const panel = page.getByRole('region', { name: '港へ出す' });
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const [id] = [...harbor.ledger.keys()];
  expect(harbor.ledger.get(id)?.chronicle.commands.map((c) => c.tick)).toEqual([savedAt]);

  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();
  await page.goto(url);
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読み終えた。港の記録と同じ結末になった', { timeout: 90_000 });
  expect(harbor.ledger.get(id)?.card).toMatchObject({ confirms: 1, mismatches: 0 });
});

test('M19-17: 自由モードの枠を石板の中で読むと、確かめてから自由モード (/) へ移ってその島になり、石板の続きは書き換わらない', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');
  const freeAt = await shownTick(page);
  const freeYear = `Year ${Math.floor(freeAt / TICKS_PER_YEAR)}`;
  await page.selectOption('#slot-select', 'manual-2');
  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${freeYear}`);

  await page.goto('/?scenario=test-quick');
  await page.click('#speed-0');
  await spawnGrass(page);
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  const tablet = { tick: await shownTick(page), commands: 1 };
  await expect.poll(() => storedScenario(page, 'test-quick')).toEqual(tablet);

  await page.selectOption('#slot-select', 'manual-2');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${freeYear}`);
  const asked = acceptDialog(page, '自由モードの枠です。自由モードを開いて読みますか');
  await page.click('#slot-load');
  await asked;
  await expect(page).toHaveURL((u) => u.pathname === '/' && u.search === '');
  await expect(page.locator('#tablet-select')).toHaveValue('');
  await page.click('#speed-0');
  await expect.poll(() => logs.filter((l) => l.event === 'persist.saved' && l.slot === 'auto').map((l) => l.tick)).toContain(freeAt);
  expect(Math.floor((await shownTick(page)) / TICKS_PER_YEAR)).toBe(Math.floor(freeAt / TICKS_PER_YEAR));
  expect(await storedScenario(page, 'test-quick')).toEqual(tablet);
  expect(logs.filter((l) => l.event === 'persist.slot.load.failed')).toEqual([]);
});

test('M19-17: 「石板を初めから」は確かめてから Year 0・力の初期値・年表なしに戻し、判定の出た島は港の板に残る', async ({ page }) => {
  test.setTimeout(120_000);
  await routeHarbor(page);
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
  // 判定の出た島 (M19-14 の直し) は、要約を作ってから港の置き場 finished に書く。書き終える前に閉じない
  await expect.poll(() => hasFinished(page, 'test-quick')).toBe(true);
  await page.reload();
  await page.click('#speed-0');
  await spawnGrass(page);
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  await page.click('#speed-10');
  await expect.poll(() => shownTick(page), { timeout: 30_000 }).toBeGreaterThan(60);
  await page.click('#speed-0');

  const restart = page.getByRole('button', { name: '石板を初めから' });
  page.once('dialog', (d) => void d.dismiss());
  await restart.click();
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');

  const asked = acceptDialog(page, '今の続きを捨てて、石板を初めからやり直しますか (判定の出た島は港へ出せるまま残ります)');
  await restart.click();
  await asked;
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.locator('#hud-season')).toHaveText(/Day 0$/);
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  await expect(page.locator('#tablet-timeline-summary')).toHaveText('年表 (0)');
  await expect.poll(() => storedScenario(page, 'test-quick')).toEqual({ tick: 0, commands: 0 });

  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drawer = page.getByRole('complementary', { name: '港' });
  await expect(drawer.locator('.harbor-finished')).toContainText('この石板で最後に判定の出た島');
  await expect(drawer.getByRole('region', { name: '港へ出す' }).getByRole('button', { name: '出港する' })).toBeEnabled();
});

test('M19-17: 知らない石板の URL (?scenario=nope) は自由モードで開き、URL から scenario を消して記録に残す', async ({ page }) => {
  const logs: { event: string; level: string; scenario?: string }[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"persist.url.')) logs.push(JSON.parse(t) as { event: string; level: string; scenario?: string });
  });
  await page.goto('/?scenario=nope&speed=x');
  await expect(page.locator('#tablet-select')).toHaveValue('');
  await expect(page).toHaveURL((u) => u.pathname === '/' && u.search === '?speed=x');
  await expect(page.getByRole('button', { name: '新しい島' })).toBeEnabled();
  await expect.poll(() => logs).toEqual([expect.objectContaining({ level: 'warn', event: 'persist.url.unknown_scenario', scenario: 'nope' })]);
});

test('M19-17: 訪問 (他人の島) では枠への保存・読込・ファイルの読込・新しい島を押せない', async ({ page }) => {
  await page.route((url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs', (route) => route.abort('failed'));
  await page.goto(`/?scenario=test-quick&visit=${'a'.repeat(64)}`);
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  for (const id of ['#slot-save', '#slot-load', '#load-input', '#new-island']) await expect(page.locator(id)).toBeDisabled();
  await expect(page.locator('#new-island')).toHaveText('新しい島');
  await expect(page.locator('#slot-save')).toHaveAttribute('title', '訪れている島は差し替えられない (他人の島)');
});

test('M19-17: 包みの無い古い枠とファイル (M19-17 より前の SaveData) は自由モードの島として読める', async ({ page }) => {
  await page.goto('/');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');
  const oldYear = await page.locator('#hud-year').textContent();
  const download = page.waitForEvent('download');
  await page.click('#save-btn');
  const file = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as { stage: string; save: { tick: number } };
  expect(file.stage).toBe('free');
  const bare = JSON.stringify(file.save);

  page.once('dialog', (d) => void d.accept());
  await page.click('#new-island');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.evaluate(
    (save) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onsuccess = () => {
          const tx = open.result.transaction(['saves', 'slots'], 'readwrite');
          const parsed = JSON.parse(save) as { tick: number };
          tx.objectStore('saves').put(parsed, 'manual-3');
          tx.objectStore('slots').put({ slot: 'manual-3', savedAt: 1, year: Math.floor(parsed.tick / 360) });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    bare,
  );
  await page.reload();
  await page.click('#speed-0');
  await page.selectOption('#slot-select', 'manual-3');
  await expect(page.locator('#slot-select option[value="manual-3"]')).toHaveText(`枠 3 · ${oldYear}`);
  const asked = acceptDialog(page, '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)');
  await page.click('#slot-load');
  await asked;
  await expect(page.locator('#hud-year')).toHaveText(oldYear ?? '');
  expect(await shownTick(page)).toBe(file.save.tick);

  page.once('dialog', (d) => void d.accept());
  await page.click('#new-island');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  const fromFile = acceptDialog(page, '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)');
  await page.locator('#load-input').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(bare) });
  await fromFile;
  await expect(page.locator('#hud-year')).toHaveText(oldYear ?? '');
  expect(await shownTick(page)).toBe(file.save.tick);
});

test('M19-17: 石板の枠を自由モードで読むと、確かめてからその石板へ移り、開いた直後に枠の時点 (力・年表・年代記) から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-0');
  await spawnGrass(page);
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  const savedAt = await shownTick(page);
  await page.selectOption('#slot-select', 'manual-1');
  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-1"]')).toHaveText('枠 1 · 試し読み · 0 年');

  await page.goto('/');
  await page.selectOption('#slot-select', 'manual-1');
  const moved = acceptDialog(page, '石板『試し読み』の枠です。石板を開いて読みますか');
  await page.click('#slot-load');
  await moved;
  await expect(page).toHaveURL((u) => u.search === '?scenario=test-quick');
  await page.click('#speed-0');
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  await expect(page.locator('#tablet-timeline-summary')).toHaveText('年表 (1)');
  await expect.poll(() => logs.filter((l) => l.event === 'persist.scenario.saved').map((l) => l.tick)).toContain(savedAt);
  expect(logs.filter((l) => l.event === 'persist.scenario.resumed')).toEqual([]);
});

test('M19-17: 移った先で渡された枠が読めなければ、その舞台の自動の続きで開き、記録に残す', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('biotope-pending-slot', 'manual-3'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  await expect.poll(() => logs.filter((l) => l.event === 'persist.slot.load.failed')).toEqual([expect.objectContaining({ level: 'warn', slot: 'manual-3' })]);
  expect(await page.evaluate(() => sessionStorage.getItem('biotope-pending-slot'))).toBeNull();
});
