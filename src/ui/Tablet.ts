import type { BudgetInfo, TimelineEvent } from '../scenario/ScenarioRunner';
import type { ScenarioDef, Verdict } from '../scenario/types';
import type { Command } from '../simulation/types';
import type { Warning } from '../scenario/warnings';
import { EDICT_FAITH } from '../simulation/edict';
import { formatFaith } from '../simulation/faith';
import { STAGE_NAMES } from '../simulation/civilization';
import type { PrayerKind } from '../simulation/prayer';
import { TOWER_RAIN_SCALE_DEFAULT } from '../simulation/weatherTower';
import type { Cargo } from '../simulation/ship';

export type Tablet = {
  /** 開始からの年・判定・星の力 (budget が無いシナリオでは null)・現在の祈り (M9-02) を表示する */
  update(
    year: number,
    verdict: Verdict,
    budget: BudgetInfo | null,
    warnings?: Warning[],
    timeline?: TimelineEvent[],
    prayer?: { kind: PrayerKind; yearsLeft: number } | null,
    /** 出す節目 (M10-02)。省略時は def.milestones。迎撃で取り消した隕石の節目を外して渡す */
    milestones?: { atYear: number; text: string }[],
  ): void;
  /** 勝敗が確定したときの大きな表示。escaped なら cargo があれば「持ち出しを保存」を出す (M10-03) */
  showVerdict(verdict: Verdict, cargo?: Cargo): void;
  /** 介入が弾かれた・力が尽きたときに石板を短く揺らして知らせる */
  flash(): void;
};

const KIND_LABEL: Record<ScenarioDef['kind'], string> = { prevent: '防ぐ', endure: '耐える', escape: '逃がす' };
/** 石板に同時に出す警告の上限 */
const MAX_WARNINGS = 3;
/** 年表に出す直近の件数 */
const MAX_TIMELINE = 6;
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
      return cmdText(e.command, true);
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
  }
}

/**
 * 石板: シナリオ選択、予言、残り年数、判定。
 * def が null のときは自由モード (選択だけ出す)。
 */
export function createTablet(
  root: HTMLElement,
  defs: ScenarioDef[],
  def: ScenarioDef | null,
  onSelect: (id: string | null) => void,
  /** 種 id → 表示名。結果の内訳で使う。省略時は id をそのまま出す */
  speciesNames: Record<string, string> = {},
): Tablet {
  const options = [`<option value="">自由モード</option>`]
    .concat(defs.filter((d) => !d.hidden).map((d) => `<option value="${d.id}"${def?.id === d.id ? ' selected' : ''}>${d.title}</option>`))
    .join('');
  root.insertAdjacentHTML(
    'beforeend',
    `
  <div class="hud tablet" id="tablet">
    <div class="row"><span class="dim">石板</span><select id="tablet-select">${options}</select></div>
    ${def ? `<div class="tablet-title" id="tablet-title">${def.title} <span class="dim">· ${KIND_LABEL[def.kind]}</span></div>
    <div class="tablet-prophecy" id="tablet-prophecy">${def.prophecy}</div>
    <div class="row"><span id="tablet-year" class="mono">0 / ${def.years} 年</span><span id="tablet-status" class="dim"></span></div>
    <div class="tablet-prayer" id="tablet-prayer" hidden></div>
    <div id="tablet-milestones" class="tablet-milestones"></div>
    <div id="tablet-warnings" class="tablet-warnings"></div>
    <details class="tablet-timeline"><summary id="tablet-timeline-summary">年表 (0)</summary><div id="tablet-timeline"></div></details>
    ${def.budget ? `<div class="row tablet-power"><span class="dim">力</span><span id="tablet-power" class="mono">${def.budget.start} / ${def.budget.max ?? def.budget.start * 3}</span><span id="tablet-power-flow" class="dim"></span></div>` : ''}` : ''}
  </div>
  <div class="verdict" id="verdict" hidden>
    <div class="verdict-box">
      <div class="verdict-title" id="verdict-title"></div>
      <div class="verdict-reason" id="verdict-reason"></div>
      <div class="verdict-stats mono" id="verdict-stats"></div>
      <div class="row"><button id="verdict-retry" class="chip">もう一度</button><button id="verdict-free" class="chip">自由モードへ</button><a id="verdict-download" class="chip" href="#" download="cargo.json" hidden>持ち出しを保存</a></div>
    </div>
  </div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>('#' + id);
    if (!el) throw new Error(`tablet element missing: #${id}`);
    return el;
  };
  $<HTMLSelectElement>('tablet-select').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    onSelect(v || null);
  });
  $('verdict-retry').addEventListener('click', () => onSelect(def?.id ?? null));
  $('verdict-free').addEventListener('click', () => onSelect(null));
  // 持ち出しの Blob URL (M10-03)。showVerdict のたびに前回分を捨てる (retry で作り直すため)
  let cargoUrl: string | null = null;

  return {
    update(year, verdict, budget, warnings = [], timeline = [], prayer = null, milestones = def?.milestones ?? []) {
      if (!def) return;
      $('tablet-year').textContent = `${Math.min(year, def.years)} / ${def.years} 年`;
      $('tablet-status').textContent = verdict.status === 'running' ? `あと ${verdict.reason}` : verdict.reason;
      // 現在の祈り (M9-02): 無ければ行ごと隠す
      const prayerEl = $('tablet-prayer');
      prayerEl.hidden = !prayer;
      if (prayer) prayerEl.textContent = `祈り: ${PRAYER_LABEL[prayer.kind]}(残り ${prayer.yearsLeft} 年)`;
      // 節目は未到達のものだけ。到達したら消える
      const pending = milestones.filter((m) => m.atYear > year);
      const msHtml = pending.map((m) => `<div class="tablet-milestone">${m.atYear} 年目: ${m.text}</div>`).join('');
      const msEl = $('tablet-milestones');
      if (msEl.innerHTML !== msHtml) msEl.innerHTML = msHtml;
      const wHtml = warnings.slice(0, MAX_WARNINGS).map((w) => `<div class="tablet-warning">⚠ ${w.text}</div>`).join('');
      const wEl = $('tablet-warnings');
      if (wEl.innerHTML !== wHtml) wEl.innerHTML = wHtml;
      const tlSummary = `年表 (${timeline.length})`;
      if ($('tablet-timeline-summary').textContent !== tlSummary) {
        $('tablet-timeline-summary').textContent = tlSummary;
        $('tablet-timeline').innerHTML = timeline
          .slice(-MAX_TIMELINE)
          .map((e) => `<div class="tablet-event">${e.year} 年: ${describeEvent(e, speciesNames)}</div>`)
          .join('');
      }
      if (budget && def.budget) {
        $('tablet-power').textContent = `${Math.floor(budget.power)} / ${budget.max}`;
        // 直前の年の収入と維持費。1 年目までは 0 なので出さない
        const flow = budget.incomeLastYear || budget.upkeepLastYear ? `(+${budget.incomeLastYear.toFixed(1)}/年、維持 −${budget.upkeepLastYear.toFixed(1)}/年)` : '';
        $('tablet-power-flow').textContent = flow;
      }
    },
    flash() {
      const el = $('tablet');
      el.classList.remove('shake');
      // 連打でも毎回揺れるよう、reflow を挟んでからクラスを付け直す
      void el.offsetWidth;
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 300);
    },
    showVerdict(verdict, cargo) {
      const box = $('verdict');
      box.hidden = false;
      box.classList.toggle('alive', verdict.status === 'alive');
      box.classList.toggle('dead', verdict.status === 'dead');
      box.classList.toggle('escaped', verdict.status === 'escaped');
      $('verdict-title').textContent = verdict.status === 'alive' ? '島は生き延びた' : verdict.status === 'escaped' ? '次の島へ' : '島は滅びた';
      $('verdict-reason').textContent = verdict.reason;
      // 持ち出し (M10-03): escaped で cargo があれば「持ち出しを保存」を出す。Blob + <a download> でその場で持てるようにする
      const dl = $<HTMLAnchorElement>('verdict-download');
      if (cargoUrl) {
        URL.revokeObjectURL(cargoUrl);
        cargoUrl = null;
      }
      if (verdict.status === 'escaped' && cargo) {
        cargoUrl = URL.createObjectURL(new Blob([JSON.stringify(cargo)], { type: 'application/json' }));
        dl.href = cargoUrl;
        dl.hidden = false;
      } else {
        dl.hidden = true;
      }
      const st = verdict.stats;
      $('verdict-stats').innerHTML = st
        ? [
            `介入 ${st.interventions} 回` + (def?.budget ? ` · 使った力 ${Math.round(st.powerSpent)}` : ''),
            `陸地率 ${(st.landRatio * 100).toFixed(0)}%`,
            Object.entries(st.totals)
              .map(([id, v]) => `${speciesNames[id] ?? id} ${v.toFixed(0)}`)
              .join(' · '),
          ]
            .map((line) => `<div>${line}</div>`)
            .join('')
        : '';
    },
  };
}
