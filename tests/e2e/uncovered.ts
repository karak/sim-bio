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

/**
 * 入れ物の子の行のすべてを、箱の左端・右端・上端・下端と真ん中の 5 点で見て、一番上の要素が行自身 (かその中) なら 'self' (M25-10)。
 * 真ん中の 1 点だけでは端に掛かる覆い (左の縁の港の札) を見逃す。窓の高さで札の縦の位置が動くので、行は名で選ばず全部見る。
 * セルの詳細のように innerHTML ごと描き直す入れ物は、行の Locator が外れる (detached) ので、行の探しと 5 点を 1 回の evaluate の中でする。
 * elementFromPoint は pointer-events: none の層を素通りするので、押せるかを見る (暗く被さる層は見ない)
 */
export async function expectAllRowsUncoveredAtFivePoints(container: Locator) {
  await expect(container).toBeVisible();
  const got = await container.evaluate((box) => {
    const out: Record<string, string> = {};
    for (const row of Array.from(box.children)) {
      const r = row.getBoundingClientRect();
      const points = [
        [r.left + 1, r.top + r.height / 2],
        [r.right - 1, r.top + r.height / 2],
        [r.left + r.width / 2, r.top + 1],
        [r.left + r.width / 2, r.bottom - 1],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      const name = (row.textContent ?? '').slice(0, 12);
      out[name] = 'self';
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !row.contains(hit)) {
          out[name] = hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.getAttribute('class') ?? ''}` : 'nothing';
          break;
        }
      }
    }
    return out;
  });
  expect(Object.keys(got).length, '行が 1 つも無い').toBeGreaterThan(0);
  expect(got).toEqual(Object.fromEntries(Object.keys(got).map((name) => [name, 'self'])));
}
