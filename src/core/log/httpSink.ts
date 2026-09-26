import type { LogRecord, LogSink } from './types';

/** 受け口 (M19-02) へ POST する本文。dropped は、前に運んだ数のあとで捨てた件数 */
export type LogBatch = { records: LogRecord[]; dropped: number };

export type HttpSinkOptions = {
  fetch?: typeof fetch;
  sendBeacon?: (url: string, data: Blob) => boolean;
  filter?: (r: LogRecord) => boolean;
  maxBatchSize?: number;
  maxWaitMs?: number;
  maxBuffered?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

export type HttpSink = LogSink & { flushViaBeacon(): void };

export const shipsToServer = (r: LogRecord): boolean => r.level !== 'info' || r.event === 'sim.tick.summary';

type Outcome = 'delivered' | 'retry' | 'reject';

function classify(status: number): Outcome {
  if (status >= 200 && status < 300) return 'delivered';
  return status === 429 || status >= 500 ? 'retry' : 'reject';
}

type Batch = {
  state: 'awaitingResponse' | 'backingOff';
  records: LogRecord[];
  attempt: number;
  /** この送信の本文が運んだ捨てた数の累計の位置 */
  carriesDroppedUpTo: number;
};

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
  } = opts;

  let queue: LogRecord[] = [];
  let inFlight: Batch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let droppedTotal = 0;
  let droppedReported = 0;

  const body = (records: LogRecord[], from: number): string =>
    JSON.stringify({ records, dropped: droppedTotal - from } satisfies LogBatch);

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function after(ms: number): void {
    timer = setTimeout(() => {
      timer = null;
      void pump();
    }, ms);
  }

  function schedule(): void {
    if (inFlight || queue.length === 0) return;
    if (queue.length >= maxBatchSize) void pump();
    else if (timer === null) after(maxWaitMs);
  }

  async function post(records: LogRecord[]): Promise<Outcome> {
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body(records, droppedReported),
      });
      return classify(res.status);
    } catch {
      return 'retry';
    }
  }

  async function pump(): Promise<void> {
    clearTimer();
    if (!inFlight) {
      if (queue.length === 0) return;
      inFlight = { state: 'awaitingResponse', records: queue.slice(0, maxBatchSize), attempt: 0, carriesDroppedUpTo: 0 };
      queue = queue.slice(maxBatchSize);
    }
    const batch = inFlight;
    batch.state = 'awaitingResponse';
    batch.carriesDroppedUpTo = droppedTotal;
    const outcome = await post(batch.records);
    if (outcome === 'delivered') {
      droppedReported = Math.max(droppedReported, batch.carriesDroppedUpTo);
    } else if (outcome === 'retry' && batch.attempt < maxRetries) {
      batch.attempt += 1;
      batch.state = 'backingOff';
      after(retryBaseDelayMs * 2 ** (batch.attempt - 1));
      return;
    } else {
      droppedTotal += batch.records.length;
    }
    inFlight = null;
    schedule();
  }

  return {
    write(record) {
      if (!filter(record)) return;
      queue.push(record);
      if (queue.length > maxBuffered) {
        droppedTotal += queue.length - maxBuffered;
        queue = queue.slice(-maxBuffered);
      }
      schedule();
    },
    flushViaBeacon() {
      if (!sendBeacon) return;
      const backingOff = inFlight?.state === 'backingOff' ? inFlight.records : [];
      const rest = [...backingOff, ...queue];
      if (rest.length === 0) return;
      if (backingOff.length > 0) inFlight = null;
      queue = [];
      clearTimer();
      // 返事待ちの fetch が運んでいる分は、beacon では運ばない (届けば受け口が数える)
      let from = inFlight ? Math.max(droppedReported, inFlight.carriesDroppedUpTo) : droppedReported;
      for (let i = 0; i < rest.length; i += maxBatchSize) {
        const blob = new Blob([body(rest.slice(i, i + maxBatchSize), from)], { type: 'application/json' });
        if (!sendBeacon(url, blob)) {
          droppedTotal += rest.length - i;
          return;
        }
        from = droppedTotal;
        droppedReported = droppedTotal;
      }
    },
  };
}
