// Web MIDI：ノートでキー、CC でノブ・スイッチ、プログラムチェンジでモード。
// 対応表は params.ts の midiCC と、下の noteToKey。
import { KEY_COUNT, PARAMS } from './params';

export const MIDI_BASE_NOTE = 36; // C1 = キー 0（A）。36〜75 に 40 キーを並べる
export const CC_POWER = 102; // 64 以上で電源 ON、未満で OFF

export interface MidiHandlers {
  key(key: number, down: boolean): void;
  param(index: number, value: number): void;
  mode(m: number): void;
  power(on: boolean): void;
  onDevices(names: string[]): void;
}

export function noteToKey(note: number): number {
  const k = note - MIDI_BASE_NOTE;
  return k >= 0 && k < KEY_COUNT ? k : -1;
}

/** CC 値（0..127）をパラメーター値に変換 */
export function ccToValue(index: number, v: number): number {
  const p = PARAMS[index];
  if (p.kind === 'continuous') return p.min + (p.max - p.min) * (v / 127);
  if (p.kind === 'stepped') return Math.round((v / 127) * (p.max - p.min)) + p.min;
  return v >= 64 ? 1 : 0;
}

export async function startMidi(h: MidiHandlers): Promise<boolean> {
  if (!('requestMIDIAccess' in navigator)) return false;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return false;
  }
  const ccMap = new Map<number, number>();
  PARAMS.forEach((p, i) => { if ('midiCC' in p && p.midiCC !== undefined) ccMap.set(p.midiCC, i); });
  const onMsg = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 2) return;
    const st = d[0] & 0xf0;
    if (st === 0x90 && d[2] > 0) { const k = noteToKey(d[1]); if (k >= 0) h.key(k, true); }
    else if (st === 0x80 || (st === 0x90 && d[2] === 0)) { const k = noteToKey(d[1]); if (k >= 0) h.key(k, false); }
    else if (st === 0xb0) {
      if (d[1] === CC_POWER) h.power(d[2] >= 64);
      const i = ccMap.get(d[1]);
      if (i !== undefined) h.param(i, ccToValue(i, d[2]));
    } else if (st === 0xc0) h.mode(d[1] % 8);
  };
  const bind = () => {
    const names: string[] = [];
    access.inputs.forEach((inp) => { inp.onmidimessage = onMsg; names.push(inp.name ?? 'MIDI'); });
    h.onDevices(names);
  };
  access.onstatechange = bind;
  bind();
  return true;
}
