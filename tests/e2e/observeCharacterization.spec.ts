import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Probe } from '../../src/dev/probe';
import { enterObserve, lookFrom, OBSERVE_VIEWS } from '../driver/observe';
import { shouldCompareBaselines } from './baseline';

/**
 * 観察画面の特性試験 (M27-04 の安全網)。view.ts を分ける前の inspect() の読みを fixture に留め、分けた後も同じであることを見る。
 * コマを手で進める (tests/driver/frames.ts) ので、同じ手順なら同じ数になる。fps・解像度の倍率は実時間に依るので外す。
 * 更新は OBSERVE_FIXTURE=update で撮り直す。基準画と同じく、手元の Mac だけで比べる (CI は撮るだけ)
 */
const FIXTURE = 'tests/e2e/fixtures/observe-characterization.json';
const UPDATE = process.env.OBSERVE_FIXTURE === 'update';
const COMPARE = shouldCompareBaselines(process.env, process.platform) && !UPDATE;

type Reading = {
  stats: Record<string, unknown> | null;
  huts: unknown;
  props: unknown;
  breakdown: unknown;
  terrainDigest: number;
  agents: unknown;
};

async function read(page: import('@playwright/test').Page): Promise<Reading> {
  return page.evaluate(() => {
    const o = (window as unknown as { __probe: Probe }).__probe.observe;
    if (!o) throw new Error('観察画面に入っていない');
    const st = o.stats();
    const { fps: _fps, res: _res, ...stats } = st ?? {};
    void _fps;
    void _res;
    return { stats: st ? stats : null, huts: o.huts(), props: o.props(), breakdown: o.breakdown(), terrainDigest: o.terrainDigest(), agents: o.debug()?.agents ?? null };
  });
}

test('M27-04: 観察画面の inspect() (計測・小屋・小物・三角形の内訳・地形・個体) が、3 つの視点で fixture と一致する', async ({ page }) => {
  test.setTimeout(180_000);
  await enterObserve(page);
  const got: Record<string, Reading> = {};
  for (const view of OBSERVE_VIEWS) {
    await lookFrom(page, view);
    got[view] = await read(page);
    expect(got[view].stats, `${view}: stats が無い (コマが進んでいない)`).not.toBeNull();
    expect(got[view].terrainDigest).toBeGreaterThan(0);
  }
  if (UPDATE || !existsSync(FIXTURE)) {
    writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
    test.info().annotations.push({ type: 'fixture', description: `wrote ${FIXTURE}` });
    return;
  }
  if (!COMPARE) return;
  expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
});
