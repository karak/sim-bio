import type { LogLevel, LogSink } from '../core/log/types';
import type { Command, SaveData, SpeciesDef, WorldConfig, WorldSnapshot } from './types';
import { generateCrystal, generateTerrain, SEA_LEVEL } from './terrain';
import { stepClimate } from './climate';
import { stepVegetation, sumVegetation } from './vegetation';
import { stepPopulations } from './populations';
import { INITIAL_VITALITY, stepVitality } from './vitality';
import { applyDisaster, forEachInRadius, stepFire } from './disaster';
import { checkEmergence, HOME_RADIUS, populationAround, stepMining, type CivState } from './civilization';

export type WorldDeps = {
  log: LogSink;
  /** ログの ts 付与用。テストで差し替える。省略時は Date */
  now?: () => Date;
};

/** 陸の全セルに与える植物の初期密度 */
const INITIAL_PLANT = 0.05;

/**
 * 生態系の中核。描画・DOM・fetch を知らない。
 * - dispatch はキューに積み、次の step の先頭で適用する
 * - snapshot は内部バッファをそのまま返す (読み取り専用)
 */
export class World {
  private queue: Command[] = [];
  private tick = 0;
  private prevTotals: Record<string, number> = {};
  private readonly n: number;
  private readonly plants: SpeciesDef[];
  private readonly animals: SpeciesDef[];
  private readonly decomposers: SpeciesDef[];
  /** 山火事で燃えるもの: 植物 + 分解者 */
  private readonly burnable: SpeciesDef[];
  private readonly byId: Map<string, SpeciesDef>;
  readonly elevation: Float32Array;
  readonly moistureBase: Float32Array;
  readonly heat: Float32Array;
  readonly temperature: Float32Array;
  readonly moisture: Float32Array;
  readonly vegetation: Float32Array;
  /** 被食による植物の回復遅れ [0,1] */
  readonly grazed: Float32Array;
  readonly vitality: Float32Array;
  readonly litter: Float32Array;
  /** 輝石 [0,1]。陸だけに決定論で塊状に置かれる。海は 0 (M8-01) */
  readonly crystal: Float32Array;
  readonly fire: Uint8Array;
  readonly burnt: Uint16Array;
  private readonly scratch: Float32Array;
  readonly populations: Record<string, Float32Array> = {};
  private readonly totals: Record<string, number> = {};
  private meanTemperature = 0;
  /** M1 では定数 (CO2 → 気温のスロットは係数 0) */
  private readonly co2 = 280;
  /** 文明の状態。config.civilization が無ければ null のまま (M8-02) */
  private civ: CivState | null = null;
  /** 文明の種の年次総量、直近 EMERGE_HISTORY_YEARS 年分 (発生判定用)。古い順 */
  private civHistory: number[] = [];

  private constructor(
    private readonly config: WorldConfig,
    private readonly deps: WorldDeps,
    terrain: { elevation: Float32Array; moistureBase: Float32Array },
  ) {
    this.n = config.size * config.size;
    this.byId = new Map(config.species.map((d) => [d.id, d]));
    this.plants = config.species.filter((d) => d.trophic === 'plant');
    this.animals = config.species.filter((d) => d.trophic !== 'plant');
    this.decomposers = config.species.filter((d) => d.trophic === 'decomposer');
    this.burnable = config.species.filter((d) => d.trophic === 'plant' || d.trophic === 'decomposer');
    this.elevation = terrain.elevation;
    this.moistureBase = terrain.moistureBase;
    this.heat = new Float32Array(this.n);
    this.temperature = new Float32Array(this.n);
    this.moisture = new Float32Array(this.n);
    this.vegetation = new Float32Array(this.n);
    this.grazed = new Float32Array(this.n);
    this.vitality = new Float32Array(this.n);
    this.litter = new Float32Array(this.n);
    // seed から決定論で生成しておく。create はそのまま使い、restore は save.crystal があればそれで上書きする
    this.crystal = generateCrystal(config.seed, this.elevation, config.size);
    this.fire = new Uint8Array(this.n);
    this.burnt = new Uint16Array(this.n);
    this.scratch = new Float32Array(this.n);
    // config.civilization があるときだけ文明の状態を持つ。start 省略時は stage 0 / home -1 (未発生) から始める
    if (config.civilization) {
      const start = config.civilization.start;
      this.civ = { speciesId: config.civilization.speciesId, stage: start?.stage ?? 0, progress: 0, home: start?.home ?? -1, population: 0 };
    }
    for (const d of config.species) {
      this.populations[d.id] = new Float32Array(this.n);
      this.totals[d.id] = 0;
    }
  }

  static create(config: WorldConfig, deps: WorldDeps): World {
    const w = new World(structuredClone(config), deps, generateTerrain(config.seed, config.size));
    for (const d of w.config.species) {
      const init = d.initialDensity ?? (d.trophic === 'plant' ? INITIAL_PLANT : 0);
      if (init <= 0) continue;
      const p = w.populations[d.id];
      for (let i = 0; i < w.n; i++) if (w.elevation[i] >= SEA_LEVEL) p[i] = init;
    }
    for (let i = 0; i < w.n; i++) if (w.elevation[i] >= SEA_LEVEL) w.vitality[i] = INITIAL_VITALITY;
    // 初期スナップショットにも気温・水分が入るように 1 回だけ気候を評価する
    stepClimate(w, w.config, 0);
    w.heat.fill(0);
    w.refresh();
    w.prevTotals = { ...w.totals };
    w.log('info', 'sim.world.created', { seed: config.seed, size: config.size, speciesCount: config.species.length });
    return w;
  }

  static restore(save: SaveData, deps: WorldDeps): World {
    if (save.version !== 1) throw new Error(`unsupported save version ${String(save.version)}`);
    const w = new World(structuredClone(save.config), deps, {
      elevation: Float32Array.from(save.elevation),
      moistureBase: Float32Array.from(save.moistureBase),
    });
    w.heat.set(save.heat);
    if (save.grazed) w.grazed.set(save.grazed);
    if (save.vitality) w.vitality.set(save.vitality);
    else for (let i = 0; i < w.n; i++) if (w.elevation[i] >= SEA_LEVEL) w.vitality[i] = INITIAL_VITALITY;
    if (save.litter) w.litter.set(save.litter);
    // 古いセーブには無いので、その場合は既に constructor で seed から埋めた決定論の値をそのまま使う
    if (save.crystal) w.crystal.set(save.crystal);
    // save.civ が無ければ constructor で config.civilization.start から作った初期状態のまま (M8-02)
    if (save.civ) w.civ = { ...save.civ };
    w.tick = save.tick;
    for (const d of w.config.species) w.populations[d.id].set(save.populations[d.id] ?? []);
    const heat = Float32Array.from(w.heat);
    stepClimate(w, w.config, w.tick % w.config.ticksPerYear);
    w.heat.set(heat);
    w.refresh();
    w.prevTotals = { ...w.totals };
    w.log('info', 'sim.world.created', {
      seed: save.config.seed, size: save.config.size, speciesCount: save.config.species.length, restored: true,
    });
    return w;
  }

  dispatch(cmd: Command): void {
    this.queue.push(cmd);
  }

  step(ticks = 1): void {
    for (let k = 0; k < ticks; k++) this.stepOnce();
  }

  snapshot(): WorldSnapshot {
    const { ticksPerYear } = this.config;
    return {
      tick: this.tick,
      year: Math.floor(this.tick / ticksPerYear),
      dayOfYear: this.tick % ticksPerYear,
      size: this.config.size,
      layers: {
        elevation: this.elevation,
        temperature: this.temperature,
        moisture: this.moisture,
        vegetation: this.vegetation,
        vitality: this.vitality,
        litter: this.litter,
        crystal: this.crystal,
        populations: this.populations,
      },
      totals: this.totals,
      meanTemperature: this.meanTemperature,
      co2: this.co2,
      species: this.config.species,
      climate: { tempOffset: this.config.climate.tempOffset, rainScale: this.config.climate.rainScale },
      civ: this.civ ? { ...this.civ } : null,
    };
  }

  serialize(): SaveData {
    const populations: Record<string, number[]> = {};
    for (const d of this.config.species) populations[d.id] = Array.from(this.populations[d.id]);
    return {
      version: 1,
      config: structuredClone(this.config),
      tick: this.tick,
      elevation: Array.from(this.elevation),
      moistureBase: Array.from(this.moistureBase),
      heat: Array.from(this.heat),
      grazed: Array.from(this.grazed),
      vitality: Array.from(this.vitality),
      litter: Array.from(this.litter),
      crystal: Array.from(this.crystal),
      populations,
      ...(this.civ ? { civ: { ...this.civ } } : {}),
    };
  }

  private stepOnce(): void {
    const cmds = this.queue;
    this.queue = [];
    for (const c of cmds) this.apply(c);
    const { ticksPerYear, size } = this.config;
    const dayOfYear = this.tick % ticksPerYear;
    stepClimate(this, this.config, dayOfYear);
    stepFire(this, this.vegetation, this.burnable, size);
    stepVegetation(this.populations, this.scratch, this, this.plants, size);
    stepPopulations(this.populations, this.scratch, this, this.animals, size);
    stepVitality(this, this.decomposers, this.scratch, size);
    this.refresh();
    // 文明(M8-02): 発生済み (stage >= 1) なら毎 tick 輝石を掘り、段階が上がればログを出す
    if (this.civ && this.civ.stage >= 1) {
      const before = this.civ.stage;
      const { state } = stepMining(this.civ, this.crystal, this.elevation, size);
      this.civ = state;
      if (this.civ.stage !== before) {
        this.log('info', 'sim.civ.stage', { from: before, to: this.civ.stage, year: Math.floor(this.tick / ticksPerYear) });
      }
    }
    for (const d of this.config.species) {
      const was = this.prevTotals[d.id] ?? 0;
      if (was > 0 && this.totals[d.id] === 0) this.log('warn', 'sim.species.extinct', { speciesId: d.id });
    }
    this.prevTotals = { ...this.totals };
    this.tick++;
    if (this.tick % ticksPerYear === 0) {
      if (this.civ) this.stepCivYearly();
      const summary: Record<string, unknown> = {
        totals: { ...this.totals },
        meanTemperature: this.meanTemperature,
        co2: this.co2,
        vegetationRatio: this.vegetationRatio(),
        vitalityMean: this.landMean(this.vitality),
      };
      // civilization が設定されているときだけ civStage/civProgress を summary に足す (未設定の世界・既存テストは変わらない)
      if (this.civ) {
        summary.civStage = this.civ.stage;
        summary.civProgress = this.civ.progress;
      }
      this.log('info', 'sim.tick.summary', summary);
    }
  }

  /**
   * 文明の年次処理 (M8-02)。年が変わるたびに 1 回呼ぶ。
   * stage 0 (未発生) なら発生判定をし、発生していれば集落半径内の人口を更新する。
   */
  private stepCivYearly(): void {
    const civ = this.civ as CivState;
    const total = this.totals[civ.speciesId] ?? 0;
    this.civHistory.push(total);
    if (this.civHistory.length > 10) this.civHistory.shift();
    if (civ.stage === 0) {
      // 集落候補: その種の密度が最大の陸セル
      const pop = this.populations[civ.speciesId];
      let candidate = -1;
      let best = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.elevation[i] < SEA_LEVEL) continue;
        if (pop[i] > best) {
          best = pop[i];
          candidate = i;
        }
      }
      if (candidate >= 0) {
        let vegSum = 0;
        let vegCount = 0;
        forEachInRadius(candidate, HOME_RADIUS, this.config.size, (i) => {
          if (this.elevation[i] >= SEA_LEVEL) {
            vegSum += this.vegetation[i];
            vegCount++;
          }
        });
        const candidateVegetation = vegCount ? vegSum / vegCount : 0;
        if (checkEmergence(this.civHistory, candidateVegetation)) {
          civ.stage = 1;
          civ.home = candidate;
          civ.progress = 0;
          this.log('info', 'sim.civ.emerged', { speciesId: civ.speciesId, home: candidate });
        }
      }
    }
    civ.population = populationAround(this.populations[civ.speciesId], civ.home, this.elevation, this.config.size);
  }

  private apply(cmd: Command): void {
    const reason = this.validate(cmd);
    this.log('info', 'cmd.received', { cmd });
    if (reason) {
      this.log('warn', 'cmd.rejected', { cmd, reason });
      return;
    }
    switch (cmd.type) {
      case 'spawn_species': {
        const p = this.populations[cmd.speciesId];
        // radius 省略時 (= 0) は forEachInRadius が中心セルだけを渡すので、既存の 1 セル放流と同じ結果になる
        forEachInRadius(cmd.cell, cmd.radius ?? 0, this.config.size, (i) => {
          if (this.elevation[i] >= SEA_LEVEL) p[i] = Math.min(1, p[i] + cmd.amount);
        });
        break;
      }
      case 'set_climate': {
        if (cmd.tempOffset !== undefined) this.config.climate.tempOffset = cmd.tempOffset;
        if (cmd.rainScale !== undefined) this.config.climate.rainScale = cmd.rainScale;
        break;
      }
      case 'disaster': {
        const r = applyDisaster(this, cmd, this.config.species, this.config.size);
        this.log('info', 'sim.disaster', { kind: cmd.kind, cell: cmd.cell, radius: cmd.radius, affectedCells: r.affectedCells });
        break;
      }
      case 'sink': {
        let drowned = 0;
        for (let i = 0; i < this.n; i++) {
          const before = this.elevation[i];
          const after = Math.max(0, before - cmd.amount);
          this.elevation[i] = after;
          if (before >= SEA_LEVEL && after < SEA_LEVEL) drowned++;
        }
        this.log('info', 'sim.sink', { amount: cmd.amount, drownedCells: drowned });
        break;
      }
    }
  }

  private validate(cmd: Command): string | null {
    if ('cell' in cmd && (!Number.isInteger(cmd.cell) || cmd.cell < 0 || cmd.cell >= this.n)) return 'cell out of range';
    if (cmd.type === 'spawn_species') {
      if (!this.byId.has(cmd.speciesId)) return 'unknown species';
      if (!(cmd.amount > 0)) return 'amount must be > 0';
      if (this.elevation[cmd.cell] < SEA_LEVEL) return 'cell is sea';
    }
    if (cmd.type === 'disaster' && !(cmd.radius >= 0)) return 'radius must be >= 0';
    if (cmd.type === 'sink' && !(cmd.amount > 0)) return 'amount must be > 0';
    return null;
  }

  private refresh(): void {
    sumVegetation(this.populations, this.plants, this.vegetation);
    for (const d of this.config.species) {
      let t = 0;
      const p = this.populations[d.id];
      for (let i = 0; i < this.n; i++) t += p[i];
      this.totals[d.id] = t;
    }
    let land = 0;
    let t = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.elevation[i] >= SEA_LEVEL) {
        land++;
        t += this.temperature[i];
      }
    }
    this.meanTemperature = land ? t / land : 0;
  }

  /** 陸セルの平均 */
  private landMean(arr: Float32Array): number {
    let land = 0;
    let v = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.elevation[i] >= SEA_LEVEL) {
        land++;
        v += arr[i];
      }
    }
    return land ? v / land : 0;
  }

  private vegetationRatio(): number {
    let land = 0;
    let v = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.elevation[i] >= SEA_LEVEL) {
        land++;
        v += this.vegetation[i];
      }
    }
    return land ? v / land : 0;
  }

  private log(level: LogLevel, event: string, payload: Record<string, unknown>): void {
    const now = this.deps.now ?? (() => new Date());
    this.deps.log.write({
      ts: now().toISOString(),
      tick: this.tick,
      year: Math.floor(this.tick / this.config.ticksPerYear),
      level,
      event,
      ...payload,
    });
  }
}
