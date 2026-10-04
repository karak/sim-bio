/** 手元の保存の枠 (M19-05)。自動の枠へは自動保存だけが書く */
export const MANUAL_SLOTS = ['manual-1', 'manual-2', 'manual-3'] as const;
export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export type SlotId = 'auto' | ManualSlot;
export const SLOTS: readonly SlotId[] = ['auto', ...MANUAL_SLOTS];

/** 一覧の 1 行。SaveData (size 128 で 1.6 MB ほど) を読まずに出せるよう別に持つ */
export type SlotSummary = { slot: SlotId; savedAt: number; year: number } & Stage;

/** どの島を遊ぶか (M19-17)。URL が決め、枠とファイルの包みも名乗る。訪問は手元に書かないので枠の舞台にはならない */
export type Stage = { stage: 'free' } | { stage: 'scenario'; scenarioId: string };
/** 違う舞台へ移った先で読む枠。ファイルから読んだ包みは 'import' に置く */
export type PendingSlot = SlotId | 'import';
