// 曲を Standard MIDI File（フォーマット 1）にする（DOM に依存しない）。
// 将来 VST にしたとき、DAW にこの MIDI を読み込めば同じ演奏になるように、次の決まりで書く：
//   ・トラック 0：曲名・テンポ・拍子・セクション名（マーカー）
//   ・曲のトラック 1 本 = MIDI トラック 1 本（チャンネル = おもちゃの MIDI チャンネル）
//   ・キー → ノート（おもちゃごとの noteOf）、ボタン（GLITCH・HOLD など）→ そのパラメーターの CC（押している間 127）
//   ・ノブ・スイッチ → そのパラメーターの CC（0〜127）。なめらかにつなぐ区間は 16 分音符ごとに細かく書く
//   ・POWER ON / OFF → CC119 = 127 / 0、CRASH → CC117 = 127（終わりで 0）＋マーカー「CRASH」「REBOOT」
import type { ParamDef } from '../core/params';
import { BTN, SYS_CRASH, SYS_POWER_OFF, SYS_POWER_ON, barBeats, songBeats, trackToy, type Song } from '../core/song';

export const PPQ = 480;
export const CC_POWER = 119;
export const CC_CRASH = 117;

export interface MidiToy {
  title: string;
  /** 0 始まりの MIDI チャンネル */
  channel: number;
  /** キー番号 → ノート番号（範囲外なら -1） */
  noteOf(key: number): number;
  paramDefs: readonly ParamDef[];
}

type Ev = { tick: number; order: number; bytes: number[] };

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const text = (s: string) => [...new TextEncoder().encode(s)];
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

/** パラメーターの値 → CC の値（0〜127） */
export function valueToCC(p: ParamDef, v: number): number {
  if (p.kind === 'toggle' || p.kind === 'momentary') return v >= 0.5 ? 127 : 0;
  return Math.max(0, Math.min(127, Math.round(((v - p.min) / (p.max - p.min || 1)) * 127)));
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [...text(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}

function trackBytes(evs: Ev[]): number[] {
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of evs) {
    out.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = Math.max(last, e.tick);
  }
  out.push(0, 0xff, 0x2f, 0); // トラックの終わり
  return chunk('MTrk', out);
}

export function songToMidi(song: Song, toys: MidiToy[]): Uint8Array<ArrayBuffer> {
  const tk = (beat: number) => Math.round(beat * PPQ);
  const endTick = tk(songBeats(song));
  // ---- トラック 0：テンポ・拍子・セクション ----
  const t0: Ev[] = [
    { tick: 0, order: 0, bytes: meta(0x03, text(song.title ?? 'BENT TOY STUDIO')) },
    { tick: 0, order: 0, bytes: meta(0x51, (() => { const us = Math.round(60_000_000 / song.bpm); return [(us >> 16) & 255, (us >> 8) & 255, us & 255]; })()) },
    { tick: 0, order: 0, bytes: meta(0x58, [barBeats(song), 2, 24, 8]) },
  ];
  for (const s of song.sections ?? []) t0.push({ tick: tk(s.start), order: 1, bytes: meta(0x06, text(s.name)) });
  t0.push({ tick: endTick, order: 9, bytes: meta(0x01, text('END')) });
  const tracks = [trackBytes(t0)];

  // ---- 曲のトラック ----
  song.tracks.forEach((tr, i) => {
    const toy = toys[trackToy(song, i)];
    if (!toy) return;
    const ch = toy.channel & 15;
    const evs: Ev[] = [{ tick: 0, order: 0, bytes: meta(0x03, text(`${tr.name ?? toy.title} (${toy.title})`)) }];
    const cc = (tick: number, num: number, val: number, order = 2) => evs.push({ tick, order, bytes: [0xb0 | ch, num & 127, val & 127] });
    for (const n of tr.notes) {
      const a = tk(n.start), b = Math.max(a + 1, tk(n.start + n.len));
      if (n.key >= SYS_CRASH) {
        if (n.key === SYS_POWER_ON) cc(a, CC_POWER, 127);
        else if (n.key === SYS_POWER_OFF) cc(a, CC_POWER, 0);
        else if (n.key === SYS_CRASH) {
          cc(a, CC_CRASH, 127);
          cc(b, CC_CRASH, 0);
          evs.push({ tick: a, order: 1, bytes: meta(0x06, text('CRASH')) }, { tick: b, order: 1, bytes: meta(0x06, text('REBOOT')) });
        }
      } else if (n.key >= BTN) {
        const p = toy.paramDefs[n.key - BTN];
        if (p?.midiCC === undefined) continue;
        cc(a, p.midiCC, 127);
        cc(b, p.midiCC, 0, 1);
      } else {
        const note = toy.noteOf(n.key);
        if (note < 0 || note > 127) continue;
        evs.push({ tick: a, order: 3, bytes: [0x90 | ch, note, 100] }, { tick: b, order: 1, bytes: [0x80 | ch, note, 0] });
      }
    }
    // ツマミの動き
    const byParam = new Map<number, typeof tr.autos>();
    for (const a of tr.autos) {
      if (!byParam.has(a.index)) byParam.set(a.index, []);
      byParam.get(a.index)!.push(a);
    }
    byParam.forEach((pts, index) => {
      const p = toy.paramDefs[index];
      if (p?.midiCC === undefined || p.kind === 'momentary') return;
      pts.sort((a, b) => a.t - b.t);
      let lastVal = -1;
      pts.forEach((a, j) => {
        const v = valueToCC(p, a.v);
        if (v !== lastVal) { cc(tk(a.t), p.midiCC!, v); lastVal = v; }
        const q = pts[j + 1];
        if (song.ramp && p.kind === 'continuous' && q && q.t - a.t > 0.25) {
          for (let b = a.t + 0.25; b < q.t - 1e-6; b += 0.25) {
            const w = valueToCC(p, a.v + ((q.v - a.v) * (b - a.t)) / (q.t - a.t));
            if (w !== lastVal) { cc(tk(b), p.midiCC!, w); lastVal = w; }
          }
        }
      });
    });
    tracks.push(trackBytes(evs));
  });

  const header = chunk('MThd', [0, 1, tracks.length >> 8, tracks.length & 255, PPQ >> 8, PPQ & 255]);
  return Uint8Array.from([...header, ...tracks.flat()]);
}
