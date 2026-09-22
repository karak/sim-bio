import type { LogLevel, LogSink } from '../core/log/types';
import type { Command, SaveData, SpeciesDef, WorldConfig, WorldSnapshot } from './types';
import { generateCrystal, generateTerrain, SEA_LEVEL } from './terrain';
import { stepClimate } from './climate';
import { stepVegetation, sumVegetation } from './vegetation';
import { stepPopulations } from './populations';
import { INITIAL_VITALITY, stepVitality } from './vitality';
import { applyDisaster, forEachInRadius, stepFire } from './disaster';
import { checkEmergence, cellDistance, EMERGE_CANDIDATE_MOVE, EMERGE_HISTORY_YEARS, MAX_STAGE, MINE_RADIUS, meanAround, SUPPORT_RADIUS, trackHomeCandidate, populationAround, stepMining, type CivState } from './civilization';
import { applyLoad, canAscend, checkDecline, DECLINE_YEARS, populationFor } from './civilizationLoad';
import { collectFuel, FUEL_NEED, FUEL_STOCK_YEARS, FUEL_YEARS } from './civilizationFuel';
import { commandKey, disasterHitsHome, updateFaith, FAITH_INITIAL, FAITH_HISTORY_YEARS } from './faith';
import { isAnswer, issuePrayer, prayerStillNeeded, PRAYER_BASELINE_MIN, PRAYER_BASELINE_YEARS, PRAYER_COOLDOWN, PRAYER_YEARS } from './prayer';
import { computeVeinLoss, labelVeins, veinCellLists } from './vein';
import { applyUnrest, stepUnrest, UNREST_FAITH_AFTER } from './unrest';
import { applyIntercept, canIntercept, stepWorks } from './works';
import { applyEdict } from './edict';
import {
  canBuildTower,
  takeCrystal,
  towerCrystalPool,
  towerFactors,
  TOWER_CRYSTAL,
  TOWER_RADIUS,
  TOWER_RAIN_SCALE_DEFAULT,
  TOWER_TEMP_OFFSET_DEFAULT,
  type WeatherTower,
} from './weatherTower';

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
  /** 開始時の輝石 (M9-03 霊脈)。seed から決定論で生成した値で、restore でも保存値で上書きしない。枯渇 = 1 − crystal / crystal0 */
  readonly crystal0: Float32Array;
  /** 霊脈の細り [0,1] (M9-03)。年に 1 回 computeVeinLoss で更新し、stepVitality が分解率に掛ける */
  readonly veinLoss: Float32Array;
  /** 霊脈の番号 (M9-03、labelVeins)。開始時の輝石から create/restore で 1 度だけ決める */
  veins: Int32Array;
  /** 脈ごとのセル一覧 (M9 レビュー: 採掘のたびに全セルを走査しないため)。veins と一緒に決める */
  veinCells: number[][];
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
  /** 衰退条件が連続で成り立っている年数 (M8-06) */
  private civDeclineStreak = 0;
  /** 文明の種の年次総量、直近 EMERGE_HISTORY_YEARS 年分 (発生判定用)。古い順 */
  private civHistory: number[] = [];
  // M9-00: 島全体の総量ではなく、集落候補の支え半径内の総量 (地域の群れ) を積む
  /** 前年の集落候補セル (M9-00)。候補が EMERGE_CANDIDATE_MOVE より遠くへ移れば civHistory を捨てる。未発生で候補が無い間は -1 */
  private civCandidate = -1;
  /** 信仰 (M9-01): 今年まだ集計していない、dispatch されたコマンドのキー (commandKey)。年ごとにリセット */
  private civYearKeys: string[] = [];
  /** 信仰 (M9-01): 今年の災害コマンドの回数 (プレイヤーも予定コマンドも)。年ごとにリセット */
  private civYearDisasters = 0;
  /** 信仰 (M9-01): 年ごとのコマンドキー履歴、直近 FAITH_HISTORY_YEARS 年分・古い順。updateFaith の recent の元 */
  private civFaithHistory: string[][] = [];
  /** 祈り (M9-02): 今年まだ集計していない、祈りに応えた回数。年ごとにリセット */
  private civYearAnswered = 0;
  /** 祈り (M9-02): 今年まだ集計していない、祈りを無視した (期限切れの) 回数。年ごとにリセット */
  private civYearIgnored = 0;
  /**
   * 祈り (M9-02): 次の祈りを出してよい最初の年 (前回解決した年 + PRAYER_COOLDOWN)。
   * -Infinity のままなら (まだ一度も解決していなければ) クールダウンは無いのと同じ。civFaithHistory と同じく
   * セーブには含めない (restore 直後はクールダウン無しから再開する。値そのものの互換は civ.prayer が担う)
   */
  private civPrayerCooldownUntil = -Infinity;
  /** 祈りの基準 (M9-03): 年ごとの草の密度平均と捕食者比、直近 PRAYER_BASELINE_YEARS 年・古い順。セーブには含めない (restore 後は数え直す) */
  private civPrayerHistory: { grassMean: number; predatorRatio: number }[] = [];
  /** 内乱 (M9-03): 信仰が UNREST_FAITH 未満の年の連続数。セーブには含めない (restore 直後は数え直す) */
  private civUnrestStreak = 0;
  /** 捕食者 (肉食トロフィック) の種。祈り「狼を減らして」の捕食者比の分子に使う (M9-02) */
  private readonly carnivores: SpeciesDef[];
  /** forest 種が config.species に無い世界で applyLoad の forest 引数を埋めるための捨て配列。常に 0 のまま (M8-03) */
  private readonly zeroForest: Float32Array;
  /** 気象塔の一覧 (M10-01)。文明が無くても常に配列 (空配列もありうる) */
  towers: WeatherTower[] = [];
  /**
   * 塔の効果の per-cell 倍率・オフセット (M10-01)。towers が変わるたび recomputeTowerFactors で更新し、
   * stepClimate に ClimateState の rainFactor/tempFactor として渡す (塔が無ければ既定 1/0 のまま、既存の挙動と同じ)
   */
  readonly rainFactor: Float32Array;
  readonly tempFactor: Float32Array;
  /**
   * 火山セル: config.volcanoCell があればそれ、無ければ標高最大の陸セル。create 時に 1 度だけ決める (M8-08)。
   * HUD が火山チップの誘導先として使う
   */
  private readonly _volcanoCell: number;

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
    this.carnivores = config.species.filter((d) => d.trophic === 'carnivore');
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
    // 輝石の倍率 (M10-02): シナリオが脈を薄くする舞台装置。脈の形 (labelVeins) は変わらず、量だけ変わる
    if (config.crystalScale !== undefined && config.crystalScale !== 1) for (let i = 0; i < this.n; i++) this.crystal[i] *= config.crystalScale;
    this.crystal0 = Float32Array.from(this.crystal);
    this.veinLoss = new Float32Array(this.n);
    this.veins = labelVeins(this.crystal0, this.elevation, config.size);
    this.veinCells = veinCellLists(this.veins);
    this.fire = new Uint8Array(this.n);
    this.burnt = new Uint16Array(this.n);
    this.scratch = new Float32Array(this.n);
    this.zeroForest = new Float32Array(this.n);
    // 気象塔 (M10-01): 既定は倍率 1・オフセット 0 (効果なし)。塔を建てるまでは既存の気候と同じ挙動になる
    this.rainFactor = new Float32Array(this.n).fill(1);
    this.tempFactor = new Float32Array(this.n);
    // 火山セルは config.volcanoCell があればそれを使う。無ければ標高最大の陸セルを既定にする (M8-08)。
    // 標高最大セルは冷えすぎて炎蜥蜴が湧かない (M8-09 の校正) ことがあるので、シナリオ側で暖かい
    // 低地セルを指定できるようにしてある
    if (config.volcanoCell !== undefined) {
      this._volcanoCell = config.volcanoCell;
    } else {
      let volcanoCell = 0;
      let volcanoElevation = -Infinity;
      for (let i = 0; i < this.n; i++) {
        if (this.elevation[i] >= SEA_LEVEL && this.elevation[i] > volcanoElevation) {
          volcanoElevation = this.elevation[i];
          volcanoCell = i;
        }
      }
      this._volcanoCell = volcanoCell;
    }
    // config.civilization があるときだけ文明の状態を持つ。start 省略時は stage 0 / home -1 (未発生) から始める
    if (config.civilization) {
      const start = config.civilization.start;
      this.civ = { speciesId: config.civilization.speciesId, stage: start?.stage ?? 0, progress: 0, home: start?.home ?? -1, population: 0 };
      // 祈りの開始指定 (M9-02): E2E の決定論のため、指定があれば開始時 (年 0) からその祈りを有効にする
      if (start?.prayer) {
        this.civ.prayer = { kind: start.prayer, issuedYear: 0, deadlineYear: PRAYER_YEARS };
      }
      // 信仰の開始指定 (M9-03): 指定があれば FAITH_INITIAL の代わりにこの値で生まれる (E2E の決定論と、シナリオの開始状態のため)
      if (start?.faith !== undefined) this.civ.faith = start.faith;
      // 工事の備蓄の開始指定 (M10-02): E2E で迎撃を最初から撃てるようにする
      if (start?.worksStock !== undefined) this.civ.works = { stock: start.worksStock, stopped: false };
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
    // 霊脈 (M9-03): 保存された輝石と開始時の輝石から細りを復元する。crystal0 は沈降で陸が減ると seed から同じ値に
    // 生成できない (陸セルの分位で閾値を決めるため) ので、セーブにあればそれを使う (M9 レビュー)
    if (save.crystal0) {
      w.crystal0.set(save.crystal0);
      w.veins = labelVeins(w.crystal0, w.elevation, w.config.size);
      w.veinCells = veinCellLists(w.veins);
    }
    computeVeinLoss(w.crystal, w.crystal0, w.elevation, w.config.size, w.veinLoss, w.veins);
    // save.civ が無ければ constructor で config.civilization.start から作った初期状態のまま (M8-02)
    if (save.civ) w.civ = { ...save.civ };
    // 気象塔 (M10-01): 古いセーブには無いので、その場合は constructor の既定 (空配列・倍率 1/オフセット 0) のまま
    if (save.towers) {
      w.towers = save.towers.map((t) => ({ ...t }));
      w.recomputeTowerFactors();
    }
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

  dispatch(cmd: Command, opts: { fromStar?: boolean } = {}): void {
    this.queue.push(cmd);
    // M9 レビュー: apply で弾かれるコマンド (海への放流など) は信仰・祈りにも数えない。
    // fromStar が false (予定コマンド、力切れの気候の戻し) は星の行為ではないので、儀式にも応えにも数えない (災害だけは民の目の前なら数える)
    const fromStar = opts.fromStar ?? true;
    if (this.civ && this.validate(cmd) === null) {
      const key = fromStar ? commandKey(cmd) : null;
      if (key !== null) this.civYearKeys.push(key);
      // 祈り (M9-02): 有効な祈りがあり、この介入が応えなら即座に解決する (応えた)。
      // rainScaleBefore はこのコマンドを apply する前の値 (dispatch は queue に積むだけで、まだ climate を変えていない)
      const answered = fromStar && !!this.civ.prayer && isAnswer(this.civ.prayer.kind, cmd, { home: this.civ.home, size: this.config.size, rainScaleBefore: this.config.climate.rainScale });
      // M9-03: 集落そのものを襲った災害だけ数える (遠くの噴火は民の目の前ではない)。
      // 民が望んだ災害 (祈りへの応え、たとえば「狼を減らして」への疫病) は裏切りではないので数えない
      // (数えると応えの +0.15 が災害の −0.1 でほぼ消え、祈りに応えて信仰を上げる道が成り立たなかった。M9-04 の実測)
      if (cmd.type === 'disaster' && !answered && disasterHitsHome(cmd, this.civ.home, this.config.size)) this.civYearDisasters++;
      if (answered && this.civ.prayer) {
        const kind = this.civ.prayer.kind;
        this.civ.prayer = undefined;
        this.civ.prayersAnswered = (this.civ.prayersAnswered ?? 0) + 1;
        this.civYearAnswered++;
        this.civPrayerCooldownUntil = Math.floor(this.tick / this.config.ticksPerYear) + PRAYER_COOLDOWN;
        this.log('info', 'sim.civ.prayer', { year: Math.floor(this.tick / this.config.ticksPerYear), phase: 'answered', kind });
      }
    }
  }

  /** 火山セル (config.volcanoCell、無ければ標高最大の陸セル)。HUD が火山チップの誘導先として使う (M8-08) */
  volcanoCell(): number {
    return this._volcanoCell;
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
      volcanoCell: this._volcanoCell,
      towers: this.towers.map((t) => ({ ...t })),
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
      crystal0: Array.from(this.crystal0),
      populations,
      ...(this.civ ? { civ: { ...this.civ } } : {}),
      towers: this.towers.map((t) => ({ ...t })),
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
    // 文明の負荷 (M8-03): 発生済み (stage >= 1) なら毎 tick、集落周りの森を伐り生気を吸う。
    // forest 種が居ない世界では捨て配列 (常に 0) を渡し、生気の負荷だけがかかるようにする
    if (this.civ && this.civ.stage >= 1) {
      const forestPop = this.populations['forest'] ?? this.zeroForest;
      const civPopulation = this.populations[this.civ.speciesId];
      applyLoad(this.civ.stage, this.civ.home, { forest: forestPop, litter: this.litter, vitality: this.vitality, elevation: this.elevation, civPopulation }, size);
    }
    this.refresh();
    // 文明(M8-02): 発生済み (stage >= 1) なら毎 tick 輝石を掘り、段階が上がればログを出す
    // 勅令 (M9-03): 民が採掘を止めている間は掘らない (段階も進まない)。負荷 (applyLoad) は残る
    if (this.civ && this.civ.stage >= 1 && !this.civ.miningStopped) {
      const before = this.civ.stage;
      // 次の段階に必要な民がいなければ掘っても上がらない (M8-06)。民は年 1 回更新される
      // 星 (7) へは半径 12 の民と信仰 0.8 が要る (M10-02、civilizationLoad.ts canAscend)
      const canAdvance = canAscend(this.civ);
      const { state } = stepMining(this.civ, this.crystal, this.elevation, size, canAdvance, { ids: this.veins, cells: this.veinCells });
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
      // 霊脈 (M9-03): 年に 1 回、輝石の枯渇から細りを更新する。掘っていなければ全セル 0 で今までどおり
      computeVeinLoss(this.crystal, this.crystal0, this.elevation, size, this.veinLoss, this.veins);
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
        // 燃料は stepCivYearly (直前で呼んでいる) が毎年必ず設定するので、ここでは存在チェック不要
        summary.civFuel = this.civ.fuel;
      }
      this.log('info', 'sim.tick.summary', summary);
    }
  }

  /**
   * 崩壊 (段階 0) のときに文明の状態を「未発生」に戻す (M9 レビュー)。
   * home だけでなく M9 の状態 (信仰・祈り・勅令・霊脈の基準・集落の生気) と発生判定の履歴も捨てる。
   * 残すと次に芽生えた文明が古い勅令で掘らず、期限切れの祈りを翌年に無視し、信仰が古い値から始まる。
   * 応えた/無視した/取り下げた祈りの数はシナリオの判定 (prayers_answered) の履歴なので残す
   */
  private collapseCiv(civ: CivState): void {
    civ.home = -1;
    civ.progress = 0;
    delete civ.faith;
    delete civ.prayer;
    delete civ.crystalStart;
    delete civ.miningStopped;
    delete civ.edict;
    delete civ.vitality;
    this.civCandidate = -1;
    this.civHistory = [];
    this.civFaithHistory = [];
    this.civPrayerHistory = [];
    this.civUnrestStreak = 0;
    this.civDeclineStreak = 0;
    this.civPrayerCooldownUntil = -Infinity;
  }

  /**
   * 文明の年次処理 (M8-02)。年が変わるたびに 1 回呼ぶ。
   * stage 0 (未発生) なら発生判定をし、発生していれば集落半径内の人口を更新する。
   */
  private stepCivYearly(): void {
    let civ = this.civ as CivState;
    const size = this.config.size;
    if (civ.stage === 0) {
      // 集落候補: その種の密度が最大の陸セル (M9-00: 採掘半径内に輝石があるものに限る)
      const pop = this.populations[civ.speciesId];
      const candidate = trackHomeCandidate(pop, this.crystal, this.elevation, size, this.civCandidate);
      if (candidate >= 0) {
        // 候補が前年から大きく動いたら別の群れなので履歴を捨てる。同じ群れの内なら地域の総量を積む (M9-00)
        if (this.civCandidate < 0 || cellDistance(candidate, this.civCandidate, size) > EMERGE_CANDIDATE_MOVE) this.civHistory = [];
        this.civCandidate = candidate;
        this.civHistory.push(populationAround(pop, candidate, this.elevation, size));
        if (this.civHistory.length > EMERGE_HISTORY_YEARS) this.civHistory.shift();
        const candidateVegetation = meanAround(this.vegetation, candidate, SUPPORT_RADIUS, this.elevation, size);
        let vegSum = 0;
        let vegCount = 0;
        for (let i = 0; i < this.n; i++) {
          if (this.elevation[i] >= SEA_LEVEL) {
            vegSum += this.vegetation[i];
            vegCount++;
          }
        }
        const islandVegetation = vegCount ? vegSum / vegCount : 0;
        if (checkEmergence(this.civHistory, { candidateVegetation, islandVegetation, hasCrystal: true })) {
          civ.stage = 1;
          civ.home = candidate;
          civ.progress = 0;
          this.log('info', 'sim.civ.emerged', { speciesId: civ.speciesId, home: candidate });
        }
      }
    }
    civ.population = populationAround(this.populations[civ.speciesId], civ.home, this.elevation, this.config.size);
    civ.populationStar = populationFor(MAX_STAGE, this.populations[civ.speciesId], civ.home, this.elevation, this.config.size);
    const year = Math.floor(this.tick / this.config.ticksPerYear);
    // 祈り (M9-02): 発生済み (stage >= 1、この年に発生した場合も含む) のときだけ扱う
    if (civ.stage >= 1) {
      // crystalStart: stage >= 1 になった最初の年 (発生時か開始時) に、採掘半径 MINE_RADIUS[MAX_STAGE] 内の
      // 輝石の総量を記録する。「星の砂を」の判定 (crystalRatio) の分母。以後は変えない
      if (civ.crystalStart === undefined) {
        let crystalSum = 0;
        forEachInRadius(civ.home, MINE_RADIUS[MAX_STAGE], this.config.size, (i) => {
          if (this.elevation[i] >= SEA_LEVEL) crystalSum += this.crystal[i];
        });
        civ.crystalStart = crystalSum;
      }
      // 期限切れの解決 (無視した) を先に判定してから、空いていれば新しい祈りを出す
      // 祈りの材料 (M9-03: 取り下げの判定にも使うので、祈りの有無に関わらず毎年計る)
      const prayerInput = (() => {
        const grassPop = this.populations['grass'];
        // grass 種が居ない世界では「雨を」の判定材料が無いので、常に閾値を上回る扱いにして rain を出さない
        const grassMean = grassPop ? meanAround(grassPop, civ.home, SUPPORT_RADIUS, this.elevation, this.config.size) : Number.POSITIVE_INFINITY;
        let predatorSum = 0;
        forEachInRadius(civ.home, SUPPORT_RADIUS, this.config.size, (i) => {
          if (this.elevation[i] >= SEA_LEVEL) for (const d of this.carnivores) predatorSum += this.populations[d.id][i];
        });
        const predatorRatio = civ.population > 0 ? predatorSum / civ.population : 0;
        let crystalNow = 0;
        forEachInRadius(civ.home, MINE_RADIUS[MAX_STAGE], this.config.size, (i) => {
          if (this.elevation[i] >= SEA_LEVEL) crystalNow += this.crystal[i];
        });
        // crystalStart が 0 (もともと輝石が無かった) なら「星の砂を」は成り立たないので比は 1 (常に閾値以上) にする
        const crystalRatio = civ.crystalStart > 0 ? crystalNow / civ.crystalStart : 1;
        // 基準 (M9-03): 今年を含まない直近の平均。PRAYER_BASELINE_MIN 年たつまでは無い
        const hist = this.civPrayerHistory;
        const baseline = hist.length >= PRAYER_BASELINE_MIN
          ? { grassMean: hist.reduce((a, h) => a + h.grassMean, 0) / hist.length, predatorRatio: hist.reduce((a, h) => a + h.predatorRatio, 0) / hist.length }
          : undefined;
        hist.push({ grassMean: Number.isFinite(grassMean) ? grassMean : 0, predatorRatio });
        if (hist.length > PRAYER_BASELINE_YEARS) hist.shift();
        return { grassMean, predatorRatio, crystalRatio, baseline };
      })();
      // 取り下げ (M9-03): 期限の前に困りごとが消えていれば、民は祈るのをやめる。信仰は動かず、無視にも応えにも数えない
      if (civ.prayer && year < civ.prayer.deadlineYear && !prayerStillNeeded(civ.prayer.kind, prayerInput)) {
        const kind = civ.prayer.kind;
        civ.prayer = undefined;
        civ.prayersWithdrawn = (civ.prayersWithdrawn ?? 0) + 1;
        this.civPrayerCooldownUntil = year + PRAYER_COOLDOWN;
        this.log('info', 'sim.civ.prayer', { year, phase: 'withdrawn', kind });
      }
      if (civ.prayer && year >= civ.prayer.deadlineYear) {
        const kind = civ.prayer.kind;
        civ.prayer = undefined;
        civ.prayersIgnored = (civ.prayersIgnored ?? 0) + 1;
        this.civYearIgnored++;
        this.civPrayerCooldownUntil = year + PRAYER_COOLDOWN;
        this.log('info', 'sim.civ.prayer', { year, phase: 'ignored', kind });
      }
      if (!civ.prayer && year >= this.civPrayerCooldownUntil) {
        const kind = issuePrayer(prayerInput);
        if (kind) {
          civ.prayer = { kind, issuedYear: year, deadlineYear: year + PRAYER_YEARS };
          this.log('info', 'sim.civ.prayer', { year, phase: 'issued', kind });
        }
      }
    }
    // 信仰 (M9-01): 年ごとのコマンドキー履歴を先に積んでから (recent が今年を含むように)、
    // stage >= 1 (この年に発生した場合も含む) なら信仰を更新する。civ.faith が無ければ発生した最初の年なので
    // FAITH_INITIAL で生まれ、規則の更新はまだ効かない
    this.civFaithHistory.push(this.civYearKeys);
    if (this.civFaithHistory.length > FAITH_HISTORY_YEARS) this.civFaithHistory.shift();
    if (civ.stage >= 1) {
      const prevFaith = civ.faith;
      civ.faith = prevFaith === undefined
        ? FAITH_INITIAL
        : updateFaith(prevFaith, {
            recent: this.civFaithHistory.flat(),
            disasters: this.civYearDisasters,
            answered: this.civYearAnswered,
            ignored: this.civYearIgnored,
          });
      const delta = civ.faith - (prevFaith ?? civ.faith);
      this.log('info', 'sim.civ.faith', { year, faith: civ.faith, delta });
      // 内乱 (M9-03): 信仰が低い年が UNREST_YEARS 続いたら、集落の民が半減し段階が 1 下がる。信仰は少し上へ戻す (連鎖させない)
      const unrest = stepUnrest(civ.faith, this.civUnrestStreak);
      this.civUnrestStreak = unrest.streak;
      if (unrest.unrest) {
        applyUnrest(this.populations[civ.speciesId], civ.home, this.elevation, size);
        const before = civ.stage;
        civ.stage -= 1;
        civ.progress = 0;
        civ.faith = UNREST_FAITH_AFTER;
        this.log('info', 'sim.civ.unrest', { year, from: before, to: civ.stage });
        this.log('info', 'sim.civ.stage', { from: before, to: civ.stage, reason: 'unrest', year });
        if (civ.stage === 0) {
          this.collapseCiv(civ);
          this.log('info', 'sim.civ.collapsed', { reason: 'unrest' });
        }
      }
    }
    this.civYearKeys = [];
    this.civYearDisasters = 0;
    this.civYearAnswered = 0;
    this.civYearIgnored = 0;
    // 塔の燃料 (M8-08): 決定判定より前に、毎年 1 度だけ集落半径内の熱・鐘樹の材から燃料を徴収する。
    // 足りない年が FUEL_YEARS 続いたら段階を 1 下げる (reason: 'fuel')。belltree レイヤーは M8-10 が
    // 追加するまで存在しないので、無い世界では熱だけが燃料源になる (collectFuel が省略時ガード)
    {
      const need = FUEL_NEED[civ.stage] ?? 0;
      const belltree = this.populations['belltree'];
      // 蓄え (M8-05 v2): 空きの分まで集めて蓄えに積み、その年の必要量を蓄えから引く。
      // 蓄えの初期値は config.civilization.start.fuelStock (省略時 0)
      const stockMax = need * FUEL_STOCK_YEARS;
      const prevStock = civ.fuel?.stock ?? this.config.civilization?.start?.fuelStock ?? 0;
      const room = Math.max(0, stockMax - prevStock);
      const { fuel } = collectFuel(civ.stage, civ.home, { heat: this.heat, belltree, elevation: this.elevation }, this.config.size, room);
      // 上限は「集める量」にだけ掛ける (room)。開始時の蓄え (fuelStock) が上限を超えていても切り捨てない
      // (石板の「蓄えは七年で尽きる」を成り立たせる)
      let stock = prevStock + fuel;
      // 不足は累積する (M8-05 v2): 蓄えから必要量を引き、足りない分を負債に積む。足りた年は負債が必要量ぶん減る。
      // 負債が FUEL_YEARS 年分に達したら段階を下げる。「3 年に 1 度だけ足りる」細い供給で塔が立ち続ける穴を塞ぐ
      const deficit = Math.max(0, need - stock);
      stock = Math.max(0, stock - need);
      const prevDebt = civ.fuel?.debt ?? 0;
      const debt = deficit > 0 ? prevDebt + deficit : Math.max(0, prevDebt - need);
      const shortYears = need > 0 ? Math.floor(debt / need) : 0;
      civ.fuel = { last: fuel, need, shortYears, stock, debt };
      if (civ.stage >= 1 && need > 0 && debt >= need * FUEL_YEARS) {
        const before = civ.stage;
        civ.stage -= 1;
        civ.progress = 0;
        civ.fuel = { ...civ.fuel, shortYears: 0, debt: 0 };
        this.log('info', 'sim.civ.stage', { from: before, to: civ.stage, reason: 'fuel', year });
        if (civ.stage === 0) {
          this.collapseCiv(civ);
          this.log('info', 'sim.civ.collapsed', { reason: 'fuel' });
        }
      }
      this.log('info', 'sim.civ.fuel', { fuel: civ.fuel.last, need: civ.fuel.need, shortYears: civ.fuel.shortYears, stock: civ.fuel.stock });
    }
    // 星の工事 (M10-02): 星なら年に一度、脈から備蓄に積む (信仰が足りなければ止まる)
    if (civ.stage >= MAX_STAGE) {
      const r = stepWorks(civ, this.crystal, this.elevation, this.config.size, { ids: this.veins, cells: this.veinCells });
      this.civ = civ = r.civ;
      this.log('info', 'sim.civ.works', { year, stock: civ.works?.stock ?? 0, stopped: civ.works?.stopped ?? false, mined: r.mined });
      if (r.mined > 0) computeVeinLoss(this.crystal, this.crystal0, this.elevation, this.config.size, this.veinLoss, this.veins);
    }
    // 文明の衰退と崩壊 (M8-03): 発生済みのときだけ判定する
    if (civ.stage >= 1) {
      let vitSum = 0;
      let vitCount = 0;
      forEachInRadius(civ.home, SUPPORT_RADIUS, this.config.size, (i) => {
        if (this.elevation[i] >= SEA_LEVEL) {
          vitSum += this.vitality[i];
          vitCount++;
        }
      });
      const vitalityMean = vitCount ? vitSum / vitCount : 0;
      civ.vitality = vitalityMean;
      // 星は半径 12 の民で衰退を見る (M10-02)。塔以下は支え半径 8 のまま
      const { decline, reason } = checkDecline(civ.stage, civ.stage >= MAX_STAGE ? (civ.populationStar ?? 0) : civ.population, vitalityMean);
      // 衰退条件が DECLINE_YEARS 年続いたときだけ段階を下げる (M8-06)。途切れれば数え直す
      this.civDeclineStreak = decline ? this.civDeclineStreak + 1 : 0;
      if (decline && this.civDeclineStreak >= DECLINE_YEARS) {
        this.civDeclineStreak = 0;
        const before = civ.stage;
        civ.stage -= 1;
        civ.progress = 0;
        this.log('info', 'sim.civ.stage', { from: before, to: civ.stage, reason, year });
        if (civ.stage === 0) {
          this.collapseCiv(civ);
          this.log('info', 'sim.civ.collapsed', { reason });
        }
      }
    }
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
      case 'civ_edict': {
        // 勅令 (M9-03): 文明が無ければ何も起きない。信仰が EDICT_FAITH 以上なら従い、採掘の停止/再開を切り替える
        if (!this.civ) break;
        const year = Math.floor(this.tick / this.config.ticksPerYear);
        const { civ, obeyed } = applyEdict(this.civ, cmd.edict, year, (this.civ.edict?.n ?? 0) + 1);
        this.civ = civ;
        this.log('info', 'sim.civ.edict', { year, edict: cmd.edict, obeyed, faith: civ.faith ?? 0, miningStopped: civ.miningStopped ?? false });
        break;
      }
      case 'intercept': {
        // 迎撃 (M10-02): validate で canIntercept を通っている。備蓄を消費して回数を増やす
        if (!this.civ) break;
        this.civ = applyIntercept(this.civ);
        this.log('info', 'sim.civ.intercept', { year: Math.floor(this.tick / this.config.ticksPerYear), n: this.civ.intercepted ?? 0, stock: this.civ.works?.stock ?? 0 });
        break;
      }
      case 'build_tower': {
        // 気象塔 (M10-01): validate で門 (段階・信仰・セル・輝石) を確かめてあるので、ここでは civ は必ずある
        const civ = this.civ as CivState;
        const pool = towerCrystalPool(civ.home, civ.stage, this.elevation, this.config.size, { ids: this.veins, cells: this.veinCells });
        takeCrystal(pool, this.crystal, TOWER_CRYSTAL);
        const year = Math.floor(this.tick / this.config.ticksPerYear);
        const tower: WeatherTower = {
          cell: cmd.cell,
          radius: TOWER_RADIUS,
          rainScale: cmd.rainScale ?? TOWER_RAIN_SCALE_DEFAULT,
          tempOffset: cmd.tempOffset ?? TOWER_TEMP_OFFSET_DEFAULT,
          active: true,
          year,
        };
        this.towers.push(tower);
        this.recomputeTowerFactors();
        this.log('info', 'sim.tower.built', { cell: tower.cell, radius: tower.radius, rainScale: tower.rainScale, tempOffset: tower.tempOffset, year });
        break;
      }
      case 'tower_power': {
        // 維持費の自動切り替え (M10-01): 全ての塔の active を一括で切り替える (ScenarioRunner が力の増減から dispatch する)
        for (const t of this.towers) t.active = cmd.active;
        this.recomputeTowerFactors();
        this.log('info', 'sim.tower.power', { active: cmd.active, count: this.towers.length });
        break;
      }
    }
  }

  /** towers が変わるたび (建てた・維持費で切り替わった) に per-cell の倍率・オフセットを作り直す (M10-01) */
  private recomputeTowerFactors(): void {
    towerFactors(this.towers, this.config.size, { rain: this.rainFactor, temp: this.tempFactor });
  }

  private validate(cmd: Command): string | null {
    if ('cell' in cmd && (!Number.isInteger(cmd.cell) || cmd.cell < 0 || cmd.cell >= this.n)) return 'cell out of range';
    if (cmd.type === 'intercept') {
      const r = canIntercept(this.civ);
      return r.ok ? null : r.reason;
    }
    if (cmd.type === 'spawn_species') {
      if (!this.byId.has(cmd.speciesId)) return 'unknown species';
      if (!(cmd.amount > 0)) return 'amount must be > 0';
      if (this.elevation[cmd.cell] < SEA_LEVEL) return 'cell is sea';
    }
    if (cmd.type === 'disaster' && !(cmd.radius >= 0)) return 'radius must be >= 0';
    if (cmd.type === 'sink' && !(cmd.amount > 0)) return 'amount must be > 0';
    if (cmd.type === 'build_tower') {
      // 気象塔 (M10-01): 輝石の合計は canBuildTower の crystalAvailable として先に計算しておく
      // (実際に取り除く takeCrystal は apply 側。validate は副作用を持たない)
      let crystalAvailable = 0;
      if (this.civ && this.civ.stage >= 1) {
        const pool = towerCrystalPool(this.civ.home, this.civ.stage, this.elevation, this.config.size, { ids: this.veins, cells: this.veinCells });
        for (const i of pool) crystalAvailable += this.crystal[i];
      }
      const r = canBuildTower(this.civ, cmd.cell, crystalAvailable, { elevation: this.elevation, towers: this.towers });
      if (!r.ok) return r.reason;
    }
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
