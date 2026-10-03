// サンプラーの Web Audio 側：AudioContext・AudioWorklet・マイク・ファイルの読み込み。
import workletUrl from './worklet.ts?worklet';
import { REC_MAX_SEC, type FromSampler, type SampleBuf, type ToSampler } from './dsp/types';

export class SamplerHost {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private pending: ToSampler[] = [];
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  onMessage: (m: FromSampler) => void = () => {};

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  start(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'paku-sampler', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<FromSampler>) => this.onMessage(e.data);
      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      for (const m of this.pending) node.port.postMessage(m);
      this.pending = [];
      await ctx.resume();
    })();
    return this.starting;
  }

  get running(): boolean {
    return !!this.node;
  }

  post(m: ToSampler): void {
    if (this.node) this.node.port.postMessage(m);
    // 起動前は、音と設定だけ覚えておく（鳴らす操作は捨てる）
    else if (m.type === 'sample' || m.type === 'params' || m.type === 'master' || m.type === 'bpm' || m.type === 'roll' || m.type === 'fx' || m.type === 'bend' || m.type === 'pattern' || m.type === 'song' || m.type === 'seqSet') this.pending.push(m);
  }

  /** マイクをつなぐ（録音の前に）。だめなら false */
  async enableMic(): Promise<boolean> {
    if (this.micNode) return true;
    await this.start();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      });
      this.micNode = this.ctx!.createMediaStreamSource(this.micStream);
      this.micNode.connect(this.node!);
      return true;
    } catch {
      return false;
    }
  }

  /** 音のファイルを読む（WAV・MP3 など、ブラウザが読めるもの）。長すぎる分は切る */
  async decodeFile(file: Blob): Promise<SampleBuf> {
    await this.start();
    const ab = await file.arrayBuffer();
    const audio = await this.ctx!.decodeAudioData(ab);
    const n = Math.min(audio.length, Math.round(REC_MAX_SEC * audio.sampleRate));
    const ch: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) ch.push(audio.getChannelData(c).slice(0, n));
    if (ch.length === 2 && sameChannels(ch[0], ch[1])) ch.pop();
    return { sr: audio.sampleRate, ch };
  }
}

function sameChannels(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i += 11) if (Math.abs(a[i] - b[i]) > 1e-4) return false;
  return true;
}
