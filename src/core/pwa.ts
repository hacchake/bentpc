// 公開ページ（https）では、オフラインでも開けるように Service Worker（public/sw.js）を入れる。手元の開発・ファイルで開いたときは入れない
export function registerOffline(): void {
  if (!import.meta.env.PROD || location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
