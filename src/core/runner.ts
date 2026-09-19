import type { WorldSnapshot } from '../simulation/types';

export type Speed = 0 | 1 | 10 | 100;

export type Runner = {
  setSpeed(s: Speed): void;
  getSpeed(): Speed;
  start(): void;
  stop(): void;
  /** 1 フレーム分の処理。テストから直接呼べる */
  frame(nowMs: number): void;
};

type SteppableWorld = { step(n?: number): void; snapshot(): WorldSnapshot };

export type RunnerOptions = {
  onFrame: (s: WorldSnapshot) => void;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** フレーム落ち時のスパイラル防止。1 フレームで進める tick の上限 */
  maxTicksPerFrame?: number;
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

  const frame = (now: number) => {
    if (last !== null && speed > 0) {
      acc += now - last;
      const ticks = Math.floor((acc * speed) / 1000);
      if (ticks > 0) {
        world.step(Math.min(ticks, cap));
        acc -= (ticks * 1000) / speed;
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
  };
}
