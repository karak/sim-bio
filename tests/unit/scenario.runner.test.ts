import { describe, it, expect } from 'vitest';
import { createScenarioRunner, type RunnerState } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import { createViewedSpecies } from '../../src/ui/viewedSpecies';
import { grass } from './helpers';

const fakeWorld = (totals: Record<string, number>) => {
  let tick = 0;
  const cmds: Command[] = [];
  const size = 4;
  const n = size * size;
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { tempOffset: 0, rainScale: 1 }, civ: null, volcanoCell: 0, towers: [], ship: null, dreamEater: null, totals,
    layers: { elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
  });
  return { dispatch: (c: Command) => { cmds.push(c); }, snapshot, step: (t: number) => { tick += t; }, cmds };
};
const def: ScenarioDef = {
  id: 't', title: 't', prophecy: 'p', kind: 'endure', years: 5, referenceSize: 4,
  schedule: [
    { atYear: 2, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 } },
    { atYear: 1, everyYears: 1, untilYear: 3, command: { type: 'sink', amount: 0.01 } },
  ],
  alive: { type: 'species_alive', ids: ['deer'] },
  dead: { type: 'species_extinct', ids: ['deer'] },
};

describe('createScenarioRunner', () => {
  it('text 付きの繰り返し予定 (M10R-07: 狼の波) は発火した年に年表 (text 付きの scheduled) と警告 (event) に出る。text 無しの繰り返しは今まで通り出ない', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 7, schedule: [
      { atYear: 2, everyYears: 2, text: '狼の群れが北の谷に下りた', command: wave },
      { atYear: 1, everyYears: 1, command: { type: 'sink', amount: 0.01 } },
    ] };
    const r = createScenarioRunner(d, w);
    const eventsByYear: Record<number, string[]> = {};
    for (let y = 0; y <= 7; y++) { r.update(w.snapshot()); eventsByYear[y] = r.warnings().filter((x) => x.kind === 'event').map((x) => x.text); w.step(360); }
    expect(eventsByYear[2]).toEqual(['狼の群れが北の谷に下りた']);
    // noticeYears が無ければ告知は発火した年だけ
    expect(eventsByYear[3]).toEqual([]);
    expect(eventsByYear[4]).toEqual(['狼の群れが北の谷に下りた']);
    const scheduled = r.timeline().filter((e) => e.kind === 'scheduled');
    expect(scheduled).toEqual([2, 4, 6].map((year) => ({ year, kind: 'scheduled', command: wave, text: '狼の群れが北の谷に下りた' })));
    // 台詞は年表に scheduled として 1 行だけ。警告 (warning) の行としては重ねない
    expect(r.timeline().filter((e) => e.kind === 'warning' && e.warning.kind === 'event')).toEqual([]);
  });
  it('text 付きの spawn_species の予定は警告 (event) に id (種 id) を持たせ、石板が種レイヤーへの案内チップを出せるようにする (M21-02 D5)', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 2, schedule: [{ atYear: 1, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    const events = r.warnings().filter((x) => x.kind === 'event');
    expect(events).toEqual([{ kind: 'event', key: 'event:0@1', text: '狼の群れが北の谷に下りた', id: 'wolf' }]);
  });
  it('noticeYears があれば告知は発火した年から noticeYears 年のあいだ残り、その種のレイヤーを開く (setViewedSpecies) とその場で消えて戻らない (M21-02 D5)', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, noticeYears: 5, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    const events = () => r.warnings().filter((x) => x.kind === 'event');
    for (let y = 0; y <= 3; y++) { r.update(w.snapshot()); w.step(360); }
    expect(events()).toEqual([{ kind: 'event', key: 'event:0@1', text: '狼の群れが北の谷に下りた', id: 'wolf' }]);
    // 別の種を開いても消えない
    r.setViewedSpecies('deer');
    expect(events()).toHaveLength(1);
    r.setViewedSpecies('wolf');
    expect(events()).toEqual([]);
    r.setViewedSpecies(null);
    r.update(w.snapshot());
    expect(events()).toEqual([]);
  });
  it('その種のレイヤーを見ている間に発火した告知は最初から出さない。見るのをやめた後の次の発火は出る', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, everyYears: 2, noticeYears: 2, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    const keys = () => r.warnings().filter((x) => x.kind === 'event').map((x) => x.key);
    r.setViewedSpecies('wolf');
    for (let y = 0; y <= 1; y++) { r.update(w.snapshot()); w.step(360); }
    expect(keys()).toEqual([]);
    r.setViewedSpecies(null);
    for (let y = 2; y <= 3; y++) { r.update(w.snapshot()); w.step(360); }
    expect(keys()).toEqual(['event:0@3']);
  });
  it('観察画面から戻って見ている状態に復帰した時 (acknowledge: false) は、観察中に出た告知を消さない。その後に開き直せば消える', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, noticeYears: 5, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    const events = () => r.warnings().filter((x) => x.kind === 'event').map((x) => x.key);
    // 狼を見ていたが観察画面に入った (見ていない扱い) 間に発火する
    r.setViewedSpecies('wolf');
    r.setViewedSpecies(null);
    for (let y = 0; y <= 1; y++) { r.update(w.snapshot()); w.step(360); }
    expect(events()).toEqual(['event:0@1']);
    // 観察画面から戻る: 見ている種は狼に戻るが、読めていない告知は残す
    r.setViewedSpecies('wolf', { acknowledge: false });
    r.update(w.snapshot());
    expect(events()).toEqual(['event:0@1']);
    // プレイヤーが狼のレイヤーを開き直したら既読
    r.setViewedSpecies('wolf');
    expect(events()).toEqual([]);
  });
  it('main.ts と同じく createViewedSpecies 経由でつなぐと、観察画面から戻った後にチップを押し直せば (同じ種を選び直せば) 観察中に出た告知が消える', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, noticeYears: 5, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    const vs = createViewedSpecies((id, opts) => r.setViewedSpecies(id, opts));
    const events = () => r.warnings().filter((x) => x.kind === 'event').map((x) => x.key);
    vs.select('wolf');
    vs.setObserving(true);
    for (let y = 0; y <= 1; y++) { r.update(w.snapshot()); w.step(360); }
    expect(events()).toEqual(['event:0@1']);
    vs.setObserving(false);
    expect(events()).toEqual(['event:0@1']);
    vs.select('wolf');
    expect(events()).toEqual([]);
  });
  it('表示中の告知は RunnerState (M19-14) に入り、閉じて開き直しても残り、開いた後も押せば消え、期限で消える', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, noticeYears: 3, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 1; y++) { r.update(w.snapshot()); w.step(360); }
    const saved = JSON.parse(JSON.stringify(r.save())) as RunnerState;
    expect(saved.notices).toEqual([{ idx: 0, untilYear: 4, warning: { kind: 'event', key: 'event:0@1', text: '狼の群れが北の谷に下りた', id: 'wolf' } }]);
    // 年次評価の警告には混ぜない (告知は notices だけが持つ)
    expect(saved.warnings.filter((x) => x.kind === 'event')).toEqual([]);
    const keys = (x: ReturnType<typeof createScenarioRunner>) => x.warnings().filter((v) => v.kind === 'event').map((v) => v.key);
    const reopened = createScenarioRunner(d, w, {}, saved);
    expect(keys(reopened)).toEqual(['event:0@1']);
    // 期限 (untilYear 4) までは残り、4 年目の評価で消える
    const byYear: string[][] = [];
    for (let y = 2; y <= 4; y++) { reopened.update(w.snapshot()); byYear.push(keys(reopened)); w.step(360); }
    expect(byYear).toEqual([['event:0@1'], ['event:0@1'], []]);
    const again = createScenarioRunner(d, w, {}, saved);
    again.setViewedSpecies('wolf');
    expect(keys(again)).toEqual([]);
  });
  it('notices を持つ前の形の RunnerState (告知を warnings に混ぜ、announced を持つ) も読め、告知は notices に移って押せば消える', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 8, schedule: [{ atYear: 1, noticeYears: 3, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 1; y++) { r.update(w.snapshot()); w.step(360); }
    const { notices, ...rest } = JSON.parse(JSON.stringify(r.save())) as RunnerState;
    // 旧い runner は年次評価の時に告知を warnings の先頭に混ぜ、発火してまだ混ぜていない分を announced に持っていた
    const legacies = [
      { ...rest, warnings: [...notices.map((n) => n.warning), ...rest.warnings], announced: [] },
      { ...rest, announced: notices.map((n) => n.warning) },
    ];
    for (const legacy of legacies) {
      const reopened = createScenarioRunner(d, w, {}, legacy as unknown as RunnerState);
      expect(reopened.warnings()).toEqual(r.warnings());
      expect(reopened.save().notices).toEqual(notices);
      expect(reopened.save()).not.toHaveProperty('announced');
      reopened.setViewedSpecies('wolf');
      expect(reopened.warnings().filter((x) => x.kind === 'event')).toEqual([]);
    }
  });
  it('noticeYears を過ぎた告知は、押されていなくても消える (「着くまで三月」が何年も残らない)', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const d: ScenarioDef = { ...def, years: 6, schedule: [{ atYear: 1, noticeYears: 2, text: '狼の群れが北の谷に下りた', command: wave }] };
    const r = createScenarioRunner(d, w);
    const texts: string[][] = [];
    for (let y = 0; y <= 4; y++) { r.update(w.snapshot()); texts.push(r.warnings().filter((x) => x.kind === 'event').map((x) => x.text)); w.step(360); }
    expect(texts).toEqual([[], ['狼の群れが北の谷に下りた'], ['狼の群れが北の谷に下りた'], [], []]);
  });
  it('同じ予定の次の発火は前の告知を置き換える (重ねない)', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const meteor: Command = { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 };
    const d: ScenarioDef = { ...def, years: 7, schedule: [
      { atYear: 2, everyYears: 2, noticeYears: 3, text: '狼の群れが北の谷に下りた', command: wave },
      { atYear: 3, noticeYears: 3, text: '星が近づいている', command: meteor },
    ] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 4; y++) { r.update(w.snapshot()); w.step(360); }
    expect(r.warnings().filter((x) => x.kind === 'event').map((x) => x.key)).toEqual(['event:0@4', 'event:1@3']);
  });
  it('告知は発火の順ではなく予定の順に並ぶ: 添字の大きい予定が先に発火した場合', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const meteor: Command = { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 };
    // idx0 は 2 年目、idx1 は 1 年目に発火する
    const d: ScenarioDef = { ...def, years: 5, schedule: [
      { atYear: 2, noticeYears: 3, text: '狼の群れが北の谷に下りた', command: wave },
      { atYear: 1, noticeYears: 3, text: '星が近づいている', command: meteor },
    ] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 2; y++) { r.update(w.snapshot()); w.step(360); }
    expect(r.warnings().filter((x) => x.kind === 'event').map((x) => x.key)).toEqual(['event:0@2', 'event:1@1']);
  });
  it('告知は発火の順ではなく予定の順に並ぶ: 期限切れで消えた後に同じ予定が再発火した場合', () => {
    const w = fakeWorld({ deer: 1 });
    const wave: Command = { type: 'spawn_species', speciesId: 'wolf', cell: 5, amount: 1, radius: 3 };
    const meteor: Command = { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 };
    // idx0 は 1 年目に出て 2 年目に期限切れで消え、4 年目に再発火する。その間に idx1 が 2 年目に入る
    const d: ScenarioDef = { ...def, years: 6, schedule: [
      { atYear: 1, everyYears: 3, noticeYears: 1, text: '狼の群れが北の谷に下りた', command: wave },
      { atYear: 2, noticeYears: 5, text: '星が近づいている', command: meteor },
    ] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 4; y++) { r.update(w.snapshot()); w.step(360); }
    expect(r.warnings().filter((x) => x.kind === 'event').map((x) => x.key)).toEqual(['event:0@4', 'event:1@2']);
  });
  it('spawn_species でない予定 (text 付き) の警告には id を持たせない', () => {
    const w = fakeWorld({ deer: 1 });
    const cmd: Command = { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 };
    const d: ScenarioDef = { ...def, years: 2, schedule: [{ atYear: 1, text: '星が近づいている', command: cmd }] };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    const events = r.warnings().filter((x) => x.kind === 'event');
    expect(events).toEqual([{ kind: 'event', key: 'event:0@1', text: '星が近づいている', id: undefined }]);
  });
  it('everyYears があって untilYear が無い予定は予言の年まで繰り返す (M10R レビュー: 以前は 1 回しか撃たなかった)', () => {
    const w = fakeWorld({ deer: 1 });
    const d: ScenarioDef = { ...def, years: 7, schedule: [{ atYear: 2, everyYears: 2, command: { type: 'sink', amount: 0.01 } }] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 7; y++) { r.update(w.snapshot()); w.step(360); }
    // 2, 4, 6 年目の 3 回 (8 年目は予言の年を越える)
    expect(w.cmds.filter((c) => c.type === 'sink')).toHaveLength(3);
  });
  it('atYear 0 の予定は最初の update で無料で発火し、timeline に scheduled として残る (M10R-08、空の舟の民の林)', () => {
    const w = fakeWorld({ deer: 1 });
    const cmd: Command = { type: 'spawn_species', speciesId: 'grass', cell: 5, amount: 0.6, radius: 4 };
    const d: ScenarioDef = { ...def, schedule: [{ atYear: 0, command: cmd }] };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot()); // まだ 1 tick も進めていない最初の update (year 0)
    expect(w.cmds).toEqual([cmd]);
    expect(r.timeline()).toEqual([{ year: 0, kind: 'scheduled', command: cmd }]);
  });
  it('fires scheduled commands once at their year, resolves cell -1 to the center, and counts interventions', () => {
    const w = fakeWorld({ deer: 1 });
    const r = createScenarioRunner(def, w);
    r.update(w.snapshot());
    expect(w.cmds).toHaveLength(0);
    w.step(360);
    r.update(w.snapshot());
    r.update(w.snapshot());
    expect(w.cmds).toEqual([{ type: 'sink', amount: 0.01 }]);
    w.step(360);
    r.update(w.snapshot());
    // schedule の並び順に発火する: 隕石 (idx 0) → 沈降 (idx 1)
    expect(w.cmds).toHaveLength(3);
    expect(w.cmds[1]).toEqual({ type: 'disaster', kind: 'meteor', cell: 2 * 4 + 2, radius: 1 });
    expect(w.cmds[2]).toEqual({ type: 'sink', amount: 0.01 });
    w.step(360);
    r.update(w.snapshot());
    expect(w.cmds).toHaveLength(4);
    // 判定が確定する前の介入は数えられる
    r.intervene({ type: 'set_climate', tempOffset: 1 });
    expect(r.interventions()).toBe(1);
    expect(w.cmds).toHaveLength(5);
  });
  it('judges yearly: alive at the target year, dead when the condition hits, then stops', () => {
    const totals = { deer: 1 };
    const w = fakeWorld(totals);
    const verdicts: string[] = [];
    const r = createScenarioRunner(def, w, { onVerdict: (v) => verdicts.push(v.status) });
    for (let y = 0; y < 5; y++) { w.step(360); expect(r.update(w.snapshot()).status).toBe(y < 4 ? 'running' : 'alive'); }
    expect(verdicts).toEqual(['alive']);
    const w2 = fakeWorld({ deer: 0 });
    const r2 = createScenarioRunner(def, w2);
    w2.step(360);
    expect(r2.update(w2.snapshot()).status).toBe('dead');
    r2.intervene({ type: 'set_climate', tempOffset: 1 });
    expect(r2.interventions()).toBe(0);
  });
});

describe('launch_ship (M10-03、ScenarioRunner)', () => {
  it('civ_edict と同じく力を消費せず (cost 0)、介入回数にも数えない', () => {
    const w = fakeWorld({ deer: 1 });
    const withBudget: ScenarioDef = { ...def, budget: { start: 10, incomePerYear: 0, costs: { spawn: 3, disaster: 5, climate: 1 }, upkeepPerYear: { rainScale: 0, tempOffset: 0 } } };
    const r = createScenarioRunner(withBudget, w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'launch_ship' })).toEqual({ ok: true });
    expect(r.power()).toBe(10); // 値段 0 なので力は減らない
    expect(r.interventions()).toBe(0); // 言葉であって行為ではないので数えない
    expect(w.cmds).toEqual([{ type: 'launch_ship' }]);
  });
});

describe('species_mean (runner)', () => {
  it('年ごとの totals を履歴に積み、species_mean が直近の平均で判定する', () => {
    const totals = { deer: 10 };
    const w = fakeWorld(totals);
    const d: ScenarioDef = { ...def, years: 4, schedule: [], dead: undefined, alive: { type: 'species_mean', ids: ['deer'], years: 3, min: 5 } };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot()); // y0: 10
    w.step(360); r.update(w.snapshot()); // y1: 10
    totals.deer = 0;
    w.step(360); r.update(w.snapshot()); // y2: 0
    w.step(360); r.update(w.snapshot()); // y3: 0
    totals.deer = 30;
    w.step(360); r.update(w.snapshot()); // y4: 30 → 直近 3 年 (0, 0, 30) 平均 10 ≥ 5
    expect(r.verdict().status).toBe('alive');
    expect(r.verdict().reason).toBe('群れが残った(3 年平均): deer 10.0');
    // referenceSize 4 の def を size 4 で回しているので areaScale は 1
  });
  it('直近の平均が低ければ dead', () => {
    const totals = { deer: 10 };
    const w = fakeWorld(totals);
    const d: ScenarioDef = { ...def, years: 4, schedule: [], dead: undefined, alive: { type: 'species_mean', ids: ['deer'], years: 3, min: 5 } };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 4; y++) { if (y >= 2) totals.deer = y === 4 ? 12 : 0; r.update(w.snapshot()); w.step(360); }
    // 直近 3 年 (0, 0, 12) 平均 4 < 5
    expect(r.verdict().status).toBe('dead');
    expect(r.verdict().reason).toContain('群れが小さい(3 年平均): deer 4.0 (< 5.0)');
  });
});

describe('ticksToNextYear (M19-04)', () => {
  it('開始 tick から数えた次の年の境目までの tick 数を返す。境目ちょうどなら 1 年分', () => {
    const w = fakeWorld({ deer: 1 });
    w.step(100);
    const r = createScenarioRunner(def, w);
    expect(r.ticksToNextYear(w.snapshot())).toBe(360);
    w.step(1);
    expect(r.ticksToNextYear(w.snapshot())).toBe(359);
    w.step(358);
    expect(r.ticksToNextYear(w.snapshot())).toBe(1);
    w.step(1);
    expect(r.ticksToNextYear(w.snapshot())).toBe(360);
  });
});
