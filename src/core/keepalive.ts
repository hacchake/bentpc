// 音が止まったままにならないように：スマホで別のアプリに切り替えた・電話が来た・画面を消した後など、
// ブラウザが音の流れ（AudioContext）を止めることがある。戻ってきたら再開し、再開できなければ次にさわったときに再開する
export function keepAlive(ctx: AudioContext): void {
  const kick = () => { if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {}); };
  const onTouch = () => { kick(); if (ctx.state === 'running') remove(); };
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  let armed = false;
  const remove = () => { if (!armed) return; armed = false; events.forEach((e) => removeEventListener(e, onTouch, true)); };
  const arm = () => { if (armed) return; armed = true; events.forEach((e) => addEventListener(e, onTouch, true)); };
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') { remove(); return; }
    if (ctx.state === 'closed') return;
    if (document.visibilityState === 'visible') kick();
    arm();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  addEventListener('pageshow', kick);
}
