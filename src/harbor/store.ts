import type { Chronicle, Digest } from '../chronicle/chronicle';
import type { CargoId, ChronicleId, InscriptionId, WithdrawKey } from './contract';

/** 港のクライアントの手元の置き場の port (M27-02)。実装は persist/harborStore.ts (IndexedDB) と createMemoryHarborStore。harbor は persist を読まない */

/** 港へ出す 1 件 (M19-09)。閉港のあいだ outbox に置き、同じ id・同じ鍵で送り直す */
export type Outbound = { id: ChronicleId; chronicle: Chronicle; digest: Digest; inscription: InscriptionId };

/** 手元の控え。受け取った積荷 (M19-10) と、回避率に数えた年代記 (M19-11) を、二度しないために残す */
export type Mark = { kind: 'received'; id: CargoId } | { kind: 'counted'; id: ChronicleId };

/**
 * 港のクライアントの手元の置き場 (設計書 §3.1 の outbox・keys)。島の置き場 (islandStore) と同じ DB の別の store に置く。
 * outbox の値は境界として港のクライアントがカタログで parse し直すので、ここは unknown で返す
 */
export type HarborStore = {
  /** id ごとに 1 つ。同じ年代記を 2 度入れても 1 つ */
  enqueue(o: Outbound): Promise<void>;
  queued(): Promise<readonly unknown[]>;
  dequeue(id: string): Promise<void>;
  /** 置いた鍵があればそれを、無ければ fresh() を置いて返す。1 つの transaction で読んで書くので、出港と再送が別の鍵を置かない */
  claimKey(id: ChronicleId, fresh: () => WithdrawKey): Promise<WithdrawKey>;
  /** 読めない鍵 (形の壊れた値) は持っていないものとして null */
  keyOf(id: ChronicleId): Promise<WithdrawKey | null>;
  forgetKey(id: ChronicleId): Promise<void>;
  /** 読める鍵を持つ年代記 (自分が出港したもの) */
  ownIds(): Promise<ReadonlySet<ChronicleId>>;
  /** 控えが無ければ置いて true、あれば false。1 つの transaction で読んで書くので、同時に claim しても true は 1 つ */
  claim(m: Mark): Promise<boolean>;
  has(m: Mark): Promise<boolean>;
  /** claim した後にやり遂げられなかった (受け取れなかった・港が閉まっていた) ときに控えを外す */
  release(m: Mark): Promise<void>;
  /**
   * 判定の出た島 (年代記と要約) を石板ごとに 1 つ残す (M19-14 の直し)。chronicles の年代記は次の挑戦の自動保存が上書きするので、
   * 判定の後に閉じてからでも港へ出せるよう、別の store に置く
   */
  keepFinished(scenarioId: string, island: { chronicle: Chronicle; digest: Digest }): Promise<void>;
  /** 無ければ null。値は境界として港のクライアントがカタログで parse し直す */
  finishedOf(scenarioId: string): Promise<unknown>;
};
