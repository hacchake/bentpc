# BLIPPY BOOK 30 — bent

90年代風の子供向け「おもちゃPC」を、サーキットベンディングで魔改造した楽器のシミュレーター（Web版）。
外観・キャラ・音はすべてオリジナル。

## 使い方

- すぐ遊ぶ：`dist/index.html` をダブルクリック（`npm run build` で作り直せる）
- 開発：`npm run dev` → http://localhost:5178
- エンジン試験：`npx tsx scripts/engine-test.ts`（全モード全キーを鳴らし、`out/` に WAV を書き出す）

## 構成

- `src/params.ts` … すべてのパラメーター定義（id・名前・範囲・初期値・種類・MIDI CC）
- `src/dsp/` … 音の処理（DOM 非依存。VST 移植対象）。詳細は `docs/DSP_SPEC.md`
- `src/worklet/processor.ts` … AudioWorklet の殻
- `src/ui/` … 液晶描画・操作部品
- `vite.config.ts` … Worklet を esbuild でまとめて Blob URL 化するプラグイン（単一HTMLビルド対応）

## 進捗

- [x] フェーズ1：電源・モード8種・A〜Z＋機能キー4つ・音声合成/メロディ/効果音・液晶・死んだキー
- [ ] フェーズ2：GLITCH×5＋BASE、LOOP、LFO、STRETCH、DIST
- [ ] フェーズ3：ストレスとフリーズ／RESET、液晶グリッチ連動、録音(WAV)、MIDI、見た目の仕上げ、マイク録音スロット
