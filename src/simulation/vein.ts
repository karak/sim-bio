/**
 * 霊脈 (M9-03)。輝石は地下で土地の生気を支える。掘り尽くした土地では分解の効きが落ち、苔がいても生気が戻らない。
 * レベルデザイン docs/design/2026-09-21-level-design-faith.md §3.2。
 * 輝石が無かった土地 (crystal0 = 0) の枯渇は常に 0 なので、既存シナリオの生気の平衡は変わらない。
 * World には依存しない純粋関数群。係数はここにまとめる。
 */
import { forEachNeighbor4 } from './grid';
import { SEA_LEVEL } from './terrain';

/** 枯渇 1.0 (輝石を掘り尽くした) の土地で分解率をどれだけ落とすか [0,1]。0.9 なら分解者の効きが 1 割に */
export const VEIN_LOSS = 1.0;
// 2026-09-21 の実測: 苔の密度 0.99 の集落では分解率が漏出の 70 倍あり、分解の効きを 1 割に落としても生気は 1.0 のまま動かなかった。
// 霊脈は「土地が生気を保てる器」でもあるとし、stepVitality で生気の上限を 1 − VEIN_LOSS × veinLoss に抑える (§3.2)。
// 器として意味を持たせるため 1.0 (脈が尽きれば生気も尽きる) にした
/** 枯渇をぼかす半径 (セル)。鉱脈の周りの土地にも霊脈の細りが及ぶ */
export const VEIN_BLUR = 3;
// 実測 (2026-09-21): 半径 3 の平均では集落の支え半径 8 の大半が脈から遠く 0 のままで、地域の平均が 0.5 に留まった。
// 今は VEIN_REACH の「脈の届く範囲」で置き換えている (VEIN_BLUR は使っていない)
/** 霊脈が土地を養う距離 (セル、4 近傍の歩数)。この範囲の土地は最寄りの脈の枯渇をそのまま受ける。集落の支え半径 (SUPPORT_RADIUS) と同じ */
export const VEIN_REACH = 8;

/**
 * 霊脈の番号付け。開始時に輝石があった陸セルを 4 近傍で繋いだ連結成分ごとに 0 始まりの番号を振る (無いセルは -1)。
 * 脈は 1 本の繋がった体で、どこを掘っても脈全体が細る (§3.2 の「霊脈」)。create/restore 時に 1 度だけ呼ぶ。
 */
export function labelVeins(crystal0: Float32Array, elevation: Float32Array, size: number): Int32Array {
  const n = size * size;
  const ids = new Int32Array(n).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (ids[s] >= 0 || elevation[s] < SEA_LEVEL || crystal0[s] <= 0) continue;
    ids[s] = next;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop() as number;
      forEachNeighbor4(i, size, (j) => {
        if (ids[j] < 0 && elevation[j] >= SEA_LEVEL && crystal0[j] > 0) {
          ids[j] = next;
          stack.push(j);
        }
      });
    }
    next++;
  }
  return ids;
}

/** 脈ごとの枯渇 [0,1] = 1 − (脈の輝石の残り) / (脈の開始時の輝石)。index = 脈の番号 */
export function veinDepletion(crystal: Float32Array, crystal0: Float32Array, veins: Int32Array): Float32Array {
  let count = 0;
  for (let i = 0; i < veins.length; i++) if (veins[i] + 1 > count) count = veins[i] + 1;
  const now = new Float64Array(count);
  const start = new Float64Array(count);
  for (let i = 0; i < veins.length; i++) {
    const v = veins[i];
    if (v < 0) continue;
    now[v] += crystal[i];
    start[v] += crystal0[i];
  }
  const out = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    const d = start[v] > 0 ? 1 - now[v] / start[v] : 0;
    out[v] = d < 0 ? 0 : d > 1 ? 1 : d;
  }
  return out;
}

/**
 * セルごとの霊脈の細り veinLoss [0,1] を out に書く。
 * depletion_i = 1 − crystal_i / crystal0_i (開始時に輝石があった陸セルだけ、他は 0)。
 * veinLoss_i = 半径 VEIN_BLUR 内の「開始時に輝石があったセル」の depletion の平均 (そういうセルが無ければ 0)。
 * (2026-09-21 改: 平均ではなく、最寄りの脈から VEIN_REACH 歩以内なら その脈の枯渇をそのまま受ける。届かない土地は 0)
 * 掘っていなければ全セル 0。年に 1 回で十分な精度 (採掘は年 0.1〜0.4 程度)。
 * veins (labelVeins) を渡せば、セルごとではなく脈ごとの枯渇 (veinDepletion) を使う。集落の採掘半径 3 の輝石 (1.05) は
 * 4 年で尽きるが半径 8 の脈 (13) は 5% しか減らず、セルごとでは生気が動かなかった (2026-09-21 の実測)。
 */
export function computeVeinLoss(crystal: Float32Array, crystal0: Float32Array, elevation: Float32Array, size: number, out: Float32Array, veins?: Int32Array): void {
  const n = size * size;
  const byVein = veins ? veinDepletion(crystal, crystal0, veins) : null;
  // 脈のセルごとの枯渇 (脈があれば脈全体で共有、無ければセルごと)
  const depletion = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (elevation[i] < SEA_LEVEL || crystal0[i] <= 0) continue;
    const d = byVein && veins ? byVein[veins[i]] : 1 - crystal[i] / crystal0[i];
    depletion[i] = d < 0 ? 0 : d > 1 ? 1 : d;
    if (depletion[i] > 0) any = true;
  }
  out.fill(0);
  if (!any) return;
  // 脈のセルを起点に、陸を 4 近傍で VEIN_REACH 歩まで広げる (多点 BFS)。各セルは最初に届いた脈 (= 最寄り) の枯渇を受ける
  const dist = new Int16Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (elevation[i] >= SEA_LEVEL && crystal0[i] > 0) {
      dist[i] = 0;
      out[i] = depletion[i];
      frontier.push(i);
    }
  }
  for (let step = 1; step <= VEIN_REACH && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      forEachNeighbor4(i, size, (j) => {
        if (dist[j] >= 0 || elevation[j] < SEA_LEVEL) return;
        dist[j] = step;
        out[j] = out[i];
        next.push(j);
      });
    }
    frontier = next;
  }
}

/** 分解率に掛ける霊脈の係数 [1 − VEIN_LOSS, 1]。veinLoss が無ければ 1 */
export function veinFactor(veinLoss: number): number {
  return 1 - VEIN_LOSS * veinLoss;
}

/** 土地が保てる生気の上限 [0,1] = 1 − VEIN_LOSS × veinLoss。veinLoss が無ければ 1 */
export function veinCap(veinLoss: number): number {
  const c = 1 - VEIN_LOSS * veinLoss;
  return c < 0 ? 0 : c;
}
