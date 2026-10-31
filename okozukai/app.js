// 声のおこづかい帳 Web版
// - アプリから共有されたリンク(#d=)なら、月のレポートを表示する
// - そうでなければ、入力・月のまとめ・アプリに送る、の画面
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SCHEME = 'u16okozukai';
  const COLORS = { '食べ物': '#ff9440', '本': '#4d8ffa', '文房具': '#40c280', '遊び': '#f5669e', 'その他': '#9e94b3' };
  const KEY_ITEMS = 'okozukai.items', KEY_BUDGET = 'okozukai.budget';

  // ---- 共通の計算 ----

  // 「2026-10」の形の月の名前
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthTitle = (key) => { const [y, m] = key.split('-'); return `${y}年${Number(m)}月`; };
  const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

  // 項目ごとの合計(多い順)
  function totals(items) {
    const sum = {};
    items.forEach(i => { sum[i.cat] = (sum[i.cat] || 0) + i.amount; });
    return Object.keys(sum).map(cat => ({ label: cat, value: sum[cat], color: COLORS[cat] || COLORS['その他'] }))
      .sort((a, b) => b.value - a.value);
  }

  // 予算のようす(アプリの BudgetCalculator と同じ式)
  // 見込み = 使った額 ÷ 今日までの日数 × 月の日数(今月だけ)
  // 予算を超えた → 赤 / 8割以上 か 見込みが予算より多い → オレンジ / それ以外 → 緑
  function budgetStatus(key, spent, budget) {
    if (!budget) return { color: 'var(--accent)', text: '予算を入れると、残りがわかります' };
    const [y, m] = key.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const now = new Date();
    const projected = key === monthKey(now) ? Math.round(spent / Math.max(now.getDate(), 1) * days) : spent;
    if (spent > budget) return { color: 'var(--bad)', text: `予算を${yen(spent - budget)}オーバーしています` };
    if (spent >= budget * 0.8) return { color: 'var(--warn)', text: '予算の8割を使いました。ここから気をつけよう' };
    if (projected > budget) return { color: 'var(--warn)', text: `このペースだと月末に約${yen(projected)}になって、予算を超えそう!` };
    return { color: 'var(--good)', text: 'いい調子!' };
  }

  // 月のまとめ(円グラフ・予算・表)のHTML
  function monthHTML(key, items, budget, { editable = false } = {}) {
    const spent = items.reduce((s, i) => s + i.amount, 0);
    const list = totals(items);
    const status = budgetStatus(key, spent, budget);
    const ratio = budget ? Math.min(1, spent / budget) : 0;
    const rows = items.slice().sort((a, b) => b.date.localeCompare(a.date)).map(i => `
      <tr>
        <td>${esc(i.date.slice(5).replace('-', '/'))}</td>
        <td><span class="cat-dot" style="background:${COLORS[i.cat] || COLORS['その他']}"></span>${esc(i.item || i.cat)}</td>
        <td>${esc(i.cat)}</td>
        <td class="num">${yen(i.amount)}</td>
        ${editable ? `<td class="num no-print"><button class="danger" data-del="${esc(i.id)}">消す</button></td>` : ''}
      </tr>`).join('');
    return `
      <div class="stats" style="margin:8px 0">
        <div class="stat"><b>${yen(spent)}</b><span>使った</span></div>
        <div class="stat"><b>${budget ? yen(budget) : '—'}</b><span>予算</span></div>
        <div class="stat"><b style="color:${status.color}">${budget ? yen(Math.abs(budget - spent)) : '—'}</b><span>${budget && spent > budget ? 'オーバー' : 'のこり'}</span></div>
      </div>
      ${budget ? `<div class="budget-bar"><span style="width:${ratio * 100}%;background:${status.color}"></span></div>` : ''}
      <p class="message" style="background:color-mix(in srgb, ${status.color} 14%, transparent);color:${status.color}">${esc(status.text)}</p>
      <div class="grid" style="align-items:center">
        <div>${Charts.donut(list, { center: yen(spent), sub: '合計' })}</div>
        <div>${list.length ? Charts.bars(list.map(t => ({ ...t, note: `${Math.round(t.value / spent * 100)}%・${yen(t.value)}` }))) : '<p class="muted">この月の記録はありません</p>'}</div>
      </div>
      ${items.length ? `<table style="margin-top:12px"><thead><tr><th>日</th><th>何に</th><th>項目</th><th class="num">金額</th>${editable ? '<th class="no-print"></th>' : ''}</tr></thead><tbody>${rows}</tbody></table>` : ''}`;
  }

  // ---- アプリから共有されたレポート ----

  async function showReport(payloadText) {
    const data = Bridge.supported ? await Bridge.decode(payloadText) : null;
    if (!data || data.kind !== 'okozukai') {
      $('report').classList.remove('hidden');
      $('report-title').textContent = 'レポートを読み込めませんでした';
      $('report-body').innerHTML = `<div class="card"><p>${Bridge.supported ? 'リンクが途中で切れているかもしれません。' : 'このブラウザは古いため読み込めません。新しいSafariかChromeで開いてください。'}</p></div>`;
      $('app').classList.add('hidden');
      return;
    }
    $('report').classList.remove('hidden');
    $('app').classList.add('hidden');
    const key = data.month || monthKey(new Date());
    $('report-title').textContent = `${monthTitle(key)}のおこづかい`;
    document.title = `${monthTitle(key)}のおこづかいレポート`;
    $('report-body').innerHTML = `<div class="card">${monthHTML(key, data.items || [], data.budget)}</div>`;
    // このブラウザのWeb版にも入れておく(同じものは入れない)
    $('report-save').onclick = () => {
      const saved = Bridge.load(KEY_ITEMS, []);
      const exists = new Set(saved.map(i => `${i.date}|${i.amount}|${i.item}`));
      (data.items || []).forEach(i => {
        if (!exists.has(`${i.date}|${i.amount}|${i.item}`)) saved.push({ ...i, id: crypto.randomUUID(), fromApp: true, sent: true });
      });
      Bridge.save(KEY_ITEMS, saved);
      if (data.budget) Bridge.save(KEY_BUDGET, data.budget);
      $('report-save').textContent = '保存しました';
      $('report-save').disabled = true;
    };
  }

  // ---- ふつうのWeb版 ----

  let items = Bridge.load(KEY_ITEMS, []);
  let viewMonth = new Date();
  viewMonth.setDate(1);

  function saveItems() { Bridge.save(KEY_ITEMS, items); }

  // 月のまとめを描き直す
  function renderMonth() {
    const key = monthKey(viewMonth);
    $('month-title').textContent = monthTitle(key);
    $('next').disabled = key >= monthKey(new Date());
    const budget = Number(Bridge.load(KEY_BUDGET, 0)) || 0;
    $('budget').value = budget || '';
    $('month-body').innerHTML = monthHTML(key, items.filter(i => i.date.startsWith(key)), budget, { editable: true });
    $('month-body').querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
      items = items.filter(i => i.id !== btn.dataset.del);
      saveItems(); render();
    });
  }

  // まだアプリに送っていない記録を、リンクとQRコードにする
  async function renderSend() {
    const unsent = items.filter(i => !i.sent);
    $('mark-sent').classList.toggle('hidden', unsent.length === 0);
    if (!unsent.length) {
      $('send-summary').textContent = '送る記録はありません';
      $('send').innerHTML = '';
      return;
    }
    $('send-summary').textContent = `未送信 ${unsent.length}件・${yen(unsent.reduce((s, i) => s + i.amount, 0))}`;
    if (!Bridge.supported) { $('send').innerHTML = '<p class="warn">このブラウザは古いため、アプリに送れません。</p>'; return; }
    const payload = await Bridge.encode({ v: 1, kind: 'okozukai', items: unsent.map(({ date, amount, item, cat }) => ({ date, amount, item, cat })) });
    Bridge.renderSendPanel($('send'), Bridge.appLink(SCHEME, 'import', payload), 'iPhoneで読むとアプリに入ります');
  }

  function render() { renderMonth(); renderSend(); }

  // 文を読み取って、確認の欄に入れる
  function readText() {
    const text = $('say').value.trim();
    if (!text) return;
    const r = ExpenseParser.parse(text);
    $('c-amount').value = r.amount ?? '';
    $('c-item').value = r.item;
    $('c-cat').value = r.cat;
    $('c-date').value = Bridge.dayString();
    $('confirm').classList.remove('hidden');
    (r.amount ? $('c-save') : $('c-amount')).focus();
  }

  // 確認した内容を保存する
  function saveConfirmed() {
    const amount = parseInt($('c-amount').value, 10);
    if (!(amount > 0)) { $('c-amount').focus(); return; }
    items.push({ id: crypto.randomUUID(), date: $('c-date').value || Bridge.dayString(), amount,
      item: $('c-item').value.trim(), cat: $('c-cat').value, sent: false });
    saveItems();
    $('say').value = '';
    $('confirm').classList.add('hidden');
    viewMonth = new Date($('c-date').value || Date.now()); viewMonth.setDate(1);
    render();
  }

  // ブラウザの音声認識(使えるブラウザだけ)
  function setupMic() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { $('mic-note').textContent = ''; return; }
    $('mic').classList.remove('hidden');
    $('mic-note').textContent = '';
    let rec = null;
    $('mic').onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = 'ja-JP';
      rec.interimResults = true;
      rec.onresult = (e) => { $('say').value = Array.from(e.results).map(r => r[0].transcript).join(''); };
      rec.onend = () => { rec = null; $('mic').classList.remove('on'); readText(); };
      rec.onerror = () => { $('mic-note').textContent = '声がうまく聞き取れませんでした。'; };
      $('mic').classList.add('on');
      rec.start();
    };
  }

  function startApp() {
    $('c-cat').innerHTML = ExpenseParser.CATEGORIES.map(c => `<option>${c}</option>`).join('');
    $('read').onclick = readText;
    $('say').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) readText(); });
    $('c-save').onclick = saveConfirmed;
    $('c-cancel').onclick = () => $('confirm').classList.add('hidden');
    $('c-item').addEventListener('input', () => {
      const g = ExpenseParser.guessCategory($('c-item').value, $('c-item').value);
      if (g !== 'その他') $('c-cat').value = g;
    });
    $('prev').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); renderMonth(); };
    $('next').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); renderMonth(); };
    $('budget').onchange = () => { Bridge.save(KEY_BUDGET, Number($('budget').value) || 0); renderMonth(); };
    $('mark-sent').onclick = () => { items.forEach(i => { i.sent = true; }); saveItems(); renderSend(); };
    // パソコンで見ているときは、「アプリで記録」もQRコードにして、iPhoneで読めばすぐ録音できるようにする
    if (!Bridge.isIOS()) {
      $('open-record').textContent = '録音用QR';
      $('open-record').onclick = (e) => {
        e.preventDefault();
        Bridge.renderSendPanel($('send'), 'u16okozukai://record', 'iPhoneで読むとすぐ録音');
        $('send').scrollIntoView({ behavior: 'smooth' });
      };
    }
    setupMic();
    render();
  }

  const payload = Bridge.hashPayload();
  if (payload) showReport(payload); else startApp();
  window.addEventListener('hashchange', () => location.reload());
})();
