// サンプラーの AudioWorklet の殻：メッセージを受けてエンジンを動かし、メーターと再生位置を画面へ返す。
import { SamplerEngine } from './dsp/engine';
import type { FromSampler, ToSampler } from './dsp/types';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class SamplerProcessor extends AudioWorkletProcessor {
  private eng = new SamplerEngine(sampleRate);
  private counter = 0;
  private lastPlay = '';

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToSampler>) => {
      const m = e.data;
      const eng = this.eng;
      switch (m.type) {
        case 'sample': eng.setSample(m.pad, m.data); break;
        case 'params': eng.setParams(m.pad, m.p); break;
        case 'trig': eng.trigger(m.pad, m.vel, m.mod); break;
        case 'roll': eng.setRoll(m.on, m.rate); break;
        case 'bpm': eng.bpm = m.bpm; break;
        case 'fx': eng.setFx(m.slot, m.fx); break;
        case 'bend': eng.bender.st = { ...m.bend, wires: [...m.bend.wires] }; break;
        case 'release': eng.releasePad(m.pad); break;
        case 'stopAll': eng.stopAll(); break;
        case 'master': eng.master = m.vol; break;
        case 'monitor': eng.monitor = m.on; break;
        case 'rec':
          if (m.on) eng.recStart(m.source, m.auto);
          else {
            const data = eng.recStop();
            this.send({ type: 'recorded', data }, data ? data.ch.map((c) => c.buffer) : []);
          }
          break;
      }
    };
  }

  private send(m: FromSampler, transfer: Transferable[] = []): void {
    this.port.postMessage(m, transfer);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out[0], r = out[1] ?? out[0];
    const inp = inputs[0];
    const inL = inp && inp.length ? inp[0] : null;
    const inR = inp && inp.length > 1 ? inp[1] : null;
    this.eng.process(inL, inR, l, r);
    // 約 20ms ごとに、メーターと鳴っているパッドを送る
    if (++this.counter >= 8) {
      this.counter = 0;
      const e = this.eng;
      this.send({ type: 'meter', inPeak: e.inPeak, outPeak: e.outPeak, rec: e.recording ? e.recSeconds : -1, waiting: e.recWaitingForSound, heat: e.bender.heat });
      const pads = e.playing();
      const key = pads.map((p) => `${p[0]}:${p[1].toFixed(3)}`).join(',');
      if (key !== this.lastPlay) {
        this.lastPlay = key;
        this.send({ type: 'play', pads });
      }
    }
    return true;
  }
}

registerProcessor('paku-sampler', SamplerProcessor);
