/**
 * 文明の信仰の値 (M9-01)。World には依存しない純粋関数群。
 * 同じ種類の介入(予測可能)を繰り返すと上がり、種類がばらつく介入や災害で下がり、
 * 何もしなければゆっくり減衰する。係数はすべてこのファイルの定数にまとめる。
 */
import type { Command } from './types';
import { cellDistance, HOME_RADIUS } from './civilization';

/** 文明が stage ≥ 1 になった最初の年に生まれる初期値 */
export const FAITH_INITIAL = 0.5;
/** 同じ種類のコマンドが続いた (a) ときに足す量 */
export const FAITH_UP = 0.05;
/** 種類がばらついた (b) ときに引く量 */
export const FAITH_DOWN = 0.05;
/** 災害 1 回につき引く量 (c) */
export const FAITH_DISASTER = 0.1;
// M9-03: 数えるのは集落そのもの (HOME_RADIUS) を襲った災害だけ (World.dispatch の disasterHitsHome)。
// 塔の重さの噴火 (集落から 10 セル、半径 4) は民の目の前ではないので数えない
/** 介入が無くても毎年これだけ減衰する (d) */
export const FAITH_DECAY = 0.01;
// 校正 (M9-03、2026-09-21): 0.03 では 0.5 → 0.3 が 17 年で、塔の重さの想定解 (儀式つき) でも噴火と祈りの無視に儀式が追いつかず
// 内乱の連鎖で崩れた。「何もしなければゆっくり減衰」の趣旨で 0.01 (0.5 → 0.3 に 51 年) にした
/** recent の最後のキーがこれ以上あれば (a) が成り立つ */
export const FAITH_STREAK_THRESHOLD = 3;
/** recent に異なるキーがこれ以上あれば (b) が成り立つ */
export const FAITH_VARIETY_THRESHOLD = 3;
/** recent / 履歴として保持する年数 (今年を含む、直近) */
export const FAITH_HISTORY_YEARS = 10;
/** 祈りに応えた 1 件につき足す量 (M9-02)。LD §3.1 の据え置き値 */
export const FAITH_ANSWER = 0.15;
/** 祈りを無視した (期限切れ) 1 件につき引く量 (M9-02)。LD §3.1 の据え置き値 */
export const FAITH_IGNORE = 0.15;

/**
 * 信仰の上限 (民の記憶、M10R-02)。docs/design/2026-09-22-level-design-faith-economy.md §3.1。
 * 信仰そのものと違い、無視された祈りの記憶で下がり、応えた記憶・祈りの無い年の忘却で戻る。
 * CivState.faithCap の初期値、および updateFaithCap の一律クランプ [0, FAITH_CAP_INITIAL] の上端
 */
export const FAITH_CAP_INITIAL = 1.0;
/** 祈りを無視した (期限切れ) 1 件につき上限から引く量 (M10R-02)。LD §3.1 の据え置き値 */
export const FAITH_CAP_IGNORE = 0.1;
/** 祈りに応えた 1 件につき上限に足す量 (M10R-02)。LD §3.1 の据え置き値 */
export const FAITH_CAP_ANSWER = 0.1;
/** 祈りが無い年 (困りごとが無い) に上限へ戻す量 (M10R-02)。LD §3.1 の据え置き値。若い信仰 (段階 ≤ FAITH_YOUNG_STAGE) には効かない (M10R-07) */
export const FAITH_CAP_RECOVER = 0.01;
/**
 * 若い信仰の段階の上限 (M10R-07、LD §8.6): 歌 (3) まで。この段階の民は「応えられずに終わった祈り」を取り下げでも記憶に刻む
 * (上限 −FAITH_CAP_IGNORE) し、上限は応えでしか戻らない。祈りに応えるなの圧はここに置く。石 (4) 以上は M10R-02 のまま
 */
export const FAITH_YOUNG_STAGE = 3;

/**
 * コマンドの「種類」のキー。信仰の更新で「同じ種類」「ばらつき」を数えるのに使う。
 * sink は滅びの進行(予定どおりの沈降)なので数えない (null)。
 */
export function commandKey(cmd: Command): string | null {
  switch (cmd.type) {
    case 'spawn_species':
      return `spawn:${cmd.speciesId}`;
    case 'set_climate':
      return 'climate';
    case 'disaster':
      return `disaster:${cmd.kind}`;
    case 'sink':
      return null;
    // 勅令 (M9-03) は言葉であって行為ではないので、儀式にも気まぐれにも数えない
    case 'civ_edict':
      return null;
    // 気象塔を建てる (M10-01) は星の行為 (輝石と力を払う) なので、儀式にもばらつきにも数える
    case 'build_tower':
      return 'build_tower';
    // 維持費の自動切り替え (M10-01) は sink/civ_edict と同じく予定どおりの進行・言葉なので数えない
    case 'tower_power':
      return null;
    // 迎撃 (M10-02) は星の行為だが 1 回きりなので儀式にはならない。気まぐれ (種類の入れ替わり) に数えないよう null
    case 'intercept':
      return null;
    // 舟を作れ (M10-03) は civ_edict と同じく言葉 (石板が民に告げる) であって行為ではないので、儀式にも気まぐれにも数えない
    case 'launch_ship':
      return null;
  }
}

/**
 * 信仰の値を 1 年分更新する。
 * - recent: 直近 FAITH_HISTORY_YEARS 年 (今年を含む) に dispatch されたコマンドのキー、古い順
 * - disasters: 今年の災害コマンドの回数 (プレイヤーも予定コマンドも含む)
 * - answered: 今年、祈りに応えた回数 (省略時 0。M9-02)
 * - ignored: 今年、祈りを無視した (期限切れ) 回数 (省略時 0。M9-02)
 * 規則:
 * (a) recent の最後のキーと同じキーが recent に FAITH_STREAK_THRESHOLD 回以上あれば +FAITH_UP
 * (b) recent の異なるキーが FAITH_VARIETY_THRESHOLD 種類以上なら −FAITH_DOWN
 * (c) 今年の災害 1 回につき −FAITH_DISASTER
 * (c') 今年、祈りに応えた 1 回につき +FAITH_ANSWER、無視した 1 回につき −FAITH_IGNORE (災害の後・減衰の前)
 * (d) 最後に × (1 − FAITH_DECAY) で減衰
 * (e) [0,1] にクランプ
 * (a)(b) は両方成り立てば両方掛かる。
 */
export function updateFaith(prev: number, input: { recent: string[]; disasters: number; answered?: number; ignored?: number }): number {
  const { recent, disasters, answered = 0, ignored = 0 } = input;
  let faith = prev;
  if (recent.length > 0) {
    const last = recent[recent.length - 1];
    const streak = recent.filter((k) => k === last).length;
    if (streak >= FAITH_STREAK_THRESHOLD) faith += FAITH_UP;
    const distinct = new Set(recent).size;
    if (distinct >= FAITH_VARIETY_THRESHOLD) faith -= FAITH_DOWN;
  }
  faith -= disasters * FAITH_DISASTER;
  faith += answered * FAITH_ANSWER - ignored * FAITH_IGNORE;
  faith *= 1 - FAITH_DECAY;
  return Math.min(1, Math.max(0, faith));
}

/**
 * 信仰の上限 (民の記憶) を 1 年分更新する (M10R-02)。docs/design/2026-09-22-level-design-faith-economy.md §3.1。
 * - answered: 今年、祈りに応えた回数
 * - ignored: 今年、祈りを無視した (期限切れ) 回数
 * - prayerPending: 今年の祈りの処理を終えた時点で、まだ有効な祈りが残っているか (取り下げ・無視・応えのどれでもなく続いている)
 * 規則:
 * (a) 無視した 1 回につき −FAITH_CAP_IGNORE
 * (b) 応えた 1 回につき +FAITH_CAP_ANSWER
 * (c) 祈りが無い年 (prayerPending が false かつ answered も ignored も 0、つまり今年は困りごと自体が無かった) だけ +FAITH_CAP_RECOVER
 * (d) [0,1] にクランプ
 * (e) young (段階 ≤ FAITH_YOUNG_STAGE、M10R-07): withdrawn (取り下げ) 1 回につき −FAITH_CAP_IGNORE、(c) は効かない
 * (a)(b)(c) は理屈上重ならない (無視・応えがあった年は必ず prayerPending か answered/ignored > 0 なので (c) は成り立たない) が、
 * 念のため足し引きしてからまとめてクランプする
 */
export function updateFaithCap(prev: number, input: { answered: number; ignored: number; prayerPending: boolean; withdrawn?: number; young?: boolean }): number {
  const { answered, ignored, prayerPending } = input;
  let cap = prev;
  cap += answered * FAITH_CAP_ANSWER - ignored * FAITH_CAP_IGNORE;
  // 若い信仰の記憶 (M10R-07、LD §8.6): 段階 ≤ 歌 (young) では、応えられずに終わった祈りは取り下げでも −FAITH_CAP_IGNORE、
  // 上限の回復は応えのみ ((c) を外す)。石以上は今まで通り (塔の重さ・霊脈枯れ・迎撃・舟は変わらない)
  if (input.young) cap -= (input.withdrawn ?? 0) * FAITH_CAP_IGNORE;
  else if (!prayerPending && answered === 0 && ignored === 0) cap += FAITH_CAP_RECOVER;
  return Math.min(1, Math.max(0, cap));
}

/**
 * 災害が集落そのものを襲ったか (M9-03)。中心からの距離が 災害の半径 + HOME_RADIUS 以内なら民の目の前。
 * 信仰を下げる災害 (updateFaith の disasters) はこれだけ数える
 */
export function disasterHitsHome(cmd: Command, home: number, size: number): boolean {
  if (cmd.type !== 'disaster' || home < 0) return false;
  return cellDistance(cmd.cell, home, size) <= cmd.radius + HOME_RADIUS;
}

/**
 * 信仰の表示 (M9-05)。小数 2 桁の切り捨て。四捨五入だと 0.597 が「0.60」と出て、勅令の門 (0.6) に足りないのに
 * 「民は聞かなかった(信仰 0.60 < 0.6)」と読める。HUD・石板・判定の文言はすべてこれで揃える
 */
export function formatFaith(faith: number): string {
  return (Math.floor(faith * 100 + 1e-9) / 100).toFixed(2);
}
