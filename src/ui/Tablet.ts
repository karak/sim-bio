import type { BudgetInfo } from '../scenario/ScenarioRunner';
import type { ScenarioDef, Verdict } from '../scenario/types';
import type { Warning } from '../scenario/warnings';

export type Tablet = {
  /** 開始からの年・判定・星の力 (budget が無いシナリオでは null) を表示する */
  update(year: number, verdict: Verdict, budget: BudgetInfo | null, warnings?: Warning[]): void;
  /** 勝敗が確定したときの大きな表示 */
  showVerdict(verdict: Verdict): void;
  /** 介入が弾かれた・力が尽きたときに石板を短く揺らして知らせる */
  flash(): void;
};

const KIND_LABEL: Record<ScenarioDef['kind'], string> = { prevent: '防ぐ', endure: '耐える', escape: '逃がす' };
/** 石板に同時に出す警告の上限 */
const MAX_WARNINGS = 3;

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
    update(year, verdict, budget, warnings = []) {
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
