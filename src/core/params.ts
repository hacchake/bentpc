// パラメーター定義の共通の形。おもちゃごとの params.ts はこの形の配列を持つ。
// UI・DSP・MIDI・（将来の）VST3 はこの表だけを見てパラメーターを扱う。

export type ParamKind =
  | 'continuous' // ノブ（連続値）
  | 'stepped' // ロータリー・スライダー（整数ステップ）
  | 'toggle' // オン/オフのスイッチ
  | 'momentary'; // 押している間だけ 1 になるボタン

export interface ParamDef {
  readonly id: string;
  readonly name: string; // 表示名
  readonly kind: ParamKind;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly labels?: readonly string[]; // stepped / toggle の各位置の名前
  readonly midiCC?: number; // Web MIDI の CC 番号（任意）
  readonly phase?: number;
}

export function defaultsOf(defs: readonly ParamDef[]): Float32Array {
  return Float32Array.from(defs.map((p) => p.default));
}
