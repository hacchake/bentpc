// Web Audio 側のつなぎ込み。AudioContext と AudioWorkletNode を作り、メッセージを中継する。
import workletUrl from './worklet.ts?worklet';
import type { FromEngine, ToEngine } from './protocol';

export class AudioHost {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  onMessage: (m: FromEngine) => void = () => {};
  /** 起動前に送られたメッセージ（ノブの値・保存してあった声）。起動したらまとめて送る */
  private pending: ToEngine[] = [];
  private starting: Promise<void> | null = null;
  private mic: MediaStreamAudioSourceNode | null = null;

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  start(): Promise<void> {
    if (this.starting) return this.starting.then(() => this.ctx?.resume());
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'toy-rack', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (e: MessageEvent<FromEngine>) => this.onMessage(e.data);
      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      for (const m of this.pending) node.port.postMessage(m);
      this.pending = [];
      await ctx.resume();
    })();
    return this.starting;
  }

  post(m: ToEngine): void {
    if (this.node) {
      this.node.port.postMessage(m);
      return;
    }
    // 起動前：ノブの値と保存した声だけ覚えておく（同じノブは最新の値だけ）
    if (m.type === 'param') {
      this.pending = this.pending.filter((p) => !(p.type === 'param' && p.toy === m.toy && p.index === m.index));
      this.pending.push(m);
    } else if (m.type === 'userSample') this.pending.push(m);
    else if (m.type === 'song') {
      this.pending = this.pending.filter((p) => p.type !== 'song');
      this.pending.push(m);
    }
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
