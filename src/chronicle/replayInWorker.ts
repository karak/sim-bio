import type { ReplayOutcome } from './contract';
import type { ReplayIsland, ReplayMessage, ReplayRequest } from './replay';

/** 再生を回す先の継ぎ目。既定は Web Worker。テストは同じ handleReplayRequest を手元で回す偽物を渡す */
export type ReplayPort = {
  start(req: ReplayRequest, on: { message(m: ReplayMessage): void; error(reason: string): void }): void;
  stop(): void;
};

const workerPort = (): ReplayPort => {
  const worker = new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' });
  return {
    start(req, on) {
      worker.onmessage = (e: MessageEvent<ReplayMessage>) => on.message(e.data);
      worker.onerror = (e) => on.error(e.message || 'worker error');
      worker.postMessage(req);
    },
    stop: () => worker.terminate(),
  };
};

/**
 * 年代記を Web Worker で回し直す (設計書 §3.1: 数百年の再生で画面を止めず、壊れた年代記でもタブを守る)。
 * 中断 (signal) は Worker ごと止めて aborted を返す。回し終えるまで Worker の中は割り込めないので、時間の上限も signal で渡す
 * (AbortSignal.timeout)。Worker が落ちたら crashed。例外を投げない
 */
export function replayInWorker(
  chronicle: unknown,
  island: ReplayIsland,
  opts: { maxTicks?: number; onYear?: (year: number) => void; signal?: AbortSignal; port?: () => ReplayPort } = {},
): Promise<ReplayOutcome> {
  if (opts.signal?.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise((resolve) => {
    let port: ReplayPort;
    try {
      port = (opts.port ?? workerPort)();
    } catch (e) {
      resolve({ kind: 'crashed', reason: String(e) });
      return;
    }
    let settled = false;
    const finish = (outcome: ReplayOutcome) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      port.stop();
      resolve(outcome);
    };
    const onAbort = () => finish({ kind: 'aborted' });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    port.start(
      { chronicle, island, maxTicks: opts.maxTicks },
      {
        message: (m) => {
          if (settled) return;
          if (m.kind === 'year') opts.onYear?.(m.year);
          else finish(m.outcome);
        },
        error: (reason) => finish({ kind: 'crashed', reason }),
      },
    );
  });
}
