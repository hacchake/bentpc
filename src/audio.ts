// Web Audio 側のつなぎ込み。AudioContext と AudioWorkletNode を作り、メッセージを中継する。
import workletUrl from './worklet/processor.ts?worklet';
import { PARAMS, defaultParamValues } from './params';
import type { FromEngine, ToEngine } from './protocol';

export class AudioHost {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  readonly values = defaultParamValues();
  onMessage: (m: FromEngine) => void = () => {};
  private starting: Promise<void> | null = null;

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  start(): Promise<void> {
    if (this.starting) return this.starting.then(() => this.ctx?.resume());
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'toy-pc', { numberOfInputs: 0, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<FromEngine>) => this.onMessage(e.data);
      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      // それまでに動かしたノブの値をまとめて送る
      PARAMS.forEach((_, i) => this.post({ type: 'param', index: i, value: this.values[i] }));
      await ctx.resume();
    })();
    return this.starting;
  }

  post(m: ToEngine): void {
    this.node?.port.postMessage(m);
  }

  setParam(index: number, value: number): void {
    this.values[index] = value;
    this.post({ type: 'param', index, value });
  }
}
