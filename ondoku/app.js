// 教科書音読チェッカー Web版
// - アプリから共有されたリンク(#d=)なら、上達レポートを表示する
// - そうでなければ、英文を貼り付けてアプリに送る・Webで音読してみる、の画面
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SCHEME = 'u16ondoku';
  const KEY = 'ondoku.passage';

  // お手本の発音を読み上げる(ブラウザの読み上げ機能。端末の中で動く)
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.85;
    speechSynthesis.speak(u);
  }

  // ---- アプリの WordAligner.swift と同じ計算 ----
  const NUMBERS = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 20: 'twenty', 100: 'hundred' };
  // 比べる用の形:小文字・前後の記号を取る・数字を英単語に
  const normalize = (w) => { let s = w.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''); return NUMBERS[s] || s; };
  const tokenize = (text) => text.split(/\s+/).map(w => ({ display: w, norm: normalize(w) })).filter(t => t.norm);

  // 最長共通部分列:dp[i][j] = お手本の先頭i語と音読の先頭j語で、順番どおりにそろう単語の最大数
  // 同じ単語なら dp[i-1][j-1]+1、ちがえば max(dp[i-1][j], dp[i][j-1])。右下から逆にたどって、そろった単語に印
  function align(reference, spoken) {
    const ref = tokenize(reference), hyp = tokenize(spoken).map(t => t.norm);
    const n = ref.length, m = hyp.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
      dp[i][j] = ref[i - 1].norm === hyp[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    const ok = new Array(n).fill(false);
    for (let i = n, j = m; i > 0 && j > 0;) {
      if (ref[i - 1].norm === hyp[j - 1]) { ok[i - 1] = true; i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
    }
    return ref.map((t, i) => ({ ...t, ok: ok[i] }));
  }

  // ---- 上達レポート ----
  function showReport(data) {
    $('app').classList.add('hidden');
    $('report').classList.remove('hidden');
    const recs = (data.records || []).slice().sort((a, b) => a.d.localeCompare(b.d));
    const t = (r) => new Date(r.d.replace(' ', 'T')).getTime();
    const avg = (list, k) => list.length ? list.reduce((s, r) => s + r[k], 0) / list.length : 0;
    const first = recs.slice(0, 3), last = recs.slice(-3);
    // よく読めない単語 = 記録の中で「読めなかった」に出てきた回数が多い順
    const missCount = {};
    recs.forEach(r => r.miss.forEach(w => { missCount[w] = (missCount[w] || 0) + 1; }));
    const misses = Object.entries(missCount).sort((a, b) => b[1] - a[1]).slice(0, 30);
    $('report').innerHTML = `
      <div class="card"><div class="row" style="justify-content:space-between">
        <div><span class="shared-badge">アプリから共有されたレポート</span><h2 style="font-size:1.4rem;margin:8px 0 0">音読の上達レポート</h2></div>
        <button class="no-print" onclick="window.print()">印刷する</button></div>
        <div class="stats" style="margin-top:12px">
          <div class="stat"><b>${recs.length}</b><span>回 練習</span></div>
          <div class="stat"><b>${Math.round(avg(last, 'acc'))}%</b><span>最近3回の正確さ(はじめは${Math.round(avg(first, 'acc'))}%)</span></div>
          <div class="stat"><b>${Math.round(avg(last, 'wpm'))}</b><span>最近3回の速さ 語/分(はじめは${Math.round(avg(first, 'wpm'))})</span></div>
        </div></div>
      <div class="grid">
        <div class="card"><h2>正確さ(%)</h2>${Charts.lines([{ label: '正確さ', color: '#22994f', points: recs.map(r => ({ x: t(r), y: r.acc })) }], { yMax: 100 })}</div>
        <div class="card"><h2>速さ(語/分)</h2>${Charts.lines([{ label: '速さ', color: '#4466cc', points: recs.map(r => ({ x: t(r), y: r.wpm })) }], { yMax: Math.max(60, Math.ceil(Math.max(...recs.map(r => r.wpm), 0) / 20) * 20) })}</div>
      </div>
      <div class="card"><h2>よく読めない単語</h2>
        <p class="muted">タップするとお手本の発音が聞けます。数字は読めなかった回数。</p>
        ${misses.length ? misses.map(([w, c]) => `<button class="miss-chip" data-w="${esc(w)}">🔊 ${esc(w)} <small>×${c}</small></button>`).join('') : '<p class="muted">ありません。すごい!</p>'}
      </div>`;
    $('report').querySelectorAll('[data-w]').forEach(b => b.onclick = () => speak(b.dataset.w));
  }

  // ---- Web版 ----
  async function renderSend() {
    const text = $('passage').value.trim();
    const words = tokenize(text).length;
    $('count').textContent = `${words} 語`;
    Bridge.save(KEY, $('passage').value);
    if (!text) { $('send').innerHTML = '<p class="muted">英文を貼り付けると、ここにQRコードが出ます。</p>'; return; }
    if (!Bridge.supported) { $('send').innerHTML = '<p class="warn">このブラウザは古いため、アプリに送れません。</p>'; return; }
    const payload = await Bridge.encode({ v: 1, kind: 'ondoku', passage: text });
    Bridge.renderSendPanel($('send'), Bridge.appLink(SCHEME, 'import', payload), 'このQRコードをiPhoneで読み取ると、音読チェッカーアプリの「読む英文」に入ります。そのままマイクボタンで音読できます。');
  }

  function setupMic() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { $('mic-note').textContent = 'このブラウザは声の入力に対応していません。音読はiPhoneのアプリでどうぞ。'; return; }
    $('mic-note').textContent = '🎤を押して英文を読み、終わったらもう一度押します。ブラウザによっては声がサーバーに送られます(アプリはiPhoneの中で認識)。';
    $('mic').disabled = false;
    let rec = null, started = 0, finalText = '';
    $('mic').onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      finalText = ''; started = Date.now();
      rec.onresult = (e) => {
        finalText = Array.from(e.results).map(r => r[0].transcript).join(' ');
        $('live').textContent = finalText;
      };
      rec.onend = () => {
        rec = null; $('mic').classList.remove('on');
        showResult(finalText, (Date.now() - started) / 1000);
      };
      $('mic').classList.add('on'); $('live').textContent = '聞いています…';
      rec.start();
    };
  }

  // 正確さ = 読めた単語 ÷ 全部の単語 × 100、速さ = 読めた単語 ÷ かかった分
  function showResult(spoken, seconds) {
    const words = align($('passage').value, spoken);
    if (!spoken.trim() || !words.length) { $('result').innerHTML = '<p class="warn">声が聞き取れませんでした。</p>'; return; }
    const read = words.filter(w => w.ok).length;
    const acc = read / words.length * 100, wpm = seconds > 1 ? read / (seconds / 60) : 0;
    $('result').innerHTML = `
      <div class="grid" style="align-items:center;margin-top:12px">
        <div>${Charts.donut([{ label: 'ok', value: read, color: '#22994f' }, { label: 'miss', value: words.length - read, color: '#e2474f' }], { center: `${Math.round(acc)}%`, sub: '正確さ' })}</div>
        <div class="stats"><div class="stat"><b>${Math.round(wpm)}</b><span>語/分(速さ)</span></div><div class="stat"><b>${words.length - read}</b><span>語 まだ</span></div></div>
      </div>
      <p class="words">${words.map((w, i) => w.ok ? `<span class="w-ok">${esc(w.display)}</span>` : `<span class="w-miss" data-i="${i}">${esc(w.display)}</span>`).join(' ')}</p>
      <p class="muted">赤い単語をタップすると、お手本の発音が聞けます。</p>`;
    $('result').querySelectorAll('[data-i]').forEach(s => s.onclick = () => speak(words[Number(s.dataset.i)].norm));
  }

  function startApp() {
    $('passage').value = Bridge.load(KEY, 'Reading aloud is a great way to learn English. When you read a text out loud, you practice listening, speaking, and reading at the same time.');
    $('passage').addEventListener('input', () => { clearTimeout(window.__t); window.__t = setTimeout(renderSend, 300); });
    setupMic();
    renderSend();
  }

  // テストで使えるように、計算の部分を外から呼べるようにしておく
  window.OndokuWeb = { align };

  (async () => {
    const payload = Bridge.hashPayload();
    const data = payload && Bridge.supported ? await Bridge.decode(payload) : null;
    if (data && data.kind === 'ondoku' && data.records) showReport(data); else startApp();
  })();
})();
