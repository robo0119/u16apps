// アプリとWebをつなぐ仕組み(iPhoneアプリの WebBridge.swift と同じ約束)
//   データ → JSON → 圧縮(deflate-raw)→ URLで使える文字(base64url)
//   アプリ → Web : このページのURLの「#d=データ」(# より後ろはサーバーに送られない)
//   Web → アプリ : u16xxxx://import?d=データ(iPhoneで開くとアプリが起動する)
(function (global) {
  'use strict';

  // base64url ⇔ バイト列
  function toBase64Url(bytes) {
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(text) {
    let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  // ストリームを最後まで読んでバイト列にする
  async function readAll(stream) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const Bridge = {
    // この端末のブラウザで圧縮が使えるか(Safari 16.4以降・Chrome などで使える)
    supported: typeof CompressionStream !== 'undefined',

    // データ → リンクの文字
    async encode(obj) {
      const json = new TextEncoder().encode(JSON.stringify(obj));
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return toBase64Url(await readAll(stream));
    },

    // リンクの文字 → データ(こわれていたら null)
    async decode(text) {
      try {
        const stream = new Blob([fromBase64Url(text)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return JSON.parse(new TextDecoder().decode(await readAll(stream)));
      } catch (e) {
        return null;
      }
    },

    // URLの「#d=…」を取り出す(無ければ null)
    hashPayload() {
      const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    },

    // アプリを開くリンク(例:u16okozukai://import?d=…)
    appLink(scheme, action, payload) {
      return `${scheme}://${action}${payload ? '?d=' + payload : ''}`;
    },

    // iPhone / iPad で見ているか
    isIOS() {
      return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    // このブラウザの中だけに保存する(サーバーには送らない)
    load(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    save(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない設定のブラウザ */ }
    },

    // 「アプリに送る」パネルを作る:iPhoneならボタン、パソコンならQRコード
    // link:アプリを開くリンク、note:説明文
    renderSendPanel(container, link, note) {
      const qr = (() => { try { return global.QR.toSVG(link, { ecl: 'L' }); } catch (e) { return null; } })();
      container.innerHTML = `
        <div class="send-panel">
          ${qr ? `<div class="qr">${qr}</div>` : '<p class="warn">データが多すぎてQRコードにできません。数を減らしてください。</p>'}
          <div class="send-text">
            <p>${note}</p>
            <ol class="steps">
              <li>iPhoneの<b>カメラ</b>でこのQRコードを写す</li>
              <li>出てきた通知をタップ →「開く」</li>
              <li>アプリで内容を確かめて「取り込む」</li>
            </ol>
            <a class="button" href="${link}">iPhoneでこのページを見ているときはここをタップ</a>
          </div>
        </div>`;
    },

    // 日付 ⇔ "2026-10-30"
    dayString(date) {
      const d = date || new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    // HTMLに入れても安全な文字にする(<>& などを変換)
    esc(text) {
      return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
  };

  global.Bridge = Bridge;
})(window);
