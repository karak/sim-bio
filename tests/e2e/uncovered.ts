import { expect, type Locator } from '@playwright/test';

/**
 * 部品が覆われていないかの型 (M21-05、M19-18 の observeEntry.spec.ts から)。
 * 実の配置 (重なり・覆い) は happy-dom では測れないので、Playwright でだけ確かめる。部品の中の振る舞いは tests/unit の部品の試験で確かめる
 */

/** 部品の真ん中の点で一番上にある要素が部品自身 (かその中) なら 'self'。覆っていれば `tag#id.class` */
export const topmostAtCenter = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && el.contains(hit) ? 'self' : hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.className}` : 'nothing';
  });

/** 並べた部品がどれも見えていて覆われていない。覆われた部品は、覆った要素の名前が差分に出る */
export async function expectUncovered(targets: Record<string, Locator>) {
  const got: Record<string, string> = {};
  for (const [name, target] of Object.entries(targets)) {
    await expect(target, name).toBeVisible();
    got[name] = await topmostAtCenter(target);
  }
  expect(got).toEqual(Object.fromEntries(Object.keys(targets).map((name) => [name, 'self'])));
}
