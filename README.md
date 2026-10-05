# BENT TOY RACK

サーキットベンディングで魔改造したおもちゃ楽器を、ブラウザで演奏・録音するシミュレーター。
外観・キャラ・音・名前はすべてオリジナル。

| # | おもちゃ | 中身 |
|---|---|---|
| 1 | **BLIPPY BOOK 30** | 子供向けおもちゃPC。音声合成・8モード・GLITCH×5＋BASE・LOOP・STRETCH・DIST・液晶グリッチ・自分の声 |
| 2 | **PIKOTONE PT-32** | 安物ミニキーボード＋エフェクト別ユニット。AMP/CPU 電圧 Starve・タッチポイント・INST HOLD・GLITCH・DIST/FIZZ/HIPASS/FEEDBACK |
| 3 | **SPIN-TOT DJ-28** | 子供用 DJ セット。スクラッチ・パッド・ミニ鍵盤・リズム 28 種（隠し 7 種）・PITCH 粗/微・光センサー・STOP・DIST×2・FEEDBACK＋ソース切替 |
| 4 | **VROOMBOX VR-5** | オリジナル設計。子供用ドライブ・ダッシュボード。点火の粒で作るエンジン音・FIRING ORDER×8＋CAM・REDLINE・SPARK・TURBO FB・RADIO BLEED・TUNE・PRESET HIJACK（MIDI でエンジンを弾ける） |
| 5 | **TYPOTRON TT-109** | オリジナル設計。PC キーボードそのものが楽器。全キーに役目（4 段の音階・SUSTAIN・Shift でオクターブ・打った行を Enter でループ等）、キーボードの故障 GHOST/SCAN/BOUNCE/OVERFLOW、ツマミ 12 個 |
| 6 | **TELEKEY TK-6** | オリジナル設計。ブラウン管モニター付きの魔改造キーボード。タブ共有 / ローカル動画 / Web カメラの映像と音をキーボードで壊す（起動時は Web カメラ、許可されなければ自動生成のテスト映像）。映像グリッチ24種（WebGL）＋音グリッチ24種・FREEZE・楽器キー11種・改造パーツ（ノブ8・トグル3・GLITCH×BASE の一発グリッチ25種・HOLD/RELEASE・LFO・キー混線）・熱による暴発（固まらない）・加工後の映像＋音の録画（WebM） |
| 7 | **PAKU-PAKU 16** | サンプラー（`sampler.html`。スマホ・タブレット・PC）。16 パッド × 16 バンク・録音・チョップ・タイムストレッチ・16 レベル・ロール・エフェクト 24 種・サーキットベンド・パターン / ソング・WAV / MIDI。ラックの 7 台目・スタジオにも並べられて、自動作曲もできる（小さい版。音の作り込みは専用のページ） |

## サンプラー PAKU-PAKU 16

`sampler.html`（ラック・スタジオの上のバーの **SAMPLER**）。子ども用の録音おもちゃを魔改造した見た目の、スマホ・タブレット・PC で使えるサンプラー。定番のパッド型サンプラーの機能を、オリジナルの名前でぜんぶ入れる予定。仕様と機能の対応表は `docs/SAMPLER_SPEC.md`。コードは `src/sampler/` にまとめてあり、あとでサンプラーだけ別のアプリに切り出せる。

- [x] フェーズ1：16 パッド × 16 バンク・GATE / LOOP / REV / POLY・ミュートグループ・音程 / 音量 / パン / フィルター / エンベロープ / スタート・エンド・ベロシティ・マイク録音（AUTO）・リサンプル・ファイル読み込み・コピー / 消去・MIDI 入力・ブラウザに自動保存・工場出荷の音 112 個（すべて合成。A ドラム・B おもちゃ・C 和・D レゲエ/ダブ/スカ・E ジャズ/ボサノバ/ファンク・F ダンス・G マーチ/チップ/パンク/ローファイ）・縦長 / 横長の画面
- [x] フェーズ2：波形の編集（START・END・LOOP・0 SNAP・ZOOM・ノーマライズ・逆転・切り詰め・UNDO）・チョップ（等分・立ち上がりで自動・手で → からっぽのバンクに並べる）・BPM の推定とテンポ合わせ（音程そのままのストレッチ／ピッチで）・16 レベル（PITCH・VEL・CUTOFF・ATTACK・START）・ロール（1/4〜1/32・3 連）・サブパッド・TEMPO / TAP
- [x] フェーズ3：エフェクト 24 種（BUS 1・BUS 2・MASTER に置く。パッドごとに送り先）・サーキットベンドのジャンパー線 6 本（熱で暴発・外せば冷める）
- [x] フェーズ4：パターン 16 個（1〜8 小節。リアルタイム録音・重ね録り・クオンタイズ・スイング・メトロノーム・ステップ入力・ERASE・UNDO）・ソング（パターンをつなぐ・くり返し回数）・書き出し（WAV・MIDI・プロジェクト丸ごと .paku の保存と読み込み・パッド 1 つの WAV）
- [x] フェーズ5：スタジオ（DAW）に 7 台目として並べられる（サンプラーで作った音がそのまま鳴る・WAV 書き出しも）・SONG タブの → STUDIO でソングをスタジオのシーケンサーへ・攻略本に「サンプラー編」

## 使い方

- **攻略本**（使い方を全部まとめた説明書・印刷や PDF にもできる）：https://hacchake.github.io/bentpc/manual/ （各画面の「📖 攻略本」から）。作り直すときは `npm run manual`（スクリーンショットの自動撮影 → おすすめシード選び → ページ → PDF。`scripts/manual/`）

- 公開ページ：https://hacchake.github.io/bentpc/ （スタジオは https://hacchake.github.io/bentpc/studio.html ）。main に push すると GitHub Actions（`.github/workflows/deploy.yml`）が自動でビルドして公開する

- すぐ遊ぶ：`dist/index.html` をダブルクリック（`npm run build` で作り直せる）
- スタジオ（2 台を並べて曲を作る）：`dist/studio.html`、またはラック右上の **STUDIO**
- サンプラー：`dist/sampler.html`、またはラック右上の **SAMPLER**（公開ページ https://hacchake.github.io/bentpc/sampler.html はスマホでも開ける）
- カメラやタブ共有がうまく動かないとき：`ブラウザで開く.bat` をダブルクリック（小さなサーバーで http://localhost:4173 を開く）
- 開発：`npm run dev` → http://localhost:5178/
- 自動テスト：`npm test`（全おもちゃの全キー・全パーツを検査。`out/` に WAV を書き出す）
- 画面の通しテスト：`npm run smoke`（このパソコンの Chrome で全ページを開いて触る：電源が入るか・RESET・はみ出し・英語の画面・攻略本の画像・エラー。PC とスマホ縦の両方）
- 処理速度の目安：`npx tsx scripts/bench.ts`

上のタブ（または F1〜F7）でおもちゃを切り替える（TYPOTRON 表示中は F キーが楽器の機能なのでタブで）。裏のおもちゃも鳴り続けるので、重ねて演奏できる。
REC は全部のおもちゃのミックスを WAV で保存する。

**まねっこ（カバー）**：取り込んだ曲（MP3・AAC・WAV）を解析して、選んだおもちゃだけで同じ曲を作り直す（作成中）。仕様と進み具合は `docs/COVER_SPEC.md`。

- [x] フェーズ1：曲の解析（テンポ・拍・小節・調・コード・メロディ・ベース・ドラム・構成）
- [x] フェーズ2：解析からカバーを作る（7 台どのおもちゃでも・何台でも）・ボーカルを取り出す（カバーに元の歌を重ねられるよう、拍にそろえる）
- [ ] フェーズ3：おもちゃ本体（MANEKKO MK-8）
- [ ] フェーズ4：攻略本・英語・仕上げ

**音の仕上げ（マスター）**：おもちゃは、鳴った順にバンドのように左右へ並べる（1 台だけなら真ん中、ドラム・ベース担当のサンプラーはいつも真ん中。サンプラーはパッドごとの左右の位置のままステレオで出る）。混ぜた後に、直流カット → ゆるいバスコンプ（まとめる）→ 低音（120Hz より下）を真ん中に（リンクウィッツ・ライリーの分け方）→ 小さな部屋の響き（左右に広げる。低音は真ん中のまま）→ 先読みリミッター（サンプルの間の山まで見て -1dBTP 以下。絶対に割れない）を通す（`src/host/master.ts`）。スピーカー・REC・WAV 書き出しのどれも同じ音で、WAV はステレオ。WAV は 16bit にするとき TPDF ディザーを足す（静かな所がザラつかない）。工場出荷の音は頭 1ms・終わり 8ms をなめらかにして「プチッ」を消した。WAV 書き出しは曲全体の大きさを -12 LUFS にそろえる（市販品と同じものさし：`src/core/loudness.ts`。`scripts/master-test.ts` で毎回確かめる）。シンセの角のある波形（のこぎり・矩形）は帯域制限（polyBLEP、`src/core/blep.ts`）で、高い音の濁り（折り返し）を約 16dB 減らした（トイPC・PIKOTONE の内蔵音源は、昔のチップの音をそのまま再現するため除く）。サンプラーの音程変更は 4 点エルミート補間。
**STUDIO**（`studio.html`）は好きなおもちゃ（最初は BLIPPY BOOK 30 と TELEKEY TK-6）を 1 ページに並べ、下のシーケンサー（横 = 時間・縦 = トラック。キー／ボタン／スイッチ／ノブの行、セクション名、ループ範囲、CRASH→再起動）で 2 台いっしょに曲を作る。再生するとキーが光り、ノブやスイッチも動く。頭から再生すると毎回同じ音になる（シード固定）。仕様は `docs/SEQUENCER_SPEC.md` の後半。曲は **WAV**（音声・速く書き出す）／**WebM**（映像込み・実時間で録画）／**MIDI**（将来の VST 用）で書き出せる。最初に入っているデモ曲「POWER ON / POWER OFF」（約 2 分 32 秒）の構成と直し方は `docs/DEMO_SONG.md`。
**AUTO COMPOSER**（おもちゃの右の緑の基板）：「自動作曲」を押すと、ルールとシードで曲を作ってシーケンサーに書き込み、鳴らす（サンプラーはスタイルに合う工場出荷の楽器で：音頭なら太鼓・篠笛・三味線・掛け声、レゲエならワンドロップ・スカンク・オルガン…）（STYLE 26 種：演歌・音頭・レゲエ・ダブ・スカ・ボサノバ・ジャズ・ファンク・ハウス・テクノ・ドラムンベース・ジャングル・トラップ・ガバ・IDM・ブレイクコア・童謡・マーチ・チップチューン・パンク・ローファイ ほか／壊れ度・長さ・BPM・SEED・鍵・セクションだけ作り直し）。7 台すべてに付いている。「参加するおもちゃ」を押すと、何台かで 1 つの曲になる（ラックでもスタジオでも）。「🔗 URL をコピー」で、同じ曲を URL で人に送れる。仕様と直し方は `docs/COMPOSE_SPEC.md`。
**☰ SEQ** はシーケンサー（スタジオと同じ画面）：演奏の操作を録音（ループしながら重ね録り）し、キー・ボタン・スイッチ・ノブの行で手直しできる。WAV・MIDI で書き出し。仕様は `docs/SEQUENCER_SPEC.md`。MIDI はチャンネル n → n 台目（1〜7）。

## 著作物の扱いについて / About copyrighted material

**日本語**：TELEKEY TK-6 はタブ共有・ローカル動画・Web カメラの映像と音を加工・録画できます。
他人の著作物（動画・音楽・画像など）を加工・録画・公開する場合は、必ず権利者の許可を得てください。
このアプリに付いているテスト映像・テスト信号は、プログラムで自動生成したもので自由に使えます。

**English**: TELEKEY TK-6 can process and record video and audio from a shared browser tab, a local video file, or a webcam.
If you process, record, or publish someone else's copyrighted work (videos, music, images, etc.), please obtain permission from the rights holder.
The built-in test pattern and test signal are procedurally generated by this app and are free to use.

## 構成

- `src/core/` … おもちゃ共通の部品（`toy.ts` = エンジンの共通の形 `ToyEngine`、`params.ts` = パラメーター定義の形、`ui.ts` = 画面の共通の形、乱数、操作部品）
- `src/host/` … アプリ本体（AudioWorklet でおもちゃを全部動かして混ぜる、録音、MIDI、シーケンサーと編集パネル）
- `src/toys/<名前>/` … おもちゃごとの `params.ts`・`dsp/`（DOM 非依存。VST 移植対象）・画面
- `src/toys/engines.ts` / `uis.ts` … おもちゃの一覧（並び順 = おもちゃ番号）
- `src/sampler/` … サンプラー PAKU-PAKU 16（`dsp/` が音の処理・DOM 非依存。ほかのおもちゃに依存しない）
- `docs/BLIPPY_DSP_SPEC.md`、`docs/PIKO_DSP_SPEC.md`、`docs/DJ_DSP_SPEC.md`、`docs/VROOM_DSP_SPEC.md`、`docs/TYPO_DSP_SPEC.md` … 音の処理の仕様（JUCE / Rust 移植用）

## おもちゃを増やすには

1. `src/toys/<名前>/params.ts`（パラメーター表）と `dsp/engine.ts`（`ToyEngine` を実装）を作る
2. 画面 `ui.ts`（`ToyUI` を返す関数）を作る
3. `src/toys/engines.ts` と `src/toys/uis.ts` に同じ順番で追加する

## 将来の構想

複数の改造おもちゃを並べて演奏し、DAW 用に収録できる KORG Gadget のようなアプリ。VST3 化も視野に入れている。
