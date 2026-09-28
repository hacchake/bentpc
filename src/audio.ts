// Web Audio 側のつなぎ込み。AudioContext と AudioWorkletNode を作り、メッセージを中継する。
import workletUrl from './worklet/processor.ts?worklet';
import { PARAMS, defaultParamValues } from './params';
import type { FromEngine, ToEngine } from './protocol';

export class AudioHost {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  readonly values = defaultParamValues();
  onMessage: (m: FromEngine) => void = () => {};
  /** 起動直後に送るメッセージ（保存してあった自分の声など） */
  pending: ToEngine[] = [];
  private starting: Promise<void> | null = null;
  private mic: MediaStreamAudioSourceNode | null = null;

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  start(): Promise<void> {
    if (this.starting) return this.starting.then(() => this.ctx?.resume());
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'toy-pc', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<FromEngine>) => this.onMessage(e.data);
      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      // それまでに動かしたノブの値をまとめて送る
      PARAMS.forEach((_, i) => this.post({ type: 'param', index: i, value: this.values[i] }));
      for (const m of this.pending) this.post(m);
      this.pending = [];
      await ctx.resume();
    })();
    return this.starting;
  }

  post(m: ToEngine): void {
    if (this.node) this.node.port.postMessage(m);
    else if (m.type === 'userSample') this.pending.push(m);
  }

  setParam(index: number, value: number): void {
    this.values[index] = value;
    this.post({ type: 'param', index, value });
  }

  /** マイクをつなぐ（初回は許可を求められる）。出力には混ぜず、エンジンの入力にだけ入れる */
  async enableMic(): Promise<boolean> {
    await this.start();
    if (this.mic) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      this.mic = this.ctx!.createMediaStreamSource(stream);
      this.mic.connect(this.node!);
      return true;
    } catch {
      return false;
    }
  }
}
