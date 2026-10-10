/**
 * このタブの印 (M24-01)。sessionStorage に置くのでタブを閉じれば消え、次に開いたときはタイトルから。
 * 舞台に入った印は、石板の「自由モードへ」で素の / へ移るときと再読み込みで、タイトルへ戻さないためのもの
 */
/** entered はこのタブで舞台に入った後、openTitle は「タイトルへ」で移ってきた一回きりの合図 */
export type TabMarks = { entered: boolean; openTitle: boolean };

const ENTERED_KEY = 'biotope-entered-stage';
/** 「タイトルへ」で移るときに置く一回きりの合図。読んだら消す */
const OPEN_TITLE_KEY = 'biotope-open-title';

export function takeTabMarks(storage: Pick<Storage, 'getItem' | 'removeItem'>): TabMarks {
  const openTitle = storage.getItem(OPEN_TITLE_KEY) === '1';
  if (openTitle) storage.removeItem(OPEN_TITLE_KEY);
  return { entered: storage.getItem(ENTERED_KEY) === '1', openTitle };
}

export function markEntered(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(ENTERED_KEY, '1');
}

/** 舞台に入った印を消してから合図を置く (移った先の起動がタイトルを選ぶように) */
export function putOpenTitle(storage: Pick<Storage, 'setItem' | 'removeItem'>): void {
  storage.removeItem(ENTERED_KEY);
  storage.setItem(OPEN_TITLE_KEY, '1');
}
