// AudioWorklet 側の薄い殻。中身はすべて Engine（src/dsp）にある。
import { Engine } from '../dsp/engine';
import { fromInt8, toChipSample, toInt8 } from '../dsp/mic';
import type { FromEngine, ToEngine } from '../protocol';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const REC_CHUNK = 8192;
const MIC_MAX_SEC = 4;

class ToyPcProcessor extends AudioWorkletProcessor {
  private engine = new Engine(sampleRate);
  private sentVersion = -1;
  private statusCounter = 0;
  private lastStatus = '';
  // LINE OUT 録音
  private recording = false;
  private recBuf = new Float32Array(REC_CHUNK);
  private recPos = 0;
  // マイク録音
  private micKey = -1;
  private micBuf = new Float32Array(sampleRate * MIC_MAX_SEC);
  private micPos = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToEngine>) => {
      const m = e.data;
      const en = this.engine;
      switch (m.type) {
        case 'param': en.setParam(m.index, m.value); break;
        case 'key': m.down ? en.keyDown(m.key) : en.keyUp(m.key); break;
        case 'power': m.on ? en.powerOn() : en.powerOff(); break;
        case 'rec':
          if (m.on) { this.recording = true; this.recPos = 0; }
          else if (this.recording) { this.recording = false; this.flushRec(); this.send({ type: 'recDone' }); }
          break;
        case 'mic':
          if (m.on) { this.micKey = m.key; this.micPos = 0; }
          else if (this.micKey === m.key) this.finishMic();
          break;
        case 'userSample': en.setUserSample(m.key, m.data ? fromInt8(m.data) : null); break;
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
    const key = this.micKey;
    this.micKey = -1;
    const s = toChipSample(this.micBuf.subarray(0, this.micPos), sampleRate);
    this.engine.setUserSample(key, s);
    this.send({ type: 'userSample', key, data: s ? toInt8(s) : null });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // マイク
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
    this.engine.process(l);
    for (let c = 1; c < out.length; c++) out[c].set(l);

    // LINE OUT 録音
    if (this.recording) {
      let i = 0;
      while (i < l.length) {
        const n = Math.min(l.length - i, REC_CHUNK - this.recPos);
        this.recBuf.set(l.subarray(i, i + n), this.recPos);
        this.recPos += n;
        i += n;
        if (this.recPos >= REC_CHUNK) { this.flushRec(); this.recBuf = new Float32Array(REC_CHUNK); }
      }
    }

    const e = this.engine;
    if (e.displayVersion !== this.sentVersion) {
      this.sentVersion = e.displayVersion;
      this.send({ type: 'display', display: e.display, version: e.displayVersion });
    }
    // 状態（LED・液晶グリッチ用の値）は約 20ms ごと、変化があったときだけ送る
    if (++this.statusCounter >= 8) {
      this.statusCounter = 0;
      const st = e.status();
      st.leds.glitch = Math.round(st.leds.glitch * 20) / 20;
      // 乱数の状態はグリッチ中しか意味がないので、比較からは外す
      const key = JSON.stringify({ ...st, fx: { ...st.fx, seed: st.fx.combos ? st.fx.seed : 0 } });
      if (key !== this.lastStatus) {
        this.lastStatus = key;
        this.send({ type: 'status', status: st });
      }
    }
    return true;
  }
}

registerProcessor('toy-pc', ToyPcProcessor);
