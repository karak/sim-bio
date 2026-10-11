import type { TimelineEvent } from './ScenarioRunner';
import type { Command } from '../simulation/types';
import { EDICT_FAITH } from '../simulation/edict';
import { formatFaith } from '../simulation/faith';
import { STAGE_NAMES } from '../simulation/civilization';
import type { PrayerKind } from '../simulation/prayer';
import { TOWER_RAIN_SCALE_DEFAULT } from '../simulation/weatherTower';

/** 年表の出来事の文 (M27-02)。石板 (ui/Tablet.ts) と観察画面の知らせの帯 (observe/notice.ts) が同じ文を出す */

const DISASTER_LABEL: Record<string, string> = { meteor: '隕石', volcano: '火山', wildfire: '山火事', plague: '疫病' };
/** 祈りの種類の文言 (M9-02) */
export const PRAYER_LABEL: Record<PrayerKind, string> = { rain: '雨を', wolves: '狼を減らして', crystal: '星の砂を' };

/** 年表の 1 行を人が読める文にする */
export function describeEvent(e: TimelineEvent, names: Record<string, string>): string {
  const cmdText = (c: Command, scheduled: boolean): string => {
    switch (c.type) {
      case 'spawn_species':
        return `${names[c.speciesId] ?? c.speciesId}を放った`;
      case 'disaster':
        return scheduled ? `予言どおり${DISASTER_LABEL[c.kind] ?? c.kind}が起きた` : `${DISASTER_LABEL[c.kind] ?? c.kind}を送った`;
      case 'set_climate':
        return [c.rainScale !== undefined ? `雨 ×${c.rainScale.toFixed(2)}` : '', c.tempOffset !== undefined ? `気温 ${c.tempOffset >= 0 ? '+' : ''}${c.tempOffset.toFixed(1)}` : ''].filter(Boolean).join('、');
      case 'sink':
        return '海が上がった';
      case 'civ_edict':
        return c.edict === 'stop_mining' ? '石板が告げた: 採掘を止めよ' : '石板が告げた: 採掘を再開せよ';
      case 'intercept':
        return '星が砕けた';
      // 気象塔を建てる (M10-01) は intervene() が専用の 'tower' kind で積むので、この分岐は実際には通らないが
      // Command の網羅性のために用意しておく
      case 'build_tower':
        return `気象塔を建てた(雨 ${(c.rainScale ?? TOWER_RAIN_SCALE_DEFAULT).toFixed(2)}×)`;
      case 'tower_power':
        return c.active ? '気象塔が動き出した' : '気象塔が止まった';
      case 'launch_ship':
        return '石板が告げた: 舟を作れ';
    }
  };
  switch (e.kind) {
    case 'intervene':
      return cmdText(e.command, false);
    case 'scheduled':
      // text 付きの予定 (M10R-07: 狼の波) はその台詞をそのまま出す
      return e.text ?? cmdText(e.command, true);
    case 'power_exhausted':
      return '力が尽き、気候が元に戻った';
    case 'warning':
      return `⚠ ${e.warning.text}`;
    case 'verdict':
      if (e.verdict.status === 'alive') return '島は生き延びた';
      if (e.verdict.status === 'escaped') return '次の島へ逃れた';
      return '島は滅びた';
    case 'civ_stage':
      if (e.to === 0) return '文明が崩壊した';
      return `文明が ${STAGE_NAMES[e.from]} → ${STAGE_NAMES[e.to]} に${e.to > e.from ? '上がった' : '下がった'}`;
    case 'civ_faith':
      return `信仰が ${formatFaith(e.from)} → ${formatFaith(e.to)} に${e.to > e.from ? '上がった' : '下がった'}`;
    // 信仰の上限 (民の記憶、M10R-02): 下がる (無視の記憶) と上がる (応え・祈りの無い年の忘却) で言葉を変える
    case 'civ_faith_cap':
      return e.to < e.from ? `民は忘れない: 信仰の上限 ${formatFaith(e.to)}` : `民の記憶が薄れる: 信仰の上限 ${formatFaith(e.to)}`;
    case 'civ_edict': {
      if (!e.obeyed) return `民は聞かなかった(信仰 ${formatFaith(e.faith)}。${EDICT_FAITH} に足りない)`;
      return e.edict === 'stop_mining' ? '民は採掘を止めた' : '民は採掘を再開した';
    }
    case 'prayer': {
      const label = PRAYER_LABEL[e.prayer];
      if (e.phase === 'issued') return `民が祈った: ${label}`;
      if (e.phase === 'answered') return `祈りに応えた: ${label}`;
      if (e.phase === 'withdrawn') return `困りごとが消え、民は祈るのをやめた: ${label}`;
      return `祈りを無視した: ${label}`;
    }
    case 'intercepted':
      return `星が砕けた(${e.atYear} 年目の星は落ちない)`;
    // 気象塔 (M10-01)
    case 'tower':
      return `星が気象塔を建てた(雨 ${e.rainScale.toFixed(2)}×)`;
    case 'tower_stopped':
      return '力が尽き、気象塔が止まった';
    case 'tower_resumed':
      return '気象塔が動き出した';
    // 夢喰い (M10R-03): 現れた・去った。信仰の上限 (faithCap) を添える (LD §3.3)
    case 'dream_eater':
      return e.phase === 'appeared' ? `夢喰いが集落に現れた(信仰の上限 ${formatFaith(e.faithCap)})` : `夢喰いが去った(信仰の上限 ${formatFaith(e.faithCap)})`;
  }
}
