import type { LogRecord, LogSink } from './types';

/** 受け口 (M19-02) へ POST する本文。dropped は、このバッチを切るまでに捨てて、まだ誰も運んでいない件数 */
export type LogBatch = { records: LogRecord[]; dropped: number };

export type HttpSinkOptions = {
  fetch?: typeof fetch;
  sendBeacon?: (url: string, data: Blob) => boolean;
  filter?: (r: LogRecord) => boolean;
  maxBatchSize?: number;
  /** 手が空いてから最初の 1 件を待たせる上限。返事待ち・送り直し待ちの間に来た記録は、そのあとから数える */
  maxWaitMs?: number;
  maxBuffered?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  requestTimeoutMs?: number;
};

export type HttpSink = LogSink & { flushViaBeacon(): void };

export const shipsToServer = (r: LogRecord): boolean => r.level !== 'info' || r.event === 'sim.tick.summary';

type Outcome = 'delivered' | 'retry' | 'reject';

function classify(status: number): Outcome {
  if (status >= 200 && status < 300) return 'delivered';
  return status === 429 || status >= 500 ? 'retry' : 'reject';
}

type Batch = { readonly records: LogRecord[]; readonly dropped: number; readonly attempt: number };

type Timer = ReturnType<typeof setTimeout>;

type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting'; timer: Timer }
  | { kind: 'sending'; batch: Batch }
  | { kind: 'backingOff'; batch: Batch; timer: Timer };

export function createHttpSink(url: string, opts: HttpSinkOptions = {}): HttpSink {
  const {
    fetch: send = (input, init) => fetch(input, init),
    sendBeacon,
    filter = shipsToServer,
    maxBatchSize = 20,
    maxWaitMs = 10_000,
    maxBuffered = 200,
    maxRetries = 3,
    retryBaseDelayMs = 2_000,
    requestTimeoutMs = 10_000,
  } = opts;

  let queue: LogRecord[] = [];
  let pendingDropped = 0;
  let phase: Phase = { kind: 'idle' };

  const encode = (b: Batch): string => JSON.stringify({ records: b.records, dropped: b.dropped } satisfies LogBatch);

  function cut(): Batch {
    const batch = { records: queue.slice(0, maxBatchSize), dropped: pendingDropped, attempt: 0 };
    queue = queue.slice(maxBatchSize);
    pendingDropped = 0;
    return batch;
  }

  function lose(b: Batch): void {
    pendingDropped += b.records.length + b.dropped;
  }

  function schedule(): void {
    if (phase.kind === 'sending' || phase.kind === 'backingOff' || queue.length === 0) return;
    if (queue.length >= maxBatchSize) {
      if (phase.kind === 'waiting') clearTimeout(phase.timer);
      void deliver(cut());
    } else if (phase.kind === 'idle') {
      phase = { kind: 'waiting', timer: setTimeout(() => void deliver(cut()), maxWaitMs) };
    }
  }

  async function post(b: Batch): Promise<Outcome> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), requestTimeoutMs);
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: encode(b),
        keepalive: true,
        signal: abort.signal,
      });
      return classify(res.status);
    } catch {
      return 'retry';
    } finally {
      clearTimeout(timeout);
    }
  }

  async function deliver(batch: Batch): Promise<void> {
    phase = { kind: 'sending', batch };
    const outcome = await post(batch);
    if (outcome === 'retry' && batch.attempt < maxRetries) {
      const next = { ...batch, attempt: batch.attempt + 1 };
      const delay = retryBaseDelayMs * 2 ** batch.attempt;
      phase = { kind: 'backingOff', batch: next, timer: setTimeout(() => void deliver(next), delay) };
      return;
    }
    if (outcome !== 'delivered') lose(batch);
    phase = { kind: 'idle' };
    schedule();
  }

  function beacon(b: Batch): boolean {
    if (!sendBeacon) return false;
    try {
      return sendBeacon(url, new Blob([encode(b)], { type: 'application/json' }));
    } catch {
      return false;
    }
  }

  return {
    write(record) {
      if (!filter(record)) return;
      queue.push(record);
      if (queue.length > maxBuffered) {
        pendingDropped += queue.length - maxBuffered;
        queue = queue.slice(-maxBuffered);
      }
      schedule();
    },
    flushViaBeacon() {
      if (!sendBeacon) return;
      // 返事待ちのバッチは自分の dropped を持ったまま fetch に任せる (keepalive なのでタブを閉じても届く)
      const held = phase.kind === 'backingOff' ? [phase.batch] : [];
      if (phase.kind === 'waiting' || phase.kind === 'backingOff') {
        clearTimeout(phase.timer);
        phase = { kind: 'idle' };
      }
      const batches = [...held];
      while (queue.length > 0) batches.push(cut());
      for (const b of batches) if (!beacon(b)) lose(b);
    },
  };
}
