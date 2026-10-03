// 攻略本の「各パーツ完全解説」のデータ。見つけ方（find）は、スクリーンショットの番号の位置を決めるのに使う：
//   text = おもちゃの画面の中で、その文字だけを持つ部品（ラベル・テープ）、sel = CSS セレクター、nth = 何番目か
// 説明は実物（src/toys/*）どおり。what = 何が起きる？、tip = おすすめの使い方（任意）

export interface PartDef {
  find: { text?: string; sel?: string; nth?: number };
  name: string;
  what: string;
  tip?: string;
}

export interface ToyManual {
  id: string; // 画像のファイル名・data の鍵
  index: number; // ラックの番号（0〜6）
  title: string;
  catch: string; // ひとこと
  desc: string;
  power: string; // 電源の場所
  parts: PartDef[];
}

export const TOYS: ToyManual[] = [
  {
    id: 'blippy', index: 0, title: 'BLIPPY BOOK 30', catch: 'しゃべる！ 歌う！ まちがえる！ 魔改造トイPC',
    desc: 'ふたに液晶、本体に文字キー 26 個とドレミの数字キーがついた子供向けパソコン。8 つのモードで、文字の読み上げ・単語・メロディ・ピアノ・ドラム・効果音・クイズになる。そこへ GLITCH ボタンや LOOP・STRETCH・DIST を後付けした、読み上げが壊れる魔改造機だ！',
    power: '本体の左上の大きな緑のボタン（赤い「POWER」の札）。OFF はその下の小さいボタン',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER', what: '電源 ON。起動音のあと「HELLO」としゃべって、モードの画面になる。しゃべり終わるまではキーが効かない。', tip: 'キーボードの Enter でも入る（電源 OFF のとき）' },
      { find: { text: 'OFF', nth: 0 }, name: 'OFF', what: '電源を切る。' },
      { find: { text: 'VOLUME' }, name: 'VOLUME', what: '音量のツマミ。' },
      { find: { sel: 'canvas[data-id="lcd"]' }, name: '液晶', what: '押した文字・キャラ・モードが出る。グリッチ中は液晶の絵も崩れ、VOICE 系のグリッチでは別のキャラに化ける。' },
      { find: { sel: '.keys-panel' }, name: '文字キー（A〜Z）と ♪ ? ★ OK', what: 'モードによって、文字の名前・単語・メロディ・ピアノの音・ドラム・効果音・クイズの答えになる。1 音ずつしか鳴らない（新しい音が前の音を切る）。', tip: 'PC キーボードの A〜Z がそのまま文字キー。- ^ @ [ が ♪ ? ★ OK' },
      { find: { sel: '[data-id="numberRow"]' }, name: 'ドレミの数字キー', what: 'ド〜上のミの 10 音。どのモードでも同じ音が鳴る。', tip: 'PC の 1〜0 キー' },
      { find: { sel: '[data-id="modeDial"]' }, name: 'MODE ダイヤル', what: 'ABC / WORD / TUNE / PIANO / DRUM / SFX / QUIZ / SAY の 8 モード。液晶の横の絵のボタンでも選べる。', tip: 'PC の ← →' },
      { find: { text: 'RESET' }, name: 'RESET', what: 'CPU が止まって電源が切れた状態になる（熱も 0 に戻る）。もう一度 POWER で起動し直す。', tip: 'PC の Esc。熱くなりすぎたときの最終手段' },
      { find: { text: 'STRETCH' }, name: 'STRETCH（スイッチ・HOLD・REL）', what: 'ON の間、音を「普通に進む」と「25ms の粒を繰り返す」の交互にする。HOLD ツマミで粒を繰り返す長さ（15〜900ms）、REL ツマミで進む長さ（8〜400ms）。', tip: 'PC の Backspace で ON/OFF。読み上げがロボットみたいにカクカクになる' },
      { find: { text: 'GLITCH' }, name: 'GLITCH 1〜5', what: '押している間だけ効くグリッチ。BASE の位置との組み合わせで 25 種類（→ 5 章）。いくつも同時押しできる。', tip: 'PC の , . / ; : キー。押しっぱなしにすると熱がたまる' },
      { find: { text: 'LOOP' }, name: 'LOOP（スイッチ・HOLD・RELEASE）', what: 'HOLD ボタンで、今鳴っている所の 50ms をつかんで繰り返す。RELEASE で放す。スイッチ：上 = 自動でつかむ、中 = ふつう、下 = MUTE（音が出ない。電源も入らない！）。', tip: 'PC の Space = HOLD、Enter = RELEASE、Tab = スイッチ' },
      { find: { text: 'LFO RATE' }, name: 'LFO RATE / DEPTH', what: 'ループしている間だけ、音程をうねらせる（速さ 0.1〜25.6Hz、深さ ±1.2 オクターブ）。', tip: 'LOOP HOLD と組み合わせる。単体では効かない' },
      { find: { text: 'BASE' }, name: 'BASE', what: 'グリッチの種類の段（1 ADDR・2 DATA・3 CLOCK・4 BEEP・5 VOICE）。', tip: 'PC の ↑ ↓' },
      { find: { text: 'DIST' }, name: 'DIST（ツマミ・CLIP / FOLD）', what: '歪み。CLIP はつぶす歪み、FOLD は折り返して量子化する荒い歪み。' },
      { find: { text: 'MY VOICE' }, name: 'MY VOICE', what: '押して待機 → キーを押している間マイクで録音（最長 4 秒）。そのキーが自分の声になる。短く押すと声を消す。', tip: 'このブラウザに保存される' },
    ],
  },
  {
    id: 'piko', index: 1, title: 'PIKOTONE PT-32', catch: '電圧を下げると、音も心もよれていく',
    desc: '32 鍵のミニキーボードに、リズムマシンと 8 つの音色（ORCHESTRA）。上には別のエフェクトユニットをつなぎ、左には電圧 Starve（わざと電気を減らす）ツマミとタッチポイントを増設した魔改造機だ！',
    power: '操作パネルの左の大きな緑のボタン（押すたびに ON / OFF）',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER', what: '押すたびに電源 ON / OFF。' },
      { find: { text: 'MASTER VOL' }, name: 'MASTER VOL', what: '音量。' },
      { find: { text: 'TEMPO' }, name: 'TEMPO（▲▼）', what: 'リズムの速さ（60〜200 BPM）。' },
      { find: { text: 'RHYTHM' }, name: 'RHYTHM ＋ START / STOP', what: 'MARCH・RHUMBA・DISCO・POP・BALLAD・WALTZ・TANGO・SWING の 8 種類。START で鳴らし、STOP で止める。', tip: 'PC の ↑ ↓ で選び、Space で START / STOP' },
      { find: { text: 'ORCHESTRA' }, name: 'ORCHESTRA ＋ VIBRATO・DEMO', what: '鍵盤の音色 8 種（ORGAN・VIOLIN・PIANO・HORN・FLUTE・GUITAR・MUSIC BOX・BANJO）。VIBRATO でゆらし、DEMO でデモ曲。', tip: 'PC の ← → で音色、Enter で DEMO' },
      { find: { text: 'GLITCH', nth: 0 }, name: 'GLITCH スイッチ', what: 'ON にするとリズムが壊れる：スネアのたびに「ピーッ」と発振し、ときどき同じ所を繰り返し、キックの音程がばらつく（パッドも）。', tip: 'PC の Backspace' },
      { find: { sel: '.pk-pad' }, name: '赤いパッド', what: 'キック・スネア・ハット・タム。', tip: 'PC の - ^ @ [' },
      { find: { text: 'INST HOLD' }, name: 'INST HOLD 1〜8', what: '楽器を選ぶ線を押さえっぱなしにする改造。ON にした音色が混ざる。' },
      { find: { sel: '[data-id="keys"]' }, name: '鍵盤（F3〜C6）', what: '32 鍵。いくつも同時に鳴る。', tip: 'PC の Z〜/（白鍵）・A〜（黒鍵）、Q〜P（高い白鍵）・2〜9（黒鍵）' },
      { find: { text: 'AMP POWER' }, name: 'AMP POWER / CPU POWER', what: '電圧 Starve。AMP を下げると音が小さく・途切れ・ブルブル揺れる。CPU を下げると全部が遅く・低く・よれていき、さらに下げると音が化け、ときどき止まり、弾いた音程までずれる（リズムも）。', tip: 'この機械のキモ！ ゆっくり下げてみよう' },
      { find: { text: 'AMP TOUCH' }, name: 'AMP TOUCH 1〜3', what: '銀の丸に指を当てている間だけ：1 = ブーンというハム、2 = 歪み、3 = ピーという発振。押したまま上下で強さが変わる。' },
      { find: { text: 'PITCH BEND' }, name: 'PITCH BEND 1〜3', what: '銀の丸に指を当てている間だけ音程が曲がる。押したまま上下で強さが変わる。' },
      { find: { text: 'ENV LEN' }, name: 'エフェクトユニット：ENV LEN・ENV/HOLD', what: '音の長さ。HOLD にすると押した音が消えずに伸びっぱなし。', tip: 'PC の Tab で ENV / HOLD' },
      { find: { text: 'FIZZ' }, name: 'DIST・FIZZ・HIPASS（RESO）', what: 'DIST = 歪み、FIZZ = シュワシュワしたノイズ、HIPASS = 低い音を削る（RESO で「ミョン」とくせをつける）。' },
      { find: { text: 'FEEDBACK' }, name: 'FEEDBACK（LONG）・PITCH', what: 'FEEDBACK = 音が自分に返ってこだまする（SHORT = 4ms のビリビリ、LONG = 280ms のこだま）。PITCH = スイッチ ON で全体の音程を ±1 オクターブ変える。' },
    ],
  },
  {
    id: 'dj', index: 2, title: 'SPIN-TOT DJ-28', catch: 'こすれ！ 止めろ！ 暗くしろ！',
    desc: '子供用 DJ セット。ディスクをこすってスクラッチ、6 つの効果音パッド、13 鍵のキーボード、28 種類のリズム（うち 7 つは隠しパターン）。そこへピッチの粗・微調整、テープのように止まる STOP、光センサー、2 つの DIST と FEEDBACK を後付けした魔改造機だ！',
    power: '右下の大きな緑のボタン（OFF は右の青いボタン）',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER / OFF', what: '電源 ON（緑）と OFF（青）。' },
      { find: { sel: '.dj-disc' }, name: 'ディスク', what: 'マウスでつかんで回すとスクラッチ。DISC EFFECT の音をこする。', tip: 'PC の . / で前・逆に回す（押している間）' },
      { find: { text: 'RHYTHM SELECTION' }, name: 'RHYTHM SELECTION', what: 'リズム 28 種類を選ぶ（1-7・8-14・15-21 と、隠しの 22-28）。', tip: 'PC の 1 2 3 4。押すたびに次へ' },
      { find: { text: 'DISC EFFECT SELECTION' }, name: 'DISC EFFECT SELECTION', what: 'ディスクでこする音を選ぶ（21 種）。', tip: 'PC の 5 6 7' },
      { find: { text: 'PLAY ▶' }, name: 'PLAY / PAUSE / RHYTHM EFFECT', what: 'リズムを鳴らす・止める。RHYTHM EFFECT は押している間、リズムを細かく刻む。', tip: 'PC の Space で PLAY / PAUSE、Enter で EFFECT' },
      { find: { text: '▲ RHYTHM TEMPO ▼' }, name: 'RHYTHM TEMPO', what: 'リズムの速さを 4 ずつ上げ下げ。', tip: 'PC の ↑ ↓' },
      { find: { text: 'STOP' }, name: 'STOP（移動停止）', what: '押している間、テープが止まるように音程ごと落ちていく。離すと戻る。', tip: 'PC の Backspace' },
      { find: { text: 'PITCH' }, name: 'PITCH（スイッチ・COARSE・FINE）', what: 'スイッチ ON で全体の音程を変える。COARSE = ±12 半音、FINE = ±1 半音。', tip: 'PC の P でスイッチ' },
      { find: { text: 'LIGHT' }, name: '光センサー・LIGHT', what: 'LIGHT スイッチ ON のとき、左右の丸いレンズにマウスを近づけると影になって音程が下がる。押さえるとまっ暗。', tip: 'PC の L でスイッチ' },
      { find: { text: 'DIST 2' }, name: 'DIST・DIST 2', what: 'DIST = かたよった歪み、DIST 2 = 整流してオクターブ上が混ざる荒い歪み。それぞれ ON/OFF とツマミ。' },
      { find: { text: 'FEEDBACK' }, name: 'FEEDBACK（RHY / DISC / ALL）', what: '音を自分に返す。どの音を返すかを RHYTHM・DISC・ALL（全部）から選ぶ。' },
      { find: { text: 'SOUND  EFFECT' }, name: 'SOUND EFFECT パッド', what: '6 つの効果音。EFFECT SELECTION で音のセットを変える。', tip: 'PC の Z X C V B N、セットは 8 9 0 - ^' },
      { find: { text: 'KEYBOARD PATTERN' }, name: '鍵盤・KEYBOARD PATTERN・INSTRUMENT', what: 'C〜C の 13 鍵。INSTRUMENT で 10 種の音色、PATTERN 2 でアルペジオ。', tip: 'PC の A W S E D F T G Y H U J K、← → で音色、Tab でパターン' },
    ],
  },
  {
    id: 'vroom', index: 3, title: 'VROOMBOX VR-5', catch: 'エンジンの爆発を、音階で弾け！',
    desc: '子供用ドライブ・ダッシュボード（オリジナル設計）。エンジン音は「点火の粒」でできていて、改造パネルで点火を間引くとリズムになり、TUNE で音階になる。MIDI やシーケンサーでエンジンそのものを弾けるのが自慢の魔改造機だ！',
    power: '左の「POWER」の札のイグニッションキー（クリックで ON、ON のままクリックでエンジン始動）',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER（イグニッションキー）', what: 'クリックで電源 ON（キーが ON の位置へ）。ON のままクリックしている間セルが回り、エンジンがかかる。KEY OFF で切る。', tip: 'PC の Enter（押している間セルが回る）' },
      { find: { text: 'VOLUME' }, name: 'VOLUME', what: '音量。' },
      { find: { text: 'GEAR' }, name: 'GEAR', what: 'N・1〜5。ギアが高いほど回転がゆっくり追いつく。変えた瞬間、回転がガクッと変わる。', tip: 'PC の Z / X' },
      { find: { text: 'ACCEL' }, name: 'ACCEL（ペダル）', what: '踏んでいる間アクセル。回転数（＝点火の速さ＝音の高さ）が上がる。', tip: 'PC の ↑ または W' },
      { find: { sel: '.vr-wheel' }, name: 'ハンドル・ホーン', what: '縁をつかんで回す（離すと戻る）。真ん中はホーン。', tip: 'PC の ← →、Space でホーン' },
      { find: { sel: '.vr-radio' }, name: 'ラジオ', what: 'プリセット 1〜8 で選局。PRESET HIJACK 中は、プリセットのボタンがエンジンの音階（ド〜ド）になる。', tip: 'PC の 1〜8、R で局を切り替え' },
      { find: { text: 'TURBO', nth: 1 }, name: 'TURBO', what: '押している間ターボ。回転が一気に上がる。', tip: 'PC の T' },
      { find: { text: 'SIREN' }, name: 'SIREN / SIGNAL / WIPERS / CRASH!', what: 'サイレン・ウインカーのカチカチ・ワイパー（ON/OFF）、CRASH! は衝突音。', tip: 'PC の S / V / B / C' },
      { find: { text: 'FIRING ORDER' }, name: 'FIRING ORDER 1〜8・CAM', what: '8 つの気筒のスイッチ。点火を間引くと、低い回転でリズムになる。CAM で点火パターンの長さ（3〜8）を変える。', tip: 'この機械のキモ！ 間引いてからアクセルを少しだけ' },
      { find: { text: 'REDLINE' }, name: 'REDLINE・SPARK・RADIO BLEED', what: 'REDLINE = 回転の上限を上げる（0 のままだとリミッターで点火が飛ぶ。上げるほど高く回る）、SPARK = 点火ごとにバチッとノイズ、RADIO BLEED = ラジオとエンジンが掛け算で混ざる。' },
      { find: { text: 'TURBO FB' }, name: 'TURBO FB', what: 'ON のとき、点火 1 回ぶん遅れた音を返して、回転に合わせて響く金属音になる。' },
      { find: { text: 'TUNE' }, name: 'TUNE・HIJACK・HORN BEND・GRIND', what: 'TUNE = 回転数が音階にそろう、HIJACK = ラジオのボタンでエンジンを弾く、HORN BEND = ホーンが曲がる、GRIND = ギアを変えるたびにガリガリ。', tip: 'PC の U で TUNE、H で HIJACK' },
      { find: { text: 'STARTER LOOP' }, name: 'STARTER LOOP', what: '押している間、エンジンがかかっていてもセルモーターが回り続ける。', tip: 'PC の Backspace' },
      { find: { text: 'CHASSIS' }, name: 'CHASSIS / HAZARD', what: '金属の丸に触ると：CHASSIS = ブーンというハムが乗り、点火がときどき飛ぶ。HAZARD = エンジンを細かく刻み、リレーのカチカチが増える。' },
    ],
  },
  {
    id: 'typo', index: 4, title: 'TYPOTRON TT-109', catch: 'キーボードを、楽器として叩け！',
    desc: 'PC キーボードそのものを楽器に改造した（オリジナル設計）。全部のキーに役目があり、文字の段が音階、テンキーがドラム、F キーが波形・音階・「キーボードの故障」。上にはツマミを 12 個増設した魔改造機だ！',
    power: 'キーボードの左上の大きな緑のボタン（押すたびに ON / OFF）',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER', what: '押すたびに電源 ON / OFF。', tip: 'PC の PgUp / PgDn でも' },
      { find: { sel: '.tt-lcd' }, name: '液晶', what: '打った音の「行」、波形・音階・テンポなどが出る。' },
      { find: { text: 'VOLUME' }, name: 'VOLUME・DECAY・TONE', what: '音量・音の減り方・明るさ。' },
      { find: { text: 'DRIVE' }, name: 'DRIVE・CRUSH・ECHO', what: '歪み・ビットつぶし・こだま。' },
      { find: { text: 'TEMPO' }, name: 'TEMPO・BEND RNG', what: '行ループの速さ（60〜240 BPM）と、ピッチベンドの幅（0〜12 半音）。' },
      { find: { text: 'GHOST', nth: 0 }, name: 'GHOST・SCAN RATE・BOUNCE・CLICK', what: '「キーボードの故障」の強さ（GHOST の出やすさ・SCAN の速さ・BOUNCE の回数）と、キーを打つカチッという音の大きさ。' },
      { find: { text: 'OVERFLOW' }, name: '状態 LED', what: 'POWER・LOOP・LATCH・OVR・STUT・CORRUPT・GHOST・SCAN・BOUNCE・OVERFLOW のどれが効いているか。' },
      { find: { sel: '.tt-key.role-wave' }, name: 'F1〜F4：WAVE', what: 'PULSE・SAW・BELL・NOISE の 4 つの波形。' },
      { find: { sel: '.tt-key.role-scale' }, name: 'F5〜F8：SCALE', what: 'MAJOR・MINOR・PENTA・BENT（わざと少し狂った音階）。' },
      { find: { sel: '.tt-key.role-bend' }, name: 'F9〜F12：キーボードの故障', what: 'GHOST = 隣のキーも勝手に鳴る、SCAN = 押しているキーを順番に読み取る（アルペジオに）、BOUNCE = チャタリングで連打、OVERFLOW = 行があふれて暴走。' },
      { find: { sel: '.tt-key.row2' }, name: '文字の段：音階', what: 'Z 段がいちばん低く、1 段上がるごとに約 4 度上。Shift を押している間はオクターブ下（左）・上（右）。' },
      { find: { text: 'Space' }, name: 'Space：SUSTAIN・その他の機能キー', what: 'Space = 音を伸ばす。Enter = 打った「行」をループ、Tab = STUTTER、Caps = LATCH（鳴りっぱなし）、Del = CORRUPT、Ins = 上書き。' },
      { find: { sel: '.tt-key.role-drum' }, name: 'テンキー・無変換・変換・かな：ドラム', what: 'KICK・SNARE・HAT・OPEN・TOM L・TOM H・CLAP・COW・ZAP・CRASH。' },
    ],
  },
  {
    id: 'tele', index: 5, title: 'TELEKEY TK-6', catch: '映像も、音も、いっしょに壊せ！',
    desc: 'ブラウン管モニター付きの魔改造キーボード（オリジナル設計）。Web カメラ・別のタブ・動画ファイルの映像と音を取り込んで、キーで同時に壊す。キーの下の小さな文字が「映像の壊れ方／音の壊れ方」。GLITCH ボタン×BASE の一発グリッチ、ノブ 8 個、熱による暴発つきの映像マシンだ！',
    power: 'モニターの右下の大きな緑のボタン（押すたびに ON / OFF）',
    parts: [
      { find: { text: 'POWER' }, name: 'POWER', what: '押すたびに電源 ON / OFF。ON でブラウン管が「ボン」と点く。', tip: 'PC の Enter（電源 OFF のとき）、PgUp / PgDn' },
      { find: { sel: '.tk-screen' }, name: 'モニター', what: '取り込んだ映像を、効いているグリッチで壊して映す（WebGL）。入力が無いときは砂嵐。' },
      { find: { sel: '.tk-vrec' }, name: '● REC VIDEO', what: '壊した後の映像と音を録画して、WebM で保存。もう一度押すと止めて保存。' },
      { find: { sel: '.tk-src' }, name: '入力の切り替え', what: 'TAB を取り込む（別のタブの映像と音）・FILE（動画ファイル）・CAM（Web カメラ）・TEST（自動で作るテスト映像）・✕（外す）。→ 8 章' },
      { find: { text: 'GLITCH' }, name: 'GLITCH ボタン 1〜5', what: '押すと、今の BASE で決まる「一発グリッチ」が約 1 秒かかる（5×5 = 25 種、→ 5 章）。', tip: 'PC の F1〜F5' },
      { find: { text: 'BASE' }, name: 'BASE', what: 'TAPE・DIGITAL・SIGNAL・BEEP・MELTDOWN の 5 段。一発グリッチの種類が変わる。', tip: 'PC の F6〜F10' },
      { find: { text: 'HOLD', nth: 0 }, name: 'HOLD / RELEASE', what: 'HOLD = 今効いているグリッチをつかんで、キーを離しても続ける。RELEASE = 全部止める。', tip: 'PC の Enter / BS' },
      { find: { text: 'GLITCH AMT' }, name: 'GLITCH AMT・LFO RATE・LFO DEPTH・FEEDBACK', what: 'グリッチの強さ・うねりの速さ・深さ・映像も音も自分に返るフィードバック。' },
      { find: { text: 'SPEED/PITCH' }, name: 'DIST・SPEED/PITCH・DRY/WET・MASTER', what: '歪み・再生の速さと音程・元の音と壊した音の割合・全体の音量。' },
      { find: { text: 'DIST TYPE' }, name: 'DIST TYPE・LFO →・CROSSTALK', what: '歪みの種類（CLIP / CRUSH）、LFO の行き先（VIDEO / AUDIO / BOTH）、キーの混線（ON で隣のキーも効いたり、押すたびに別の効果になったり）。', tip: 'PC の Tab・F11・F12' },
      { find: { text: 'HEAT' }, name: 'HEAT の LED', what: '熱（ストレス）。熱いほど速く赤く点滅し、画面が震え、勝手にグリッチが暴れる。固まらない。', tip: '→ 7 章' },
      { find: { sel: '.tk-key.role-glitch' }, name: 'Q〜［・A〜］：グリッチキー', what: '押している間だけ効く 24 種のグリッチ。映像と音が同時に壊れる（→ 8 章の表）。' },
      { find: { sel: '.tk-key.role-inst' }, name: 'Z〜＼：楽器キー', what: 'ビープ・ノイズ・キック・スネア・ハット・ドローン・ザップ・ブリップ・ブザー・チャープ（音階つき）。' },
      { find: { sel: '.tk-key.role-cue' }, name: '1〜0：キューポイント', what: '映像の 10%〜90%・0% へ飛ぶ。Shift＋数字で今の位置を登録。' },
      { find: { text: 'FREEZE' }, name: 'Space：FREEZE', what: '押している間、今の映像と音をつかんで繰り返す。' },
    ],
  },
  {
    id: 'pkt', index: 6, title: 'PAKU-PAKU 16', catch: '音を食べて、切って、並べろ！',
    desc: '子ども用の録音おもちゃ（ワニの口のスピーカー付き）を魔改造したサンプラー。16 パッド × 10 バンクに、録った声・読み込んだ音・最初から入っている 32 音を入れて叩く。ラックとスタジオではこの小さい版で叩いて録って自動作曲、音の作り込み（録音・チョップ・エフェクト・ベンド・パターン）は専用のページ（サンプラー編）で！',
    power: '左上の赤いボタン（パクッ、パクッと鳴って起動）。電源 OFF のときは Enter でも入る',
    parts: [
      { find: { sel: '[data-id="power"]' }, name: 'POWER', what: '電源の入／切。入れると「パクッ、パクッ」と鳴って、パッドが明るくなる。', tip: '電源 OFF のときは Enter キーでも入る' },
      { find: { sel: '.pkt-lcd' }, name: '液晶', what: 'いま選んでいるパッドと音の名前、入っている音の数。' },
      { find: { sel: '[data-a="melo"]' }, name: '♪ MELO / BASS', what: 'いま選んでいるパッドを、メロディ用・ベース用にする。シーケンサーの「♪」「BASS」の行で、そのパッドの音を音程を変えて弾ける。自動作曲もこれでメロディとベースを作る。', tip: '最初は B-09 TOY PNO と B-02 BASS C。自分で録った声をメロディにすると楽しい' },
      { find: { sel: '[data-id="bend"]' }, name: 'BEND', what: '上げるほど基板のジャンパー線が増えて、再生がカクカク・ザリザリに壊れる（0 ならサンプラーのページの設定）。', tip: 'MIDI の CC1（モジュレーション）でも動く' },
      { find: { sel: '[data-id="vol"]' }, name: 'VOL', what: '音量。' },
      { find: { sel: '[data-a="reload"]' }, name: '↻ 読み直す・サンプラーを開く', what: 'サンプラーのページで作った音（このブラウザに保存したもの）を読み直す／サンプラーのページを別のタブで開く。' },
      { find: { sel: '[data-a="stop"]' }, name: 'STOP', what: '鳴っている音を全部止める（ループしている音も）。' },
      { find: { sel: '.pkt-banks' }, name: 'バンク A〜J', what: '16 パッドの組を切り替える。音の入っているバンクは水色。', tip: 'PC の [ ]' },
      { find: { sel: '.pkt-pads' }, name: 'パッド 16 個', what: '左下が 1。押すと鳴る。♪ と BASS の印はメロディ用・ベース用のパッド。', tip: 'PC の Z X C V・A S D F・Q W E R・1 2 3 4 がパッドと同じ並び' },
    ],
  },
];
