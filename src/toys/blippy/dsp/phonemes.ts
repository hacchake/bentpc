// 音素表と読み上げ辞書。音声チップの「ROM」に相当する。
// 値は 8kHz 動作の簡易フォルマント合成用（F1〜F3 は Hz、dur は ms）。

export interface SegDef {
  f?: [number, number, number]; // フォルマント周波数。省略時は前の区間を引き継ぐ
  av?: number; // 有声音（声帯）の強さ
  af?: number; // 摩擦音ノイズの強さ
  fn?: number; // 摩擦ノイズの中心周波数
  fbw?: number; // 摩擦ノイズの帯域幅
  asp?: number; // 気息ノイズ（声道フィルターを通るノイズ）の強さ
  next?: boolean; // フォルマントを次の有声区間から借りる（H や破裂音の気息）
  dur: number;
}

const V = (f1: number, f2: number, f3: number, dur: number): SegDef => ({ f: [f1, f2, f3], av: 1, dur });

export const PHONEMES: Record<string, SegDef[]> = {
  // 母音
  IY: [V(280, 2250, 2900, 150)],
  IH: [V(400, 1920, 2560, 100)],
  EH: [V(550, 1770, 2490, 120)],
  AE: [V(690, 1660, 2490, 140)],
  AA: [V(750, 1150, 2500, 150)],
  AO: [V(600, 880, 2540, 150)],
  UH: [V(450, 1030, 2380, 100)],
  UW: [V(320, 900, 2300, 150)],
  AH: [V(620, 1220, 2550, 110)],
  ER: [V(480, 1350, 1650, 150)],
  AX: [V(550, 1300, 2500, 60)],
  // 二重母音
  EY: [V(480, 1900, 2500, 100), V(320, 2200, 2850, 90)],
  AY: [V(760, 1250, 2500, 120), V(380, 2050, 2600, 90)],
  OW: [V(560, 950, 2450, 110), V(380, 850, 2300, 80)],
  AW: [V(760, 1250, 2500, 110), V(380, 850, 2300, 90)],
  OY: [V(580, 880, 2500, 110), V(380, 2000, 2600, 90)],
  // 半母音・流音
  W: [{ f: [300, 650, 2200], av: 0.7, dur: 60 }],
  Y: [{ f: [280, 2200, 3000], av: 0.7, dur: 60 }],
  R: [{ f: [420, 1250, 1550], av: 0.7, dur: 70 }],
  L: [{ f: [380, 1000, 2600], av: 0.7, dur: 70 }],
  // 鼻音
  M: [{ f: [280, 1100, 2200], av: 0.45, dur: 70 }],
  N: [{ f: [280, 1650, 2600], av: 0.45, dur: 70 }],
  NG: [{ f: [280, 2050, 2700], av: 0.45, dur: 80 }],
  // 摩擦音
  S: [{ av: 0, af: 1, fn: 3600, fbw: 700, dur: 120 }],
  SH: [{ av: 0, af: 0.7, fn: 2500, fbw: 900, dur: 120 }],
  F: [{ av: 0, af: 0.15, fn: 2200, fbw: 3500, dur: 100 }],
  TH: [{ av: 0, af: 0.12, fn: 2800, fbw: 3000, dur: 90 }],
  H: [{ av: 0, asp: 0.7, next: true, dur: 60 }],
  Z: [{ f: [260, 1600, 2600], av: 0.4, af: 0.7, fn: 3600, fbw: 700, dur: 90 }],
  V: [{ f: [280, 1100, 2300], av: 0.45, af: 0.25, fn: 2200, fbw: 3500, dur: 70 }],
  DH: [{ f: [280, 1500, 2600], av: 0.45, af: 0.2, fn: 2800, fbw: 3000, dur: 50 }],
  ZH: [{ f: [260, 1800, 2600], av: 0.4, af: 0.7, fn: 2500, fbw: 900, dur: 80 }],
  // 破裂音（閉鎖 → 破裂 → 気息）
  P: [{ f: [400, 1100, 2300], av: 0, dur: 60 }, { af: 0.5, fn: 1000, fbw: 2500, dur: 10 }, { asp: 0.6, next: true, dur: 40 }],
  T: [{ f: [400, 1700, 2600], av: 0, dur: 50 }, { af: 0.8, fn: 3400, fbw: 1200, dur: 12 }, { asp: 0.6, next: true, dur: 35 }],
  K: [{ f: [400, 1900, 2500], av: 0, dur: 55 }, { af: 0.8, fn: 1900, fbw: 800, dur: 18 }, { asp: 0.6, next: true, dur: 40 }],
  B: [{ f: [200, 1100, 2300], av: 0.15, dur: 45 }, { af: 0.35, fn: 1000, fbw: 2500, dur: 8 }],
  D: [{ f: [200, 1700, 2600], av: 0.15, dur: 40 }, { af: 0.5, fn: 3200, fbw: 1500, dur: 10 }],
  G: [{ f: [200, 1900, 2500], av: 0.15, dur: 45 }, { af: 0.5, fn: 1900, fbw: 1000, dur: 12 }],
  CH: [{ f: [400, 1800, 2600], av: 0, dur: 45 }, { af: 0.6, fn: 3000, fbw: 1200, dur: 8 }, { av: 0, af: 1, fn: 2500, fbw: 900, dur: 90 }],
  JH: [{ f: [200, 1800, 2600], av: 0.15, dur: 40 }, { af: 0.4, fn: 3000, fbw: 1200, dur: 6 }, { f: [260, 1800, 2600], av: 0.4, af: 0.7, fn: 2500, fbw: 900, dur: 70 }],
  // 無音
  _: [{ av: 0, dur: 70 }],
};

export const VOWELS = new Set(['IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'AH', 'ER', 'AX', 'EY', 'AY', 'OW', 'AW', 'OY']);

// アルファベットの読み（英語の文字名）
export const LETTER_NAMES: Record<string, string> = {
  A: 'EY', B: 'B IY', C: 'S IY', D: 'D IY', E: 'IY', F: 'EH F', G: 'JH IY', H: 'EY CH',
  I: 'AY', J: 'JH EY', K: 'K EY', L: 'EH L', M: 'EH M', N: 'EH N', O: 'OW', P: 'P IY',
  Q: 'K Y UW', R: 'AA R', S: 'EH S', T: 'T IY', U: 'Y UW', V: 'V IY',
  W: 'D AH B AX L Y UW', X: 'EH K S', Y: 'W AY', Z: 'Z IY',
};

// 各文字の単語（液晶のドット絵キャラと対応）
export const WORDS: Record<string, [string, string]> = {
  A: ['APPLE', 'AE P AX L'],
  B: ['BALL', 'B AO L'],
  C: ['CAT', 'K AE T'],
  D: ['DOG', 'D AO G'],
  E: ['EGG', 'EH G'],
  F: ['FISH', 'F IH SH'],
  G: ['GIFT', 'G IH F T'],
  H: ['HAT', 'H AE T'],
  I: ['ICE', 'AY S'],
  J: ['JAM', 'JH AE M'],
  K: ['KING', 'K IH NG'],
  L: ['LEAF', 'L IY F'],
  M: ['MOON', 'M UW N'],
  N: ['NUT', 'N AH T'],
  O: ['OWL', 'AW L'],
  P: ['PIG', 'P IH G'],
  Q: ['QUEEN', 'K W IY N'],
  R: ['ROBOT', 'R OW B AA T'],
  S: ['SUN', 'S AH N'],
  T: ['TREE', 'T R IY'],
  U: ['UMBRELLA', 'AH M B R EH L AX'],
  V: ['VAN', 'V AE N'],
  W: ['WHALE', 'W EY L'],
  X: ['BOX', 'B AA K S'],
  Y: ['YO-YO', 'Y OW Y OW'],
  Z: ['ZAP', 'Z AE P'],
};

// 決まり文句
export const PHRASES: Record<string, string> = {
  IS_FOR: 'IH Z F AO R',
  RIGHT: 'R AY T',
  NO: 'N OW',
  GOOD_JOB: 'G UH D _ JH AA B',
  HELLO: 'H AX L OW',
  LETS_PLAY: 'L EH T S _ P L EY',
  TRY_AGAIN: 'T R AY _ AX G EH N',
  WOW: 'W AW',
  OOPS: 'UW P S',
  PRESS_A_KEY: 'P R EH S AX _ K IY',
  WELL_DONE: 'W EH L _ D AH N',
  UH_OH: 'AH _ OW',
  FIND: 'F AY N D',
  BYE_BYE: 'B AY _ B AY',
};
