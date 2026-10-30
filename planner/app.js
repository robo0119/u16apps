// 学習プランナー Web版
// - アプリから共有されたリンクに今日の計画(report)があれば、レポートを表示する
// - 設定だけのリンクなら、エディターに読み込む
// - エディターで入力したものは、QRコードでアプリに送る
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SCHEME = 'u16planner';
  const KEY = 'planner.setup';
  const DAYS = ['', '日', '月', '火', '水', '木', '金', '土'];
  const PALETTE = ['#4078f2', '#ed5c6b', '#33ad73', '#f7992e', '#9461e6', '#1aa8bf', '#c7854d', '#808c9e'];
  const color = (setup, name) => PALETTE[Math.max(0, setup.subjects.indexOf(name)) % PALETTE.length];

  // 時刻 ⇔ 「0時からの分」
  const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
  const toTime = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

  const emptySetup = () => ({
    v: 1, kind: 'planner', subjects: [], timetable: [],
    life: { wake: 390, sleep: 1380, schoolStart: 500, schoolEnd: 950, commute: 20, living: 150 },
    weekly: [], events: [], scores: [],
  });

  // ---- アプリと同じ計算(Engine/AvailableTime.swift)----
  // 勉強時間 = 起きている − 学校 − 予定(重なりはまとめる)− 生活 − 休憩(空き時間の1/6)
  function availableTime(setup, weekday) {
    const L = setup.life;
    const wake = L.wake, sleep = L.sleep <= L.wake ? L.sleep + 1440 : L.sleep;
    const awake = sleep - wake;
    const slots = setup.timetable;
    const isSchool = slots.length === 0 ? weekday >= 2 && weekday <= 6 : slots.some(s => s.w === weekday);
    const clip = (b) => { const s = Math.max(b.s, wake), e = Math.min(b.e, sleep); return e > s ? { s, e } : null; };
    const school = isSchool ? clip({ s: L.schoolStart - L.commute, e: L.schoolEnd + L.commute }) : null;
    const blocks = [school, ...setup.weekly.filter(w => w.w === weekday).map(w => clip({ s: w.s, e: w.e }))]
      .filter(Boolean).sort((a, b) => a.s - b.s);
    const merged = [];
    blocks.forEach(b => { const last = merged[merged.length - 1]; if (last && b.s <= last.e) last.e = Math.max(last.e, b.e); else merged.push({ ...b }); });
    const busy = merged.reduce((sum, b) => sum + (b.e - b.s), 0);
    const schoolMin = school ? school.e - school.s : 0;
    const living = Math.min(L.living, Math.max(0, awake - busy));
    const free = Math.max(0, awake - busy - living);
    const breaks = Math.ceil(free / 6);
    const study = Math.max(0, Math.floor((free - breaks) / 5) * 5);
    return { awake, school: schoolMin, events: busy - schoolMin, living, breaks: free - study, study };
  }

  // ---- レポート(アプリから共有された今日の計画)----
  function showReport(data) {
    const r = data.report;
    const t = r.time;
    const total = r.tasks.reduce((s, x) => s + x.m, 0);
    const done = r.tasks.filter(x => x.done).reduce((s, x) => s + x.m, 0);
    const today = new Date(r.date + 'T00:00:00');
    const upcoming = data.events.filter(e => e.k !== '行事' && e.d >= r.date).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
    const daysTo = (d) => Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
    const periods = Math.max(6, ...data.timetable.map(s => s.p));
    $('report').innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div><span class="shared-badge">アプリから共有された計画</span>
            <h2 style="font-size:1.4rem;margin:8px 0 0">${today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}の勉強</h2></div>
          <div class="row no-print"><button onclick="window.print()">印刷する</button>
            <a class="button secondary" href="#" id="to-editor">この設定をWebで編集</a></div>
        </div>
        <div class="stats" style="margin-top:12px">
          <div class="stat"><b>${total}分</b><span>今日の勉強</span></div>
          <div class="stat"><b>${total ? Math.round(done / total * 100) : 0}%</b><span>終わった</span></div>
          <div class="stat"><b>${r.tasks.length}</b><span>タスク</span></div>
        </div>
      </div>
      <div class="grid">
        <div class="card"><h2>今日のタスクと、選んだ理由</h2>
          ${r.tasks.length ? r.tasks.map(x => `
            <div class="task"><span class="check">${x.done ? '✅' : '⬜️'}</span>
              <div><span class="tag" style="background:${color(data, x.s)}">${esc(x.s)}</span> <b>${x.m}分</b> ${esc(x.c)}${x.carry ? ' <span class="warn">(やり残し)</span>' : ''}
                <div class="reason">💡 ${esc(x.r)}</div></div></div>`).join('') : '<p class="muted">今日は予定がいっぱいで、勉強の時間はとれません。</p>'}
        </div>
        <div>
          <div class="card"><h2>使える時間の計算</h2>
            <table class="formula">
              <tr><td></td><td>起きている時間</td><td class="num">${t[0]}分</td></tr>
              <tr><td>−</td><td>学校(通学ふくむ)</td><td class="num">${t[1]}分</td></tr>
              <tr><td>−</td><td>部活・塾などの予定</td><td class="num">${t[2]}分</td></tr>
              <tr><td>−</td><td>食事・お風呂など</td><td class="num">${t[3]}分</td></tr>
              <tr><td>−</td><td>休憩(50分ごとに10分)</td><td class="num">${t[4]}分</td></tr>
              <tr><td>=</td><td><b>勉強に使える時間</b></td><td class="num"><b>${t[5]}分</b></td></tr>
            </table></div>
          <div class="card"><h2>次のテスト</h2>
            ${upcoming.length ? upcoming.map(e => `<p style="margin:4px 0"><b>${esc(e.t)}</b> ${e.d.slice(5).replace('-', '/')} <span class="${daysTo(e.d) <= 7 ? 'bad' : 'muted'}">あと${daysTo(e.d)}日</span> <span class="muted">${esc(e.subs.length ? e.subs.join('・') : '全教科')}</span></p>`).join('') : '<p class="muted">登録されていません</p>'}
          </div>
        </div>
      </div>
      <div class="card"><h2>苦手度(0〜100)</h2>
        ${Charts.bars(r.weakness.slice().sort((a, b) => b.w - a.w).map(w => ({ label: w.s, value: w.w, color: color(data, w.s), note: Math.round(w.w) })), { max: 100 })}
        <p class="muted">苦手度 = 100 − 最近3回の成績の重みつき平均(新しい順に3:2:1)。最新がその前より10以上下がると+10。成績が無い教科は50。</p>
      </div>
      ${data.timetable.length ? `<div class="card"><h2>時間割</h2><div style="overflow-x:auto">${timetableHTML(data, periods, false)}</div></div>` : ''}`;
    $('to-editor').onclick = (e) => {
      e.preventDefault();
      const setup = { ...data }; delete setup.report;
      Bridge.save(KEY, setup);
      location.href = location.pathname;  // # を消してエディターを開く
    };
  }

  // 時間割の表(editable なら選べる)
  function timetableHTML(setup, periods, editable) {
    let html = '<tr><th></th>' + [2, 3, 4, 5, 6, 7].map(d => `<th>${DAYS[d]}</th>`).join('') + '</tr>';
    for (let p = 1; p <= periods; p++) {
      html += `<tr><th>${p}</th>`;
      for (let d = 2; d <= 7; d++) {
        const slot = setup.timetable.find(s => s.w === d && s.p === p);
        if (editable) {
          html += `<td><select data-w="${d}" data-p="${p}" style="${slot ? `background:${color(setup, slot.s)};color:#fff` : ''}">
            <option value=""></option>${setup.subjects.map(s => `<option ${slot && slot.s === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>`;
        } else {
          html += `<td><div class="cell" style="background:${slot ? color(setup, slot.s) : 'var(--line)'}">${slot ? esc(slot.s) : ''}</div></td>`;
        }
      }
      html += '</tr>';
    }
    return `<table class="tt">${html}</table>`;
  }

  // ---- エディター ----
  let setup;
  const save = () => { Bridge.save(KEY, setup); renderSend(); renderForecast(); };

  function renderSubjects() {
    $('subjects').innerHTML = setup.subjects.map((s, i) =>
      `<span class="chip" style="background:${PALETTE[i % PALETTE.length]}">${esc(s)}<button data-i="${i}" aria-label="消す">×</button></span>`).join('') ||
      '<span class="muted">まだ教科がありません</span>';
    $('subjects').querySelectorAll('button').forEach(b => b.onclick = () => {
      const name = setup.subjects[b.dataset.i];
      setup.subjects.splice(b.dataset.i, 1);
      setup.timetable = setup.timetable.filter(t => t.s !== name);
      renderAll();
    });
    $('e-subjects').innerHTML = setup.subjects.map(s => `<label><input type="checkbox" value="${esc(s)}">${esc(s)}</label>`).join('');
    $('s-inputs').innerHTML = setup.subjects.map(s => `<div><label>${esc(s)}</label><input type="number" data-score="${esc(s)}" placeholder="点数"><input type="number" step="0.1" data-dev="${esc(s)}" placeholder="偏差値(任意)" style="margin-top:4px"></div>`).join('');
  }

  function renderTimetable() {
    const periods = Number($('periods').value) || 6;
    $('timetable').outerHTML = timetableHTML(setup, periods, true).replace('<table class="tt">', '<table class="tt" id="timetable">');
    $('timetable').querySelectorAll('select').forEach(sel => sel.onchange = () => {
      const w = Number(sel.dataset.w), p = Number(sel.dataset.p);
      setup.timetable = setup.timetable.filter(s => !(s.w === w && s.p === p));
      if (sel.value) setup.timetable.push({ w, p, s: sel.value });
      renderTimetable(); save();
    });
  }

  function renderLife() {
    ['wake', 'sleep', 'schoolStart', 'schoolEnd'].forEach(k => { $(k).value = toTime(setup.life[k]); });
    $('commute').value = setup.life.commute;
    $('living').value = setup.life.living;
  }

  // 表とその「消す」ボタンを作る
  function listTable(id, rows, header, onDelete) {
    $(id).innerHTML = rows.length ? `<thead><tr>${header.map(h => `<th>${h}</th>`).join('')}<th></th></tr></thead><tbody>` +
      rows.map((cells, i) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}<td class="num"><button class="danger" data-i="${i}">消す</button></td></tr>`).join('') + '</tbody>'
      : '<tr><td class="muted">まだありません</td></tr>';
    $(id).querySelectorAll('button').forEach(b => b.onclick = () => { onDelete(Number(b.dataset.i)); renderAll(); });
  }

  function renderLists() {
    setup.weekly.sort((a, b) => a.w - b.w || a.s - b.s);
    listTable('weekly-table', setup.weekly.map(w => [DAYS[w.w], esc(w.t), `${toTime(w.s)}〜${toTime(w.e)}`]), ['曜日', '名前', '時間'],
      i => setup.weekly.splice(i, 1));
    setup.events.sort((a, b) => a.d.localeCompare(b.d));
    listTable('events-table', setup.events.map(e => [e.d, esc(e.k), esc(e.t), esc(e.subs.length ? e.subs.join('・') : '全教科')]), ['日にち', '種類', '名前', '教科'],
      i => setup.events.splice(i, 1));
    setup.scores.sort((a, b) => b.d.localeCompare(a.d));
    listTable('scores-table', setup.scores.map(s => [s.d, esc(s.t), esc(s.s), `${s.sc}/${s.mx}${s.dev ? `(偏差値${s.dev})` : ''}`]), ['日にち', 'テスト', '教科', '点数'],
      i => setup.scores.splice(i, 1));
  }

  // 曜日ごとの勉強時間の見通し
  function renderForecast() {
    const rows = [2, 3, 4, 5, 6, 7, 1].map(d => {
      const t = availableTime(setup, d);
      const club = setup.weekly.filter(w => w.w === d).map(w => w.t).join('・');
      return { label: `${DAYS[d]}曜`, value: t.study, color: club ? '#f7992e' : 'var(--accent)', note: `${Math.floor(t.study / 60)}時間${t.study % 60}分` };
    });
    const week = rows.reduce((s, r) => s + r.value, 0);
    $('week-forecast').innerHTML = Charts.bars(rows, { max: Math.max(...rows.map(r => r.value), 60) }) +
      `<p class="muted">オレンジは部活・塾がある日。1週間で約 <b>${Math.floor(week / 60)}時間${week % 60}分</b> 勉強できます。</p>`;
  }

  async function renderSend() {
    if (!Bridge.supported) { $('send').innerHTML = '<p class="warn">このブラウザは古いため、アプリに送れません。</p>'; return; }
    const payload = await Bridge.encode(setup);
    Bridge.renderSendPanel($('send'), Bridge.appLink(SCHEME, 'import', payload), 'このQRコードをiPhoneで読み取ると、学習プランナーアプリに入ります。');
  }

  function renderAll() {
    renderSubjects(); renderTimetable(); renderLife(); renderLists(); save();
  }

  function startEditor(fromApp) {
    setup = fromApp || Bridge.load(KEY, null) || emptySetup();
    if (fromApp) {
      Bridge.save(KEY, setup);
      $('loaded-notice').textContent = 'アプリの今の設定を読み込みました。直したら、下のQRコードでアプリに送ってください。';
      $('loaded-notice').classList.remove('hidden');
      history.replaceState(null, '', location.pathname);
    }
    const maxP = Math.max(6, ...setup.timetable.map(s => s.p));
    $('periods').innerHTML = [4, 5, 6, 7, 8].map(n => `<option ${n === maxP ? 'selected' : ''}>${n}</option>`).join('');
    $('periods').onchange = renderTimetable;
    $('w-day').innerHTML = [2, 3, 4, 5, 6, 7, 1].map(d => `<option value="${d}">${DAYS[d]}曜</option>`).join('');
    $('e-date').value = Bridge.dayString(new Date(Date.now() + 14 * 86400000));
    $('s-date').value = Bridge.dayString();

    const addSubject = (name) => { name = name.trim(); if (name && !setup.subjects.includes(name)) setup.subjects.push(name); };
    $('add-subject').onclick = () => { addSubject($('new-subject').value); $('new-subject').value = ''; renderAll(); };
    $('new-subject').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('add-subject').click(); });
    $('five-subjects').onclick = () => { ['国語', '数学', '英語', '理科', '社会'].forEach(addSubject); renderAll(); };
    ['wake', 'sleep', 'schoolStart', 'schoolEnd'].forEach(k => $(k).onchange = () => { setup.life[k] = toMin($(k).value); save(); });
    $('commute').onchange = () => { setup.life.commute = Number($('commute').value) || 0; save(); };
    $('living').onchange = () => { setup.life.living = Number($('living').value) || 0; save(); };
    $('add-weekly').onclick = () => {
      const s = toMin($('w-start').value), e = toMin($('w-end').value);
      if (!$('w-title').value.trim() || e <= s) return;
      setup.weekly.push({ t: $('w-title').value.trim(), w: Number($('w-day').value), s, e }); renderAll();
    };
    $('e-kind').onchange = () => { $('e-title').value = $('e-kind').value === '定期テスト' ? '期末テスト' : $('e-kind').value; };
    $('add-event').onclick = () => {
      if (!$('e-title').value.trim() || !$('e-date').value) return;
      const subs = [...$('e-subjects').querySelectorAll('input:checked')].map(c => c.value);
      setup.events.push({ t: $('e-title').value.trim(), k: $('e-kind').value, d: $('e-date').value, s: null, e: null, subs: $('e-kind').value === '行事' ? [] : subs });
      renderAll();
    };
    $('add-scores').onclick = () => {
      const mx = Number($('s-max').value) || 100;
      document.querySelectorAll('[data-score]').forEach(inp => {
        if (inp.value === '') return;
        const dev = document.querySelector(`[data-dev="${CSS.escape(inp.dataset.score)}"]`).value;
        setup.scores = setup.scores.filter(s => !(s.d === $('s-date').value && s.t === $('s-test').value && s.s === inp.dataset.score));
        setup.scores.push({ d: $('s-date').value, t: $('s-test').value.trim(), s: inp.dataset.score, sc: Number(inp.value), mx, dev: dev ? Number(dev) : null });
      });
      renderAll();
    };
    renderAll();
  }

  (async () => {
    const payload = Bridge.hashPayload();
    const data = payload && Bridge.supported ? await Bridge.decode(payload) : null;
    if (data && data.kind === 'planner' && data.report) {
      $('editor').classList.add('hidden');
      $('report').classList.remove('hidden');
      showReport(data);
    } else {
      if (data && data.kind === 'planner') delete data.report;
      startEditor(data && data.kind === 'planner' ? data : null);
    }
  })();
})();
