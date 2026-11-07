// 画面の演出(中身や計算は変えない)
// - 見出しの文字が1文字ずつ下から現れる([data-split])
// - タブを開いたとき・結果が出たとき、カードが少しずつずれて下から現れる。画面の外のカードは、スクロールして見えたときに現れる
// - 大きな数字は 0 から数えあげる
// - 使い方のシートを開く・閉じる
// 動きを減らす設定の人には、動きなしで表示する
(function () {
  'use strict';
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TARGETS = '.card, .stat-tile, .ch-topic, .weak-word, .hrow, .ch-rank, .seg';

  /** 見出しを1文字ずつに分けて、順番に現れるようにする(文字の間隔 = 35ミリ秒) */
  function split(el) {
    if (still || el.dataset.splitDone) return;
    el.dataset.splitDone = '1';
    const text = el.textContent;
    el.setAttribute('aria-label', text);
    el.innerHTML = [...text].map((c, i) => `<span class="ch" aria-hidden="true" style="animation-delay:${150 + i * 35}ms">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
  }

  // 画面に入ったら .in を付ける(見えた順に、1つ 70ミリ秒ずつ遅らせる)
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    let k = 0;
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      io.unobserve(el);
      setTimeout(() => el.classList.add('in'), Math.min(k++, 8) * 70);
    });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;

  /** root の中のカードを、下から現れるようにする */
  function reveal(root) {
    if (still || !io || !root) return;
    root.querySelectorAll(TARGETS).forEach(el => {
      if (el.closest('.hidden') || el.classList.contains('in')) return;
      el.classList.add('rv');
      io.observe(el);
    });
    // 念のため:何かの理由で現れなかったものは、少したったら必ず見せる
    setTimeout(() => root.querySelectorAll('.rv:not(.in)').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight) el.classList.add('in');
    }), 1500);
  }

  /** 数字を 0 から数えあげる(ms ミリ秒で。小数のない数字だけ) */
  function countUp(el, ms = 900) {
    if (!el) return;
    const to = Number(el.textContent);
    if (!Number.isFinite(to) || still) return;
    const t0 = performance.now();
    // 進み方 = 1 − (1 − 経過の割合)³(最後にゆっくり止まる)
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
    setTimeout(() => { el.textContent = to; }, ms + 300);   // 画面が裏にあっても、最後は必ず正しい数字
  }

  // ---- 使い方のシート ----
  const help = document.getElementById('help');
  document.getElementById('help-open')?.addEventListener('click', () => {
    if (help && help.showModal) help.showModal(); else if (help) help.setAttribute('open', '');
  });
  document.getElementById('help-close')?.addEventListener('click', () => help && (help.close ? help.close() : help.removeAttribute('open')));
  // シートの外(暗いところ)を押しても閉じる
  help?.addEventListener('click', (e) => { if (e.target === help && help.close) help.close(); });

  document.querySelectorAll('[data-split]').forEach(split);
  window.Motion = { reveal, countUp, split };
  // はじめに開いたタブ
  reveal(document.querySelector('main section:not(.hidden)'));
})();
