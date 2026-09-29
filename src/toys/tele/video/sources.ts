// 映像の入力（3 モード＋テスト映像）。
// ・TAB：getDisplayMedia で別のタブを映像＋音声ごと取り込む
// ・FILE：手持ちの動画ファイル
// ・CAM：Web カメラ（起動時のデモ。許可されなければテスト映像）
// ・TEST：手続き的に作るテスト映像（カラーバーと図形のアニメ。音はエンジン側のテスト信号）

import { TestPattern } from './testpattern';

export type SourceKind = 'none' | 'tab' | 'file' | 'cam' | 'test';

export class Sources {
  kind: SourceKind = 'none';
  readonly video: HTMLVideoElement;
  readonly test = new TestPattern();
  private stream: MediaStream | null = null;
  private fileUrl = '';
  onChange: (kind: SourceKind, label: string) => void = () => {};

  constructor(private connectAudio: (src: MediaStream | HTMLMediaElement | null) => Promise<void>) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = false;
    this.video.crossOrigin = 'anonymous';
  }

  /** 前の入力を片付ける */
  private stopAll(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = '';
    void this.connectAudio(null);
  }

  async openTab(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      // 取り込み元のタブの音は止めて、こちらで加工した音だけが聞こえるようにする（二重にならない）
      audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
      // @ts-expect-error Chrome の追加オプション
      preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include',
    });
    this.stopAll();
    this.stream = stream;
    this.video.srcObject = new MediaStream(stream.getVideoTracks());
    this.video.muted = true;
    await this.video.play();
    await this.connectAudio(stream);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (this.stream === stream) this.openTest(); });
    this.kind = 'tab';
    const hasAudio = stream.getAudioTracks().length > 0;
    this.onChange('tab', hasAudio ? 'TAB（音声あり）' : 'TAB（音声なし：「タブの音声も共有」にチェックして取り込み直してください）');
  }

  async openFile(file: File): Promise<void> {
    this.stopAll();
    this.fileUrl = URL.createObjectURL(file);
    this.video.srcObject = null;
    this.video.src = this.fileUrl;
    this.video.loop = true;
    this.video.muted = false;
    await this.connectAudio(this.video); // 音は要素からこちらの処理へ（そのままでは鳴らない）
    await this.video.play();
    this.kind = 'file';
    this.onChange('file', `FILE: ${file.name}`);
  }

  async openCam(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    this.stopAll();
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    await this.video.play();
    this.kind = 'cam';
    this.onChange('cam', 'CAMERA');
  }

  /** テスト映像（カラーバーと図形のアニメ）。音はエンジンのテスト信号 */
  openTest(): void {
    this.stopAll();
    this.kind = 'test';
    this.onChange('test', 'TEST PATTERN（テスト映像＋テスト信号）');
  }

  close(): void {
    this.stopAll();
    this.kind = 'none';
    this.onChange('none', '');
  }

  /** WebGL に渡す映像 */
  get frameSource(): HTMLVideoElement | HTMLCanvasElement | null {
    if (this.kind === 'test') return this.test.canvas;
    return this.kind === 'tab' || this.kind === 'file' || this.kind === 'cam' ? this.video : null;
  }

  // ---- 再生の操作（ファイルのとき） ----
  playPause(): void {
    if (this.kind === 'file' || this.kind === 'tab' || this.kind === 'cam') {
      if (this.video.paused) void this.video.play();
      else this.video.pause();
    } else if (this.kind === 'test') this.test.paused = !this.test.paused;
  }

  /** 全体の長さに対する割合（0〜1）へ移動 */
  seekFraction(f: number): void {
    if (this.kind === 'file' && isFinite(this.video.duration)) this.video.currentTime = this.video.duration * f;
    else if (this.kind === 'test') this.test.jump(f);
  }

  seekBy(sec: number): void {
    this.seekTo(this.currentTime + sec);
  }

  get currentTime(): number {
    if (this.kind === 'file') return this.video.currentTime;
    if (this.kind === 'test') return this.test.time;
    return 0;
  }

  seekTo(t: number): void {
    if (this.kind === 'file') this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, t));
    else if (this.kind === 'test') this.test.time = Math.max(0, t);
  }

  // ---- 再生の速さ（- ^ ¥ キーと SPEED ノブ） ----
  private baseRate = 1;
  private knobRate = 1;

  /** キーで変える基本の速さ（0.25〜2） */
  setBaseRate(r: number): void {
    this.baseRate = Math.max(0.25, Math.min(2, r));
    this.applyRate();
  }

  get rate(): number {
    return this.baseRate;
  }

  /** SPEED / PITCH ノブによる倍率 */
  setKnobRate(r: number): void {
    if (Math.abs(r - this.knobRate) < 0.01) return;
    this.knobRate = r;
    this.applyRate();
  }

  private applyRate(): void {
    const r = Math.max(0.25, Math.min(2, this.baseRate * this.knobRate));
    if (this.kind === 'file') this.video.playbackRate = r;
    this.test.rate = r;
  }
}
