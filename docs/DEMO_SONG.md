# デモ曲「POWER ON / POWER OFF」

スタジオ（`studio.html`）の最初の曲。「デモ曲」ボタンでいつでも読み込み直せる。
曲データは `src/studio/demo.ts` のコードで組み立てている（手で弾いた録音ではない）ので、言葉での直しをそのまま反映できる。

- BPM 120・76 小節・約 2 分 32 秒・シード 20260929（頭から再生すると毎回同じ音・同じグリッチ）
- 映像は TELEKEY のテスト映像（4 小節ごとに場面が変わる）。入力の音はテスト信号（Am → F → C → G を 1 小節ずつ）
- 検査：`npx tsx scripts/demo-test.ts`（最後まで鳴らして、長さ・セクションごとの音量・クラッシュの無音・再現性を確かめ、`out/demo.wav` に書き出す）

## トラック

| トラック | おもちゃ | 中身 |
|---|---|---|
| 声 | トイPC | 単語・読み上げ（SAY / WORD モード）、モードの切り替え |
| メロディ | トイPC | ドレミの数字キー（Aメロ）、PIANO モードのアルペジオ（展開） |
| 改造パーツ | トイPC | 電源・CRASH、GLITCH ボタン、LOOP HOLD/RELEASE、STRETCH、LFO・DIST・BASE |
| ビート | TELEKEY | 楽器キーの KICK・SNARE・HAT（リズムの型 a / dev / chorus / fill / roll） |
| 楽器 | TELEKEY | チャイム（CHIRP・BLIP）、ZAP、NOISE |
| 映像グリッチ | TELEKEY | 電源・CRASH、グリッチキー（音と映像が同時に壊れる）、一発グリッチ、FREEZE、HOLD/RELEASE、キュー、ノブ |

## 構成

| セクション | 小節 | やっていること |
|---|---|---|
| イントロ | 1〜8 | トイPC の起動音「HELLO」→「K IS FOR KING」「C IS FOR CAT」「R IS FOR ROBOT」「S IS FOR SUN」→ ドミソの小さなメロディ。最後の小節で TELEKEY の電源が入る（ブラウン管の「ボン」） |
| Aメロ | 9〜24 | TELEKEY の楽器キーでビート、トイPC の数字キーでメロディ（4 小節 × 4、2 回目は終わりが違う）。フレーズの終わりにトイPC が単語を呼び（KING / CAT …）、TELEKEY がグリッチで返す |
| 展開 | 25〜40 | トイPC が PIANO モードのアルペジオ。グリッチが 4 小節ごとに増える（1 小節に 1 回 → 2 回 → 拍ごと → 8 分ごと）。LFO が深くなってうねる。STRETCH・BASE 切り替え、12 小節目で LOOP HOLD → RELEASE、最後に FREEZE |
| サビ | 41〜56 | トイPC のキャラ連打（KING・CAT・ROBOT・ZAP を 8 分で）、GLITCH ボタンを拍ごとに回す、DIST が上がる。TELEKEY は 8 分ごとにグリッチを入れ替え、4 小節ごとに一発グリッチ（BASE も変わる）、後半はキー混線・CRUSH。13 小節目で HOLD → 15 小節目で RELEASE |
| ブレイク | 57〜64 | 2 台同時に CRASH（音が張り付いて無音・画面が固まる 4 秒）→ RESET・再起動の音。トイPC だけが「H IS FOR HAT」と Aメロの頭をゆっくり。最後の小節でスネアのロール |
| ラスト | 65〜76 | Aメロをもう一度（ビートはサビの型）→ キャラ連打 2 小節 → MELTDOWN の CHAOS で全部壊す → FREEZE したまま「Z IS FOR ZAP」→ 2 台とも電源 OFF |

## 直し方（例）

| 言われたこと | 直す場所 |
|---|---|
| 全体を速く / 遅く | `DEMO.bpm` |
| イントロを短く、サビを長く | `DEMO.bars` |
| トイPC がうるさい / キーボードが小さい | `DEMO.toyVolume` / `DEMO.teleVolume` |
| メロディを変えて | `A_MELODY`（数字 = ドレミ、`:2` = 8 分音符 2 つ分の長さ、`r` = 休み） |
| ビートをもっと跳ねて | `BEATS`（16 分音符 16 個。`x` = 鳴らす） |
| サビの連打の言葉を変えて | `CHORUS_CHARS`（文字 = そのキーの単語。K = KING、C = CAT …） |
| 呼びかけと返しを変えて | `CALLS`（単語の文字と、返すグリッチ） |
| もっと壊して / 控えめに | 各セクションの `glitchSet`・`seq`・ノブの `ramp`（0〜1） |
| クラッシュを長く | ブレイクの `SYS_CRASH` の長さ（拍） |
