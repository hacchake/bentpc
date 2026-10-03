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

  /** toys：使うおもちゃの番号（スタジオ用。省略時は全部） */
  constructor(private options: { toys?: number[] } = {}) {}

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため） */
  start(): Promise<void> {
    // 2 回目以降も、止まっていれば操作の瞬間に再開する
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    if (this.starting) return this.starting.then(() => this.ctx?.resume());
    this.starting = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      // 入力 0 = マイク（1台目の自分の声）、入力 1 = 取り込んだ動画の音（6台目）
      const node = new AudioWorkletNode(ctx, 'toy-rack', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: this.options });
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
    else if (m.type === 'custom') {
      this.pending = this.pending.filter((p) => !(p.type === 'custom' && p.toy === m.toy && p.key === m.key));
      this.pending.push(m);
    }
    else if (m.type === 'signal') {
      this.pending = this.pending.filter((p) => !(p.type === 'signal' && p.toy === m.toy));
      this.pending.push(m);
    }
    else if (m.type === 'song') {
      this.pending = this.pending.filter((p) => p.type !== 'song');
      this.pending.push(m);
    }
  }

  private videoSrc: AudioNode | null = null;
  private outDest: MediaStreamAudioDestinationNode | null = null;

  /** 出力（全部のおもちゃのミックス）を MediaStream として取り出す（録画用） */
  async outputStream(): Promise<MediaStream> {
    await this.start();
    if (!this.outDest) {
      this.outDest = this.ctx!.createMediaStreamDestination();
      this.node!.connect(this.outDest);
    }
    return this.outDest.stream;
  }

  /** 取り込んだ動画の音をエンジンの 2 つ目の入力へつなぐ（前のものは外す）。null で外すだけ */
  async connectVideo(src: MediaStream | HTMLMediaElement | null): Promise<void> {
    await this.start();
    this.videoSrc?.disconnect();
    this.videoSrc = null;
    if (!src) return;
    const ctx = this.ctx!;
    if (src instanceof MediaStream) {
      if (!src.getAudioTracks().length) return;
      this.videoSrc = ctx.createMediaStreamSource(src);
    } else {
      // 同じ要素から 2 回は作れないので覚えておく
      const el = src as HTMLMediaElement & { __bentSrc?: MediaElementAudioSourceNode };
      el.__bentSrc ??= ctx.createMediaElementSource(el);
      this.videoSrc = el.__bentSrc;
    }
    this.videoSrc.connect(this.node!, 0, 1);
  }

  /** マイクをつなぐ（初回は許可を求められる）。出力には混ぜず、エンジンの入力にだけ入れる */
  async enableMic(): Promise<boolean> {
    await this.start();
    if (this.mic) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
      this.mic = this.ctx!.createMediaStreamSource(stream);
      this.mic.connect(this.node!, 0, 0);
      return true;
    } catch {
      return false;
    }
  }
}
