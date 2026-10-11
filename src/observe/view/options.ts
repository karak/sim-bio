import { DAY_CYCLE_S } from '../daylight';
import { HUT_NEAR_M, PROP_NEAR_M } from '../settlementLayout';

/**
 * M22-02 デフォルメ試作 (observe.html)。空の舟 25 年目 (舟は肋の段) の保存から、集落の周り半径 8 セルを組んで見る。
 * 本体は読むだけ。個体の動きは試作用の単純な徘徊で、M22-04 の個体層に置き換える。
 * URL: ?deer=300&trees=200&near=40&grass=20000&grade=1&bloom=1&shadow=1
 * (個体層をつないだ後: deer は区域の鹿の目標頭数。K を密度の合計から逆算する。0 なら本体の密度 × K_DEFAULT のまま。near は使わない)
 * (M22-06: ship は舟の進み (0〜120、無ければ保存の値)、launched=1 で飛び立った舟、forest は森の木の上限本数)
 * (M22-08: depart=1 で開いてすぐ舟が飛び去る。sink は海面を何 m 上げて見せるか (沈降の試し)。auto=0 で自動カメラを切る (shot を指定したときも切る)。speed は本体の速さ (0 / 1 / 10、1 = 1 秒に 1 tick)。freeze=1 は本体も止める)
 * (M22-07: air=0 で空気の層と昼夜を切る。time は始まりの時刻 (0 = 夜明け、0.3 = 正午、0.8 = 深夜)、day は 1 周の秒数、freeze=1 で時刻を止める)
 * (M23-06: far は鐘樹の成木と森の木をインポスター (板) に替える距離 (m)。0 で切る)
 * (M23-08: cfar は動物を遠い段 (群れ LOD を削った形) に替える距離 (m、個体ごとに ±10%)。0 で切る)
 * (M23-09: hut は小屋を遠距離版 hut_lod1 に替える距離 (m、カメラの高さも入れた距離、小屋ごとに ±10% 揺らす)。0 で切る (いつも近い形))
 * (M23-07: msaa は場面の MSAA の段 (0 / 2 / 4)、pr はピクセル比の上限、airres は空気の層を場面の何分の 1 で描くか (1 か 2、既定 2)、
 *  dynres=0 で動的な解像度 (コマが 60 fps の予算を続けて超えたときだけ合成の倍率を下げる。ピクセル比 2 で 0.5、1 で 0.7 まで) を切る)
 */
export const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(params.get(k) ?? d);
const flag = (k: string) => params.get(k) !== '0';
export const OPT = {
  deer: num('deer', 0),
  trees: num('trees', 140),
  near: num('near', 40),
  cfar: num('cfar', 50),
  // (草の磨き上げ: 房を 36 三角形に減らした分、25,000 から 30,000 房に増やして草の絨毯を密にする)
  grass: num('grass', 30000),
  grade: flag('grade'),
  bloom: flag('bloom'),
  shadow: flag('shadow'),
  forest: num('forest', 80),
  ship: params.has('ship') ? num('ship', 0) : null,
  launched: params.get('launched') === '1',
  depart: params.get('depart') === '1',
  speed: num('speed', 1),
  sink: num('sink', 0),
  auto: params.get('auto') !== '0' && !params.has('shot'),
  air: flag('air'),
  time: num('time', 0.16),
  day: num('day', DAY_CYCLE_S),
  freeze: params.get('freeze') === '1',
  far: num('far', 60),
  hut: num('hut', HUT_NEAR_M),
  // (M23-09 の 3 回目で追加) 小屋でない集落の部品 (灯り柱・石垣・立石・船台・衝立) を遠距離版 <名前>_lod1 に替える距離 (m)。0 で切る
  prop: num('prop', PROP_NEAR_M),
  msaa: num('msaa', 4),
  pr: num('pr', 2),
  airScale: (num('airres', 2) === 1 ? 1 : 2) as 1 | 2,
  dynres: flag('dynres'),
};
/** 区域 (半径 8) の外に、地面を 4 セル分の縁まで作る */
export const AREA_R = 8;
export const WINDOW = 12;
