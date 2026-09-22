import { test, expect } from '@playwright/test';

test('boots, advances a year at 100x, graph shows values, layer switch works', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 20_000 });
  await expect(page.locator('#stat-veg')).not.toHaveText('--%');
  // 凡例に現在の総量が数字で出る
  await expect(page.locator('#legend-grass')).toHaveText(/^\d+$/);
  await page.click('#layer-temperature');
  await expect(page.locator('#layer-temperature')).toHaveClass(/on/);
  // 輝石チップでレイヤーが切り替わる (M8-01)
  await page.click('#layer-crystal');
  await expect(page.locator('#layer-crystal')).toHaveClass(/on/);
  await expect(page.locator('#layer-temperature')).not.toHaveClass(/on/);
  const summaries = logs.filter((l) => l.includes('"event":"sim.tick.summary"'));
  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(summaries[0])).toMatchObject({ event: 'sim.tick.summary', year: 1 });
});

test('species palette: pick a species and click the island to spawn it', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#spawn-forest')).toBeVisible();
  await page.click('#spawn-forest');
  await expect(page.locator('#spawn-forest')).toHaveClass(/armed/);
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#spawn-forest')).not.toHaveClass(/armed/);
  await expect
    .poll(() => logs.filter((l) => l.includes('"event":"cmd.received"') && l.includes('"type":"spawn_species"')).length)
    .toBeGreaterThan(0);
  expect(logs.filter((l) => l.includes('"event":"cmd.rejected"'))).toHaveLength(0);
});

test('firelizard (M8-09): shown in legend but not spawnable by the watcher', async ({ page }) => {
  await page.goto('/');
  // 凡例には出る (熱でしか増えない種でも観測対象ではある)
  await expect(page.locator('#legend-firelizard')).toBeVisible();
  // 住みやすさレイヤーの種チップにも出る
  await expect(page.locator('#layer-species-firelizard')).toBeVisible();
  // 見守り手は炎蜥蜴を放てない (放流チップには出ない)
  await expect(page.locator('#spawn-firelizard')).toHaveCount(0);
});

test('鐘樹 (belltree, M8-10): spawn chip and legend appear in free mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spawn-belltree')).toBeVisible();
  // 凡例に種名 鐘樹 が出る (対応する legend-belltree の総量表示と対で存在する)
  await expect(page.locator('#legend')).toContainText('鐘樹');
  await expect(page.locator('#legend-belltree')).toHaveText(/^\d+$/);
});

test('suitability layer: mode toggle + species chip reflect the choice in DOM state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#layer-mode-density')).toHaveClass(/on/);
  await expect(page.locator('#layer-mode-suit')).not.toHaveClass(/on/);
  await page.click('#layer-mode-suit');
  await expect(page.locator('#layer-mode-suit')).toHaveClass(/on/);
  await expect(page.locator('#layer-mode-density')).not.toHaveClass(/on/);
  await expect(page.locator('#layer-species-forest')).toBeVisible();
  await page.click('#layer-species-forest');
  await expect(page.locator('#layer-species-forest')).toHaveClass(/on/);
  // モードチップの選択状態は種チップを選んだ後も維持される
  await expect(page.locator('#layer-mode-suit')).toHaveClass(/on/);
});

test('clicking the island opens the cell panel with a local time series', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cell-panel')).toBeHidden();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-panel')).toBeVisible();
  await expect(page.locator('#local-graph')).toBeVisible();
  await expect(page.locator('#cell-info')).toContainText('セル (');
});

test('stone tablet: ?scenario=sinking shows the prophecy and counts years', async ({ page }) => {
  await page.goto('/?scenario=sinking');
  await expect(page.locator('#tablet-title')).toContainText('沈む欠片');
  await expect(page.locator('#tablet-prophecy')).toContainText('百年');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 100 年');
  await page.click('#speed-100');
  await expect(page.locator('#tablet-year')).not.toHaveText('0 / 100 年', { timeout: 20_000 });
  await expect(page.locator('#verdict')).toBeHidden();
});

test('stone tablet: verdict overlay appears and stops the clock', async ({ page }) => {
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const y = await page.locator('#hud-year').textContent();
  await page.waitForTimeout(1500);
  expect(await page.locator('#hud-year').textContent()).toBe(y);
});

test('free mode has the selector but no prophecy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tablet-select')).toBeVisible();
  await expect(page.locator('#tablet-title')).toHaveCount(0);
});

test('civilization: ?scenario=test-civ shows the stage line in the HUD (M8-04)', async ({ page }) => {
  await page.goto('/?scenario=test-civ');
  await expect(page.locator('#hud-civ')).toBeVisible();
  await expect(page.locator('#hud-civ')).toContainText('文明 石(4)');
});

test('civilization: free mode has no civ line', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hud-civ')).toBeHidden();
});

test('tower fuel: ?scenario=test-civ shows the fuel line once a year has passed (M8-08)', async ({ page }) => {
  await page.goto('/?scenario=test-civ');
  await page.click('#speed-100');
  // stage 4 なので、1 年たって fuel が一度でも計算されれば「· 燃料 N / M」が出る
  await expect(page.locator('#hud-civ')).toContainText('燃料', { timeout: 8000 });
});

test('faith: ?scenario=test-civ shows the faith line once a year has passed (M9-01)', async ({ page }) => {
  await page.goto('/?scenario=test-civ');
  await page.click('#speed-100');
  // stage 4 で始まるので、1 年たって信仰が生まれれば「· 信仰 0.50」が出る (小数 2 桁まで内容を確認)
  await expect(page.locator('#hud-civ')).toContainText(/信仰 \d\.\d\d/, { timeout: 8000 });
});

test('prayer: ?scenario=test-civ shows the current prayer, and an answering intervention clears it and logs answered (M9-02)', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/?scenario=test-civ');
  // test-civ の start.civilization.prayer: "rain" で開始時から祈りが有効になっている (期限 5 年)
  await expect(page.locator('#tablet-prayer')).toBeVisible();
  await expect(page.locator('#tablet-prayer')).toHaveText('祈り: 雨を(残り 5 年)');
  // 雨を今より増やす (既存 E2E の気候操作と同じ操作) で応える
  await page.locator('#rain-scale').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#tablet-prayer')).toBeHidden();
  // 年表の prayer イベントは年次評価 (年をまたぐタイミング) でしか積まれないので、1 年進める
  await page.click('#speed-100');
  await expect(page.locator('#tablet-timeline')).toContainText('祈りに応えた: 雨を', { timeout: 20_000 });
  // ログ scenario.prayer(answered)
  await expect
    .poll(() => logs.filter((l) => l.includes('"event":"scenario.prayer"') && l.includes('"phase":"answered"') && l.includes('"kind":"rain"')).length)
    .toBeGreaterThanOrEqual(1);
});

test('edict: ?scenario=test-civ の勅令「採掘を止めよ」は信仰 0.7 の民が従い、HUD に「採掘 止」、年表に「民は採掘を止めた」が出る (M9-03)', async ({ page }) => {
  await page.goto('/?scenario=test-civ');
  await expect(page.locator('#hud-edict')).toBeVisible();
  await expect(page.locator('#hud-civ')).not.toContainText('採掘 止');
  await page.click('#edict-stop');
  await expect(page.locator('#hud-civ')).toContainText('採掘 止');
  await expect(page.locator('#edict-stop')).toHaveClass(/on/);
  // 年表の civ_edict は年次評価 (年をまたぐタイミング) でしか積まれないので、1 年進める
  await page.click('#speed-100');
  await expect(page.locator('#tablet-timeline')).toContainText('民は採掘を止めた', { timeout: 20_000 });
  await expect(page.locator('#tablet-timeline')).toContainText('石板が告げた: 採掘を止めよ');
});

test('volcano hint: arming the 火山 chip shows the hint text, unarming hides it (M8-08)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#volcano-hint')).toBeHidden();
  await page.click('#disaster-volcano');
  await expect(page.locator('#disaster-volcano')).toHaveClass(/armed/);
  await expect(page.locator('#volcano-hint')).toBeVisible();
  await expect(page.locator('#volcano-hint')).toContainText('火の山');
  await page.click('#disaster-volcano');
  await expect(page.locator('#volcano-hint')).toBeHidden();
});

test('star power: budget line is shown, spawning costs power, and an unaffordable spawn is rejected', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/?scenario=test-quick');
  // test-quick の budget: start 10, spawn 3 → 3 回で 1 になり 4 回目は弾かれる
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  const spawnOnce = async () => {
    await page.click('#spawn-grass');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
    await expect(page.locator('#spawn-grass')).not.toHaveClass(/armed/);
  };
  await spawnOnce();
  await expect(page.locator('#tablet-power')).toHaveText('7 / 30');
  await spawnOnce();
  await spawnOnce();
  await expect(page.locator('#tablet-power')).toHaveText('1 / 30');
  // 年表に放流 3 件が積まれている
  await expect(page.locator('#tablet-timeline-summary')).toHaveText('年表 (3)');
  await expect(page.locator('#tablet-timeline')).toContainText('0 年: 草を放った');
  await expect(page.locator('#spawn-grass')).toHaveClass(/unaffordable/);
  await spawnOnce();
  await expect(page.locator('#tablet-power')).toHaveText('1 / 30');
  await expect
    .poll(() => logs.filter((l) => l.includes('"event":"cmd.rejected"') && l.includes('"reason":"budget"')).length)
    .toBe(1);
});

test('stone tablet: milestone disappears when reached, power warning appears, verdict shows stats', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#tablet-milestones')).toHaveText('1 年目: 試しの節目(一年で消える)');
  await expect(page.locator('#tablet-warnings')).toHaveText('');
  // 力を使い切る: 放流 3 回 (9) + 気候 1 回 (1) = 10
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < 3; i++) {
    await page.click('#spawn-grass');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
    await expect(page.locator('#spawn-grass')).not.toHaveClass(/armed/);
  }
  await page.locator('#rain-scale').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#tablet-power')).toHaveText('0 / 30');
  await expect(page.locator('#rain-scale-v')).toHaveText('×1.50');
  await page.click('#speed-100');
  // 1 年目: 節目が消え、力の警告が出る。力が尽きて雨が既定に戻り、スライダーもそれに従う
  await expect(page.locator('#tablet-milestones')).toHaveText('', { timeout: 20_000 });
  await expect(page.locator('#rain-scale-v')).toHaveText('×1.00');
  await expect(page.locator('#tablet-warnings')).toContainText('力が足りない(残り 0)');
  await expect.poll(() => logs.filter((l) => l.includes('"event":"scenario.warning"') && l.includes('"kind":"power_low"')).length).toBe(1);
  // 2 年目: 滅び。内訳が出る
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#verdict-stats')).toContainText('介入 4 回 · 使った力 10');
  await expect(page.locator('#verdict-stats')).toContainText(/陸地率 \d+%/);
  await expect(page.locator('#verdict-stats')).toContainText('草 ');
});

test('intercept: ?scenario=test-intercept の星の民は「星を砕け」で三年目の隕石を取り消し、節目が消えて年表に「星が砕けた」が出る (M10-02)', async ({ page }) => {
  await page.goto('/?scenario=test-intercept');
  await expect(page.locator('#hud-works')).toBeVisible();
  await expect(page.locator('#hud-civ')).toContainText('工事 3.0 / 3');
  await expect(page.locator('#tablet-milestones')).toContainText('3 年目: 星が落ちる');
  await expect(page.locator('#intercept-btn')).not.toHaveClass(/unaffordable/);
  await page.click('#intercept-btn');
  await expect(page.locator('#tablet-timeline')).toContainText('星が砕けた(3 年目の星は落ちない)');
  await expect(page.locator('#tablet-milestones')).not.toContainText('星が落ちる');
  // 備蓄が消費され、二度目は撃てない
  await expect(page.locator('#hud-civ')).toContainText('工事 0.0 / 3');
  await expect(page.locator('#intercept-btn')).toHaveClass(/unaffordable/);
});
