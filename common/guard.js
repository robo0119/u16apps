// 思わぬエラーが起きても、画面が止まったように見えないようにする「安全ネット」
// - プログラムのエラーは、画面の下に短いお知らせを出す(何度も同じものは出さない)
// - インターネットが切れたら知らせ、つながったら消す
// 本来のエラー処理は各機能の中で行い、これは「取りこぼし」を受け止めるためのもの
(function () {
  'use strict';
  let box = null, hideTimer = null;
  const shown = new Set();

  /** 画面の下にお知らせを出す(kind:'error' か 'info')。ms ミリ秒で消える(0なら消さない) */
  function toast(text, kind = 'info', ms = 4000) {
    if (!document.body) return;
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.className = `show ${kind}`;
    clearTimeout(hideTimer);
    if (ms) hideTimer = setTimeout(() => { box.className = ''; }, ms);
  }

  /** エラーを1回だけ知らせる(同じ文は2回目から出さない。開発のためにコンソールにも残す) */
  function report(message) {
    const key = String(message || '').slice(0, 120);
    if (shown.has(key)) return;
    shown.add(key);
    toast('うまく動かない所がありました。もう一度ためすか、ページを読み込み直してください', 'error', 6000);
  }

  // 拡張機能など、このサイト以外から来たエラーは知らせない(ファイル名がこのサイトのものだけ)
  window.addEventListener('error', (e) => {
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    if (!e.message || /ResizeObserver loop/.test(e.message)) return;   // 害のないブラウザの警告
    report(e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // 中断(ユーザーが止めた音声など)はエラーではない
    if (r && (r.name === 'AbortError' || r.name === 'NotAllowedError')) return;
    report(r && r.message ? r.message : String(r));
  });

  // インターネットの接続
  window.addEventListener('offline', () => toast('インターネットが切れています(声の入力と同期は、つながってから)', 'error', 0));
  window.addEventListener('online', () => toast('インターネットにつながりました', 'info', 2500));

  window.Guard = { toast };
})();
