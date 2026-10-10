import { join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { chronicleId } from '../../src/harbor/contract';
import { writeRequest } from '../../src/harbor/wire';
import { catalog, routeHarbor, wireOf } from '../driver/harbor';
import { playScenarioToVerdict } from '../driver/verdict';
import { DUMMY_TOKEN } from '../fixtures/fakeHarbor';

/**
 * 港のクライアントと画面 (M19-09) を実際のブラウザで確かめる。港の API と Turnstile の script は page.route() で決定論的に答える
 * (本物の Worker と同じ readRequest で読み、writeResponse・writeRefusal で書く港の写し tests/fixtures/fakeHarbor.ts)。
 * HARBOR_SHOTS に置き場を渡すと、画面の撮影を残す
 */
const WITH_WIDGET = { turnstile: { delayMs: 300, widget: true } };

async function shot(page: Page, name: string) {
  const dir = process.env.HARBOR_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

const publishFrom = (page: Page) => page.getByRole('region', { name: '港へ出す' });

test('M19-09: 出港 → リンク → 訪問 (3D 観察画面) → 照合 (年表を読む) の一連', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-civ');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた');

  const panel = publishFrom(page);
  await expect(panel.getByRole('heading', { name: '港へ出す' })).toBeVisible();
  await expect(panel.getByRole('radio')).toHaveText(['まだ、ここにいる', 'できることはした', '雨は来た', '狼は残った', '海が勝った', 'また始めよう']);
  await panel.getByRole('radio', { name: '雨は来た' }).click();
  await expect(panel.getByRole('radio', { name: '雨は来た' })).toHaveAttribute('aria-checked', 'true');
  await shot(page, '01-publish-choose');
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');

  const published = harbor.sent.find((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  expect(published?.headers['cf-turnstile-response']).toBe(DUMMY_TOKEN);
  expect(published?.headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
  const [id] = [...harbor.fake.ledger.keys()];
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ scenarioId: 'test-civ', inscription: 'rain-came', verdict: 'alive', year: 5 });
  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();
  expect(url).toBe(`${new URL(page.url()).origin}/?scenario=test-civ&visit=${id}`);
  await shot(page, '02-published-link');

  // 一覧: 自分が出港した島として、取り下げの札が付く
  await page.goto('/');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const list = page.getByRole('list', { name: '流れ着いた年代記' });
  const card = list.getByRole('listitem');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading')).toHaveText(/^[ア-ン]{3,4}の(島|環|洲)$/);
  await expect(card).toContainText('「雨は来た」');
  await expect(card).toContainText('文明の試し読みを 5 年、生き延びた');
  await expect(card).toContainText('まだ誰もたどっていない');
  await expect(card).toContainText('あなたが出港した島');
  await expect(card.getByRole('button', { name: '取り下げる' })).toBeVisible();
  await shot(page, '03-browse');
  const name = await card.getByRole('heading').textContent();

  // 訪問: リンクを開くと、その石板の島を普段どおり組み、港から引いた年代記を 10 倍速で打ち直し、3D 観察画面に入る
  await card.getByRole('link', { name: '訪れる' }).click();
  await expect(page).toHaveURL(url);
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await expect(plaque.getByRole('heading')).toHaveText(name ?? '');
  await expect(plaque).toContainText('「雨は来た」');
  await expect(plaque.locator('#harbor-visit-ending')).toHaveText('文明の試し読みを 5 年、生き延びた');
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#speed-10')).toHaveClass(/on/);
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^\d+ 年/, { timeout: 90_000 });
  // 訪問の再生が進めた年と季節が、観察画面の下の帯に渡る (M19-09 の直し)。10 倍速では 1 年が 36 秒、季節は 9 秒ごと
  const bar = page.locator('#observe-layer .o-stats');
  await expect(bar).toHaveText('0 年 · 夏', { timeout: 30_000 });
  await expect(bar).toHaveText('1 年 · 春', { timeout: 60_000 });
  await shot(page, '04-visit-observe');

  // 照合: 明示の操作で Web Worker が回し直し、進みを見せ、終われば港へ結末を送る。港の写しが hash を比べて確認を数える
  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await expect(plaque.getByRole('progressbar', { name: '年表を読む進み' })).toBeVisible();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読み終えた。港の記録と同じ結末になった', { timeout: 90_000 });
  // 確かめた人の数は、読み終えの文を書いた後に港へ confirm を送り、年代記を引き直してから書き換わる (HarborVisit.ts の reader)。
  // この 2 往復と hash の計算は 3D を描く main thread のタスクに並ぶので、暇な Mac でも 1.2 秒かかり、CI (1 worker、ソフトウェア描画) では
  // 既定の 5 秒で 2 回しか見に行けないほど遅れて落ちた。港のクライアントは 1 往復 10 秒で諦めるので、30 秒待てば足り、それより後には書き換わらない
  await expect(plaque.locator('#harbor-visit-confirms')).toHaveText('1 人がたどって確かめた', { timeout: 30_000 });
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ confirms: 1, mismatches: 0 });
  await shot(page, '05-visit-read');
});

test('M19-18: 集落の無い島 (test-quick) の訪問でも 3D 観察画面に入り、戻ると「3D で見る」は時間の箱の端で覆われず押せる', async ({ page }) => {
  test.setTimeout(180_000);
  await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-quick');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const panel = publishFrom(page);
  await panel.getByRole('radio', { name: '海が勝った' }).click();
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();

  await page.goto(url);
  await expect(page.getByRole('region', { name: '訪れている島' })).toBeVisible();
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^\d+ 年 · [春夏秋冬]$/, { timeout: 90_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();
  const open = page.getByRole('button', { name: '3D で見る' });
  await expect(open).toBeEnabled();
  await expect(page.locator('.hud-tl #speed-row > #observe-open')).toHaveText('3D で見る');
  const topmost = await page.evaluate(() => {
    const b = document.getElementById('observe-open')!;
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
  });
  expect(topmost).toBe(true);
  await open.click();
  await expect(page.locator('#observe-layer')).toBeVisible();
});

test('M19-09: 照合は「やめる」で止まり、もう一度読める', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-civ');
  await publishFrom(page).getByRole('button', { name: '出港する' }).click();
  await expect(publishFrom(page).getByRole('textbox', { name: '訪問のリンク' })).toBeVisible();
  const [id] = [...harbor.fake.ledger.keys()];

  await page.goto(`/?scenario=test-civ&visit=${id}`);
  // 照合の worker の読み込みを「やめる」を押すまで止める。止めないと 5 年の照合が押す前に読み終わることがある
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.context().route('**/replay.worker*', async (route) => {
    await held;
    await route.continue();
  });
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await plaque.getByRole('button', { name: 'やめる' }).click();
  release();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読むのをやめた。もう一度読むと、初めから読む');
  await expect(plaque.getByRole('button', { name: '年表を読む' })).toBeVisible();
  expect(harbor.sent.filter((w) => w.path.endsWith('/confirm'))).toEqual([]);
});

test('M26-15: 照合の後の引き直しが 1 回落ちても、間を置いて引き直し、確かめた人の数が書き換わる', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-civ');
  await publishFrom(page).getByRole('button', { name: '出港する' }).click();
  await expect(publishFrom(page).getByRole('textbox', { name: '訪問のリンク' })).toBeVisible();
  const [id] = [...harbor.fake.ledger.keys()];

  await page.goto(`/?scenario=test-civ&visit=${id}`);
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await expect(plaque.locator('#harbor-visit-confirms')).toHaveText('まだ誰もたどっていない');
  // confirm を送った後の最初の引き直しだけを網の失敗にする。routeHarbor より後に足した route が先に当たる
  const visitPath = `/api/v1/chronicles/${id}`;
  const confirmed = () => harbor.sent.some((w) => w.path === `${visitPath}/confirm`);
  let dropped = 0;
  await page.route(
    (u) => u.pathname === visitPath,
    async (route) => {
      if (route.request().method() === 'GET' && confirmed() && dropped === 0) {
        dropped += 1;
        harbor.sent.push(wireOf(route));
        return route.abort('failed');
      }
      return route.fallback();
    },
  );

  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読み終えた。港の記録と同じ結末になった', { timeout: 90_000 });
  await expect(plaque.locator('#harbor-visit-confirms')).toHaveText('1 人がたどって確かめた', { timeout: 30_000 });
  expect(dropped).toBe(1);
  const afterConfirm = harbor.sent.slice(harbor.sent.findIndex((w) => w.path === `${visitPath}/confirm`) + 1);
  expect(afterConfirm.filter((w) => w.method === 'GET' && w.path === visitPath)).toHaveLength(2);
});

test('M26-08: 訪問が判定まで進んだあとの「もう一度」は、URL の visit を残して同じ訪問を初めから開き直す', async ({ page }) => {
  test.setTimeout(240_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-civ');
  await publishFrom(page).getByRole('button', { name: '出港する' }).click();
  await expect(publishFrom(page).getByRole('textbox', { name: '訪問のリンク' })).toBeVisible();
  const [id] = [...harbor.fake.ledger.keys()];

  await page.goto(`/?scenario=test-civ&visit=${id}`);
  await expect(page.getByRole('region', { name: '訪れている島' })).toBeVisible();
  // 訪問は年代記が届くと 10 倍速で再生される。判定まで急ぐため、観察画面を閉じて 100 倍速にする
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
  await page.locator('#verdict-retry').click();
  // 訪問を離れる操作ではないので、visit は残り、訪問として開く (自分の石板の島ではない)
  await expect(page).toHaveURL((u) => u.search === `?scenario=test-civ&visit=${id}`);
  await expect(page.locator('#verdict')).toBeHidden();
  await expect(page.getByRole('region', { name: '訪れている島' })).toBeVisible();
  await expect(page.locator('#slot-save')).toBeDisabled();
});

test('M19-09: 港を全部閉じても 1 シナリオ遊べ、出港は outbox に入る。港が開いてから開き直すと、同じ id・同じ鍵で送り直す', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  harbor.state.closed = true;

  await playScenarioToVerdict(page, 'test-quick');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const panel = publishFrom(page);
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す');
  await expect(page.locator('#harbor-dock-count')).toHaveText('預け 1');
  await shot(page, '06-closed-queued');

  // 閉じた港の一覧は、閉港を普段の状態として言う
  await page.locator('#verdict-free').click();
  // 判定の出た島を離れるので確かめる (M21-04)
  await page.getByRole('alertdialog').getByRole('button', { name: '離れる' }).click();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  await expect(page.locator('#harbor-state')).toHaveText('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
  await shot(page, '07-closed-browse');

  const first = harbor.sent.find((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  if (!first?.body) throw new Error('出港の要求が無い');
  const queuedId = await chronicleId(JSON.parse(first.body).chronicle);
  // 自由モードで開いた直後の送り直しが閉港で断られるのを待ってから港を開く (M21-10)。
  // 待たないと、遅い機械ではその送り直しが港を開いた後に届いて先に港へ出し、開き直しの送り直しと 2 回になる
  const publishes = () => harbor.sent.filter((w) => w.method === 'POST' && w.path === '/api/v1/chronicles').length;
  await expect.poll(publishes, { timeout: 30_000 }).toBe(2);

  harbor.state.closed = false;
  const before = harbor.sent.length;
  await page.reload();
  await expect(page.locator('#harbor-toast')).toHaveText('預けていた年代記 1 件を港へ出した', { timeout: 30_000 });
  const resent = harbor.sent.slice(before).filter((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  expect(resent).toHaveLength(1);
  expect(await chronicleId(JSON.parse(resent[0].body ?? '{}').chronicle)).toBe(queuedId);
  expect(resent[0].headers.authorization).toBe(first.headers.authorization);
  expect([...harbor.fake.ledger.keys()]).toEqual([queuedId]);
  await expect(page.locator('#harbor-dock-count')).toBeHidden();
});

test('M19-09 不変条件: main.ts は静的アセット以外のネットワークに頼らずに起動し、遊べる (港の API と外の origin を全部断つ)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== origin || url.pathname.startsWith('/api/'),
    (route) => {
      refused.push(new URL(route.request().url()).pathname);
      return route.abort('failed');
    },
  );
  for (const path of ['/', '/?scenario=test-quick']) {
    await page.goto(path);
    await expect(page.locator('#hud-year')).toHaveText('Year 0');
    await page.click('#speed-100');
    await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  }
  // ログの送り (M19-02) は失敗しても本体を止めない。港 (出港・一覧) には、起動では問い合わせない
  expect(refused.filter((p) => p !== '/api/v1/logs')).toEqual([]);
});

/** 手元の置き場 (IndexedDB) の値を直に読む */
const stored = (page: Page, store: string, key: string) =>
  page.evaluate(
    ([name, id]) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).get(id);
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    [store, key],
  );
/** 石板の年代記の命令 (M19-06 の置き場) */
const storedCommands = async (page: Page, scenarioId: string) =>
  ((await stored(page, 'chronicles', scenarioId)) as { commands: { tick: number; command: Record<string, unknown> }[] } | null)?.commands ?? null;

test('M19-10: 浜の漂着を引き、追い払う・受け取る。受け取った積荷は外来種の放流として年代記に載り、二度は受け取れない (開き直しても)', async ({ page }) => {
  const harbor = await routeHarbor(page, WITH_WIDGET);
  // ほかの見守り手が流した積荷 (本物の wire で港の写しに流す)
  await harbor.fake.serve(writeRequest({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'rabbit', amount: 2.5 }, { speciesId: 'wolf', amount: 0.3 }] } }));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drift = page.getByRole('region', { name: '浜の漂着' });
  const status = drift.locator('#harbor-drift-status');

  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(status).toHaveText('積荷が流れ着いた。受け取れば、外来種として島の浜に放たれる');
  await expect(drift.locator('#harbor-drift-items')).toHaveText('ウサギ 2.5・狼 0.3');
  await shot(page, '08-drift-drawn');
  await drift.getByRole('button', { name: '追い払う' }).click();
  await expect(status).toHaveText('積荷を沖へ返した');
  await expect(drift.getByRole('button', { name: '受け取る' })).toBeHidden();
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');

  await drift.getByRole('button', { name: '浜を見る' }).click();
  await drift.getByRole('button', { name: '受け取る' }).click();
  await expect(status).toHaveText('積荷を受け取った。外来種が島の浜に放たれた');
  await expect(page.locator('#tablet-power')).toHaveText('4 / 30');
  await shot(page, '09-drift-received');
  await expect.poll(async () => (await storedCommands(page, 'test-quick'))?.length).toBe(2);
  const commands = (await storedCommands(page, 'test-quick')) ?? [];
  expect(commands.map((c) => c.command)).toEqual([
    { type: 'spawn_species', speciesId: 'rabbit', cell: commands[0].command.cell, amount: 2.5, radius: 1 },
    { type: 'spawn_species', speciesId: 'wolf', cell: commands[0].command.cell, amount: 0.3, radius: 1 },
  ]);

  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(status).toHaveText('この積荷はもう受け取った');
  await expect(drift.getByRole('button', { name: '受け取る' })).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(status).toHaveText('この積荷はもう受け取った');
  await expect(drift.getByRole('button', { name: '受け取る' })).toBeHidden();
});

test('M19-10: 星の力が足りなければ積荷を受け取らず (1 種も放たない)、控えも残さない', async ({ page }) => {
  const harbor = await routeHarbor(page, WITH_WIDGET);
  const items = ['rabbit', 'wolf', 'deer', 'grass'].map((speciesId) => ({ speciesId, amount: 1 }));
  await harbor.fake.serve(writeRequest({ kind: 'cast_cargo', cargo: { items } }));
  await page.goto('/?scenario=test-quick');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drift = page.getByRole('region', { name: '浜の漂着' });
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await drift.getByRole('button', { name: '受け取る' }).click();
  await expect(drift.locator('#harbor-drift-status')).toHaveText('星の力が足りない。力が溜まってから、もう一度受け取る');
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  await expect(drift.getByRole('button', { name: '受け取る' })).toBeVisible();
  expect(await storedCommands(page, 'test-quick')).toBeNull();
});

test('M19-10: 空の舟で次の島へ逃れると、積荷 (種と量) を港に流す', async ({ page }) => {
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await page.goto('/?scenario=test-ship');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('次の島へ', { timeout: 30_000 });
  await expect(page.locator('#harbor-toast')).toHaveText('積荷を港に流した。どこかの見守り手の浜に流れ着く');
  const cast = harbor.sent.filter((w) => w.method === 'POST' && w.path === '/api/v1/cargo');
  expect(cast).toHaveLength(1);
  expect(harbor.fake.cargo).toHaveLength(1);
  const { items } = harbor.fake.cargo[0].cargo;
  expect(items.length).toBeGreaterThanOrEqual(1);
  expect(items.length).toBeLessThanOrEqual(5);
  for (const item of items) {
    expect(catalog.species.has(item.speciesId)).toBe(true);
    expect(item.amount).toBeGreaterThan(0);
    expect(item.amount).toBeLessThanOrEqual(10);
  }
  await shot(page, '10-cargo-cast');
});

test('M19-11: 石板を終えると 1 回数え、石板と判定の板に回避率を出す。同じ年代記は二度数えない', async ({ page }) => {
  test.setTimeout(120_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await harbor.fake.serve(writeRequest({ kind: 'report_outcome', scenarioId: 'test-civ', verdict: 'dead' }));
  await page.goto('/?scenario=test-civ');
  await expect(page.locator('#tablet-avoidance')).toBeHidden();
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた', { timeout: 90_000 });
  await expect(page.locator('#verdict-avoidance')).toHaveText('この予言を越えた見守り手は 50%');
  await expect(page.locator('#tablet-avoidance')).toHaveText('この予言を越えた見守り手は 50%');
  await shot(page, '11-avoidance');
  expect(harbor.fake.outcomes.get('test-civ')).toEqual({ finished: 2, avoided: 1 });

  // 同じ石板を介入なしでもう一度 (同じ年代記) 終えても、数えは増えない
  await page.locator('#verdict-retry').click();
  // 判定の出た島を離れるので確かめる (M21-04)
  await page.getByRole('alertdialog').getByRole('button', { name: '離れる' }).click();
  await page.click('#speed-100');
  await expect(page.locator('#verdict-avoidance')).toHaveText('この予言を越えた見守り手は 50%', { timeout: 90_000 });
  expect(harbor.fake.outcomes.get('test-civ')).toEqual({ finished: 2, avoided: 1 });
  expect(harbor.sent.filter((w) => w.method === 'POST' && w.path === '/api/v1/outcomes')).toHaveLength(1);
});

test('M19-11: 閉港なら回避率を出さない', async ({ page }) => {
  test.setTimeout(120_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  harbor.state.closed = true;
  await playScenarioToVerdict(page, 'test-quick');
  await expect(page.locator('#verdict-harbor')).toContainText('港へ出す');
  await expect.poll(() => harbor.sent.filter((w) => w.path.startsWith('/api/v1/outcomes')).length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#verdict-avoidance')).toBeHidden();
  await expect(page.locator('#tablet-avoidance')).toBeHidden();
});

test('M19-14 の直し: 判定の後に閉じて開き直し、次の挑戦が進んでも、判定の出た島を港の板から出港できる', async ({ page }) => {
  test.setTimeout(120_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-quick');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  await expect(publishFrom(page).getByRole('button', { name: '出港する' })).toBeVisible();
  await expect.poll(() => stored(page, 'finished', 'test-quick')).not.toBeNull();
  await page.reload();
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drawer = page.getByRole('complementary', { name: '港' });
  await expect(drawer.locator('.harbor-finished')).toContainText('この石板で最後に判定の出た島');
  await drawer.getByRole('region', { name: '港へ出す' }).getByRole('button', { name: '出港する' }).click();
  await expect(drawer.getByRole('region', { name: '港へ出す' }).getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const [id] = [...harbor.fake.ledger.keys()];
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ scenarioId: 'test-quick', verdict: 'dead' });
  await shot(page, '12-finished-publish');
});

/** DevTools を下に開いたときの画面の高さ (受入試験の画面) */
const DEVTOOLS_OPEN = { width: 1200, height: 420 };

/** 板の中で切れずに読める: 板の中を寄せてから、板の枠と画面の枠の内に収まる (M19-15) */
async function expectReadableIn(page: Page, item: Locator, board: Locator) {
  await item.scrollIntoViewIfNeeded();
  const a = await item.boundingBox();
  const b = await board.boundingBox();
  if (!a || !b) throw new Error('板か文が描かれていない');
  const bottom = Math.min(b.y + b.height, page.viewportSize()?.height ?? Infinity);
  expect(a.y).toBeGreaterThanOrEqual(Math.max(b.y, 0));
  expect(a.y + a.height).toBeLessThanOrEqual(bottom);
}

const CLOSED_PUBLISH = '港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す';

test('M19-15 (1): DevTools の request blocking と同じ閉じ方 (ERR_BLOCKED_BY_CLIENT) で、DevTools を開いた高さでも、判定の板と港の板の出港で閉港の知らせが読める', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DEVTOOLS_OPEN);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  harbor.state.closed = true;
  harbor.state.abortWith = 'blockedbyclient';

  await playScenarioToVerdict(page, 'test-quick');
  const panel = publishFrom(page);
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText(CLOSED_PUBLISH);
  await expectReadableIn(page, panel.getByRole('status').first(), page.locator('#verdict .verdict-box'));
  await shot(page, '13-closed-devtools-verdict');

  // 開き直して、港の口の板 (判定の出た島) から出港する
  await page.reload();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drawer = page.getByRole('complementary', { name: '港' });
  await expect(drawer.locator('#harbor-state')).toHaveText('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
  await expectReadableIn(page, drawer.locator('#harbor-state'), drawer);
  const late = drawer.getByRole('region', { name: '港へ出す' });
  await late.getByRole('button', { name: '出港する' }).click();
  await expect(late.getByRole('status').first()).toHaveText(CLOSED_PUBLISH);
  await expectReadableIn(page, late.getByRole('status').first(), drawer);
  await shot(page, '14-closed-devtools-drawer');
});

test('M19-15 (1): Turnstile の script が返ってこない (待ち続ける) ときも、出港は閉港として預け、知らせを出す', async ({ page }) => {
  test.setTimeout(120_000);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  harbor.state.closed = true;
  // 後から登録した route が先に当たる。答えずに放っておく (challenges.cloudflare.com へ届かないまま待ち続ける)
  await page.route('https://challenges.cloudflare.com/turnstile/**', () => {});
  await playScenarioToVerdict(page, 'test-quick');
  const panel = publishFrom(page);
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ運んでいる…');
  await expect(panel.getByRole('status').first()).toHaveText(CLOSED_PUBLISH, { timeout: 20_000 });
  await expect(page.locator('#harbor-dock-count')).toHaveText('預け 1');
});

test('M19-15 (2): 受入の手順 (判定まで進め、出港せずに閉じ、開き直して次の挑戦を少し進める) のあと、DevTools を開いた高さでも港の口から判定の出た島を出港できる。自由モードの港の口にも並ぶ', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DEVTOOLS_OPEN);
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await playScenarioToVerdict(page, 'test-quick');
  await expect.poll(() => stored(page, 'finished', 'test-quick')).not.toBeNull();
  await page.reload();
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');

  await page.goto('/');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drawer = page.getByRole('complementary', { name: '港' });
  await expect(drawer.locator('.harbor-finished')).toContainText('『試し読み』で最後に判定の出た島');
  await expect(drawer.getByRole('region', { name: '港へ出す' }).getByRole('button', { name: '出港する' })).toBeEnabled();

  await page.goto('/?scenario=test-quick');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  await expect(drawer.locator('.harbor-finished')).toContainText('この石板で最後に判定の出た島');
  const late = drawer.getByRole('region', { name: '港へ出す' });
  await late.getByRole('button', { name: '出港する' }).click();
  await expect(late.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  await expectReadableIn(page, late.getByRole('textbox', { name: '訪問のリンク' }), drawer);
  const [id] = [...harbor.fake.ledger.keys()];
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ scenarioId: 'test-quick', verdict: 'dead' });
  await shot(page, '15-late-publish-devtools');
});

test('M19-15 (4): 漂着を受け取ると、積荷の着いた浜のセルを選んで見せ、放たれた種の密度がそのセルで読める', async ({ page }) => {
  const harbor = await routeHarbor(page, WITH_WIDGET);
  await harbor.fake.serve(writeRequest({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'wolf', amount: 0.411 }, { speciesId: 'deer', amount: 0.254 }] } }));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await expect(page.locator('#cell-panel')).toBeHidden();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const drift = page.getByRole('region', { name: '浜の漂着' });
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await drift.getByRole('button', { name: '受け取る' }).click();
  await expect(drift.locator('#harbor-drift-status')).toHaveText('積荷を受け取った。外来種が島の浜に放たれた');
  await expect(page.locator('#cell-panel')).toBeVisible();
  await expect(page.locator('#cell-info')).toContainText(/^セル \(\d+, \d+\)/);
  // 放流は次の刻みで島に効く (港の板は速さの列に重なるので閉じる)
  await page.getByRole('complementary', { name: '港' }).getByRole('button', { name: '閉じる' }).click();
  await page.click('#speed-1');
  const density = (name: string) => page.locator('#cell-info > div', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('.mono');
  await expect.poll(async () => Number(await density('狼').textContent()), { timeout: 10_000 }).toBeGreaterThan(0.3);
  await page.click('#speed-0');
  expect(Number(await density('鹿').textContent())).toBeGreaterThan(0.2);
  await shot(page, '16-drift-landing-cell');
});
