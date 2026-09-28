// AudioWorklet 側の薄い殻。おもちゃのエンジンを全部動かして、音を混ぜて出す。
import type { ToyEngine } from '../core/toy';
import { fromInt8, toChipSample, toInt8 } from '../toys/blippy/dsp/mic';
import { TOY_ENGINES } from '../toys/engines';
import type { FromEngine, ToEngine } from './protocol';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const REC_CHUNK = 8192;
const MIC_MAX_SEC = 4;

class ToyRackProcessor extends AudioWorkletProcessor {
  private toys: ToyEngine[] = TOY_ENGINES.map((make) => make(sampleRate));
  private sentVersion: number[] = this.toys.map(() => -1);
  private lastStatus: string[] = this.toys.map(() => '');
  private statusCounter = 0;
  private tmp = new Float32Array(128);
  // 録音
  private recording = false;
  private recBuf = new Float32Array(REC_CHUNK);
  private recPos = 0;
  // マイク録音
  private micToy = -1;
  private micKey = -1;
  private micBuf = new Float32Array(sampleRate * MIC_MAX_SEC);
  private micPos = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToEngine>) => {
      const m = e.data;
      if (m.type === 'rec') {
        if (m.on) { this.recording = true; this.recPos = 0; }
        else if (this.recording) { this.recording = false; this.flushRec(); this.send({ type: 'recDone' }); }
        return;
      }
      const t = this.toys[m.toy];
      if (!t) return;
      switch (m.type) {
        case 'param': t.setParam(m.index, m.value); break;
        case 'key': m.down ? t.keyDown(m.key) : t.keyUp(m.key); break;
        case 'power': m.on ? t.powerOn() : t.powerOff(); break;
        case 'mic':
          if (m.on) { this.micToy = m.toy; this.micKey = m.key; this.micPos = 0; }
          else if (this.micToy === m.toy && this.micKey === m.key) this.finishMic();
          break;
        case 'userSample': t.setUserSample?.(m.key, m.data ? fromInt8(m.data) : null); break;
      }
    };
  }

  private send(m: FromEngine, transfer: Transferable[] = []): void {
    this.port.postMessage(m, transfer);
  }

  private flushRec(): void {
    if (this.recPos === 0) return;
    const data = this.recBuf.slice(0, this.recPos);
    this.send({ type: 'recChunk', data }, [data.buffer]);
    this.recPos = 0;
  }

  private finishMic(): void {
    const toy = this.micToy, key = this.micKey;
    this.micToy = this.micKey = -1;
    const s = toChipSample(this.micBuf.subarray(0, this.micPos), sampleRate);
    this.toys[toy]?.setUserSample?.(key, s);
    this.send({ type: 'userSample', toy, key, data: s ? toInt8(s) : null });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.micKey >= 0) {
      const inp = inputs[0]?.[0];
      if (inp) {
        const n = Math.min(inp.length, this.micBuf.length - this.micPos);
        this.micBuf.set(inp.subarray(0, n), this.micPos);
        this.micPos += n;
        if (this.micPos >= this.micBuf.length) this.finishMic();
      }
    }

    const out = outputs[0];
    const l = out[0];
    if (this.tmp.length !== l.length) this.tmp = new Float32Array(l.length);
    l.fill(0);
    for (const t of this.toys) {
      t.process(this.tmp);
      for (let i = 0; i < l.length; i++) l[i] += this.tmp[i];
    }
    for (let i = 0; i < l.length; i++) l[i] = Math.max(-1, Math.min(1, l[i]));
    for (let c = 1; c < out.length; c++) out[c].set(l);

    if (this.recording) {
      let i = 0;
      while (i < l.length) {
        const n = Math.min(l.length - i, REC_CHUNK - this.recPos);
        this.recBuf.set(l.subarray(i, i + n), this.recPos);
        this.recPos += n;
        i += n;
        if (this.recPos >= REC_CHUNK) this.flushRec();
      }
    }

    this.toys.forEach((t, toy) => {
      if (t.displayVersion !== this.sentVersion[toy]) {
        this.sentVersion[toy] = t.displayVersion;
        this.send({ type: 'display', toy, display: t.display, version: t.displayVersion });
      }
    });
    // 状態（LED など）は約 20ms ごと、変化があったときだけ送る
    if (++this.statusCounter >= 8) {
      this.statusCounter = 0;
      this.toys.forEach((t, toy) => {
        const st = t.status();
        if (st.leds.glitch !== undefined) st.leds.glitch = Math.round(st.leds.glitch * 20) / 20;
        // 乱数の状態はグリッチ中しか意味がないので、比較からは外す
        const key = JSON.stringify({ ...st, fx: { ...st.fx, seed: st.fx.combos ? st.fx.seed : 0 } });
        if (key !== this.lastStatus[toy]) {
          this.lastStatus[toy] = key;
          this.send({ type: 'status', toy, status: st });
        }
      });
    }
    return true;
  }
}

registerProcessor('toy-rack', ToyRackProcessor);
