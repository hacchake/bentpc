// 攻略本：自動作曲ユニットとシーケンサーの部品（番号の吹き出し用）
import type { PartDef } from './parts';

export const COMPOSER_PARTS: PartDef[] = [
  { find: { sel: '.dome.compose' }, name: '自動作曲', what: '押すたびに新しいシードで曲を作り、シーケンサーに書き込んで、頭から鳴らす。' },
  { find: { sel: '.cp-seed' }, name: 'SEED', what: 'いまの曲のシード（種）の番号。数字を入れて Enter で、そのシードの曲を作る。' },
  { find: { text: 'この設定で作り直す' }, name: 'この設定で作り直す', what: 'シードはそのまま、変えた STYLE・壊れ度・長さ・BPM で作り直す。' },
  { find: { sel: '.cp-style' }, name: 'STYLE（◀ ▶）', what: '26 種類：演歌・音頭・レゲエ・スカ・ボサノバ・ジャズ・ハウス・ドラムンベース・IDM など。◀ ▶ で順に、まん中を押すと一覧から選べる。下にそのスタイルの説明（→ 9 章の表）。' },
  { find: { sel: '.cp-chips' }, name: '参加するおもちゃ', what: '押して光ったおもちゃが、同じ 1 つの曲に入る。ビートは 1 台が刻み、メロディは 2 小節ずつ掛け合い。点線のおもちゃ（このパネルの持ち主）はいつも参加。' },
  { find: { text: '壊れ度' }, name: '壊れ度', what: 'グリッチ・歪み・クラッシュの量（0〜100%）。' },
  { find: { text: 'LENGTH' }, name: 'LENGTH', what: '曲の長さ：30 秒・1 分・2 分・3 分。' },
  { find: { text: 'BPM' }, name: 'BPM', what: 'テンポ。STYLE を変えると、そのスタイルのふつうのテンポに戻る。' },
  { find: { sel: '.cp-sec' }, name: 'セクション選び ＋ このセクションだけ作り直す', what: '選んだセクション（サビなど）だけを作り直す。ほかの場所は 1 音も変わらない。' },
  { find: { text: '▶ 再生 / ■ 停止' }, name: '再生 / 停止', what: '曲を頭から鳴らす・止める。' },
  { find: { text: '🔗 URL をコピー' }, name: 'URL をコピー', what: 'この曲の URL をコピー。送った相手が開くと、同じ曲が作られる。' },
];

export const SEQ_PARTS: PartDef[] = [
  { find: { sel: '[data-id="play"]' }, name: '⏮ ▶ ● REC', what: '最初へ・再生 / 停止・手で弾いた操作の録音（● の付いたトラックへ重ね録り）。' },
  { find: { sel: '[data-id="pos"]' }, name: '位置', what: '小節.拍・時間・いまのセクション名。' },
  { find: { sel: '[data-id="bpm"]' }, name: 'BPM・長さ', what: 'テンポと、曲の長さ（小節）。' },
  { find: { sel: '[data-id="loop"]' }, name: 'LOOP・グリッド・クリック', what: 'ループ範囲をくり返す・音符を置くマス目の細かさ・メトロノーム。' },
  { find: { sel: '[data-id="seed"]' }, name: 'SEED', what: '曲の乱数の種。頭から再生すると、おもちゃを新品にしてこの種で鳴らすので、毎回同じ音・同じグリッチ。' },
  { find: { sel: '[data-id="save"]' }, name: '保存・読込', what: '曲を JSON ファイルに保存・読み込み（曲はこのブラウザにも自動で保存される）。' },
  { find: { text: 'WAV' }, name: 'WAV・WebM・MIDI', what: '書き出し。WAV = 音（速く作る）、WebM = 映像込み（曲の長さだけかかる）、MIDI = 将来の VST・DAW 用。' },
  { find: { sel: '.arr-ruler' }, name: '目盛り', what: '上段 = セクション名（ダブルクリックで追加・名前変更）、下段 = クリックで再生位置、ドラッグでループ範囲。' },
  { find: { sel: '.arr-main' }, name: 'トラックと行', what: '左がトラック名（M ミュート・🔒 鍵・● 録音先・＋ 行を追加）、右が音符とツマミの動き。' },
];

export const SAMPLER_PARTS: PartDef[] = [
  { find: { sel: '.pk-lcd' }, name: '液晶', what: 'いまのパッド（A-01 など）・音の名前と長さ・波形（赤い線が START と END）。下の段はお知らせ・テンポ・入っているエフェクト・入力と出力の音の大きさ。PATTERN・SONG タブではパターンの中身になる。' },
  { find: { sel: '.pk-pages' }, name: 'ノブのページ', what: 'SOUND（音量・パン・音程・微調整）・FILTER・ENV・SAMPLE（START・END・LOOP・強さの効き）・MIX（ミュートグループ・送り先・音の BPM）・FX・SEQ・BEND。' },
  { find: { sel: '#pk-k0' }, name: 'ノブ 4 つ', what: 'ページの名前のとおりに働く。上下にドラッグ、ダブルクリックで初期値。' },
  { find: { sel: '.pk-tabs' }, name: '機能タブ', what: 'PAD（録音・再生のしかた）・PLAY（ロール・16 レベル・テンポ）・EDIT（波形・チョップ）・FX・BEND・PATTERN・SONG で、下のボタンが替わる。' },
  { find: { sel: '#pk-rec' }, name: 'REC / RESAMPLE', what: 'REC → 録るパッドを押す → 声や音を入れる → REC で止める。RESAMPLE は自分が鳴らしている音を録る。' },
  { find: { sel: '#pk-gate' }, name: 'GATE・LOOP・REV・POLY', what: '押している間だけ鳴る・くり返す・逆再生・押し直しで重ねる（パッドごと）。' },
  { find: { sel: '#pk-master' }, name: 'VOL と STOP', what: '全体の音量と、鳴っている音を全部止めるボタン（パターンの再生も止まる）。' },
  { find: { sel: '.pk-banks' }, name: 'バンク A〜J', what: '16 パッド × 10 バンク = 160 音。音の入っているバンクは水色。' },
  { find: { sel: '.pk-pads' }, name: 'パッド 16 個', what: '左下が 1。押すと鳴って、そのパッドを選ぶ。上の方を押すほど強い。モードによってはパターン選び・ステップ（16 分のマス）になる。' },
];
