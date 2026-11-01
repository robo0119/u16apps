// パスワードの入口(どのページも最初にこれを読む)
// 合っていれば、この端末に覚えておき、次からは聞かない
// 注意:サーバーを使わない仕組みなので、本格的な鍵ではなく「知らない人が見ないための入口」
(function () {
  'use strict';
  // パスワードそのものは書かず、SHA-256 にしたものだけを置く
  const HASH = '29881aad8730c5ab11d275376323d8e4ff4179aae8ccb6c13fe4902137e162ef';
  const KEY = 'sotaapp.unlocked';

  // この端末で一度入っていれば、何もしない
  try { if (localStorage.getItem(KEY) === HASH) return; } catch (e) { /* 保存できないブラウザ */ }

  // 中身が見えないように、最初はページを隠す
  const hide = document.createElement('style');
  hide.id = 'gate-hide';
  hide.textContent = 'body > *:not(#gate) { display: none !important; }';
  document.documentElement.appendChild(hide);

  // 文字を SHA-256 にする
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 入口の画面を出す
  function show() {
    const gate = document.createElement('div');
    gate.id = 'gate';
    gate.innerHTML = `
      <style>
        #gate { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
                background: var(--bg, #f6f5f1); z-index: 9999; padding: 16px; }
        #gate form { background: var(--card, #fff); border-radius: 20px; padding: 28px 24px; width: 100%; max-width: 340px;
                     box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }
        #gate h1 { margin: 0 0 4px; font-size: 1.5rem; }
        #gate p { margin: 0 0 18px; color: var(--muted, #6b7078); font-size: .9rem; }
        #gate input { width: 100%; font-size: 1.1rem; text-align: center; margin-bottom: 12px; }
        #gate button { width: 100%; }
        #gate .err { color: var(--bad, #e2474f); font-size: .85rem; min-height: 1.2em; margin: 8px 0 0; }
      </style>
      <form autocomplete="off">
        <h1>Sotaのapp</h1>
        <p>パスワードを入力</p>
        <input type="password" id="gate-pw" inputmode="text" autocapitalize="off" autofocus>
        <button type="submit">入る</button>
        <div class="err" id="gate-err"></div>
      </form>`;
    document.body.appendChild(gate);
    const input = gate.querySelector('#gate-pw');
    input.focus();
    gate.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await sha256(input.value.trim()) === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch (err) { /* 覚えられなくても入れる */ }
        gate.remove();
        document.getElementById('gate-hide')?.remove();
      } else {
        gate.querySelector('#gate-err').textContent = 'パスワードが違います';
        input.select();
      }
    });
  }

  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();
