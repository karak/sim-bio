/** 手元の保存の枠 (M19-05)。自動の枠へは自動保存だけが書く */
export const MANUAL_SLOTS = ['manual-1', 'manual-2', 'manual-3'] as const;
export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export type SlotId = 'auto' | ManualSlot;
export const SLOTS: readonly SlotId[] = ['auto', ...MANUAL_SLOTS];

/** 一覧の 1 行。SaveData (size 128 で 1.6 MB ほど) を読まずに出せるよう別に持つ */
export type SlotSummary = { slot: SlotId; savedAt: number; year: number };
