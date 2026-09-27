import { test, expect, type Page } from '@playwright/test';

/** assets/data/world.default.json の ticksPerYear。test-quick も上書きしない */
const TICKS_PER_YEAR = 360;

type Logged = { event: string; slot?: string; tick: number };

function collectLogs(page: Page): Logged[] {
  const logs: Logged[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"persist.')) logs.push(JSON.parse(t) as Logged);
  });
  return logs;
}

/** 確かめのダイアログ (M21-04) を受ける・取り消す */
const answerDialog = (page: Page, accept: boolean) => page.getByRole('alertdialog').locator(accept ? '.confirm-ok' : '.confirm-cancel').click();

const saved = (logs: Logged[], slot: string) => logs.filter((l) => l.event === 'persist.saved' && l.slot === slot);

/** IndexedDB に確定した自動の枠の tick。ページの記録ではなく置き場そのものを読む */
const storedAutoTick = (page: Page): Promise<number | null> =>
  page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('saves').objectStore('saves').get('auto');
          req.onsuccess = () => {
            open.result.close();
            resolve((req.result as { save: { tick: number } } | undefined)?.save.tick ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );

/** HUD の年と日から今の tick を読む (Day は tick % ticksPerYear) */
async function shownTick(page: Page): Promise<number> {
  const year = Number((await page.locator('#hud-year').textContent())?.replace('Year ', ''));
  const day = Number((await page.locator('#hud-season').textContent())?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

async function runUntilAutosaved(page: Page, logs: Logged[], minTick: number) {
  await page.click('#speed-100');
  await expect.poll(() => saved(logs, 'auto').some((l) => l.tick >= minTick), { timeout: 30_000 }).toBe(true);
  await page.click('#speed-0');
}

/** タブが隠れたときと同じ経路を通す (page.close では visibilitychange が出るとは限らない) */
const hideTab = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

test('M19-05: 閉じて開き直すと、止めた所の続きから遊べる (自動保存と、隠れたときの書き込み)', async ({ context }) => {
  const first = await context.newPage();
  const firstLogs = collectLogs(first);
  await first.goto('/');
  await expect(first.locator('#hud-year')).toHaveText('Year 0');
  await runUntilAutosaved(first, firstLogs, TICKS_PER_YEAR);
  const pausedAt = await shownTick(first);
  await hideTab(first);
  await expect.poll(() => storedAutoTick(first)).toBe(pausedAt);
  await first.close();

  const second = await context.newPage();
  const secondLogs = collectLogs(second);
  await second.goto('/');
  // 開き直した島は 1 倍速で進むので、HUD は止めた tick 以上 (ちょうどの値は persist.resumed の tick で見る)
  await expect.poll(() => shownTick(second)).toBeGreaterThanOrEqual(pausedAt);
  expect(await shownTick(second)).toBeLessThan(pausedAt + 60);
  await expect.poll(() => secondLogs.filter((l) => l.event === 'persist.resumed')).toEqual([expect.objectContaining({ slot: 'auto', tick: pausedAt })]);
  await expect(second.locator('#slot-select option[value="auto"]')).toHaveText(`自動 · Year ${Math.floor(pausedAt / TICKS_PER_YEAR)}`);
});

test('M19-05: 手動の枠に保存し、先へ進めてから読み込むと保存した島に戻り、開き直してもその島から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await page.selectOption('#slot-select', 'manual-2');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText('枠 2 · 空き');
  await expect(page.locator('#slot-load')).toBeDisabled();
  await runUntilAutosaved(page, logs, TICKS_PER_YEAR);
  const savedAt = await shownTick(page);
  const savedYear = `Year ${Math.floor(savedAt / TICKS_PER_YEAR)}`;

  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(savedYear, { timeout: 30_000 });
  await page.click('#speed-0');
  await page.click('#slot-load');
  await answerDialog(page, true);
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  // 読み込んだ島をその場で自動の枠に書く (止めたまま閉じても、読み込む前の島に戻らない)
  await expect.poll(() => storedAutoTick(page)).toBe(savedAt);

  await page.reload();
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);
});

test('M19-05: 「新しい島」は確かめてから Year 0 に作り直し (取り消せば今の島のまま)、開き直しても新しい島から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await runUntilAutosaved(page, logs, TICKS_PER_YEAR);
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0');

  const before = await storedAutoTick(page);
  await page.click('#new-island');
  await answerDialog(page, false);
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0');
  expect(await storedAutoTick(page)).toBe(before);

  await page.click('#new-island');
  await answerDialog(page, true);
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect.poll(() => storedAutoTick(page)).toBe(0);
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText('自動 · Year 0');

  await page.reload();
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
});

test('M19-05: シナリオ中は自由モードの自動の枠から戻さず、自動の枠にも書かない (M19-17 から、石板の中でも枠の読込と「石板を初めから」は押せる)', async ({ context }) => {
  const free = await context.newPage();
  const freeLogs = collectLogs(free);
  await free.goto('/');
  await runUntilAutosaved(free, freeLogs, 90);
  await free.close();

  const page = await context.newPage();
  const logs = collectLogs(page);
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  const before = await storedAutoTick(page);
  expect(before).not.toBeNull();
  await page.selectOption('#slot-select', 'auto');
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText(`自動 · Year ${Math.floor((before ?? 0) / TICKS_PER_YEAR)}`);
  await expect(page.locator('#slot-load')).toBeEnabled();
  await expect(page.locator('#load-input')).toBeEnabled();
  await expect(page.getByRole('button', { name: '石板を初めから' })).toBeEnabled();

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).toHaveText('Year 1', { timeout: 30_000 });
  await hideTab(page);
  expect(await storedAutoTick(page)).toBe(before);
  expect(logs.filter((l) => l.event === 'persist.resumed' || l.event === 'persist.saved')).toEqual([]);
});

/** IndexedDB に確定した石板の途中の島 (M19-14) の tick と、同じ transaction で書いた年代記の命令の数 */
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

test('M19-14: シナリオの途中で閉じて開き直すと、同じ年・同じ石板の状態 (力・年表・年代記) から続く', async ({ context }) => {
  test.setTimeout(180_000);
  const first = await context.newPage();
  const firstLogs = collectLogs(first);
  await first.goto('/?scenario=test-quick');
  await first.click('#speed-0');
  await expect(first.locator('#tablet-power')).toHaveText('10 / 30');
  const box = await first.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await first.click('#spawn-grass');
  await first.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(first.locator('#tablet-power')).toHaveText('7 / 30');
  // 受理された介入の直後に、島・runner・年代記を書く
  const clickedAt = await shownTick(first);
  await expect.poll(() => storedScenario(first, 'test-quick')).toEqual({ tick: clickedAt, commands: 1 });

  // test-quick は 2 年目に滅ぶので、1 年目のうちに止めて閉じる。100 倍速では 1 年目が数秒で過ぎ、並べて回すと止め損ねるので 10 倍速にする
  await first.click('#speed-10');
  await expect(first.locator('#tablet-year')).toHaveText('1 / 5 年', { timeout: 90_000 });
  await first.click('#speed-0');
  const pausedAt = await shownTick(first);
  expect(pausedAt).toBeLessThan(2 * TICKS_PER_YEAR);
  const shown = {
    power: await first.locator('#tablet-power').textContent(),
    flow: await first.locator('#tablet-power-flow').textContent(),
    timeline: await first.locator('#tablet-timeline-summary').textContent(),
  };
  await hideTab(first);
  await expect.poll(() => storedScenario(first, 'test-quick')).toEqual({ tick: pausedAt, commands: 1 });
  expect(firstLogs.filter((l) => l.event === 'persist.scenario.saved').length).toBeGreaterThan(0);
  await first.close();

  const second = await context.newPage();
  const secondLogs = collectLogs(second);
  await second.goto('/?scenario=test-quick');
  await expect.poll(() => secondLogs.filter((l) => l.event === 'persist.scenario.resumed').map((l) => l.tick)).toEqual([pausedAt]);
  await second.click('#speed-0');
  await expect(second.locator('#tablet-year')).toHaveText('1 / 5 年');
  await expect(second.locator('#hud-year')).toHaveText('Year 1');
  await expect(second.locator('#tablet-power')).toHaveText(shown.power ?? '');
  await expect(second.locator('#tablet-power-flow')).toHaveText(shown.flow ?? '');
  await expect(second.locator('#tablet-timeline-summary')).toHaveText(shown.timeline ?? '');
  await expect(second.locator('#tablet-timeline')).toContainText('0 年:');

  // 続けて介入すると、年代記は閉じる前の命令の後ろに積まれる
  await second.click('#spawn-grass');
  await second.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect.poll(async () => (await storedScenario(second, 'test-quick'))?.commands).toBe(2);
});

test('M19-14: 同じ石板の他人の島を訪れても (M19-09 の ?visit)、自分の続きから戻さず、訪れた島を自分の続きとして書かない', async ({ context }) => {
  const own = await context.newPage();
  await own.goto('/?scenario=test-quick');
  await own.click('#speed-0');
  const box = await own.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await own.click('#spawn-grass');
  await own.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(own.locator('#tablet-power')).toHaveText('7 / 30');
  const clickedAt = await shownTick(own);
  const mine = { tick: clickedAt, commands: 1 };
  await expect.poll(() => storedScenario(own, 'test-quick')).toEqual(mine);
  await own.close();

  const visit = await context.newPage();
  const logs = collectLogs(visit);
  // 港は閉じている (訪れた島の年代記は届かず、島は Year 0 で止まったまま)
  await visit.route((url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs', (route) => route.abort('failed'));
  await visit.goto(`/?scenario=test-quick&visit=${'a'.repeat(64)}`);
  await expect(visit.locator('#tablet-power')).toHaveText('10 / 30');
  await expect(visit.locator('#tablet-year')).toHaveText('0 / 5 年');
  await hideTab(visit);
  await visit.waitForTimeout(500);
  expect(await storedScenario(visit, 'test-quick')).toEqual(mine);
  expect(logs.filter((l) => l.event.startsWith('persist.scenario.'))).toEqual([]);
});
