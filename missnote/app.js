// ミス診断ノート Web版
// - アプリから共有されたリンク(#d=)なら、ミス診断レポートを表示する
// - そうでなければ、写真なしの手早い記録・分析・アプリに送る、の画面
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SCHEME = 'u16missnote';
  const KEY = 'missnote.problems';
  // アプリの Models.swift と同じ教科・ミスの種類・色・アドバイス
  const SUBJECTS = { '数学': '#3373d9', '英語': '#e65973', '国語': '#409e66', '理科': '#1aa6bf', '社会': '#bf8c33' };
  const MISTAKES = {
    '計算ミス': { color: '#ff9500', advice: '途中式を省かずに書き、最後に見直しの時間を1分とろう。' },
    '知識不足': { color: '#007aff', advice: '教科書やノートに戻って、覚えることをカードにまとめよう。' },
    '読み違い': { color: '#af52de', advice: '問題文の条件や「〜でないもの」に線を引くクセをつけよう。' },
    '時間切れ': { color: '#8e8e93', advice: '時間を計って解く練習をして、わからない問題は後回しにしよう。' },
  };

  // 分析(アプリの MistakeAnalysis と同じ式)
  // 教科の割合 = その教科の問題数 ÷ 全部の問題数
  // ミスの割合 = その種類のタグ数 ÷ 全部のタグ数(1問に複数つくので、合計が100%になるようにタグで数える)
  function analyze(problems) {
    const bySubject = Object.keys(SUBJECTS).map(s => ({ label: s, value: problems.filter(p => p.s === s).length, color: SUBJECTS[s] }));
    const tags = problems.flatMap(p => p.m);
    const byMistake = Object.keys(MISTAKES).map(m => ({ label: m, value: tags.filter(t => t === m).length, color: MISTAKES[m].color }));
    const top = Math.max(0, ...byMistake.map(b => b.value));
    return { bySubject, byMistake, tagCount: tags.length, tops: top > 0 ? byMistake.filter(b => b.value === top) : [] };
  }

  // 分析のカード(レポートとWeb版の両方で使う)
  function analysisHTML(problems, { editable = false } = {}) {
    if (!problems.length) return '<div class="card"><p class="muted">まだ記録がありません。</p></div>';
    const a = analyze(problems);
    const pct = (v, total) => `${Math.round(v / Math.max(total, 1) * 100)}%`;
    const reviewed = problems.reduce((s, p) => s + (p.rv || 0), 0), solved = problems.reduce((s, p) => s + (p.ok || 0), 0);
    const list = problems.slice().sort((x, y) => y.d.localeCompare(x.d)).map((p, i) => `
      <div class="problem">
        <span class="tag" style="background:${SUBJECTS[p.s] || '#888'}">${esc(p.s)}</span> <b>${esc(p.u || '(単元なし)')}</b>
        <span class="muted">${esc(p.d)}</span>
        ${p.m.map(m => `<span class="tag" style="background:${(MISTAKES[m] || {}).color || '#888'}">${esc(m)}</span>`).join(' ')}
        ${p.rv ? `<span class="muted">復習 ${p.rv}回中 ${p.ok}回 解けた</span>` : ''}
        ${editable ? `<button class="danger no-print" data-del="${i}">消す</button>` : ''}
        ${p.memo ? `<div class="memo">📝 ${esc(p.memo)}</div>` : ''}
      </div>`).join('');
    return `
      <div class="card">
        <h2>あなたに一番多いミス</h2>
        ${a.tops.map(t => `<div class="top-mistake" style="color:${t.color}">${esc(t.label)} ${pct(t.value, a.tagCount)}</div><p>${esc(MISTAKES[t.label].advice)}</p>`).join('')}
        <div class="stats">
          <div class="stat"><b>${problems.length}</b><span>問 記録</span></div>
          <div class="stat"><b>${reviewed}</b><span>回 復習</span></div>
          <div class="stat"><b>${reviewed ? pct(solved, reviewed) : '—'}</b><span>復習で解けた割合</span></div>
        </div>
      </div>
      <div class="grid">
        <div class="card"><h2>ミスの種類別</h2>${Charts.bars(a.byMistake.map(b => ({ ...b, note: `${b.value}件・${pct(b.value, a.tagCount)}` })))}</div>
        <div class="card"><h2>教科別</h2>${Charts.donut(a.bySubject.filter(b => b.value), { center: `${problems.length}問`, sub: '合計' })}
          <div class="legend" style="justify-content:center">${a.bySubject.filter(b => b.value).map(b => `<span class="legend-item"><i style="background:${b.color}"></i>${b.label} ${pct(b.value, problems.length)}</span>`).join('')}</div></div>
      </div>
      <div class="card"><h2>問題の一覧</h2>${list}</div>`;
  }

  // ---- アプリから共有されたレポート ----
  function showReport(data) {
    $('app').classList.add('hidden');
    $('report').classList.remove('hidden');
    $('report').innerHTML = `
      <div class="card"><div class="row" style="justify-content:space-between">
        <div><span class="shared-badge">アプリから共有されたレポート</span><h2 style="font-size:1.4rem;margin:8px 0 0">ミス診断レポート</h2></div>
        <button class="no-print" onclick="window.print()">印刷する</button></div>
        <p class="muted">写真は入っていません。データはリンクの「#」より後ろにあり、サーバーには送られていません。</p></div>
      ${analysisHTML(data.problems || [])}`;
  }

  // ---- Web版 ----
  let problems = Bridge.load(KEY, []);
  let subject = '数学';
  const chosen = new Set();

  function renderToggles() {
    $('subject').innerHTML = Object.keys(SUBJECTS).map(s => `<button class="toggle ${s === subject ? 'on' : ''}" style="--c:${SUBJECTS[s]}" data-s="${s}">${s}</button>`).join('');
    $('mistakes').innerHTML = Object.keys(MISTAKES).map(m => `<button class="toggle ${chosen.has(m) ? 'on' : ''}" style="--c:${MISTAKES[m].color}" data-m="${m}">${m}</button>`).join('');
    $('subject').querySelectorAll('button').forEach(b => b.onclick = () => { subject = b.dataset.s; renderToggles(); });
    $('mistakes').querySelectorAll('button').forEach(b => b.onclick = () => { chosen.has(b.dataset.m) ? chosen.delete(b.dataset.m) : chosen.add(b.dataset.m); renderToggles(); });
  }

  function render() {
    Bridge.save(KEY, problems);
    const sorted = problems.slice().sort((x, y) => y.d.localeCompare(x.d));
    $('analysis').innerHTML = analysisHTML(sorted, { editable: true });
    $('analysis').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      problems = problems.filter(p => p !== sorted[Number(b.dataset.del)]); render();
    });
    renderSend();
  }

  async function renderSend() {
    const unsent = problems.filter(p => !p.sent);
    $('mark-sent').classList.toggle('hidden', !unsent.length);
    if (!unsent.length) { $('send-summary').textContent = '送る問題はありません'; $('send').innerHTML = ''; return; }
    $('send-summary').textContent = `未送信 ${unsent.length}問`;
    if (!Bridge.supported) { $('send').innerHTML = '<p class="warn">このブラウザは古いため、アプリに送れません。</p>'; return; }
    const payload = await Bridge.encode({ v: 1, kind: 'missnote', problems: unsent.map(({ d, s, u, m, memo }) => ({ d, s, u, m, memo, rv: 0, ok: 0 })) });
    Bridge.renderSendPanel($('send'), Bridge.appLink(SCHEME, 'import', payload), 'iPhoneで読むとアプリに入ります');
  }

  function startApp() {
    $('date').value = Bridge.dayString();
    renderToggles();
    $('add').onclick = () => {
      if (!chosen.size) { $('add-note').textContent = 'ミスの種類を1つ以上選んでください'; return; }
      problems.push({ d: $('date').value || Bridge.dayString(), s: subject, u: $('unit').value.trim(),
        m: Object.keys(MISTAKES).filter(m => chosen.has(m)), memo: $('memo').value.trim(), sent: false });
      $('unit').value = ''; $('memo').value = ''; chosen.clear(); $('add-note').textContent = '記録しました';
      renderToggles(); render();
    };
    $('mark-sent').onclick = () => { problems.forEach(p => { p.sent = true; }); render(); };
    render();
  }

  (async () => {
    const payload = Bridge.hashPayload();
    const data = payload && Bridge.supported ? await Bridge.decode(payload) : null;
    if (data && data.kind === 'missnote') showReport(data); else startApp();
  })();
})();
