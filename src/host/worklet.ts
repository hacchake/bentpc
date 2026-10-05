// AudioWorklet 側の薄い殻。おもちゃのエンジンを全部動かして、音を混ぜて出す。
import type { ToyEngine } from '../core/toy';
import { fromInt8, toChipSample, toInt8 } from '../toys/blippy/dsp/mic';
import { TOY_ENGINES } from '../toys/engines';
import type { FromEngine, ToEngine } from './protocol';
import { Sequencer, toyCenter } from './sequencer';
import { TestSignal } from '../core/testsignal';
import { hashSeed } from '../core/rng';
import { MasterBus } from './master';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const REC_CHUNK = 8192;
const MIC_MAX_SEC = 4;

/** processorOptions：toys = 使うおもちゃの番号（省略時は全部。スタジオは [0, 5] など） */
interface RackOptions { toys?: number[] }

class ToyRackProcessor extends AudioWorkletProcessor {
  private ids: number[];
  private toys: ToyEngine[];
  private sentVersion: number[];
  private lastStatus: string[];
  private userSamples: Map<number, Float32Array | null>[]; // 作り直したときに戻すため
  private customs: Map<string, unknown>[]; // おもちゃ専用のデータ（作り直したときに戻すため）
  private statusCounter = 0;
  private tmp = new Float32Array(128);
  private click = new Float32Array(128);
  private vin = new Float32Array(128); // 取り込んだ動画の音（モノラル）
  private posCounter = 0;
  private signal = new TestSignal(sampleRate);
  private signalOn: boolean[];
  private sigBuf = new Float32Array(128);
  private seq: Sequencer;
  // 録音
  private recording = false;
  private recBuf = new Float32Array(REC_CHUNK);
  private recBufR = new Float32Array(REC_CHUNK);
  /** 仕上げ（まとめ・響き・割れ止め）。録音にも同じ音が入る */
  private master = new MasterBus(sampleRate);
  private right = new Float32Array(128);
  private recPos = 0;
  // マイク録音
  private micToy = -1;
  private micKey = -1;
  private micBuf = new Float32Array(sampleRate * MIC_MAX_SEC);
  private micPos = 0;

  constructor(options?: { processorOptions?: RackOptions }) {
    super();
    this.ids = options?.processorOptions?.toys ?? TOY_ENGINES.map((_, i) => i);
    const make = (seed?: number) => this.ids.map((id) => TOY_ENGINES[id](sampleRate, seed === undefined ? undefined : (hashSeed(seed, id) >>> 0)));
    this.toys = make();
    this.sentVersion = this.toys.map(() => -1);
    this.lastStatus = this.toys.map(() => '');
    this.signalOn = this.toys.map(() => false);
    this.userSamples = this.toys.map(() => new Map());
    this.customs = this.toys.map(() => new Map());
    this.seq = new Sequencer(sampleRate, this.toys, {
      onTake: (take, data) => this.send({ type: 'seqTake', take, data }),
      onEnd: () => this.send({ type: 'seqEnd' }),
      onRebuild: () => {
        this.sentVersion.fill(-1);
        this.lastStatus.fill('');
        this.signal.reset();
        this.userSamples.forEach((m, toy) => m.forEach((buf, key) => this.toys[toy].setUserSample?.(key, buf)));
        this.customs.forEach((m, toy) => m.forEach((d) => this.toys[toy].custom?.(d)));
      },
    }, make);
    this.seq.center = toyCenter(this.ids);
    this.port.onmessage = (e: MessageEvent<ToEngine>) => {
      const m = e.data;
      if (m.type === 'song') { this.seq.setSong(m.song); return; }
      if (m.type === 'transport') { if (m.play) this.seq.play(m.from); else this.seq.stop(); return; }
      if (m.type === 'seqRec') {
        // 止まっている所からの録音：カウントイン（クリックを countIn 拍）してから始める
        if (m.on && !this.seq.playing && m.countIn) { this.seq.startCountIn(m.countIn, m.take); return; }
        if (!m.on && this.seq.counting) { this.seq.cancelCountIn(); return; }
        if (m.on && !this.seq.playing) this.seq.play();
        this.seq.setRecording(m.on, m.take);
        return;
      }
      if (m.type === 'bounce') { this.seq.stop(); this.seq.bounce = true; this.seq.play(0); return; }
      if (m.type === 'rec') {
        if (m.on) { this.recording = true; this.recPos = 0; }
        else if (this.recording) { this.recording = false; this.flushRec(); this.send({ type: 'recDone' }); }
        return;
      }
      const t = this.toys[m.toy];
      if (!t) return;
      switch (m.type) {
        case 'param': t.setParam(m.index, m.value); this.seq.live(m.toy, m); break;
        case 'key': m.down ? t.keyDown(m.key) : t.keyUp(m.key); this.seq.live(m.toy, m); break;
        case 'power': m.on ? t.powerOn() : t.powerOff(); break;
        case 'mic':
          if (m.on) { this.micToy = m.toy; this.micKey = m.key; this.micPos = 0; }
          else if (this.micToy === m.toy && this.micKey === m.key) this.finishMic();
          break;
        case 'userSample': {
          const buf = m.data ? fromInt8(m.data) : null;
          this.userSamples[m.toy].set(m.key, buf);
          t.setUserSample?.(m.key, buf);
          break;
        }
        case 'signal': this.signalOn[m.toy] = m.on; break;
        case 'custom': this.customs[m.toy].set(m.key, m.data); t.custom?.(m.data); break;
      }
    };
  }

  private send(m: FromEngine, transfer: Transferable[] = []): void {
    this.port.postMessage(m, transfer);
  }

  private flushRec(): void {
    if (this.recPos === 0) return;
    const data = this.recBuf.slice(0, this.recPos), dataR = this.recBufR.slice(0, this.recPos);
    this.send({ type: 'recChunk', data, dataR }, [data.buffer, dataR.buffer]);
    this.recPos = 0;
  }

  private finishMic(): void {
    const toy = this.micToy, key = this.micKey;
    this.micToy = this.micKey = -1;
    const s = toChipSample(this.micBuf.subarray(0, this.micPos), sampleRate);
    this.toys[toy]?.setUserSample?.(key, s);
    this.userSamples[toy]?.set(key, s);
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
    if (this.tmp.length !== l.length) { this.tmp = new Float32Array(l.length); this.click = new Float32Array(l.length); }
    // 2 つ目の入力 = 取り込んだ動画の音。モノラルにまとめて渡す
    const vi = inputs[1];
    if (this.vin.length !== l.length) this.vin = new Float32Array(l.length);
    this.vin.fill(0);
    if (vi && vi.length) {
      for (const ch of vi) for (let i = 0; i < ch.length; i++) this.vin[i] += ch[i] / vi.length;
    }
    // テスト映像のときは、取り込んだ音の代わりにテスト信号を渡す（再生中は曲の拍に合わせる）
    let input = this.vin;
    if (this.signalOn.some((x) => x)) {
      if (this.sigBuf.length !== l.length) this.sigBuf = new Float32Array(l.length);
      this.signal.render(this.sigBuf, this.seq.playing ? this.seq.pos : null, this.seq.song.bpm);
      input = this.sigBuf;
    }
    if (this.right.length !== l.length) this.right = new Float32Array(l.length);
    const r = this.right;
    this.seq.render(l, this.click, this.tmp, input, r);
    this.master.process(l, r, l, r);

    if (this.recording) {
      let i = 0;
      while (i < l.length) {
        const n = Math.min(l.length - i, REC_CHUNK - this.recPos);
        this.recBuf.set(l.subarray(i, i + n), this.recPos);
        this.recBufR.set(r.subarray(i, i + n), this.recPos);
        this.recPos += n;
        i += n;
        if (this.recPos >= REC_CHUNK) this.flushRec();
      }
    }
    // メトロノームは録音に入れず、スピーカーにだけ足す
    for (let i = 0; i < l.length; i++) { l[i] = Math.max(-1, Math.min(1, l[i] + this.click[i])); r[i] = Math.max(-1, Math.min(1, r[i] + this.click[i])); }
    if (out.length > 1) for (let c = 1; c < out.length; c++) out[c].set(r);
    else for (let i = 0; i < l.length; i++) l[i] = (l[i] + r[i]) * 0.5;
    if (++this.posCounter >= 6) {
      this.posCounter = 0;
      this.send({ type: 'seqPos', beat: this.seq.pos, playing: this.seq.playing, recording: this.seq.recording || this.seq.counting });
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
