// VROOMBOX VR-5 の DSP エンジン（おもちゃ1台分）。DOM・Web Audio に依存しない。
// エンジン音は「点火（爆発）の粒」の連続：回転数から点火の間隔を決め、1 回ごとに減衰するノイズ＋チップ音を
// 排気管（2 つの共振）に通す。FIRING ORDER で点火を間引くと、低回転ではリズムになる。

import { pulseBL } from '../../../core/blep';
import { defaultsOf } from '../../../core/params';
import { Rng, hashSeed } from '../../../core/rng';
import type { ToyEngine, ToyStatus } from '../../../core/toy';
import { V_CRASH, V_HORN, V_NOTE, V_NOTE_BASE, V_NOTE_COUNT, V_PRESET, V_START, VROOM_INDEX, VROOM_PARAMS, type VroomParamId } from '../params';
import { CHIP_RATE, makeCrash, makeRadio } from './sounds';

export const VROOM_SEED = 0x7200b0c5;
const IDLE = 850;
const MAX_RPM = 7000;
const RATIOS = [0, 3.5, 2.1, 1.4, 1.0, 0.8];
const HIJACK_SCALE = [48, 50, 52, 53, 55, 57, 59, 60]; // プリセット 1〜8 → C3〜C4
const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** 状態変数フィルター（バンドパス出力） */
class Svf {
  lp = 0; bp = 0;
  tick(x: number, fc: number, q: number, sr: number): number {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, sr / 6)) / sr);
    const hp = x - this.lp - q * this.bp;
    this.bp += f * hp;
    this.lp += f * this.bp;
    return this.bp;
  }
}

export interface VroomDisplay {
  text: string;
}

export class VroomEngine implements ToyEngine<VroomDisplay> {
  readonly params = defaultsOf(VROOM_PARAMS);
  readonly paramDefs = VROOM_PARAMS;
  powered = false;
  running = false;
  rpm = 0;
  speed = 0;
  private rng: Rng;
  private radio: Float32Array[];
  private crash: Float32Array;
  // 始動
  private cranking = false;
  private crankT = 0;
  private crankNeed = 0.8;
  private starterPh = 0;
  // 点火
  private firePh = 0;
  private step = 0;
  private env = 0;
  private sparkEnv = 0;
  private res1 = new Svf();
  private res2 = new Svf();
  private chipPh = 0;
  // ノート（HIJACK と MIDI）
  private notes: number[] = [];
  // 付属の音
  private hornOn = false;
  private hornPh = [0, 0];
  private sirenPh = 0;
  private sirenLfo = 0;
  private relayPh = 0;
  private relayTick = 0;
  private relayEnv = 0;
  private wiperPh = 0;
  private wiperSvf = new Svf();
  private crashPos = -1;
  private turboEnv = 0;
  private blowOff = 0;
  private turboSvf = new Svf();
  private turboPh = 0;
  private prevTurbo = false;
  private grindT = 0;
  private grindPh = 0;
  private grindSvf = new Svf();
  private screechSvf = new Svf();
  private prevWheel = 0;
  private wheelVel = 0;
  private humPh = 0;
  private hazardPh = 0;
  private radioPos = 0;
  private radioStatic = 0;
  private radioLp = 0;
  private prevStation = 0;
  private prevGear = 0;
  // TURBO FB（点火の周期に合わせた櫛形フィードバック）
  private fbBuf: Float32Array;
  private fbPos = 0;
  // 出力段
  private vol = 0;
  private gate = 0;
  private dcX = 0;
  private dcY = 0;
  private t = 0;
  displayVersion = 0;

  constructor(readonly sampleRate: number, readonly seed = VROOM_SEED) {
    this.rng = new Rng(hashSeed(seed, 'vroom'));
    this.radio = makeRadio(seed);
    this.crash = makeCrash(seed);
    this.fbBuf = new Float32Array(Math.ceil(sampleRate * 0.06));
  }

  p(id: VroomParamId): number {
    return this.params[VROOM_INDEX[id]];
  }

  setParam(index: number, value: number): void {
    const def = VROOM_PARAMS[index];
    if (!def) return;
    this.params[index] = Math.max(def.min, Math.min(def.max, def.kind === 'continuous' ? value : Math.round(value)));
  }

  setParamById(id: VroomParamId, v: number): void {
    this.setParam(VROOM_INDEX[id], v);
  }

  powerOn(): void {
    this.powered = true;
  }

  powerOff(): void {
    this.powered = false;
    this.running = false;
    this.cranking = false;
    this.notes = [];
    this.hornOn = false;
  }

  keyDown(key: number): void {
    if (!this.powered) return;
    if (key >= V_PRESET && key < V_PRESET + 8) {
      if (this.p('hijack') > 0.5) this.notes.push(HIJACK_SCALE[key - V_PRESET]);
      else this.setParamById('station', 1 + ((key - V_PRESET) % 3));
    } else if (key === V_HORN) this.hornOn = true;
    else if (key === V_CRASH) this.crashPos = 0;
    else if (key === V_START) { if (!this.running) { this.cranking = true; this.crankT = 0; this.crankNeed = 0.5 + this.rng.next() * 0.6; } }
    else if (key >= V_NOTE && key < V_NOTE + V_NOTE_COUNT) this.notes.push(V_NOTE_BASE + key - V_NOTE);
  }

  keyUp(key: number): void {
    const drop = (n: number) => { this.notes = this.notes.filter((x) => x !== n); };
    if (key >= V_PRESET && key < V_PRESET + 8) drop(HIJACK_SCALE[key - V_PRESET]);
    else if (key === V_HORN) this.hornOn = false;
    else if (key === V_START) this.cranking = false;
    else if (key >= V_NOTE && key < V_NOTE + V_NOTE_COUNT) drop(V_NOTE_BASE + key - V_NOTE);
  }

  get display(): VroomDisplay {
    return this.displayState;
  }
  private displayState: VroomDisplay = { text: '' };

  status(): ToyStatus {
    return {
      powered: this.powered,
      playing: this.running,
      leds: {
        running: this.running ? 1 : 0,
        signal: this.p('signal') > 0.5 && this.relayPh < 0.5 ? 1 : 0,
        turbo: this.turboEnv > 0.3 ? 1 : 0,
      },
      fx: { rpm: Math.round(this.rpm / 10) * 10, speed: Math.round(this.speed), gear: this.p('gear') },
    };
  }

  process(out: Float32Array): void {
    const sr = this.sampleRate;
    const dt = 1 / sr;
    const P = (id: VroomParamId) => this.params[VROOM_INDEX[id]];
    const throttle = P('throttle'), gear = P('gear'), wheel = P('wheel');
    const cam = P('cam');
    const cyl: boolean[] = [];
    for (let i = 0; i < 8; i++) cyl.push(this.params[VROOM_INDEX.cyl1 + i] > 0.5);
    const redline = P('redline'), spark = P('spark');
    const maxRpm = MAX_RPM * Math.pow(2, 3 * redline);
    const turbo = P('turbo') > 0.5 && this.running;
    const grind = P('grind') > 0.5;
    const fbOn = P('turboFbOn') > 0.5, fbAmt = P('turboFb');
    const bleed = P('radioBleed');
    const tune = P('tune') > 0.5;
    const hornBend = P('hornBend') > 0.5;
    const chassis = P('chassis'), hazard = P('hazard');
    const station = this.powered ? P('station') : 0;
    const volTarget = P('volume') ** 2;
    const starterLoop = P('starterLoop') > 0.5 && this.powered;

    // ギアを変えた瞬間
    if (gear !== this.prevGear) {
      if (RATIOS[gear] && RATIOS[this.prevGear]) this.rpm *= RATIOS[gear] / RATIOS[this.prevGear];
      if (grind) this.grindT = 0.6;
      this.prevGear = gear;
    }
    if (station !== this.prevStation) { this.radioStatic = 0.3; this.prevStation = station; }
    if (this.prevTurbo && !turbo) this.blowOff = 0.25;
    this.prevTurbo = turbo;
    // ハンドルを回す速さ（タイヤの鳴き用）
    const wv = Math.abs(wheel - this.prevWheel) / (out.length / sr);
    this.prevWheel = wheel;
    this.wheelVel += (wv - this.wheelVel) * 0.3;

    for (let i = 0; i < out.length; i++) {
      this.t += dt;
      const noise = this.rng.bi();

      // ---- 始動（セルモーター）----
      let starter = 0;
      if ((this.cranking && this.powered && !this.running) || starterLoop) {
        this.crankT += dt;
        this.starterPh = (this.starterPh + 118 / sr) % 1;
        const chug = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * this.t);
        starter = ((this.starterPh * 2 - 1) * 0.4 + noise * 0.3 * chug) * (0.4 + 0.6 * chug);
        if (this.cranking && !this.running && this.crankT > this.crankNeed) { this.running = true; this.rpm = 1300; this.cranking = false; }
      }

      // ---- 回転数 ----
      if (this.running) {
        let target = IDLE + Math.pow(throttle, 1.3) * (maxRpm - IDLE);
        if (turbo) target *= 1.2;
        const tau = gear ? 0.12 + gear * 0.12 : 0.08;
        this.rpm += (target - this.rpm) * (dt / tau);
        if (grind && gear) this.rpm *= 1 + 0.0004 * Math.sin(2 * Math.PI * 3 * this.t);
      } else this.rpm *= 1 - dt / 0.5;
      this.speed = gear ? this.rpm * 0.02 / RATIOS[gear] : this.speed * (1 - dt / 4);

      // ---- 点火の間隔 ----
      const noteOn = this.notes.length > 0 && this.powered;
      let F = noteOn ? mtof(this.notes[this.notes.length - 1]) : this.rpm / 30;
      if (tune && !noteOn && F > 1) F = 440 * Math.pow(2, Math.round(12 * Math.log2(F / 440)) / 12);
      const firing = (this.running || noteOn) && this.powered;
      if (firing) {
        this.firePh += F / sr;
        if (this.firePh >= 1) {
          this.firePh -= 1;
          this.step = (this.step + 1) % cam;
          let fire = cyl[this.step];
          if (!noteOn && redline < 0.01 && this.rpm > MAX_RPM * 0.98 && this.rng.chance(0.5)) fire = false; // リミッター
          if (chassis > 0 && this.rng.chance(chassis * 0.4)) fire = false; // 車体に触ると点火が飛ぶ
          if (fire) { this.env = 1; this.sparkEnv = 1; }
        }
      }
      // ---- 排気の粒 → 排気管の共振 ----
      const tau = Math.min(0.012, 0.6 / Math.max(1, F));
      this.env *= Math.exp(-dt / tau);
      const src = this.env * (0.6 + 0.4 * noise);
      const body = 1 + chassis * 1.5;
      let eng = this.res1.tick(src, 140, 0.8, sr) * 1.4 * body + this.res2.tick(src, 520, 0.5, sr) * 0.7;
      this.chipPh = this.firePh;
      if (this.env > 0.02) eng += (this.chipPh < 0.3 ? 1 : -1) * this.env * 0.3; // おもちゃのチップ音
      // SPARK：点火のたびにバチッ、ビットも粗くなる
      if (spark > 0) {
        this.sparkEnv *= Math.exp(-dt / 0.0015);
        eng += noise * this.sparkEnv * spark * 0.9;
        const q = Math.pow(2, 8 - 5 * spark);
        eng = Math.round(eng * q) / q;
      }
      // HAZARD：リレーがエンジンを刻む
      if (hazard > 0) {
        this.hazardPh = (this.hazardPh + (1.5 + hazard * 12) / sr) % 1;
        if (this.hazardPh < 0.5) eng *= 1 - hazard;
      }
      // TURBO FB：点火の周期に合わせた櫛形フィードバック（金属的なうなり）
      if (fbOn && F > 1) {
        const d = Math.max(8, Math.min(this.fbBuf.length - 1, Math.round(sr / F)));
        const y = this.fbBuf[(this.fbPos - d + this.fbBuf.length) % this.fbBuf.length];
        eng += Math.tanh(y * fbAmt * 1.1);
        this.fbBuf[this.fbPos] = eng;
      } else this.fbBuf[this.fbPos] = 0;
      this.fbPos = (this.fbPos + 1) % this.fbBuf.length;

      // ---- ラジオ ----
      let radio = 0;
      if (station > 0) {
        const buf = this.radio[station - 1];
        this.radioPos = (this.radioPos + CHIP_RATE / sr) % buf.length;
        radio = buf[this.radioPos | 0];
        if (this.radioStatic > 0) { this.radioStatic -= dt; radio = noise * 0.5; }
        this.radioLp += (radio - this.radioLp) * 0.3; // ダッシュボードの小さなスピーカー
        radio = this.radioLp * 0.5;
      }
      // RADIO BLEED：ラジオがエンジンの配線に漏れて、掛け算で混ざる
      if (bleed > 0) {
        eng = eng * (1 - bleed) + eng * radio * 8 * bleed;
        radio *= 1 - bleed * 0.8 * (1 - Math.min(1, this.env * 2));
      }

      // ---- ターボ ----
      let turboOut = 0;
      this.turboEnv += ((turbo ? 1 : 0) - this.turboEnv) * (dt / 0.3);
      if (this.turboEnv > 0.001) {
        this.turboPh = (this.turboPh + (this.rpm * 0.9) / sr) % 1;
        turboOut = this.turboSvf.tick(noise, 800 + this.rpm * 0.4, 0.3, sr) * this.turboEnv * 0.5 + Math.sin(2 * Math.PI * this.turboPh) * this.turboEnv * 0.08;
      }
      if (this.blowOff > 0) { this.blowOff -= dt; turboOut += noise * this.blowOff * 1.6; }

      // ---- ホーン・サイレン・ウインカー・ワイパー ----
      let extra = 0;
      if (this.hornOn) {
        const bend = hornBend ? Math.pow(2, wheel) : 1;
        this.hornPh[0] = (this.hornPh[0] + (392 * bend) / sr) % 1;
        this.hornPh[1] = (this.hornPh[1] + (494 * bend) / sr) % 1;
        extra += Math.tanh((pulseBL(this.hornPh[0], (392 * bend) / sr) + pulseBL(this.hornPh[1], (494 * bend) / sr)) * 0.8) * 0.35;
      }
      if (P('siren') > 0.5 && this.powered) {
        this.sirenLfo = (this.sirenLfo + 0.8 / sr) % 1;
        const f = 700 + 400 * (0.5 - 0.5 * Math.cos(2 * Math.PI * this.sirenLfo));
        this.sirenPh = (this.sirenPh + f / sr) % 1;
        extra += pulseBL(this.sirenPh, f / sr) * 0.18;
      }
      const relayRate = P('signal') > 0.5 ? 1.5 : 0;
      if ((relayRate || hazard > 0) && this.powered) {
        const rate = relayRate + hazard * 20;
        const prev = this.relayPh;
        this.relayPh = (this.relayPh + rate / sr) % 1;
        if (this.relayPh < prev || (prev < 0.5 && this.relayPh >= 0.5)) { this.relayEnv = 1; this.relayTick ^= 1; }
      }
      if (this.relayEnv > 0.001) {
        this.relayEnv *= Math.exp(-dt / 0.002);
        extra += (noise * 0.5 + Math.sin(2 * Math.PI * (this.relayTick ? 1300 : 1000) * this.t)) * this.relayEnv * 0.3;
      }
      if (P('wipers') > 0.5 && this.powered) {
        this.wiperPh = (this.wiperPh + 1 / 1.3 / sr) % 1;
        const w = Math.sin(Math.PI * Math.min(1, this.wiperPh * 2.2)) ** 2;
        extra += this.wiperSvf.tick(noise, 1200 + 1800 * w, 0.6, sr) * w * 0.25;
      }
      // クラッシュ
      if (this.crashPos >= 0) {
        extra += this.crash[this.crashPos | 0] * 0.8;
        this.crashPos += CHIP_RATE / sr;
        if (this.crashPos >= this.crash.length) this.crashPos = -1;
      }
      // ギアのガリガリ
      if (this.grindT > 0) {
        this.grindT -= dt;
        this.grindPh = (this.grindPh + 43 / sr) % 1;
        extra += this.grindSvf.tick(noise, 3000, 0.4, sr) * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.grindPh)) * 0.8;
      }
      // タイヤの鳴き
      const sq = Math.min(1, this.wheelVel * 0.4) * Math.min(1, this.speed / 60);
      if (sq > 0.01) extra += this.screechSvf.tick(noise, 2500 + 300 * Math.sin(2 * Math.PI * 30 * this.t), 0.15, sr) * sq * 0.3;
      // CHASSIS：車体に触るとハム
      if (chassis > 0) {
        this.humPh = (this.humPh + 50 / sr) % 1;
        extra += (Math.sin(2 * Math.PI * this.humPh) + 0.4 * (this.humPh < 0.5 ? 1 : -1)) * chassis * 0.12;
      }

      let x = eng * 0.7 + starter + radio + turboOut + extra;
      this.gate += ((this.powered ? 1 : 0) - this.gate) * 0.005;
      this.vol += (volTarget - this.vol) * 0.002;
      const y = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = y;
      x = Math.tanh(y);
      out[i] = x * this.vol * this.gate;
    }
    // スピードメーターの表示
    const text = this.powered ? String(Math.min(999, Math.round(this.speed))).padStart(3, ' ') : '';
    if (text !== this.displayState.text) { this.displayState = { text }; this.displayVersion++; }
  }
}
