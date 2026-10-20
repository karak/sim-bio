import type { BudgetInfo, TimelineEvent } from '../scenario/ScenarioRunner';
import type { ScenarioDef, Verdict } from '../scenario/types';
import type { Warning } from '../scenario/warnings';
import { describeEvent, PRAYER_LABEL } from '../scenario/describe';
import type { PrayerKind } from '../simulation/prayer';
import type { Cargo } from '../simulation/ship';
import { makeMovable } from './movable';

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
  /** 判定の表示を閉じる (M19-17)。判定の前の枠を読んだ・石板を初めからにしたとき */
  hideVerdict(): void;
  /** 介入が弾かれた・力が尽きたときに石板を短く揺らして知らせる */
  flash(): void;
};

export const KIND_LABEL: Record<ScenarioDef['kind'], string> = { prevent: '防ぐ', endure: '耐える', escape: '逃がす' };
/** 石板に同時に出す警告の上限 */
const MAX_WARNINGS = 3;
/** 年表に出す直近の件数 */
const MAX_TIMELINE = 6;

/** update の入り (M21-09)。省略できる引数は update が既定を埋めてから渡す */
export type TabletInput = {
  year: number;
  verdict: Verdict;
  budget: BudgetInfo | null;
  warnings: Warning[];
  timeline: TimelineEvent[];
  prayer: { kind: PrayerKind; yearsLeft: number } | null;
  milestones: { atYear: number; text: string }[];
};

/** 石板の文 (M21-09)。prayer・power は出さないとき null。chip は警告から種レイヤーを開く札 */
export type TabletView = {
  year: string;
  status: string;
  prayer: string | null;
  milestones: string[];
  warnings: { text: string; chip: { species: string; label: string } | null }[];
  timeline: { summary: string; lines: string[] };
  power: { value: string; flow: string } | null;
};

/** update の入りから石板の文を決める (M21-09)。DOM に触れない純粋な関数 */
export function tabletViewOf(def: ScenarioDef, speciesNames: Record<string, string>, i: TabletInput): TabletView {
  return {
    year: `${Math.min(i.year, def.years)} / ${def.years} 年`,
    status: i.verdict.status === 'running' ? `あと ${i.verdict.reason}` : i.verdict.reason,
    prayer: i.prayer ? `祈り: ${PRAYER_LABEL[i.prayer.kind]}(残り ${i.prayer.yearsLeft} 年)` : null,
    // 節目は未到達のものだけ。到達したら消える
    milestones: i.milestones.filter((m) => m.atYear > i.year).map((m) => `${m.atYear} 年目: ${m.text}`),
    // 種レイヤーへの案内チップ (M21-02 D5): id を持つ警告 (species_low、狼の波などの event) だけに出す。
    // 狼の波の警告からレイヤーを開けるよう促す (m10r-07 playtest)
    warnings: i.warnings.slice(0, MAX_WARNINGS).map((w) => ({ text: `⚠ ${w.text}`, chip: w.id ? { species: w.id, label: `${speciesNames[w.id] ?? w.id}を見る` } : null })),
    timeline: { summary: `年表 (${i.timeline.length})`, lines: i.timeline.slice(-MAX_TIMELINE).map((e) => `${e.year} 年: ${describeEvent(e, speciesNames)}`) },
    power:
      i.budget && def.budget
        ? {
            value: `${Math.floor(i.budget.power)} / ${i.budget.max}`,
            // 直前の年の収入と維持費。1 年目までは 0 なので出さない
            flow: i.budget.incomeLastYear || i.budget.upkeepLastYear ? `(+${i.budget.incomeLastYear.toFixed(1)}/年、維持 −${i.budget.upkeepLastYear.toFixed(1)}/年)` : '',
          }
        : null,
  };
}

/** 判定の板の文 (M21-09)。cargo は「持ち出しを保存」で渡す持ち出し (出さないとき null) */
export type VerdictView = { title: string; reason: string; stats: string[]; cargo: Cargo | null };

/** 判定の板の文と持ち出しの出し分けを決める (M21-09)。DOM に触れない純粋な関数 */
export function verdictViewOf(verdict: Verdict, cargo: Cargo | undefined, def: ScenarioDef | null, speciesNames: Record<string, string>): VerdictView {
  const st = verdict.stats;
  return {
    title: verdict.status === 'alive' ? '島は生き延びた' : verdict.status === 'escaped' ? '次の島へ' : '島は滅びた',
    reason: verdict.reason,
    stats: st
      ? [
          `介入 ${st.interventions} 回` + (def?.budget ? ` · 使った力 ${Math.round(st.powerSpent)}` : ''),
          `陸地率 ${(st.landRatio * 100).toFixed(0)}%`,
          Object.entries(st.totals)
            .map(([id, v]) => `${speciesNames[id] ?? id} ${v.toFixed(0)}`)
            .join(' · '),
        ]
      : [],
    cargo: verdict.status === 'escaped' && cargo ? cargo : null,
  };
}

/** 石板の外 (M21-09)。揺れを止める時計と、持ち出しの Blob URL。試験では差し替える */
export type TabletEnv = { later(fn: () => void, ms: number): void; createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };

const browserEnv: TabletEnv = {
  later: (fn, ms) => void setTimeout(fn, ms),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

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
  /** 警告の「〜を見る」チップ (M21-02 D5) を押したときに呼ぶ。省略時はチップを出しても押しても何もしない */
  onShowSpecies?: (id: string) => void,
  env: TabletEnv = browserEnv,
  /** 判定の板の「もう一度」(M26-08)。省略時は石板を選ぶ (onSelect) と同じ */
  onRetry: () => void = () => onSelect(def?.id ?? null),
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
    <div class="tablet-avoidance dim" id="tablet-avoidance" hidden></div>
    <div class="row"><span id="tablet-year" class="mono">0 / ${def.years} 年</span><span id="tablet-status" class="dim"></span></div>
    <div class="tablet-prayer" id="tablet-prayer" hidden></div>
    <div id="tablet-milestones" class="tablet-milestones"></div>
    <div id="tablet-warnings" class="tablet-warnings"></div>
    <details class="tablet-timeline"><summary id="tablet-timeline-summary">年表 (0)</summary><div id="tablet-timeline"></div></details>
    ${def.budget ? `<div class="row tablet-power"><span class="dim">力</span><span id="tablet-power" class="mono">${def.budget.start} / ${def.budget.max ?? def.budget.start * 3}</span><span id="tablet-power-flow" class="dim"></span></div>` : ''}` : ''}
  </div>
  <div class="verdict" id="verdict" hidden>
    <div class="verdict-box" id="verdict-box">
      <button type="button" class="verdict-grip" id="verdict-grip" aria-label="判定の板を動かす (ドラッグか矢印キー)" title="ドラッグか矢印キーで動かす"><i></i></button>
      <div class="verdict-title" id="verdict-title"></div>
      <div class="verdict-reason" id="verdict-reason"></div>
      <div class="verdict-stats mono" id="verdict-stats"></div>
      <div class="verdict-avoidance dim" id="verdict-avoidance" hidden></div>
      <div id="verdict-harbor"></div>
      <div class="row"><button id="verdict-retry" class="chip">もう一度</button><button id="verdict-free" class="chip">自由モードへ</button><a id="verdict-download" class="chip" href="#" download="cargo.json" hidden>持ち出しを保存</a></div>
    </div>
  </div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>('#' + id);
    if (!el) throw new Error(`tablet element missing: #${id}`);
    return el;
  };
  const select = $<HTMLSelectElement>('tablet-select');
  // (M21-04) 選んだだけでは舞台は変わらない。移るとき (確かめを受けたとき) は開き直すので、選んだ直後に今の舞台の表示へ戻す
  const shown = select.value;
  select.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    select.value = shown;
    onSelect(v || null);
  });
  $('verdict-retry').addEventListener('click', () => onRetry());
  $('verdict-free').addEventListener('click', () => onSelect(null));
  const verdictBoard = makeMovable($('verdict-box'), $('verdict-grip'), 'biotope.verdict-offset');
  // 警告から種レイヤーを開ける (M21-02 D5): update() のたびに innerHTML ごと差し替わるチップに直接つけず、
  // #tablet-warnings 自体に 1 つだけ委譲リスナーを持たせる (要素が消えてもリスナーは残る)。
  // 自由モード (def === null) では #tablet-warnings 自体を描かないので、$ (無ければ例外) ではなく querySelector で確かめる
  root.querySelector('#tablet-warnings')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.tablet-warning-layer');
    const id = btn?.dataset.species;
    if (id) onShowSpecies?.(id);
  });
  // 持ち出しの Blob URL (M10-03)。showVerdict のたびに前回分を捨てる (retry で作り直すため)
  let cargoUrl: string | null = null;

  return {
    update(year, verdict, budget, warnings = [], timeline = [], prayer = null, milestones = def?.milestones ?? []) {
      if (!def) return;
      const v = tabletViewOf(def, speciesNames, { year, verdict, budget, warnings, timeline, prayer, milestones });
      $('tablet-year').textContent = v.year;
      $('tablet-status').textContent = v.status;
      // 現在の祈り (M9-02): 無ければ行ごと隠す
      const prayerEl = $('tablet-prayer');
      prayerEl.hidden = v.prayer === null;
      if (v.prayer !== null) prayerEl.textContent = v.prayer;
      const msHtml = v.milestones.map((m) => `<div class="tablet-milestone">${m}</div>`).join('');
      const msEl = $('tablet-milestones');
      if (msEl.innerHTML !== msHtml) msEl.innerHTML = msHtml;
      const wHtml = v.warnings
        .map((w) => {
          const chip = w.chip ? ` <button class="chip tablet-warning-layer" data-species="${w.chip.species}">${w.chip.label}</button>` : '';
          return `<div class="tablet-warning">${w.text}${chip}</div>`;
        })
        .join('');
      const wEl = $('tablet-warnings');
      if (wEl.innerHTML !== wHtml) wEl.innerHTML = wHtml;
      if ($('tablet-timeline-summary').textContent !== v.timeline.summary) {
        $('tablet-timeline-summary').textContent = v.timeline.summary;
        $('tablet-timeline').innerHTML = v.timeline.lines.map((line) => `<div class="tablet-event">${line}</div>`).join('');
      }
      if (v.power) {
        $('tablet-power').textContent = v.power.value;
        $('tablet-power-flow').textContent = v.power.flow;
      }
    },
    flash() {
      const el = $('tablet');
      el.classList.remove('shake');
      // 連打でも毎回揺れるよう、reflow を挟んでからクラスを付け直す
      void el.offsetWidth;
      el.classList.add('shake');
      env.later(() => el.classList.remove('shake'), 300);
    },
    hideVerdict() {
      $('verdict').hidden = true;
    },
    showVerdict(verdict, cargo) {
      const v = verdictViewOf(verdict, cargo, def, speciesNames);
      const box = $('verdict');
      box.hidden = false;
      verdictBoard.show();
      box.classList.toggle('alive', verdict.status === 'alive');
      box.classList.toggle('dead', verdict.status === 'dead');
      box.classList.toggle('escaped', verdict.status === 'escaped');
      $('verdict-title').textContent = v.title;
      $('verdict-reason').textContent = v.reason;
      // 持ち出し (M10-03): escaped で cargo があれば「持ち出しを保存」を出す。Blob + <a download> でその場で持てるようにする
      const dl = $<HTMLAnchorElement>('verdict-download');
      if (cargoUrl) {
        env.revokeObjectURL(cargoUrl);
        cargoUrl = null;
      }
      if (v.cargo) {
        cargoUrl = env.createObjectURL(new Blob([JSON.stringify(v.cargo)], { type: 'application/json' }));
        dl.href = cargoUrl;
        dl.hidden = false;
      } else {
        dl.hidden = true;
      }
      $('verdict-stats').innerHTML = v.stats.map((line) => `<div>${line}</div>`).join('');
    },
  };
}
