// Web MIDI。受け取ったメッセージをそのまま渡す（どのおもちゃに送るかは main.ts で決める）。
// 1 バイトのリアルタイムのメッセージ（クロック・START・STOP）は onRealtime へ（外の機器のテンポに合わせる用）
export async function startMidi(
  onMsg: (status: number, d1: number, d2: number) => void,
  onDevices: (names: string[]) => void,
  onRealtime?: (status: number, timeMs: number) => void,
): Promise<boolean> {
  if (!('requestMIDIAccess' in navigator)) return false;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return false;
  }
  const handler = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (d && d.length === 1 && d[0] >= 0xf8) onRealtime?.(d[0], e.timeStamp);
    else if (d && d.length >= 2) onMsg(d[0], d[1], d[2] ?? 0);
  };
  const bind = () => {
    const names: string[] = [];
    access.inputs.forEach((inp) => {
      inp.onmidimessage = handler;
      names.push(inp.name ?? 'MIDI');
    });
    onDevices(names);
  };
  access.onstatechange = bind;
  bind();
  return true;
}
