// AudioWorklet 側の薄い殻。中身はすべて Engine（src/dsp）にある。
import { Engine } from '../dsp/engine';
import type { FromEngine, ToEngine } from '../protocol';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class ToyPcProcessor extends AudioWorkletProcessor {
  private engine = new Engine(sampleRate);
  private sentVersion = -1;
  private statusCounter = 0;
  private lastPlaying = false;
  private lastPowered = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToEngine>) => {
      const m = e.data;
      if (m.type === 'param') this.engine.setParam(m.index, m.value);
      else if (m.type === 'key') m.down ? this.engine.keyDown(m.key) : this.engine.keyUp(m.key);
      else if (m.type === 'power') m.on ? this.engine.powerOn() : this.engine.powerOff();
    };
  }

  private send(m: FromEngine): void {
    this.port.postMessage(m);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const l = out[0];
    this.engine.process(l);
    for (let c = 1; c < out.length; c++) out[c].set(l);

    const e = this.engine;
    if (e.displayVersion !== this.sentVersion) {
      this.sentVersion = e.displayVersion;
      this.send({ type: 'display', display: e.display, version: e.displayVersion });
    }
    // 状態は約 20ms ごと、変化があったときだけ送る
    if (++this.statusCounter >= 8) {
      this.statusCounter = 0;
      const playing = e.isPlaying, powered = e.fw.powered;
      if (playing !== this.lastPlaying || powered !== this.lastPowered) {
        this.lastPlaying = playing;
        this.lastPowered = powered;
        this.send({ type: 'status', playing, powered });
      }
    }
    return true;
  }
}

registerProcessor('toy-pc', ToyPcProcessor);
