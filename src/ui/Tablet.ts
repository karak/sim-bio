import type { BudgetInfo, TimelineEvent } from '../scenario/ScenarioRunner';
import type { ScenarioDef, Verdict } from '../scenario/types';
import type { Command } from '../simulation/types';
import type { Warning } from '../scenario/warnings';
import { STAGE_NAMES } from '../simulation/civilization';

export type Tablet = {
  /** 開始からの年・判定・星の力 (budget が無いシナリオでは null) を表示する */
  update(year: number, verdict: Verdict, budget: BudgetInfo | null, warnings?: Warning[], timeline?: TimelineEvent[]): void;
  /** 勝敗が確定したときの大きな表示 */
  showVerdict(verdict: Verdict): void;
  /** 介入が弾かれた・力が尽きたときに石板を短く揺らして知らせる */
  flash(): void;
};

const KIND_LABEL: Record<ScenarioDef['kind'], string> = { prevent: '防ぐ', endure: '耐える', escape: '逃がす' };
/** 石板に同時に出す警告の上限 */
const MAX_WARNINGS = 3;
/** 年表に出す直近の件数 */
const MAX_TIMELINE = 6;
const DISASTER_LABEL: Record<string, string> = { meteor: '隕石', volcano: '火山', wildfire: '山火事', plague: '疫病' };

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
      return e.verdict.status === 'alive' ? '島は生き延びた' : '島は滅びた';
    case 'civ_stage':
      if (e.to === 0) return '文明が崩壊した';
      return `文明が ${STAGE_NAMES[e.from]} → ${STAGE_NAMES[e.to]} に${e.to > e.from ? '上がった' : '下がった'}`;
    case 'civ_faith':
      return `信仰が ${e.from.toFixed(2)} → ${e.to.toFixed(2)} に${e.to > e.from ? '上がった' : '下がった'}`;
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
      <div class="row"><button id="verdict-retry" class="chip">もう一度</button><button id="verdict-free" class="chip">自由モードへ</button></div>
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

  return {
    update(year, verdict, budget, warnings = [], timeline = []) {
      if (!def) return;
      $('tablet-year').textContent = `${Math.min(year, def.years)} / ${def.years} 年`;
      $('tablet-status').textContent = verdict.status === 'running' ? `あと ${verdict.reason}` : verdict.reason;
      // 節目は未到達のものだけ。到達したら消える
      const pending = (def.milestones ?? []).filter((m) => m.atYear > year);
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
    showVerdict(verdict) {
      const box = $('verdict');
      box.hidden = false;
      box.classList.toggle('alive', verdict.status === 'alive');
      box.classList.toggle('dead', verdict.status === 'dead');
      $('verdict-title').textContent = verdict.status === 'alive' ? '島は生き延びた' : '島は滅びた';
      $('verdict-reason').textContent = verdict.reason;
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
