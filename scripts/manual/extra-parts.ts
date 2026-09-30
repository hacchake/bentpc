// 攻略本：自動作曲ユニットとシーケンサーの部品（番号の吹き出し用）
import type { PartDef } from './parts';

export const COMPOSER_PARTS: PartDef[] = [
  { find: { sel: '.dome.compose' }, name: '自動作曲', what: '押すたびに新しいシードで曲を作り、シーケンサーに書き込んで、頭から鳴らす。' },
  { find: { sel: '.cp-seed' }, name: 'SEED', what: 'いまの曲のシード（種）の番号。数字を入れて Enter で、そのシードの曲を作る。' },
  { find: { text: 'この設定で作り直す' }, name: 'この設定で作り直す', what: 'シードはそのまま、変えた STYLE・壊れ度・長さ・BPM で作り直す。' },
  { find: { text: 'STYLE' }, name: 'STYLE', what: '素朴・ビート・アンビエント・ノイズ・崩壊の 5 つ（→ 9 章の表）。' },
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
