import type { WorldSnapshot } from '../simulation/types';

/** 1000 は開発用 (M19-16)。HUD は開発のときだけ 1000x の札を出す */
export type Speed = 0 | 1 | 10 | 100 | 1000;

export type Runner = {
  setSpeed(s: Speed): void;
  getSpeed(): Speed;
  start(): void;
  stop(): void;
  /** 1 フレーム分の処理。テストから直接呼べる */
  frame(nowMs: number): void;
  /** 速さと時計に関わらず、ちょうど n tick 進める (M25-02)。年の境目では onYear を呼び、最後に onFrame を 1 回呼ぶ。開発の板 (src/dev/probe.ts) が使う */
  advance(n: number): void;
};

type SteppableWorld = { step(n?: number): void; snapshot(): WorldSnapshot };

export type RunnerOptions = {
  onFrame: (s: WorldSnapshot) => void;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** フレーム落ち時のスパイラル防止。1 フレームで進める tick の上限 */
  maxTicksPerFrame?: number;
  /** 年 (ticksPerYear tick) の境目ちょうどで呼ぶ。HUD のグラフの点はこの 1 年ごとの拾いで、フレームの間隔に依らない (M25-02)。ticksPerYear とともに指定する */
  onYear?: (s: WorldSnapshot) => void;
  ticksPerYear?: number;
};

/** rAF ループと速度倍率を隠す。速度 s のとき 1 秒に s tick 進める。 */
export function createRunner(world: SteppableWorld, opts: RunnerOptions): Runner {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  const cap = opts.maxTicksPerFrame ?? 200;
  let speed: Speed = 1;
  let last: number | null = null;
  let acc = 0;
  let handle: number | null = null;
  let running = false;

  /** n tick 進める。年の境目で切って onYear を呼ぶ。stopOnPause なら、step の中で速度が 0 にされた (判定) 時点でやめる */
  const advanceTicks = (n: number, stopOnPause: boolean) => {
    const { onYear, ticksPerYear } = opts;
    if (!onYear || !ticksPerYear) {
      world.step(n);
      return;
    }
    let left = n;
    while (left > 0) {
      const toBoundary = ticksPerYear - (world.snapshot().tick % ticksPerYear);
      const k = Math.min(left, toBoundary);
      world.step(k);
      left -= k;
      if (k === toBoundary) onYear(world.snapshot());
      if (stopOnPause && speed === 0) return;
    }
  };

  const frame = (now: number) => {
    if (last !== null && speed > 0) {
      // step の中で速度が 0 にされうる (シナリオの判定の onVerdict、M19-04)。割る速度はこのフレームの速度に固定する
      const s = speed;
      acc += now - last;
      const ticks = Math.floor((acc * s) / 1000);
      if (ticks > 0) {
        advanceTicks(Math.min(ticks, cap), true);
        acc -= (ticks * 1000) / s;
      }
    } else if (speed === 0) {
      acc = 0;
    }
    last = now;
    opts.onFrame(world.snapshot());
  };

  const loop = (t: number) => {
    if (!running) return;
    frame(t);
    handle = raf(loop);
  };

  return {
    setSpeed(s) {
      speed = s;
    },
    getSpeed: () => speed,
    start() {
      if (running) return;
      running = true;
      last = null;
      handle = raf(loop);
    },
    stop() {
      running = false;
      if (handle !== null) caf(handle);
      handle = null;
    },
    frame,
    advance(n) {
      advanceTicks(n, false);
      opts.onFrame(world.snapshot());
    },
  };
}
