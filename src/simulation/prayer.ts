/**
 * 文明の祈り (M9-02)。World には依存しない純粋関数群。
 * 設計: docs/design/2026-09-21-level-design-faith.md §3.1、§4。
 * 集落の困りごとが石板に届く。条件 (草の密度・捕食者比・輝石量) ごとに 1 種類、同時に 1 つだけ、
 * 期限内に対応する介入があれば信仰が上がり (応えた)、期限切れなら下がる (無視した)。
 */
import type { Command } from './types';
import { cellDistance, SUPPORT_RADIUS } from './civilization';

/** 祈りの種類 */
export type PrayerKind = 'rain' | 'wolves' | 'crystal';

/** 現在有効な祈り。CivState が持つ (省略可、無ければ祈りが無い) */
export type PrayerState = { kind: PrayerKind; issuedYear: number; deadlineYear: number };

/** 祈りの期限 (年)。issuedYear からこの年数で無視した扱いになる */
export const PRAYER_YEARS = 5;
/**
 * 祈りが解決してから次が出るまでの年数。同時に 1 つだけ。
 * 元は 3 (M9-02)。M10R-02 で 0 にした: 「困りごとが続く限り、翌年また祈る」(LD §3.1/§3.2)。
 * 圧は間隔ではなく舞台装置 (狼の密度など) で作る。World 側は解決した年の翌年から次を出せるようにする
 * (civPrayerCooldownUntil = year + PRAYER_COOLDOWN + 1 で、同じ年のうちには出ない)
 */
export const PRAYER_COOLDOWN = 0;

/**
 * 「雨を」が出る閾値: 集落の支え半径 (SUPPORT_RADIUS) 内の草の密度平均がこれ未満。
 * 実測 (seed 42 / size 64 / 全種、civilization: { speciesId: 'deer', start: { stage: 3, home: 2635 } } で
 * 100 年放置) で候補半径 8 の草の密度平均は 0.074〜0.132 (中央値 0.107) で終始低く張り付いていた。
 * PRAYER_GRASS_LOW = 0.15 (常にこの下)、PRAYER_PREDATOR_HIGH = 0.33 の組み合わせで
 * issuePrayer を優先度どおりに通すと「雨を」10 回・「狼を減らして」3 回 (100 年) になり、
 * 受入基準の範囲 (雨を 4〜12 回、狼を減らして 1〜6 回) に収まる。使い捨ての計測スクリプトはコミットしていない。
 */
export const PRAYER_GRASS_LOW = 0.15;
/**
 * 「狼を減らして」が出る閾値: 支え半径内の捕食者 (肉食) の総量 / 民の総量がこれを超える。
 * 同じ実測で捕食者比は 0.165〜1.924 (中央値 0.301) だった。0.33 (中央値よりわずかに高い) を選ぶと、
 * 優先度 (crystal > wolves > rain) を通して 100 年で 3 回出る。
 */
export const PRAYER_PREDATOR_HIGH = 0.33;
/** 「星の砂を」が出る閾値: 採掘半径内の輝石の残量 / crystalStart がこれ未満 (LD §3.1 の据え置き値) */
export const PRAYER_CRYSTAL_LOW = 0.1;
// M9-03 (2026-09-21): 上の PRAYER_GRASS_LOW / PRAYER_PREDATOR_HIGH の絶対値は場所に依存した。塔の重さの集落 (2847) では狼/鹿の密度比が
// 常に 1.5〜8.5 で、2635 で決めた 0.33 を恒常的に超え、「狼を減らして」が 8 年ごとに出て無視され続け、信仰が崩れて塔が内乱で落ちた。
// 民は「いつもより」困ったときに祈るとし、直近 PRAYER_BASELINE_YEARS 年の基準に対する比で判定する (issuePrayer の baseline)。
// 絶対値の定数は参照のため残す (issuePrayer では使わない)
/** 「雨を」: 支え半径内の草の密度平均が、基準 (直近の平均) のこの倍率未満に落ちたら */
export const PRAYER_GRASS_DROP = 0.7;
/** 「狼を減らして」: 支え半径内の捕食者比が、基準のこの倍率を超えて上がったら */
export const PRAYER_PREDATOR_RISE = 1.5;
/** 基準に使う直近の年数 */
export const PRAYER_BASELINE_YEARS = 10;
/** 基準ができるまでの最小年数。これより短いと「いつも」が無いので雨・狼の祈りは出ない */
export const PRAYER_BASELINE_MIN = 3;

/** issuePrayer の入力。すべて集落の支え半径 (草・捕食者) または採掘半径 (輝石) で測った値 */
export type PrayerCheckInput = {
  /** 支え半径内の草 (id 'grass') の密度平均 */
  grassMean: number;
  /** 支え半径内の捕食者 (肉食トロフィック) の総量 / 民の総量 */
  predatorRatio: number;
  /** 採掘半径内の輝石の残量 / crystalStart */
  crystalRatio: number;
  /** 「いつも」の基準 (直近 PRAYER_BASELINE_YEARS 年の平均、今年を含まない)。無ければ雨・狼の祈りは出ない (M9-03) */
  baseline?: { grassMean: number; predatorRatio: number };
};

/**
 * 今年出す祈りの種類を決める。複数当てはまれば crystal > wolves > rain の優先。
 * どれも当てはまらなければ null (祈りは出ない)。
 */
export function issuePrayer(input: PrayerCheckInput): PrayerKind | null {
  if (input.crystalRatio < PRAYER_CRYSTAL_LOW) return 'crystal';
  // M9-03: 絶対値ではなく基準比 (「いつもより」)。基準が無ければ出ない
  if (input.baseline && input.predatorRatio > 0 && input.predatorRatio > input.baseline.predatorRatio * PRAYER_PREDATOR_RISE) return 'wolves';
  if (input.baseline && input.grassMean < input.baseline.grassMean * PRAYER_GRASS_DROP) return 'rain';
  return null;
}

/**
 * その種類の困りごとがまだ続いているか (M9-03)。期限の前に困りごとが自然に消えれば、民は祈るのをやめる (取り下げ、信仰は動かない)。
 * 塔の重さでは噴火の炎蜥蜴が数年で消えるので「狼を減らして」の大半がこれに当たる (期限切れの無視にすると信仰が崩れて塔が内乱で落ちた)
 */
export function prayerStillNeeded(kind: PrayerKind, input: PrayerCheckInput): boolean {
  switch (kind) {
    case 'crystal':
      return input.crystalRatio < PRAYER_CRYSTAL_LOW;
    // 基準がまだ無ければ判断できないので、祈りは残す (開始時に指定した祈りが最初の年に消えないように)
    case 'wolves':
      return !input.baseline || (input.predatorRatio > 0 && input.predatorRatio > input.baseline.predatorRatio * PRAYER_PREDATOR_RISE);
    case 'rain':
      return !input.baseline || input.grassMean < input.baseline.grassMean * PRAYER_GRASS_DROP;
  }
}

/**
 * この介入 (dispatch されたコマンド) が祈りに応えるものかどうか。
 * - rain: `set_climate` で雨 (rainScale) を今より増やす、または半径内 (SUPPORT_RADIUS + radius) への草の放流
 * - wolves: 半径内 (SUPPORT_RADIUS + radius) への疫病 (disaster plague)
 * - crystal: 常に false (M9 では応えようがない。M11 星砂層で追加)
 */
export function isAnswer(kind: PrayerKind, cmd: Command, ctx: { home: number; size: number; rainScaleBefore: number }): boolean {
  switch (kind) {
    case 'rain':
      if (cmd.type === 'set_climate') return cmd.rainScale !== undefined && cmd.rainScale > ctx.rainScaleBefore;
      if (cmd.type === 'spawn_species') return cmd.speciesId === 'grass' && cellDistance(cmd.cell, ctx.home, ctx.size) <= SUPPORT_RADIUS + (cmd.radius ?? 0);
      return false;
    case 'wolves':
      return cmd.type === 'disaster' && cmd.kind === 'plague' && cellDistance(cmd.cell, ctx.home, ctx.size) <= SUPPORT_RADIUS + cmd.radius;
    case 'crystal':
      return false;
  }
}
