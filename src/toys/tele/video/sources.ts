// 映像の入力（3 モード）。
// ・YOUTUBE：YouTube IFrame Player API で埋め込み再生。ブラウザの決まりで中身（映像・音）は加工できないので、
//            再生そのもの（位置・速度・一時停止）を操作して壊し、映像効果は上に重ねる層で表現する
// ・TAB：getDisplayMedia で別のタブを映像＋音声ごと取り込む（完全に加工できる本命）
// ・FILE / CAM：手持ちの動画ファイル、または Web カメラ

export type SourceKind = 'none' | 'youtube' | 'tab' | 'file' | 'cam';

// ---- YouTube IFrame API の最小限の型 ----
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: object) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytReady: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytReady = null; reject(new Error('YouTube に接続できませんでした')); };
    document.head.appendChild(s);
  });
  return ytReady;
}

/** URL（watch?v= / youtu.be / shorts / embed / ID だけ）から動画 ID と開始秒を取り出す */
export function parseYouTube(url: string): { id: string; start: number } | null {
  const u = url.trim();
  if (/^[\w-]{11}$/.test(u)) return { id: u, start: 0 };
  try {
    const x = new URL(u);
    let id = '';
    if (x.hostname.includes('youtu.be')) id = x.pathname.slice(1, 12);
    else if (x.searchParams.get('v')) id = x.searchParams.get('v')!;
    else {
      const m = /\/(shorts|embed|live)\/([\w-]{11})/.exec(x.pathname);
      if (m) id = m[2];
    }
    if (!/^[\w-]{11}$/.test(id)) return null;
    const t = x.searchParams.get('t') ?? x.searchParams.get('start') ?? '0';
    const start = /^\d+$/.test(t) ? Number(t) : Number(/(\d+)m/.exec(t)?.[1] ?? 0) * 60 + Number(/(\d+)s/.exec(t)?.[1] ?? 0);
    return { id, start };
  } catch {
    return null;
  }
}

export class Sources {
  kind: SourceKind = 'none';
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private yt: YTPlayer | null = null;
  private ytHolder: HTMLElement;
  private fileUrl = '';
  onChange: (kind: SourceKind, label: string) => void = () => {};

  constructor(ytBox: HTMLElement, private connectAudio: (src: MediaStream | HTMLMediaElement | null) => Promise<void>) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = false;
    this.video.crossOrigin = 'anonymous';
    this.ytHolder = ytBox;
  }

  /** 前の入力を片付ける */
  private stopAll(): void {
    for (const k of [...this.actions.keys()]) this.stopAction(k);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.video.load();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = '';
    this.yt?.destroy();
    this.yt = null;
    this.ytHolder.innerHTML = '';
    void this.connectAudio(null);
  }

  async openYouTube(url: string): Promise<void> {
    const p = parseYouTube(url);
    if (!p) throw new Error('YouTube の URL として読めませんでした');
    await loadYouTubeApi();
    this.stopAll();
    const div = document.createElement('div');
    this.ytHolder.appendChild(div);
    await new Promise<void>((resolve) => {
      this.yt = new window.YT!.Player(div, {
        videoId: p.id,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, start: p.start, iv_load_policy: 3, fs: 0 },
        events: { onReady: () => resolve() },
      });
      setTimeout(resolve, 8000);
    });
    this.yt?.playVideo();
    this.kind = 'youtube';
    this.onChange('youtube', `YouTube: ${p.id}`);
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
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (this.stream === stream) { this.stopAll(); this.kind = 'none'; this.onChange('none', ''); } });
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

  close(): void {
    this.stopAll();
    this.kind = 'none';
    this.onChange('none', '');
  }

  /** WebGL に渡す映像（YouTube のときは無し） */
  get frameSource(): HTMLVideoElement | null {
    return this.kind === 'tab' || this.kind === 'file' || this.kind === 'cam' ? this.video : null;
  }

  // ---- 再生の操作（フェーズ2でグリッチからも使う） ----
  get canSeek(): boolean {
    return this.kind === 'youtube' || this.kind === 'file';
  }

  playPause(): void {
    if (this.kind === 'youtube' && this.yt) {
      if (this.yt.getPlayerState() === 1) this.yt.pauseVideo();
      else this.yt.playVideo();
    } else if (this.kind === 'file' || this.kind === 'tab' || this.kind === 'cam') {
      if (this.video.paused) void this.video.play();
      else this.video.pause();
    }
  }

  /** 全体の長さに対する割合（0〜1）へ移動 */
  seekFraction(f: number): void {
    if (this.kind === 'youtube' && this.yt) this.yt.seekTo(this.yt.getDuration() * f, true);
    else if (this.kind === 'file' && isFinite(this.video.duration)) this.video.currentTime = this.video.duration * f;
  }

  seekBy(sec: number): void {
    this.seekTo(this.currentTime + sec);
  }

  get currentTime(): number {
    if (this.kind === 'youtube' && this.yt) return this.yt.getCurrentTime();
    if (this.kind === 'file') return this.video.currentTime;
    return 0;
  }

  seekTo(t: number): void {
    if (this.kind === 'youtube' && this.yt) this.yt.seekTo(Math.max(0, t), true);
    else if (this.kind === 'file') this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, t));
  }

  // ---- 再生の速さ（- ^ ¥ キーと、グリッチの一時的な変更） ----
  private baseRate = 1;
  private glitchRate = 0; // 0 = グリッチによる変更なし

  /** キーで変える基本の速さ（0.25〜2） */
  setBaseRate(r: number): void {
    this.baseRate = Math.max(0.25, Math.min(2, r));
    this.applyRate();
  }

  get rate(): number {
    return this.baseRate;
  }

  private knobRate = 1;

  /** SPEED / PITCH ノブによる倍率 */
  setKnobRate(r: number): void {
    if (Math.abs(r - this.knobRate) < 0.01) return;
    this.knobRate = r;
    this.applyRate();
  }

  private applyRate(): void {
    const r = Math.max(0.25, Math.min(2, this.glitchRate || this.baseRate * this.knobRate));
    if (this.kind === 'youtube' && this.yt) this.yt.setPlaybackRate(r);
    else if (this.kind === 'file') this.video.playbackRate = r;
  }

  // ---- YouTube / ファイルの「再生そのものを壊す」操作（押している間だけ） ----
  private actions = new Map<string, { t0: number; timer: number }>();

  /** kind：stutter（同じ所を連打）/ pause（止める）/ slow / fast / jump（あちこちへ飛ぶ）/ mute（音の明滅） */
  startAction(kind: 'stutter' | 'pause' | 'slow' | 'fast' | 'jump' | 'mute'): void {
    if (this.actions.has(kind) || !(this.kind === 'youtube' || this.kind === 'file')) return;
    const t0 = this.currentTime;
    let timer = 0;
    switch (kind) {
      case 'stutter': timer = window.setInterval(() => this.seekTo(t0), 170); break;
      case 'pause': if (this.kind === 'youtube') this.yt?.pauseVideo(); else this.video.pause(); break;
      case 'slow': this.glitchRate = 0.25; this.applyRate(); break;
      case 'fast': this.glitchRate = 2; this.applyRate(); break;
      case 'jump': timer = window.setInterval(() => this.seekTo(t0 + (Math.random() - 0.3) * 20), 380); break;
      case 'mute': {
        let m = false;
        timer = window.setInterval(() => {
          m = !m;
          if (this.kind === 'youtube') (m ? this.yt?.mute() : this.yt?.unMute());
          else this.video.muted = m;
        }, 70);
        break;
      }
    }
    this.actions.set(kind, { t0, timer });
  }

  stopAction(kind: string): void {
    const a = this.actions.get(kind);
    if (!a) return;
    this.actions.delete(kind);
    if (a.timer) clearInterval(a.timer);
    if (kind === 'pause') { if (this.kind === 'youtube') this.yt?.playVideo(); else void this.video.play(); }
    if (kind === 'slow' || kind === 'fast') { this.glitchRate = 0; this.applyRate(); }
    if (kind === 'mute') { if (this.kind === 'youtube') this.yt?.unMute(); else this.video.muted = false; }
  }
}
