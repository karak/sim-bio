import { handleReplayRequest, type ReplayMessage, type ReplayRequest } from './replay';

/** 年代記の再生の Web Worker (M19-06)。1 つの Worker で 1 本だけ回し、呼び手が終わったら terminate する */
addEventListener('message', (e: MessageEvent<ReplayRequest>) => {
  void handleReplayRequest(e.data, (m: ReplayMessage) => postMessage(m));
});
