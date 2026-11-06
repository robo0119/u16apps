// StudyPilot Web版の画面(AI以外は iOS版と同じ:入力・閲覧・計画・ストリーク)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const E = Engine, S = Store, L = Logic;
  const DAYS = ['', '日', '月', '火', '水', '木', '金', '土'];
  const PALETTE = ['#4078f2', '#ed5c6b', '#33ad73', '#f7992e', '#9461e6', '#1aa8bf', '#c7854d', '#808c9e'];
  const ROLES = ['メイン', '毎日', '考査用', '補助', '後回し'];
  const ROLE_NOTE = { 'メイン': '毎日ノルマを出す', '毎日': '毎日ノルマを出し、連続記録もつける', '考査用': '考査モードの日だけノルマを出す',
    '補助': 'ノルマは出さない(必要なときに使う)', '後回し': 'ノルマは出さない(あとで始める)' };
  const ROLE_ICON = { 'メイン': '★', '毎日': '🔥', '考査用': '📝', '補助': '🛟', '後回し': '🕒' };
  const UNITS = ['ページ', '語', '分', '題', '回', '章'];
  const EVERY = [[1, '毎日'], [2, '2日に1回'], [3, '3日に1回'], [4, '4日に1回'], [7, '7日に1回'], [0, '自動(その他・土日)']];
  /** 出す日の表示 */
  const everyText = (n, weekendOnly) => weekendOnly ? '土日だけ' : n === 1 ? '毎日' : n > 1 ? `${n}日に1回` : '自動';
  const KINDS = ['問題集', '参考書', '単語帳', '過去問', '教科書・副教材', 'ルーティーン', '映像授業'];
  /** 問題ごとに ○△× をつけるか(問題集・過去問で、総問題数が決まっているとき) */
  const usesMarks = (m) => (m.kind === '問題集' || m.kind === '過去問' || !m.kind) && m.total > 0;
  const MODE_NOTE = { '通常': 'いつものペース', '考査': '考査に出る教科を多めに', '軽め': '行事の日はノルマ半分', '休み': '休みの日は、いつもより多めに' };

  // 時刻 ⇔ 「0時からの分」
  const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
  const toTime = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const md = (key) => { const d = E.toDate(key); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay() + 1]})`; };

  /**
   * よくある教科の決まった色の番号(iOS版の SubjectPalette.fixed と同じ)
   * 国語=青、数学=赤、英語=緑、化学=オレンジ、物理=紫、生物・地学=青緑、社会=茶
   */
  const FIXED_COLORS = [
    [['国語', '現代文', '古文', '漢文', '古典', '言語文化', '論理国語'], 0], [['数'], 1], [['英'], 2], [['化学'], 3], [['物理'], 4],
    [['生物', '地学', '理科'], 5], [['社会', '歴史', '日本史', '世界史', '地理', '公共', '政治', '倫理'], 6],
  ];
  /** 教科の色(決まった色がある教科はそれ、ほかは登録の色の番号。登録になくても灰色にしない) */
  function color(name) {
    const hit = FIXED_COLORS.find(([words]) => words.some(w => (name || '').includes(w)));
    if (hit) return PALETTE[hit[1]];
    const s = L.subjects().find(x => x.name === name);
    return PALETTE[s ? ((s.colorIndex % 8) + 8) % 8 : 7];
  }
  const tag = (name) => `<span class="tag" style="background:${color(name)}">${esc(name)}</span>`;

  // 画面の状態
  const state = {
    tab: (() => { try { return localStorage.getItem('planner.tab') || 'today'; } catch (e) { return 'today'; } })(),
    chip: null,          // 選んでいる問題(「教材ID#番号」)
    detail: null,        // 詳しく見ている教材のID
    form: null,          // 編集中の教材(下書き)
    monthKey: null,      // カレンダーの月(その月の1日)
    message: '',
  };
  const today = () => L.today();

  // ---------------- 今日 ----------------

  function renderToday() {
    const key = today();
    let html = '';
    if (!L.subjects().length) {
      return `<div class="card"><h2>はじめに</h2><p>「登録」タブで教科・時間割・予定を入れると、毎日の計画とノルマが出ます。</p>
        <button data-act="tab" data-tab="setup">登録へ</button></div>`;
    }
    L.ensurePlan(key);
    const log = L.ensureDayLog(key);
    const tasks = L.tasks(key).sort((a, b) => (a.carry ? 0 : 1) - (b.carry ? 0 : 1) || b.minutes - a.minutes);
    const total = tasks.reduce((s, t) => s + t.minutes, 0);
    const next = L.nextTest(key);
    const streak = L.streak(key);
    const day = L.streakDays().find(d => d.date === key) || { quota: 0, done: 0 };
    const achieved = E.isAchieved(day.quota, day.done);

    // いちばん上のカード:あいさつ・日付・モード・ノルマの輪・連続記録・次のテスト
    const needed = Math.ceil(day.quota * 0.8);
    const ratio = day.quota ? Math.min(1, day.done / day.quota) : 0;
    const hour = new Date().getHours();
    const greet = hour >= 4 && hour < 11 ? 'おはよう' : hour < 17 && hour >= 11 ? 'こんにちは' : 'こんばんは';
    const nextDays = next ? E.daysBetween(key, next.date) : null;
    html += `<div class="hero hero-${log.mode}">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div><div style="opacity:.85;font-weight:700">${greet}</div>
        <div style="font-size:1.5rem;font-weight:800">${md(key)}</div></div><span class="hero-pill">${log.mode}モード</span></div>
      <div class="row" style="gap:18px;margin-top:12px;flex-wrap:nowrap">
        <div class="ring" style="--p:${ratio * 100}"><b>${day.done}</b><small>/ ${day.quota}</small></div>
        <div>${day.quota > 0 ? `<div style="font-size:1.15rem;font-weight:800">${achieved ? '今日のノルマ達成!' : `あと${Math.max(0, needed - day.done)}つで達成`}</div>
          <div style="opacity:.85;font-size:.85rem">${day.quota}つのうち${needed}つ(8割)できたら達成</div>` : '<div>教材を登録すると、今日のノルマが出ます</div>'}
          <div style="font-weight:800;margin-top:4px">🔥 ${streak.current}日連続${streak.tickets ? `・おやすみ券 ${streak.tickets}枚` : ''}</div></div>
      </div>
      <div style="opacity:.9;font-size:.85rem;margin-top:10px">${MODE_NOTE[log.mode]}${next ? `・<b>${esc(next.title.replace('(日付は仮)', ''))}${nextDays === 0 ? 'は今日' : `まで あと${nextDays}日`}</b>` : ''}</div>
    </div>`;
    // 達成していなかった → 達成した、に変わったらお祝い
    if (state.wasAchieved === false && achieved) celebrate(streak.current);
    state.wasAchieved = achieved;

    const items = L.todayMaterials(log);
    if (L.materials().length) {
      const custom = L.customEntries(log);
      html += `<div class="sec-head"><span>今日のノルマ</span><span>${items.filter(i => i.e.done > 0).length + custom.filter(e => e.done > 0).length}/${items.length + custom.length}</span></div>
        ${quotaGroupsHTML(items, custom)}
        <div class="card list">${custom.length ? subjectHead('自分で追加', 'var(--accent)', custom.filter(e => e.done > 0).length, custom.length) + custom.map(customRow).join('') : ''}
          <button class="add-quota" data-act="add-open">＋ ノルマを足す</button>${state.addOpen ? addPanel(items) : ''}</div>
        <p class="sec-foot">終わったら丸をタップ。8割チェックで達成です。× で今日は外せます</p>`;
    }
    const reviews = L.todayReviews(key);
    if (reviews.length) {
      html += `<div class="card"><h2>解き直し(×は翌日・△は3日後)</h2>${reviews.map(r => `
        <div class="task" style="align-items:center">
          <b style="color:${r.r.lastMark === '×' ? 'var(--ng)' : 'var(--tri)'};width:20px">${r.r.lastMark}</b>
          <div style="flex:1"><div class="${r.done ? 'muted' : ''}" style="${r.done ? 'text-decoration:line-through' : ''}">${esc(r.m.name)} 問${r.r.no}</div>
            <div class="reason">${esc(r.m.subject)}${r.field ? '・' + esc(r.field) : ''}${r.weak ? ' <span class="weak">苦手分野</span>' : ''}</div></div>
          ${r.done ? '✅' : ['○', '△', '×'].map(mk => `<button class="b-${mk}" style="min-height:36px;padding:4px 12px" data-act="mark" data-m="${r.m.id}" data-no="${r.r.no}" data-mark="${mk}">${mk}</button>`).join('')}
        </div>`).join('')}</div>`;
    }

    html += `<details class="card" ${state.showTime ? 'open' : ''} data-time><summary><b>🕒 時間の目安</b> <span class="muted">${total}分</span></summary>
      <p class="muted">学校・部活の時間から計算した、今日勉強できる時間と、教科ごとの時間の目安</p>
      <div class="row" style="justify-content:flex-end"><button class="secondary" data-act="regen">作り直す</button></div>
      ${tasks.length ? tasks.map(t => `<label class="task ${t.done ? 'done' : ''}" style="margin:0;color:var(--text)">
        <input type="checkbox" data-act="task" data-id="${t.id}" ${t.done ? 'checked' : ''}>
        <div><div>${tag(t.subject)} <b>${t.minutes}分</b> <span class="c">${esc(t.content)}</span>${t.carry ? ' <span class="warn">やり残し</span>' : ''}</div>
        <div class="reason">💡 ${esc(t.reason)}</div></div></label>`).join('') : '<p class="muted">今日は予定がいっぱいで、勉強の時間はとれません</p>'}`;

    const b = E.availableTime(L.dayContext(key));
    const factor = E.loadFactor(L.recentResults(key));
    html += `<h3 style="margin:16px 0 6px">使える時間の計算</h3><table>
      <tr><td></td><td>起きている時間</td><td class="num">${b.awake}分</td></tr>
      <tr><td>−</td><td>学校(通学ふくむ)</td><td class="num">${b.school}分</td></tr>
      <tr><td>−</td><td>部活・塾などの予定</td><td class="num">${b.events}分</td></tr>
      <tr><td>−</td><td>食事・お風呂など</td><td class="num">${b.living}分</td></tr>
      <tr><td>−</td><td>休憩(50分ごとに10分)</td><td class="num">${b.breaks}分</td></tr>
      <tr><td>=</td><td><b>勉強に使える時間</b></td><td class="num"><b>${b.study}分</b></td></tr>
      ${factor < 1 ? `<tr><td>×</td><td><b>ペース調整 ${Math.round(factor * 100)}%</b></td><td class="num"><b>${E.adjustedMinutes(b.study, factor)}分</b></td></tr>` : ''}
    </table></details>`;
    return html;
  }

  /** 教材1つのノルマの行:チェック・教材名・1日の量・選んだ理由 */
  /**
   * 今日のノルマを教科ごとにまとめる(iOS版と同じ)
   * 上に教科ごとの進み具合のタイル、そのあと教科ごとのカード(色の縦線・できた数・細いバー)
   * 並び:主要教科(理系なら数学・理科・英語)→ 登録の順 → 登録にない教科
   */
  function quotaGroupsHTML(items, custom) {
    if (!items.length && !custom.length) return '<div class="card"><p class="muted">今日のノルマはありません</p></div>';
    const track = L.settings().track || 'なし';
    const subs = L.subjects();
    const order = subs.filter(x => E.isCore(track, x.name)).concat(subs.filter(x => !E.isCore(track, x.name))).map(x => x.name);
    const idx = (n) => { const i = order.indexOf(n); return i < 0 ? 99 : i; };
    const names = [...new Set(items.map(i => i.m.subject))].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
    const groups = names.map(n => { const list = items.filter(i => i.m.subject === n); return { n, list, c: color(n), done: list.filter(i => i.e.done > 0).length }; });
    const tiles = `<div class="sub-tiles">${groups.map(g => { const fin = g.done === g.list.length;
      return `<div class="sub-tile ${fin ? 'fin' : ''}" style="--c:${g.c}"><small>${esc(g.n)}${fin ? ' ✓' : ''}</small><b>${g.done}/${g.list.length}</b></div>`; }).join('')}</div>`;
    return `<div class="card">${tiles}</div>` + groups.map(g => `<div class="card list qgroup">${subjectHead(g.n, g.c, g.done, g.list.length)}${g.list.map(quotaRow).join('')}</div>`).join('');
  }

  /** 教科のまとまりの見出し:色の縦線・名前・できた数(全部できたら「完了」)・進み具合のバー(できた数 ÷ 数) */
  const subjectHead = (name, c, done, total) => `<div class="sub-head" style="--c:${c}"><div><i></i><b>${esc(name)}</b><span>${done === total && total ? '✓ 完了' : `${done}/${total}`}</span></div>
    <div class="sub-bar"><span style="width:${total ? done / total * 100 : 0}%"></span></div></div>`;

  function quotaRow(i) {
    const done = i.e.done > 0, c = color(i.m.subject);
    return `<label class="qitem ${done ? 'done' : ''}" style="--c:${c}">
      <input type="checkbox" class="circle" data-act="quota" data-m="${i.m.id}" ${done ? 'checked' : ''}>
      <div class="qbody"><div class="qtop"><b class="qname">${esc(i.m.name)}</b>
        ${i.e.amount > 0 ? `<span class="qamt">${i.e.amount}${esc(i.e.unit)}</span>` : ''}</div>
        <div class="qtags"><span class="rtag">${esc(shortReason(i.e.reason || ''))}</span> ${lapBadge(i.m)}</div>
        ${i.e.unit === '単元' ? `<div class="qunit">${esc(i.e.reason)}</div>` : ''}</div>
      <button class="q-remove" data-act="q-remove" data-m="${i.m.id}" title="今日は外す">×</button></label>`;
  }

  /** 自分で書いたノルマの行 */
  function customRow(e) {
    return `<label class="qitem ${e.done > 0 ? 'done' : ''}" style="--c:var(--accent)">
      <input type="checkbox" class="circle" data-act="quota" data-m="${e.material}" ${e.done > 0 ? 'checked' : ''}>
      <div class="qbody"><div class="qtop"><b class="qname">${esc(e.title)}</b>${e.amount > 0 ? `<span class="qamt">${e.amount}${esc(e.unit)}</span>` : ''}</div>
        <div class="qtags"><span class="rtag">自分で追加</span></div></div>
      <button class="q-remove" data-act="q-remove" data-m="${e.material}" title="今日は外す">×</button></label>`;
  }

  /** ノルマを足すパネル(教材から選ぶ/自分で書く) */
  function addPanel(items) {
    const inToday = new Set(items.map(i => i.m.id));
    const mats = L.materials().filter(m => !inToday.has(m.id) && m.role !== '後回し');
    const order = L.subjects().map(s => s.name).concat(['全教科']);
    const subjects = [...new Set(mats.map(m => m.subject))].sort((a, b) => (order.indexOf(a) + 99) % 199 - (order.indexOf(b) + 99) % 199);
    return `<div class="add-panel"><div class="row"><button class="${state.addMode === 'custom' ? 'secondary' : ''}" data-act="add-mode" data-mode="material">教材から選ぶ</button>
      <button class="${state.addMode === 'custom' ? '' : 'secondary'}" data-act="add-mode" data-mode="custom">自分で書く</button></div>
      ${state.addMode === 'custom' ? `<div class="fg" style="margin-top:8px"><div style="grid-column:1/-1"><label>やること</label><input id="cq-title" placeholder="例:スタサプ 力学"></div>
          <div><label>量(0 = 決めない)</label><input id="cq-amount" type="number" min="0" value="0"></div>
          <div><label>単位</label><select id="cq-unit">${['ページ', '題', '語', '分', '講', '回'].map(u => `<option>${u}</option>`).join('')}</select></div></div>
          <button style="margin-top:10px;width:100%" data-act="add-custom">今日のノルマに足す</button>`
        : subjects.map(sub => `<div class="muted" style="margin-top:10px;font-weight:700">${esc(sub)}</div>` + mats.filter(m => m.subject === sub).map(m =>
          `<button class="add-item" data-act="add-material" data-m="${m.id}"><span>${esc(m.name)}<small> ${esc([everyText(m.every ?? 0, m.weekendOnly), m.amount > 0 ? m.amount + (m.unit || '') : ''].filter(Boolean).join('・'))}</small></span><b>＋</b></button>`).join('')).join('')}
      </div>`;
  }

  /** 選んだ理由の短い表示(毎日・2日に1回・交互・おまかせ・土日・休みの日・単元の順) */
  function shortReason(r) {
    if (r.startsWith('毎日')) return '毎日';
    if (r.startsWith('その他')) return 'おまかせ';
    if (r.startsWith('土日')) return '土日';
    if (r.startsWith('休み')) return '休みの日';
    if (r.includes('単元')) return '単元の順';
    if (r.includes('交互')) return '交互';
    const m = r.match(/\d+日に1回/);
    return m ? m[0] : r;
  }

  /** ノルマ達成のお祝い(紙ふぶきと大きな文字。2.5秒で消える) */
  function celebrate(days) {
    const box = document.createElement('div');
    box.className = 'celebrate';
    const colors = ['#ffd23f', '#ff6b9a', '#ff9f1c', '#2ec4b6', '#9b5de5', '#3a86ff'];
    box.innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${colors[i % 6]};animation-delay:${(i % 9) * 0.06}s"></i>`).join('') +
      `<div class="celebrate-card"><div style="font-size:3.5rem">🔥</div><b>今日のノルマ達成!</b><div>${days}日連続</div></div>`;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2600);
  }

  /** 使い方(はじめて開いたときと、「?」ボタン) */
  function showHelp() {
    const box = document.createElement('div');
    box.className = 'help';
    const topics = [
      ['✅', '今日のノルマ', '毎日やる教材や、2日・3日に1回の教材が自動で並びます。終わったら丸をタップ。全体の8割にチェックできたら、その日は達成です。'],
      ['🔥', '連続記録とおやすみ券', '達成した日が続くと連続記録がのびます。7日続けるごとに「おやすみ券」が1枚(最大2枚)。できなかった日に自動で使われ、記録が途切れません。'],
      ['📊', '周回とロードマップ', '教材ごとに「何周目を、いつまでに」を決めてあります。教材タブのロードマップで全部の予定を横棒で見られます。早く終わったら教材の画面で「終えた」。'],
      ['🌅', 'モード', '定期テストの2週間前からは「考査」、行事の日は「軽め」、冬休みなどは「休み」で多めに。ノルマが自動で変わります。'],
      ['↩️', '解き直し', '教材の画面で、間違えた問題を ×(翌日)や △(3日後)で記録すると、その日の「解き直し」に出ます。'],
      ['🕒', '時間の目安', '学校や部活の時間から計算した、勉強できる時間の目安です。「時間の目安」を開くと見られます。'],
    ];
    box.innerHTML = `<div class="help-card"><h2>StudyPilot の使い方</h2>${topics.map(([i, t, d]) => `<div class="help-row"><span>${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
      <button style="width:100%">はじめる</button></div>`;
    box.querySelector('button').onclick = () => box.remove();
    document.body.appendChild(box);
  }

  /** 周回の状態の小さなラベル(遅れは赤、途中は青、まだは灰) */
  function lapBadge(m) {
    const st = E.lapStatus(m.laps, today());
    if (!st) return '';
    return `<span class="lapb lapb-${st.state}">${esc(E.lapLabel(st))}</span>`;
  }

  /** 日付を「12/23」の形に */
  const mdShort = (key) => { const d = E.toDate(key); return `${d.getMonth() + 1}/${d.getDate()}`; };

  /**
   * 周回のロードマップ(iOS版の RoadmapView と同じ):教科ごとに、教材の「何周目を、いつからいつまでに」を横の帯で
   * - 上:遅れ・やっている周・30日以内に締切の数と、遅れている教材
   * - 帯の左はしは今日の1週間前。位置 = (その日 − 左はし) ÷ (右はし − 左はし)
   * - 周回は教科の色。今の周は、始めから今日までを少し暗く。終えた周はうすく ✓
   */
  function roadmapHTML() {
    const key = today();
    const months = state.rmRange ?? 6;
    const start = E.addDays(key, -7);
    const allEnd = L.materials().flatMap(m => (m.laps || []).map(l => l.end)).sort().pop() || key;
    let end;
    if (months) { const d = E.toDate(key); d.setMonth(d.getMonth() + months); end = E.keyOf(d); }
    else { const d = E.toDate(key); d.setMonth(d.getMonth() + 1); end = allEnd > E.keyOf(d) ? allEnd : E.keyOf(d); }
    const span = Math.max(1, E.daysBetween(start, end));
    const pos = (k) => Math.max(0, Math.min(100, E.daysBetween(start, k) / span * 100));
    const order = L.subjects().map(x => x.name);
    const idx = (name) => { const i = order.indexOf(name); return i < 0 ? 99 : i; };
    const statuses = L.materials().filter(m => (m.laps || []).length).map(m => ({ m, st: E.lapStatus(m.laps, key) })).filter(x => x.st);
    const late = statuses.filter(x => x.st.state === 'late').sort((a, b) => b.st.days - a.st.days);
    const running = statuses.filter(x => x.st.state === 'running');
    const soon = running.filter(x => x.st.days <= 30).length;
    // テストの旗(考査はオレンジ、模試は青、英検は紫。同じ名前が続く日はまとめる)
    const flags = [];
    S.all('events').filter(e => (e.kind === '定期テスト' || e.kind === '模試' || e.title.includes('英検')) && e.date >= start && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(e => { if (!flags.some(f => f.title === e.title && Math.abs(E.daysBetween(f.date, e.date)) < 4)) flags.push(e); });
    const flagColor = (e) => e.title.includes('英検') ? '#9b51e0' : e.kind === '定期テスト' ? '#f08a24' : '#3478f6';
    const shortName = (e) => { if (e.title.includes('英検')) return '英検'; const t = e.title.replace(/前期|後期/g, '').split(/[(（]/)[0].trim(); return t.length > 8 ? t.slice(0, 8) : t; };
    // 月の目盛り
    let ticks = '';
    const t = E.toDate(start); t.setDate(1); t.setMonth(t.getMonth() + 1);
    while (E.keyOf(t) <= end) { ticks += `<span class="rm-tick" style="left:${pos(E.keyOf(t))}%">${t.getMonth() + 1}月</span>`; t.setMonth(t.getMonth() + 1); }
    const flagIcons = flags.map(e => `<span class="rm-flag" style="left:${pos(e.date)}%;color:${flagColor(e)}">⚑</span>`).join('');
    const examLines = flags.filter(e => e.kind === '定期テスト').map(e => `<span class="rm-line" style="left:${pos(e.date)}%"></span>`).join('');
    const todayLine = `<span class="rm-today" style="left:${pos(key)}%"></span>`;
    // 教科ごとの教材
    const mats = L.materials().filter(m => (m.laps || []).some(l => l.end >= start && l.start <= end));
    const groups = [...new Set(mats.map(m => m.subject))].sort((a, b) => idx(a) - idx(b))
      .map(sub => ({ sub, items: mats.filter(m => m.subject === sub).sort((a, b) => ((a.routeOrder ?? 99) - (b.routeOrder ?? 99)) || ((a.order || 0) - (b.order || 0))) }));
    const lapBar = (l, c) => {
      const a = pos(l.start), b = pos(E.addDays(l.end, 1)), w = Math.max(1.5, b - a);
      // 今の周の濃い所 = (今日 − 始め) ÷ (終わり − 始め)
      const elapsed = l.done ? 0 : Math.max(0, Math.min(100, (pos(key) - a) / w * 100));
      return `<span class="rm-bar" title="${l.lap}周目 ${mdShort(l.start)}〜${mdShort(l.end)} ${esc(l.scope || '')}" style="left:${a}%;width:${w}%;background:${c};opacity:${l.done ? 0.3 : 0.9}">
        ${elapsed > 0 ? `<i style="width:${elapsed}%;background:rgba(0,0,0,.2)"></i>` : ''}<b>${l.done ? '✓' : ''}${w > 9 ? `${l.lap}周目` : l.lap}</b></span>`;
    };
    const rows = groups.map(g => `<div class="card rm-group"><h3><i style="background:${color(g.sub)}"></i>${esc(g.sub)} <span class="muted">${g.items.length}冊</span></h3>
      ${g.items.map(m => { const st = E.lapStatus(m.laps, key); const cur = st && st.lap;
        return `<div class="rm-row"><div class="rm-name"><b>${esc(m.name)}</b>${lapBadge(m)}</div>
          <div class="rm-track">${examLines}${(m.laps || []).filter(l => l.end >= start && l.start <= end).map(l => lapBar(l, color(m.subject))).join('')}${todayLine}</div>
          ${cur && cur.scope ? `<div class="muted rm-scope">${cur.lap}周目:${esc(cur.scope)}(〜${mdShort(cur.end)})</div>` : ''}</div>`; }).join('')}</div>`).join('');
    const tile = (v, label, cls, icon) => `<div class="rm-tile ${cls}"><span>${icon}</span><b>${v}</b><small>${label}</small></div>`;
    return `<div class="row" style="margin-bottom:12px"><button class="secondary" data-act="close-roadmap">‹ 教材</button><h2 style="margin:0;flex:1">ロードマップ</h2></div>
      <div class="rm-tiles">${tile(late.length, '遅れ', late.length ? 'bad' : '', '⚠︎')}${tile(running.length, 'やっている周', 'run', '↻')}${tile(soon, '30日以内に締切', 'soon', '🏁')}</div>
      ${late.length ? `<div class="card rm-late"><b class="bad">⚠︎ 遅れている周</b>${late.map(x => `<div class="row" style="justify-content:space-between;padding:4px 0"><span><i class="dot" style="background:${color(x.m.subject)}"></i> ${esc(x.m.name)}</span>${lapBadge(x.m)}</div>`).join('')}
        <p class="muted" style="margin:4px 0 0">終わっていたら、教材の画面で「終えた」に</p></div>` : ''}
      <div class="row" style="margin:12px 0">${[[3, '3か月'], [6, '半年'], [12, '1年'], [0, '全部']].map(([n, t]) => `<button class="${months === n ? '' : 'secondary'}" style="min-height:36px;padding:4px 14px" data-act="rm-range" data-n="${n}">${t}</button>`).join('')}</div>
      ${flags.length ? `<div class="rm-dates">${flags.map(e => `<span style="color:${flagColor(e)};background:color-mix(in srgb, ${flagColor(e)} 12%, transparent)">⚑ ${mdShort(e.date)} ${esc(shortName(e))}</span>`).join('')}</div>` : ''}
      ${groups.length ? `<div class="rm-head">${ticks}${flagIcons}<span class="rm-todaylabel" style="left:${pos(key)}%">今日</span></div>${rows}` : '<div class="card"><p class="muted">この期間の周回の予定はありません</p></div>'}
      <p class="muted rm-legend"><span><i style="background:var(--accent)"></i>周回(暗い所がたった日数)</span><span><i style="background:var(--accent);opacity:.3"></i>終えた周</span>
        <span style="color:#f08a24">⚑ 考査</span><span style="color:#3478f6">⚑ 模試</span><span style="color:#9b51e0">⚑ 英検</span><span style="color:var(--ng)">| 今日</span></p>`;
  }

  /** ○△×を選ぶボタン */
  const markBar = (mid, no, current) => `<div class="markbar"><span class="muted" style="align-self:center">問${no}</span>
    ${['○', '△', '×'].map(mk => `<button class="b-${mk}" data-act="mark" data-m="${mid}" data-no="${no}" data-mark="${mk}">${mk}</button>`).join('')}
    ${current ? `<button class="danger" data-act="undo" data-m="${mid}" data-no="${no}">取り消す</button>` : ''}</div>`;

  // ---------------- 教材 ----------------

  function renderMaterials() {
    if (state.form) return materialForm();
    if (state.roadmap) return roadmapHTML();
    if (state.detail && S.get('materials', state.detail)) return materialDetail(S.get('materials', state.detail));
    const subjects = L.subjects();
    const mats = L.materials();
    let html = `<div class="row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">教材</h2>
      <div class="row"><label class="button secondary" style="margin:0;color:var(--accent)">JSONから読み込む<input type="file" accept=".json,application/json" id="import-json" hidden></label>
      <button data-act="new-material">＋ 教材を追加</button></div></div>
      ${state.importMessage ? `<div class="notice">${esc(state.importMessage)}</div>` : ''}`;
    const statuses = L.materials().map(m => E.lapStatus(m.laps, today())).filter(Boolean);
    if (statuses.length) {
      const late = statuses.filter(x => x.state === 'late').length;
      const soon = statuses.filter(x => x.state === 'running' && x.days <= 7).length;
      html += `<div class="card mrow" data-act="roadmap" style="margin-bottom:16px"><span class="rm-icon">▤</span>
        <div class="grow"><b>周回のロードマップ</b><div class="muted ${late ? 'bad' : ''}">${late ? `遅れ ${late}冊・` : ''}今週終わる周 ${soon}・いつまでに何周かを見る</div></div><span class="muted">›</span></div>`;
    }
    if (!mats.length) return html + '<div class="card"><p class="muted">問題集・単語帳などを追加しよう</p></div>';
    const order = subjects.map(s => s.name).concat(['全教科']);
    const groups = {};
    mats.forEach(m => { (groups[m.subject] = groups[m.subject] || []).push(m); });
    Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 199 - (order.indexOf(b) + 99) % 199).forEach(sub => {
      // 役割の順(メイン → 毎日 → 考査用 → 補助 → 後回し)、同じ役割なら使う順番
      const list = groups[sub].slice().sort((a, b) => (ROLES.indexOf(a.role) - ROLES.indexOf(b.role)) || ((a.routeOrder ?? 99) - (b.routeOrder ?? 99)) || ((a.order || 0) - (b.order || 0)));
      html += `<div class="card"><h2>${tag(sub)}</h2>${list.map(m => `
        <div class="mrow" data-act="open-material" data-id="${m.id}" style="${m.role === '後回し' || m.role === '補助' ? 'opacity:.7' : ''}">
          <span style="width:24px;text-align:center">${ROLE_ICON[m.role] || '★'}</span>
          <div class="grow"><b>${m.routeOrder ? `<span class="muted">${m.routeOrder}</span> ` : ''}${esc(m.name)}</b> ${lapBadge(m)}
            ${m.total > 0 ? `<div class="progress" style="margin:6px 0"><i style="width:${Math.min(100, m.done / m.total * 100)}%"></i></div>` : ''}
            <div class="muted">${[everyText(m.every ?? 0, m.weekendOnly) + (m.group ? `(交互${m.group})` : ''), m.amount > 0 ? `${m.amount}${m.unit || ''}` : '', m.role, m.kind, m.period].filter(Boolean).map(esc).join('・')}</div>
            ${m.note ? `<div class="muted" style="font-size:.85rem">${esc(m.note)}</div>` : ''}</div><span class="muted">›</span>
        </div>`).join('')}</div>`;
    });
    return html;
  }

  /** 教材の詳しい画面:問題ごとの ○△× のマス目 */
  function materialDetail(m) {
    const key = today();
    const latestMark = {};
    S.all('attempts').filter(a => a.material === m.id).sort((a, b) => a.at - b.at).forEach(a => { latestMark[a.no] = a.mark; });
    const counts = { '○': 0, '△': 0, '×': 0 };
    Object.values(latestMark).forEach(mk => { counts[mk]++; });
    const overall = L.streak(key);
    const ms = m.daily ? L.materialStreak(m.id, overall, key) : null;
    const total = Math.max(1, m.total);
    return `<div class="row" style="margin-bottom:12px"><button class="secondary" data-act="close-detail">‹ 一覧</button>
      <h2 style="margin:0;flex:1">${esc(m.name)}</h2>
      <button class="secondary" data-act="edit-material" data-id="${m.id}">編集</button>
      <button class="danger" data-act="delete-material" data-id="${m.id}">削除</button></div>
      <div class="card"><div class="row">${tag(m.subject)}<span>${esc(m.role)}・${esc(m.kind || '問題集')}${m.period ? '・' + esc(m.period) : ''}</span>${m.total > 0 ? `<b>${m.done}/${m.total}問</b>` : ''}
        ${counts['○'] + counts['△'] + counts['×'] ? `<span style="color:var(--ok)">○できた ${counts['○']}</span><span style="color:var(--tri)">△あやしい ${counts['△']}</span><span style="color:var(--ng)">×まちがい ${counts['×']}</span>` : ''}</div>
        ${m.total > 0 ? `<div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, m.done / total * 100)}%"></i></div>` : ''}
        ${ms ? `<p style="margin:10px 0 0"><b>🔥 ${ms.current}日連続</b>・最長 ${ms.longest}日</p>` : ''}
        ${m.note ? `<p class="muted" style="margin:8px 0 0">${esc(m.note)}</p>` : ''}
        <p style="margin:10px 0 0"><b>ノルマ:</b>${esc([everyText(m.every ?? 0, m.weekendOnly) + (m.group ? `(交互${m.group})` : ''), m.amount > 0 ? `${m.amount}${m.unit || ''}` : ''].filter(Boolean).join('・'))}
          ${m.activeFrom || m.activeUntil ? `<span class="muted">・期間 ${m.activeFrom ? md(m.activeFrom) : ''}〜${m.activeUntil ? md(m.activeUntil) : ''}</span>` : ''}</p></div>
      ${(m.laps || []).length ? `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">周回</h2>${lapBadge(m)}</div>
        ${m.laps.slice().sort((a, b) => a.lap - b.lap).map(l => `<div class="task" style="align-items:center">
          <b style="width:24px;color:${l.done ? 'var(--ok)' : 'var(--accent)'}">${l.done ? '✓' : l.lap}</b>
          <div style="flex:1"><b>${l.lap}周目</b> ${md(l.start)}〜${md(l.end)}<div class="reason">${esc(l.scope || '')}${l.done ? `・${md(l.done)}に終えた` : ''}</div></div>
          <button class="secondary" style="min-height:34px;padding:4px 12px" data-act="lap-toggle" data-m="${m.id}" data-lap="${l.lap}">${l.done ? '戻す' : '終えた'}</button></div>`).join('')}
        <p class="muted">周の期間の中だけ、今日のノルマに出ます。早く終わったら「終えた」を押すと、その周はもう出ません</p></div>` : ''}
      <div class="card"><h2>○△×の記録</h2>
        <div class="row"><input id="mark-no" type="number" min="1" placeholder="問題番号" style="width:130px">
          ${['○', '△', '×'].map(mk => `<button class="b-${mk}" data-act="mark-no" data-m="${m.id}" data-mark="${mk}">${mk}</button>`).join('')}</div>
        ${S.all('attempts').filter(a => a.material === m.id).sort((a, b) => b.at - a.at).slice(0, 10)
          .map(a => `<p style="margin:6px 0"><b style="color:${a.mark === '○' ? 'var(--ok)' : a.mark === '△' ? 'var(--tri)' : 'var(--ng)'}">${a.mark}</b> 問${a.no} <span class="muted">${md(a.date)}</span></p>`).join('')}
        <p class="muted">×は翌日・△は3日後に、今日の画面の「解き直し」に出ます</p></div>`;
  }

  /** 教材の追加・編集フォーム */
  function materialForm() {
    const f = state.form;
    return `<div class="card"><h2>${f.id ? '教材を編集' : '教材を追加'}</h2>
      <div class="fg">
        <div><label>教科</label>${L.subjects().length
          ? `<select id="mf-subject">${[...new Set(L.subjects().map(s => s.name).concat(f.subject ? [f.subject] : []))].map(n => `<option ${n === f.subject ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`
          : `<input id="mf-subject" value="${esc(f.subject)}" placeholder="例:数学">`}</div>
        <div><label>教材名</label><input id="mf-name" value="${esc(f.name)}" placeholder="例:青チャート"></div>
        <div><label>種類</label><select id="mf-kind">${KINDS.map(k => `<option ${k === f.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
        <div><label>役割</label><select id="mf-role">${ROLES.map(r => `<option ${r === f.role ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div><label>使う時期</label><input id="mf-period" value="${esc(f.period || '')}" placeholder="例:今〜12月"></div>
        <div style="grid-column:1/-1"><label>メモ</label><input id="mf-note" value="${esc(f.note || '')}"></div>
        <div><label>1日の量(0 = 決めない)</label><input id="mf-amount" type="number" min="0" value="${f.amount || 0}"></div>
        <div><label>単位</label><select id="mf-unit">${UNITS.map(u => `<option ${u === (f.unit || 'ページ') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div><label>出す日</label><select id="mf-every">${EVERY.map(([v, t]) => `<option value="${v}" ${v === (f.every ?? 2) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div><label>交互のグループ名</label><input id="mf-group" value="${esc(f.group || '')}" placeholder="例:①"></div>
        <div class="checks" style="align-self:center"><label><input type="checkbox" id="mf-weekend" ${f.weekendOnly ? 'checked' : ''}>土日だけ(休みの日も)</label></div>
        <div><label>始める日(任意)</label><input id="mf-from" type="date" value="${f.activeFrom || ''}"></div>
        <div><label>終わる日(任意)</label><input id="mf-until" type="date" value="${f.activeUntil || ''}"></div>
      </div>
      <h2 style="margin-top:16px">周回(いつまでに何周)</h2>
      <div id="mf-laps">${(f.laps || []).map((l, i) => `<div class="route-row" style="grid-template-columns:auto 1fr 1fr 1.4fr auto;align-items:center">
        <b>${i + 1}周目</b><input type="date" data-l="${i}" data-k="start" value="${l.start}"><input type="date" data-l="${i}" data-k="end" value="${l.end}">
        <input data-l="${i}" data-k="scope" value="${esc(l.scope || '')}" placeholder="どこまで(全部・×だけ)"><button class="danger" data-act="lap-del" data-i="${i}">×</button></div>`).join('')}</div>
      <button class="secondary" data-act="lap-add">＋ 周を追加</button>
      <p class="muted">${esc(ROLE_NOTE[f.role] || '')}。周回を決めると、周の期間の中だけノルマに出ます。同じグループ名の教材は1つの枠を交互に使います。「自動」は、2日に1回の「その他」と土日に、教科の優先度と前回からの日数で選びます</p>
      <div class="row" style="margin-top:16px"><button data-act="save-material">保存</button><button class="secondary" data-act="cancel-material">やめる</button></div>
    </div>`;
  }

  /** フォームの入力を下書きに読み込む */
  function readMaterialForm() {
    const f = state.form;
    f.subject = $('mf-subject').value.trim(); f.name = $('mf-name').value.trim(); f.role = $('mf-role').value;
    f.amount = Math.max(0, Number($('mf-amount').value) || 0); f.unit = $('mf-unit').value; f.every = Number($('mf-every').value);
    f.weekendOnly = $('mf-weekend').checked;
    f.group = $('mf-group').value.trim(); f.activeFrom = $('mf-from').value || null; f.activeUntil = $('mf-until').value || null;
    document.querySelectorAll('#mf-laps [data-l]').forEach(inp => { f.laps[Number(inp.dataset.l)][inp.dataset.k] = inp.value; });
    f.kind = $('mf-kind').value; f.period = $('mf-period').value.trim(); f.note = $('mf-note').value.trim();
  }

  // ---------------- カレンダー ----------------

  function renderCalendar() {
    const key = today();
    const streak = L.streak(key);
    if (!state.monthKey) state.monthKey = key.slice(0, 8) + '01';
    const first = E.toDate(state.monthKey);
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const events = {};
    S.all('events').forEach(e => { events[e.date] = e; });
    let cells = ['日', '月', '火', '水', '木', '金', '土'].map(d => `<div class="h">${d}</div>`).join('');
    for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
    for (let d = 1; d <= daysIn; d++) {
      const k = E.addDays(state.monthKey, d - 1);
      const st = streak.status[k];
      const ev = events[k];
      cells += `<div class="d ${st === 'achieved' || st === 'ticket' || st === 'missed' ? st : ''} ${k === key ? 'today' : ''}">${d}
        <small style="color:${ev ? (ev.kind === '行事' ? '#1aa8bf' : ev.kind === '長期休み' ? 'var(--tri)' : 'var(--ng)') : 'transparent'}">${ev ? (ev.kind === '行事' ? '⚑' : ev.kind === '長期休み' ? '☀' : '✎') : '・'}</small></div>`;
    }
    const daily = L.materials().filter(m => m.daily);
    return `<div class="card"><div class="stats">
        <div class="stat"><b>🔥 ${streak.current}日</b><span>連続</span></div>
        <div class="stat"><b>🏆 ${streak.longest}日</b><span>最長記録</span></div>
        <div class="stat"><b>🎟️ ${streak.tickets}/${E.MAX_TICKETS}</b><span>おやすみチケット</span></div></div>
        <p class="muted" style="margin-bottom:0">7日連続でチケット1枚(最大2枚)。できなかった日に自動で使い、記録が途切れません</p></div>
      <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px">
        <button class="secondary" data-act="month" data-n="-1">‹</button>
        <b>${first.getFullYear()}年${first.getMonth() + 1}月</b>
        <button class="secondary" data-act="month" data-n="1">›</button></div>
        <div class="cal">${cells}</div>
        <div class="legend" style="margin-top:10px"><span><i style="background:color-mix(in srgb, var(--ok) 40%, transparent)"></i>達成</span>
          <span><i style="background:color-mix(in srgb, var(--ticket) 30%, transparent)"></i>チケット</span>
          <span><i style="background:color-mix(in srgb, var(--muted) 15%, transparent)"></i>未達成</span></div></div>
      ${daily.length ? `<div class="card"><h2>毎日やる教材</h2><table>${daily.map(m => { const s = L.materialStreak(m.id, streak, key);
        return `<tr><td>${esc(m.name)}</td><td class="num">🔥${s.current}日</td><td class="num muted">最長${s.longest}日</td></tr>`; }).join('')}</table></div>` : ''}`;
  }

  // ---------------- 分析 ----------------

  /** 結果を、テストの名前と日ごとにまとめる(新しい順) */
  function testGroups() {
    const by = {};
    S.all('scores').forEach(x => { const k = `${x.date}|${x.testName}`; (by[k] = by[k] || []).push(x); });
    return Object.entries(by).map(([key, records]) => ({ key, records, first: records[0] }))
      .sort((a, b) => b.first.date.localeCompare(a.first.date) || b.first.testName.localeCompare(a.first.testName));
  }
  /** 数字を文字に(整数なら小数点なし) */
  const num = (v) => Number.isInteger(v) ? String(v) : v.toFixed(1);
  const pct = (x) => x.max > 0 ? x.score / x.max * 100 : 0;

  // ---------------- おすすめの参考書と予想ロードマップ(iOS版の BookAdviceView と同じ) ----------------

  /** 参考書の一覧(catalog.json)。はじめて開いたときに読み込む */
  let catalog = null;
  function loadCatalog() {
    if (catalog) return;
    catalog = { loading: true, books: [] };
    fetch('catalog.json?v=' + Date.now()).then(r => r.json()).then(c => { catalog = c; if (state.tab === 'analysis') render(); })
      .catch(() => { catalog = { error: true, books: [] }; if (state.tab === 'analysis') render(); });
  }

  /** 日付を「1/7」の形に(今年でなければ「2027/1/7」) */
  const ymd = (key) => { const d = E.toDate(key); return d.getFullYear() === new Date().getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

  /**
   * 教科ごとに:今の偏差値の目安・今やる本と次の本(理由つき)・目標までの予想ロードマップ
   * 偏差値の目安 = 新しい順に3回を 3:2:1(点数だけのテストは 35 + 得点率 × 0.3)
   * 苦手分野 = 最新の分野別の得点で苦手だった分野 + プロフィールの「苦手:」
   */
  function booksHTML() {
    loadCatalog();
    const back = '<div class="row" style="margin-bottom:12px"><button class="secondary" data-act="books-close">‹ 分析</button><h2 style="margin:0;flex:1">おすすめの参考書</h2></div>';
    if (!catalog || catalog.loading) return back + '<div class="card"><p class="muted">参考書の一覧を読み込んでいます…</p></div>';
    if (catalog.error) return back + '<div class="card"><p class="bad">参考書の一覧を読めませんでした</p></div>';
    const s = L.settings(), track = s.track || 'なし', goal = s.goalDeviation || 65;
    const scores = S.all('scores');
    const owned = L.materials().map(m => ({ subject: m.subject, name: m.name }));
    const inCatalog = new Set(catalog.books.map(b => b.subject));
    const subs = L.subjects().filter(x => inCatalog.has(x.name));
    const ordered = subs.filter(x => E.isCore(track, x.name)).concat(subs.filter(x => !E.isCore(track, x.name)));
    const profileWeak = E.weakWordsFromProfile(s.profile);
    const dots = (level, c) => `<span class="lv">${[1, 2, 3, 4, 5].map(i => `<i style="background:${i <= level ? c : 'var(--line)'}"></i>`).join('')}</span>`;
    let html = back + `<div class="card"><div class="row" style="justify-content:space-between"><b style="font-size:1.1rem">🏁 目標の偏差値 ${goal}</b>
        <div class="row"><button class="secondary" style="min-height:36px;padding:2px 14px" data-act="goal" data-d="-1">−</button><button class="secondary" style="min-height:36px;padding:2px 14px" data-act="goal" data-d="1">＋</button></div></div>
        <p class="muted" style="margin:6px 0 0">テストの結果(偏差値の目安)・苦手分野・持っている教材から、今やる本と次の本を選び、目標までの予想ロードマップを作ります</p></div>`;
    ordered.forEach(sub => {
      const c = color(sub.name);
      const dev = E.bookDeviation(scores.filter(x => x.subject === sub.name).map(x => ({ date: x.date, score: x.score, max: x.max, deviation: E.effectiveDeviation(x) })));
      const latest = scores.filter(x => x.subject === sub.name && x.fields && x.fields.length).sort((a, b) => b.date.localeCompare(a.date))[0];
      const weak = (latest ? E.weakIn(latest.fields).map(f => f.name) : []).concat(profileWeak);
      const advice = E.adviseBooks(sub.name, dev, weak, owned, catalog.books);
      const road = E.bookRoadmap(sub.name, dev, goal, weak, owned, catalog.books, today());
      html += `<div class="card"><div class="row" style="justify-content:space-between"><h3 class="bk-sub"><i style="background:${c}"></i>${esc(sub.name)}${E.isCore(track, sub.name) ? ' <span style="color:#f08a24">★</span>' : ''}</h3>
          <b style="color:${c};font-size:.9rem">${dev != null ? `今の目安 偏差値 ${Math.round(dev)}` : `成績なし(${E.UNKNOWN_DEVIATION}として)`}</b></div>
        ${advice.length ? advice.map(a => `<div class="bk-row"><span class="bk-kind" style="${a.kind === '今やる' ? `background:color-mix(in srgb, ${c} 15%, transparent);color:${c}` : ''}">${a.kind}</span>
            <div style="flex:1"><b>${esc(a.book.name)}</b><div class="muted" style="font-size:.8rem">${esc(a.book.publisher)}・${esc(a.book.area)} ${dots(a.book.level, c)}</div>
              <div style="font-size:.85rem">${esc(a.reasons.join('・'))}</div><div class="muted" style="font-size:.78rem">${esc(a.book.note)}</div></div>
            <button class="secondary bk-add" data-act="book-add" data-id="${a.book.id}" ${owned.some(o => o.subject === a.book.subject && o.name === a.book.name) ? 'disabled' : ''}>＋ 教材に</button></div>`).join('')
          : '<p class="muted">今の力に合う本は、もう持っています</p>'}
        ${road.length ? `<div class="bk-road"><b class="muted" style="font-size:.8rem">予想ロードマップ</b>${road.map((r, i) => `<div class="bk-step"><span class="bk-dot" style="border-color:${c};background:${r.owned ? c : 'transparent'}"></span>${i < road.length - 1 ? `<span class="bk-line" style="background:${c}"></span>` : ''}
            <div><b>${esc(r.book.name)}</b>${r.owned ? ` <small style="color:${c};font-weight:800">今の本</small>` : ''}<div class="muted" style="font-size:.8rem">${ymd(r.start)}〜${ymd(r.end)}・仕上げると偏差値 ${Math.round(r.deviationAfter)} くらい</div></div></div>`).join('')}
          <p class="muted" style="font-size:.75rem">1冊 = 1周の目安 × 1.5(2周目の復習をふくむ)。偏差値は本の範囲の真ん中までとして計算した目安です</p></div>` : ''}</div>`;
    });
    html += `<div class="card"><b>参考書の一覧(${esc(catalog.updated)}更新・${catalog.books.length}冊)</b><p class="muted" style="font-size:.8rem">${esc(catalog.note)}</p>
      <details><summary class="muted">参考にした記事</summary>${(catalog.sources || []).map(u => `<div style="font-size:.78rem;word-break:break-all"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></div>`).join('')}</details></div>`;
    return html;
  }

  /**
   * 成績の推移:教科ごとの小さなカード(最新の値・前回との差・小さな折れ線)
   * 横は何回目のテストか、縦はその教科の値の 最小 − 5 〜 最大 + 5(得点率は 0〜100、偏差値は 20〜80 におさめる)
   */
  function trendCards(ordered, scores, metric, track) {
    const value = (x) => metric === 'percent' ? pct(x) : E.effectiveDeviation(x);
    return `<div class="trend-grid">${ordered.map(sub => {
      const pts = scores.filter(x => x.subject === sub.name).sort((a, b) => a.date.localeCompare(b.date)).map(x => ({ v: value(x), name: x.testName })).filter(p => p.v != null);
      if (!pts.length) return '';
      const c = color(sub.name), last = pts[pts.length - 1].v, diff = pts.length >= 2 ? last - pts[pts.length - 2].v : null;
      const [blo, bhi] = metric === 'percent' ? [0, 100] : [20, 80];
      const lo = Math.max(blo, Math.min(...pts.map(p => p.v)) - 5), hi = Math.min(bhi, Math.max(...pts.map(p => p.v)) + 5);
      const W = 200, H = 64, x = (i) => pts.length === 1 ? W / 2 : 8 + i * (W - 16) / (pts.length - 1), y = (v) => H - 6 - (v - lo) / Math.max(1, hi - lo) * (H - 12);
      const line = pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ');
      return `<div class="trend-card" style="--c:${c}"><div class="row" style="justify-content:space-between"><b><i class="dot" style="background:${c}"></i> ${esc(sub.name)}${E.isCore(track, sub.name) ? ' <span style="color:#f08a24">★</span>' : ''}</b><small class="muted">${pts.length}回</small></div>
        <div class="trend-val">${metric === 'percent' ? Math.round(last) + '%' : last.toFixed(1)}${diff != null ? ` <small class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '↗ +' : '↘ '}${Math.round(diff)}</small>` : ''}</div>
        <svg viewBox="0 0 ${W} ${H}" class="trend-svg"><polygon points="${x(0)},${H} ${line} ${x(pts.length - 1)},${H}" fill="${c}" fill-opacity=".12"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="2.5"/>
          ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3.5" fill="${c}"/>`).join('')}<text x="2" y="10" class="axis">${Math.round(hi)}</text><text x="2" y="${H - 2}" class="axis">${Math.round(lo)}</text></svg>
        <small class="muted">${esc(pts[pts.length - 1].name)}</small></div>`;
    }).join('')}</div>`;
  }

  function renderAnalysis() {
    if (state.books) return booksHTML();
    const subjects = L.subjects();
    const scores = S.all('scores');
    const track = L.settings().track || 'なし';
    const key = today();
    // 主要教科(理系なら数学・理科・英語)を先に
    const ordered = subjects.filter(x => E.isCore(track, x.name)).concat(subjects.filter(x => !E.isCore(track, x.name)));
    const orderIdx = (name) => { const i = ordered.findIndex(x => x.name === name); return i < 0 ? 99 : i; };
    let html = `<div class="card mrow" data-act="books-open" style="margin-bottom:16px"><span class="rm-icon" style="background:#5856d6">📚</span>
      <div class="grow"><b>おすすめの参考書と予想ロードマップ</b><div class="muted">成績から、今やる本・次の本と目標までの道すじ</div></div><span class="muted">›</span></div>`;
    const latest = testGroups()[0];
    if (!scores.length) html += '<div class="card"><p class="muted">成績がまだありません(登録 → テストの結果)</p></div>';
    if (latest && track !== 'なし') {
      // 主要教科とほかの教科の、得点率の平均
      const core = latest.records.filter(x => E.isCore(track, x.subject)), rest = latest.records.filter(x => !E.isCore(track, x.subject));
      const avg = (list) => list.length ? list.reduce((t, x) => t + pct(x), 0) / list.length : null;
      const devs = core.map(E.effectiveDeviation).filter(v => v != null);
      html += `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0;color:#f08a24">★ ${esc(track)}の主要教科</h2><span class="muted">${esc(latest.first.testName)}</span></div>
        <div class="stats" style="margin-top:10px"><div class="stat"><b>${avg(core) == null ? '—' : Math.round(avg(core)) + '%'}</b><span>${track === '理系' ? '数学・理科・英語' : '国語・社会・英語'}</span></div>
        ${devs.length ? `<div class="stat"><b>${(devs.reduce((a, b) => a + b, 0) / devs.length).toFixed(1)}</b><span>${E.isMock(latest.first) ? '偏差値の平均' : '偏差値の目安'}</span></div>` : ''}
        ${avg(rest) != null ? `<div class="stat"><b class="muted">${Math.round(avg(rest))}%</b><span>ほかの教科</span></div>` : ''}</div></div>`;
    }
    if (scores.length) {
      const metric = state.metric || 'percent';
      html += `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">成績の推移</h2>
        <div class="row">${[['percent', '得点率'], ['deviation', '偏差値']].map(([k, t]) => `<button class="${metric === k ? '' : 'secondary'}" style="min-height:32px;padding:2px 12px" data-act="metric" data-k="${k}">${t}</button>`).join('')}</div></div>
        ${trendCards(ordered, scores, metric, track)}
        ${metric === 'deviation' ? '<p class="muted">考査は、順位か平均点から見積もった偏差値の目安</p>' : ''}</div>`;
    }
    if (latest) {
      const rows = latest.records.slice().sort((a, b) => orderIdx(a.subject) - orderIdx(b.subject)).map(x => {
        const dev = E.effectiveDeviation(x), diff = x.average != null ? x.score - x.average : null;
        return `<tr><td>${E.isCore(track, x.subject) ? '<span style="color:#f08a24">★</span> ' : ''}${tag(x.subject)}</td><td class="num">${num(x.score)}/${num(x.max)}</td>
          <td class="num">${diff != null ? `<b class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${num(diff)}</b>` : ''}</td>
          <td class="num muted">${x.rank != null ? `${x.rank}${x.takers ? '/' + x.takers : ''}位` : ''}</td>
          <td class="num">${dev != null ? `<span class="devchip">${x.deviation != null ? dev.toFixed(1) : '≈' + Math.round(dev)}</span>` : ''}</td></tr>`;
      }).join('');
      html += `<div class="card"><h2>最新:${esc(latest.first.testName)}(${mdShort(latest.first.date)})</h2><table>${rows}</table>
        <p class="muted">${E.isMock(latest.first) ? '右の数字は偏差値' : '緑・赤は平均点との差。右の ≈ は順位か平均点から見積もった偏差値の目安'}</p></div>`;
    }
    const weakBy = {};
    scores.filter(s => s.fields && s.fields.length).forEach(s => { if (!weakBy[s.subject] || weakBy[s.subject].date < s.date) weakBy[s.subject] = s; });
    const weakList = Object.values(weakBy).map(s => ({ s, weak: E.weakIn(s.fields) })).filter(x => x.weak.length).sort((a, b) => orderIdx(a.s.subject) - orderIdx(b.s.subject));
    if (weakList.length) {
      html += `<div class="card"><h2>苦手分野(最新の模試)</h2>${weakList.map(x => `<p style="margin:6px 0">${tag(x.s.subject)} ${x.weak.map(f => `${esc(f.name)} <b class="bad">${Math.round(f.score / f.max * 100)}%</b>`).join('、')}</p>`).join('')}
        <p class="muted">得点率60%未満、または教科の平均より10点以上低い分野。教材ルートの同じ分野の問題が先に出ます</p></div>`;
    }
    if (subjects.length) {
      const states = L.subjectStates(key).sort((a, b) => (E.isCore(track, a.name) ? 0 : 1) - (E.isCore(track, b.name) ? 0 : 1) || b.weakness - a.weakness);
      html += `<div class="card"><h2>苦手度(0〜100)</h2>${Charts.bars(states.map(s => ({ label: (E.isCore(track, s.name) ? '★' : '') + s.name, value: s.weakness, color: color(s.name), note: Math.round(s.weakness) })), { max: 100 })}
        <p class="muted">100 − 最近3回の平均(3:2:1)・下降で+10。偏差値(考査は目安)があれば得点率と半々で使う。★は${esc(track)}の主要教科</p></div>`;
    }
    return html;
  }

  // ---------------- 登録 ----------------

  function renderSetup() {
    const s = L.settings();
    const subjects = L.subjects();
    const slots = S.all('timetable');
    const periods = Math.max(6, ...slots.map(x => x.period), state.periods || 0);
    const user = Auth.user;
    let tt = '<tr><th></th>' + [2, 3, 4, 5, 6, 7].map(d => `<th>${DAYS[d]}</th>`).join('') + '</tr>';
    for (let p = 1; p <= periods; p++) {
      tt += `<tr><th>${p}</th>`;
      for (let d = 2; d <= 7; d++) {
        const slot = slots.find(x => x.weekday === d && x.period === p);
        tt += `<td><select data-act-change="slot" data-w="${d}" data-p="${p}" style="${slot ? `background:${color(slot.subject)};color:#fff` : ''}">
          <option value=""></option>${subjects.map(x => `<option ${slot && slot.subject === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></td>`;
      }
      tt += '</tr>';
    }
    const weekly = S.all('weeklyEvents').sort((a, b) => a.weekday - b.weekday || a.start - b.start);
    const events = S.all('events').sort((a, b) => a.date.localeCompare(b.date));
    const scores = S.all('scores').sort((a, b) => b.date.localeCompare(a.date));
    return `
      <div class="card"><h2>アカウントと同期</h2>${accountHTML(user)}</div>
      <div class="card"><h2>教科</h2>
        <div class="chips">${subjects.map(x => `<span class="chip" style="background:${color(x.name)}">${esc(x.name)}<button data-act="del-subject" data-id="${x.id}" aria-label="消す">×</button></span>`).join('') || '<span class="muted">まだ教科がありません</span>'}</div>
        <div class="row"><input id="new-subject" placeholder="教科を追加(例:数学)" style="flex:1;min-width:160px">
          <button data-act="add-subject">追加</button><button class="secondary" data-act="five-subjects">5教科を入れる</button></div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">時間割</h2>
        <span class="muted">1日 <select data-act-change="periods" style="width:auto;min-height:36px">${[4, 5, 6, 7, 8, 9].map(n => `<option ${n === periods ? 'selected' : ''}>${n}</option>`).join('')}</select> 時間目まで</span></div>
        <div style="overflow-x:auto;margin-top:8px"><table class="tt">${tt}</table></div></div>
      <div class="card"><h2>生活時間・時程</h2><div class="fg">
        ${[['wake', '起きる'], ['sleep', '寝る'], ['schoolStart', '学校の始まり'], ['schoolEnd', '学校が終わる']].map(([k, l]) => `<div><label>${l}</label><input type="time" data-set="${k}" data-time="1" value="${toTime(s[k])}"></div>`).join('')}
        ${[['commute', '通学(片道・分)'], ['living', '食事・お風呂など(分)'], ['periodLength', '1コマ(分)'], ['periodBreak', '休み時間(分)'], ['lunchAfter', '昼休みは何時間目のあと'], ['lunchLength', '昼休み(分)'], ['afterLast', '終礼など(分)']].map(([k, l]) => `<div><label>${l}</label><input type="number" data-set="${k}" value="${s[k]}"></div>`).join('')}
        <div><label>1時間目の始まり</label><input type="time" data-set="firstPeriodStart" data-time="1" value="${toTime(s.firstPeriodStart)}"></div>
      </div></div>
      <div class="card"><h2>文系・理系</h2><div class="row">${['理系', '文系', 'なし'].map(t => `<button class="${(s.track || 'なし') === t ? '' : 'secondary'}" data-act="track" data-t="${t}">${t}</button>`).join('')}
        <label style="margin-left:auto">目標の偏差値 <input type="number" min="45" max="78" data-set="goalDeviation" value="${s.goalDeviation || 65}" style="width:5em"></label></div>
        <p class="muted">理系なら数学・理科の優先度を1.2倍にして、分析でも数学・理科・英語を先に出します</p></div>
      <div class="card"><h2>毎週の予定(部活・塾)</h2>
        <table>${weekly.map(w => `<tr><td>${DAYS[w.weekday]}</td><td>${esc(w.title)}</td><td>${toTime(w.start)}〜${toTime(w.end)}</td><td class="num"><button class="danger" data-act="del" data-c="weeklyEvents" data-id="${w.id}">消す</button></td></tr>`).join('') || '<tr><td class="muted">まだありません</td></tr>'}</table>
        <div class="fg"><div><label>名前</label><input id="w-title" placeholder="部活"></div>
          <div><label>曜日</label><select id="w-day">${[2, 3, 4, 5, 6, 7, 1].map(d => `<option value="${d}">${DAYS[d]}曜</option>`).join('')}</select></div>
          <div><label>始まり</label><input id="w-start" type="time" value="16:10"></div><div><label>終わり</label><input id="w-end" type="time" value="18:30"></div>
          <div><button data-act="add-weekly" style="width:100%">追加</button></div></div></div>
      <div class="card"><h2>テスト・模試・行事</h2>
        <table>${events.map(e => `<tr><td>${md(e.date)}</td><td>${esc(e.kind)}</td><td>${esc(e.title)}${e.kind === '定期テスト' || e.kind === '模試' ? `<div class="muted">${esc(e.subjects && e.subjects.length ? e.subjects.join('・') : '全教科')}</div>` : ''}</td>
          <td class="muted">${e.periodFrom != null ? `${e.periodFrom}〜${e.periodTo}時間目` : e.hasTime ? `${toTime(e.start)}〜${toTime(e.end)}` : ''}</td>
          <td class="num"><button class="danger" data-act="del" data-c="events" data-id="${e.id}">消す</button></td></tr>`).join('') || '<tr><td class="muted">まだありません</td></tr>'}</table>
        <div class="fg"><div><label>種類</label><select id="e-kind"><option>定期テスト</option><option>模試</option><option>行事</option></select></div>
          <div><label>名前</label><input id="e-title" value="期末テスト"></div>
          <div><label>日にち</label><input id="e-date" type="date" value="${E.addDays(today(), 14)}"></div>
          <div><label>最終日(複数日なら)</label><input id="e-end" type="date"></div>
          <div><label>時間</label><select id="e-time"><option value="none">決まっていない</option><option value="clock">時刻</option><option value="period">時限</option></select></div>
          <div><label>始まり/何時間目から</label><input id="e-s" placeholder="9:00 か 8"></div>
          <div><label>終わり/何時間目まで</label><input id="e-e" placeholder="15:00 か 9"></div></div>
        <label>テストの教科(未選択 = 全教科)</label><div class="checks" id="e-subjects">${subjects.map(x => `<label><input type="checkbox" value="${esc(x.name)}">${esc(x.name)}</label>`).join('')}</div>
        <button data-act="add-event" style="margin-top:10px">追加</button></div>
      ${scoresHTML(subjects)}`;
  }

  /**
   * テストの結果(テストごとにまとめて表示。「直す」で下の入力欄に入れて直せる)
   * 考査は 平均点・順位・人数、模試は 偏差値 を入れる(種類を切りかえると欄が変わる)
   */
  function scoresHTML(subjects) {
    const groups = testGroups();
    const order = subjects.map(x => x.name);
    const editing = state.scoreEdit ? groups.find(g => g.key === state.scoreEdit) : null;
    const rec = (name) => editing ? editing.records.find(r => r.subject === name) : null;
    const first = editing ? editing.first : null;
    const kind = first ? (E.isMock(first) ? '模試' : '考査') : '考査';
    const maxes = editing ? editing.records.map(r => r.max) : [100];
    const common = maxes.sort((a, b) => maxes.filter(v => v === b).length - maxes.filter(v => v === a).length)[0];
    const names = order.concat(editing ? editing.records.map(r => r.subject).filter(n => !order.includes(n)) : []);
    const v = (x) => x == null ? '' : x;
    const detail = (r) => [r.deviation != null ? `偏差値${r.deviation}` : '', r.average != null ? `平均${num(r.average)}(${r.score - r.average >= 0 ? '+' : ''}${num(r.score - r.average)})` : '',
      r.rank != null ? `${r.rank}${r.takers ? '/' + r.takers : ''}位` : '', r.fields && r.fields.length ? `分野別${r.fields.length}` : ''].filter(Boolean).join('・');
    return `<div class="card"><h2>テストの結果</h2>
      ${groups.map(g => `<div class="test-group"><div class="row" style="justify-content:space-between">
          <div><span class="kind-tag ${E.isMock(g.first) ? 'mock' : 'exam'}">${E.isMock(g.first) ? '模試' : '考査'}</span> <b>${esc(g.first.testName)}</b> <span class="muted">${md(g.first.date)}</span></div>
          <div class="row"><button class="secondary" style="min-height:32px;padding:2px 12px" data-act="score-edit" data-k="${esc(g.key)}">直す</button>
          <button class="danger" data-act="score-del" data-k="${esc(g.key)}">消す</button></div></div>
        ${g.records.slice().sort((a, b) => (order.indexOf(a.subject) + 99) % 199 - (order.indexOf(b.subject) + 99) % 199).map(r => `<div class="row tg-row">${tag(r.subject)}<span class="num">${num(r.score)}/${num(r.max)}</span><span class="muted">${esc(detail(r))}</span></div>`).join('')}</div>`).join('') || '<p class="muted">まだありません</p>'}
      <div class="sform" id="sform" data-kind="${kind}"><h3>${editing ? `「${esc(first.testName)}」を直す` : '結果を追加'}</h3>
        <div class="fg"><div><label>種類</label><select id="s-kind" data-act-change="score-kind"><option ${kind === '考査' ? 'selected' : ''}>考査</option><option ${kind === '模試' ? 'selected' : ''}>模試</option></select></div>
          <div><label>テストの名前</label><input id="s-test" value="${esc(first ? first.testName : '中間テスト')}"></div>
          <div><label>日にち</label><input id="s-date" type="date" value="${first ? first.date : today()}"></div>
          <div><label>満点</label><input id="s-max" type="number" value="${common}"></div>
          <div class="k-exam"><label>人数(学年など・任意)</label><input id="s-takers" type="number" value="${v(editing && editing.records.map(r => r.takers).find(x => x != null))}"></div></div>
        ${names.map(name => { const r = rec(name) || {};
          return `<div class="fg" style="margin-top:6px"><div><label>${esc(name)}</label><input type="number" step="0.1" data-score="${esc(name)}" placeholder="点数" value="${v(r.score)}"></div>
          <div class="k-mock"><label>偏差値(任意)</label><input type="number" step="0.1" data-dev="${esc(name)}" value="${v(r.deviation)}"></div>
          <div class="k-exam"><label>平均点(任意)</label><input type="number" step="0.1" data-avg="${esc(name)}" value="${v(r.average)}"></div>
          <div class="k-exam"><label>順位(任意)</label><input type="number" data-rank="${esc(name)}" value="${v(r.rank)}"></div>
          <div style="grid-column:span 2"><label>分野別(任意)例:二次関数 25/30, 確率 12/35</label><input data-fields="${esc(name)}" value="${esc((r.fields || []).map(f => `${f.name} ${num(f.score)}/${num(f.max)}`).join(', '))}"></div></div>`; }).join('')}
        <p class="muted k-exam">平均点か順位を入れると、偏差値の目安を出して苦手度の計算に使います(順位があれば順位を優先)</p>
        <div class="row" style="margin-top:10px"><button data-act="add-scores">${editing ? '直して保存' : '保存'}</button>${editing ? '<button class="secondary" data-act="score-cancel">やめる</button>' : ''}</div></div></div>`;
  }

  /** アカウントの部分 */
  function accountHTML(user) {
    if (!Sync.configured()) return '<p class="warn">Firebaseの設定がまだです</p><p class="muted">web/planner/firebase-config.js に apiKey と projectId を入れると、iPhoneのアプリと同期できます。</p>';
    if (user) {
      return `<p>ログイン中:<b>${esc(user.email)}</b></p>
        <div class="row"><button data-act="sync" ${Sync.isSyncing ? 'disabled' : ''}>${Sync.isSyncing ? '同期中…' : '今すぐ同期'}</button>
        <button class="secondary" data-act="logout">ログアウト</button></div>
        ${Sync.lastSync ? `<p class="muted">最後の同期 ${Sync.lastSync.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</p>` : ''}
        ${Sync.lastError ? `<p class="bad">${esc(Sync.lastError)}</p>` : ''}
        <p class="muted">ログアウトしても、このブラウザのデータは消えません</p>`;
    }
    return `<div class="fg"><div><label>メールアドレス</label><input id="a-email" type="email" autocomplete="username"></div>
      <div><label>パスワード(6文字以上)</label><input id="a-pass" type="password" autocomplete="current-password"></div></div>
      <div class="row" style="margin-top:10px"><button data-act="login">ログイン</button><button class="secondary" data-act="signup">新しく登録</button></div>
      ${state.message ? `<p class="bad">${esc(state.message)}</p>` : ''}
      <p class="muted">iPhoneのアプリと同じメールアドレスでログインすると、データがそろいます</p>`;
  }

  // ---------------- 表示 ----------------

  const VIEWS = { today: renderToday, materials: renderMaterials, calendar: renderCalendar, analysis: renderAnalysis, setup: renderSetup };

  /** 今のタブを描く(入力中の文字が消えないよう、フォームを開いているときは呼び方に気をつける) */
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    $('view').innerHTML = VIEWS[state.tab]();
    const u = Auth.user;
    $('sync-dot').textContent = !Sync.configured() ? '' : !u ? '未ログイン' : Sync.isSyncing ? '同期中…' : Sync.lastError ? '⚠︎ 同期エラー' : '同期 ✓';
  }

  /** 保存して同期し、描き直す */
  function commit() {
    S.save();
    render();
    scheduleSync();
  }

  let syncTimer = null;
  /** 変更のあと、少し待ってから同期する(続けて押したときにまとめる) */
  function scheduleSync() {
    if (!Auth.user || !Sync.configured()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 2500);
  }
  /** 同期して描き直す */
  async function runSync() {
    render();
    await Sync.run(S);
    // iPhone と別々に作った同じ教科・時間割を1つにまとめ、消した分をすぐ同期する
    if (L.dedupe()) await Sync.run(S);
    if (!state.form) render();
  }

  // ---------------- 操作 ----------------

  const ACTIONS = {
    tab(el) { state.tab = el.dataset.tab; state.chip = null; try { localStorage.setItem('planner.tab', state.tab); } catch (e) { /* なし */ } render(); window.scrollTo(0, 0); },
    chip(el) { const k = `${el.dataset.m}#${el.dataset.no}`; state.chip = state.chip === k ? null : k; render(); },
    mark(el) { L.record(el.dataset.mark, el.dataset.m, Number(el.dataset.no), today()); state.chip = null; commit(); },
    undo(el) { L.undo(el.dataset.m, Number(el.dataset.no), today()); state.chip = null; commit(); },
    prog(el) { L.addProgress(Number(el.dataset.n), el.dataset.m, today()); commit(); },
    regen() { L.regeneratePlan(today()); commit(); },
    month(el) { const d = E.toDate(state.monthKey); d.setMonth(d.getMonth() + Number(el.dataset.n)); state.monthKey = E.keyOf(d); render(); },
    'open-material'(el) { state.detail = el.dataset.id; state.chip = null; render(); window.scrollTo(0, 0); },
    'close-detail'() { state.detail = null; state.chip = null; render(); },
    'new-material'() {
      state.form = { id: null, subject: (L.subjects()[0] || {}).name || '', name: '', role: 'メイン', kind: '問題集', period: '', note: '',
        amount: 0, unit: 'ページ', every: 2, group: '', activeFrom: null, activeUntil: null, laps: [] };
      render();
    },
    'edit-material'(el) { const m = S.get('materials', el.dataset.id); state.form = { ...m, laps: (m.laps || []).map(l => ({ ...l })) }; render(); },
    roadmap() { state.roadmap = true; render(); window.scrollTo(0, 0); },
    'close-roadmap'() { state.roadmap = false; render(); },
    'rm-range'(el) { state.rmRange = Number(el.dataset.n); render(); },
    'lap-toggle'(el) {
      const m = S.get('materials', el.dataset.m);
      const lap = (m.laps || []).find(l => l.lap === Number(el.dataset.lap));
      if (!lap) return;
      lap.done = lap.done ? null : today();
      S.put('materials', m.id, m); commit();
    },
    'lap-add'() {
      readMaterialForm();
      const f = state.form; f.laps = f.laps || [];
      const last = f.laps[f.laps.length - 1];
      const start = last && last.end ? E.addDays(last.end, 1) : today();
      const d = E.toDate(start); d.setMonth(d.getMonth() + 1);
      f.laps.push({ lap: f.laps.length + 1, start, end: E.keyOf(d), scope: f.laps.length ? '×だけ' : '全部', done: null });
      render();
    },
    'lap-del'(el) { readMaterialForm(); state.form.laps.splice(Number(el.dataset.i), 1); render(); },
    'delete-material'(el) {
      if (!confirm('この教材と、その○△×の記録を消しますか?')) return;
      S.all('attempts').filter(a => a.material === el.dataset.id).forEach(a => S.remove('attempts', a.id));
      S.remove('materials', el.dataset.id); state.detail = null; commit();
    },
    'mark-no'(el) {
      const no = Number($('mark-no').value);
      if (!(no > 0)) { alert('問題番号を入れてください'); return; }
      L.record(el.dataset.mark, el.dataset.m, no, today());
      commit();
    },
    'route-add'() {
      readMaterialForm();
      const f = state.form; const from = (f.route.length ? f.route[f.route.length - 1].to : 0) + 1;
      f.route.push({ title: `${f.route.length + 1}章`, from, to: Math.min(f.total, from + 19), field: '' }); render();
    },
    'route-del'(el) { readMaterialForm(); state.form.route.splice(Number(el.dataset.i), 1); render(); },
    'cancel-material'() { state.form = null; render(); },
    'save-material'() {
      readMaterialForm();
      const f = state.form;
      if (!f.name || !f.subject) { alert('教科と教材名を入れてください'); return; }
      // 教科がまだなければ、一緒に作る
      const list = L.subjects();
      if (f.subject !== '全教科' && !list.some(s => s.name === f.subject)) S.put('subjects', S.newID(), { name: f.subject, colorIndex: list.length, order: list.length });
      const id = f.id || S.newID();
      const old = S.get('materials', id);
      S.put('materials', id, { ...(old || { total: 0, done: 0, route: [], deadline: null }),
        subject: f.subject, name: f.name, role: f.role, kind: f.kind, period: f.period, note: f.note,
        routeOrder: old ? (old.routeOrder ?? null) : null, amount: f.amount, unit: f.unit, every: f.every, group: f.group, weekendOnly: !!f.weekendOnly,
        activeFrom: f.activeFrom, activeUntil: f.activeUntil, daily: f.every === 1,
        laps: (f.laps || []).filter(l => l.start && l.end).map((l, i) => ({ lap: i + 1, start: l.start, end: l.end < l.start ? l.start : l.end, scope: l.scope || '', done: l.done || null })),
        order: old ? old.order : L.materials().reduce((m, x) => Math.max(m, x.order || 0), -1) + 1 });
      state.form = null; state.detail = id;
      L.ensureDayLog(today());
      commit();
    },
    task(el) { const t = S.get('tasks', el.dataset.id); S.put('tasks', t.id, { ...t, done: el.checked }); commit(); },

    // 登録
    'add-subject'() {
      const name = $('new-subject').value.trim();
      const list = L.subjects();
      if (!name || list.some(s => s.name === name)) return;
      S.put('subjects', S.newID(), { name, colorIndex: list.length, order: list.length }); commit();
    },
    'five-subjects'() {
      ['国語', '数学', '英語', '理科', '社会'].forEach(name => {
        const list = L.subjects();
        if (!list.some(s => s.name === name)) S.put('subjects', S.newID(), { name, colorIndex: list.length, order: list.length });
      });
      commit();
    },
    'del-subject'(el) {
      const s = S.get('subjects', el.dataset.id);
      S.remove('subjects', s.id);
      S.all('timetable').filter(t => t.subject === s.name).forEach(t => S.remove('timetable', t.id));
      commit();
    },
    del(el) { S.remove(el.dataset.c, el.dataset.id); commit(); },
    'add-weekly'() {
      const title = $('w-title').value.trim(), start = toMin($('w-start').value), end = toMin($('w-end').value);
      if (!title || end <= start) { alert('名前と時間を確かめてください'); return; }
      S.put('weeklyEvents', S.newID(), { title, weekday: Number($('w-day').value), start, end });
      L.regeneratePlan(today()); commit();
    },
    'add-event'() {
      const kind = $('e-kind').value, title = $('e-title').value.trim(), from = $('e-date').value, to = $('e-end').value || from;
      if (!title || !from || to < from) { alert('名前と日にちを確かめてください'); return; }
      const mode = $('e-time').value, a = $('e-s').value.trim(), b = $('e-e').value.trim();
      const subs = kind === '行事' ? [] : [...document.querySelectorAll('#e-subjects input:checked')].map(c => c.value);
      for (let d = from; d <= to; d = E.addDays(d, 1)) {
        const ev = { title, kind, date: d, hasTime: mode !== 'none', start: 540, end: 900, subjects: subs, periodFrom: null, periodTo: null };
        if (mode === 'clock') { ev.start = toMin(a || '9:00'); ev.end = toMin(b || '15:00'); }
        if (mode === 'period') { ev.periodFrom = Number(a) || 1; ev.periodTo = Math.max(ev.periodFrom, Number(b) || ev.periodFrom); }
        S.put('events', S.newID(), ev);
      }
      L.regeneratePlan(today()); commit();
    },
    'add-scores'() {
      const max = Number($('s-max').value) || 100, date = $('s-date').value, testName = $('s-test').value.trim() || 'テスト';
      const kind = $('s-kind').value, mock = kind === '模試', takers = Number($('s-takers').value) || null;
      const numOrNull = (sel) => { const el = document.querySelector(sel); return el && el.value !== '' ? Number(el.value) : null; };
      // 直すときは、同じ教科の結果を書きかえ(IDはそのまま)、点数を消した教科の結果は消す
      const editing = state.scoreEdit ? testGroups().find(g => g.key === state.scoreEdit) : null;
      const remaining = editing ? editing.records.slice() : [];
      let count = 0;
      document.querySelectorAll('[data-score]').forEach(inp => {
        if (inp.value === '') return;
        const name = inp.dataset.score, q = CSS.escape(name);
        const fieldText = document.querySelector(`[data-fields="${q}"]`).value;
        // 「二次関数 25/30, 確率 12/35」→ 分野別の得点
        const fields = fieldText.split(/[,、\n]/).map(t => t.trim().match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/))
          .filter(Boolean).map(m => ({ name: m[1].trim(), score: Math.min(Number(m[2]), Number(m[3])), max: Number(m[3]) })).filter(f => f.max > 0);
        const old = remaining.find(r => r.subject === name);
        if (old) remaining.splice(remaining.indexOf(old), 1);
        // 模試は偏差値、考査は平均点・順位・人数(もう片方は消す)
        S.put('scores', old ? old.id : S.newID(), { date, testName, subject: name, score: Math.min(Number(inp.value), max), max, kind,
          deviation: mock ? numOrNull(`[data-dev="${q}"]`) : null, average: mock ? null : numOrNull(`[data-avg="${q}"]`),
          rank: mock ? null : numOrNull(`[data-rank="${q}"]`), takers: mock ? null : takers, fields });
        count++;
      });
      if (!count) { alert('点数を入れてください'); return; }
      remaining.forEach(r => S.remove('scores', r.id));
      state.scoreEdit = null;
      L.ensureDayLog(today()); commit();
    },
    'score-edit'(el) { state.scoreEdit = el.dataset.k; render(); $('sform').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'score-cancel'() { state.scoreEdit = null; render(); },
    'score-del'(el) {
      const g = testGroups().find(x => x.key === el.dataset.k);
      if (!g || !confirm(`「${g.first.testName}」の結果を全部消しますか?`)) return;
      g.records.forEach(r => S.remove('scores', r.id));
      if (state.scoreEdit === el.dataset.k) state.scoreEdit = null;
      commit();
    },
    track(el) { S.put('settings', 'main', { ...L.settings(), track: el.dataset.t }); commit(); },
    metric(el) { state.metric = el.dataset.k; render(); },
    'books-open'() { state.books = true; render(); window.scrollTo(0, 0); },
    'books-close'() { state.books = false; render(); },
    goal(el) { const s = L.settings(); S.put('settings', 'main', { ...s, goalDeviation: Math.min(78, Math.max(45, (s.goalDeviation || 65) + Number(el.dataset.d))) }); commit(); },
    /** おすすめの本を教材に足す(「後回し」で入れるので、今日のノルマはすぐには変わらない) */
    'book-add'(el) {
      const b = catalog.books.find(x => x.id === el.dataset.id);
      if (!b) return;
      S.put('materials', S.newID(), { total: 0, done: 0, route: [], deadline: null, subject: b.subject, name: b.name, role: '後回し', kind: '問題集',
        period: '', note: `おすすめから追加(${b.publisher}・偏差値 ${b.devLo}〜${b.devHi})`, routeOrder: null, amount: 0, unit: 'ページ', every: 0, group: '',
        weekendOnly: false, activeFrom: null, activeUntil: null, daily: false, laps: [], order: L.materials().reduce((m, x) => Math.max(m, x.order || 0), -1) + 1 });
      commit();
    },
    async login() { await auth('signIn'); },
    async signup() { await auth('signUp'); },
    logout() { Auth.signOut(); render(); },
    sync() { runSync(); },
    'add-open'() { state.addOpen = !state.addOpen; render(); },
    'add-mode'(el) { state.addMode = el.dataset.mode; render(); },
    'add-material'(el) { L.addToday(el.dataset.m, today()); state.addOpen = false; commit(); },
    'add-custom'() {
      const title = $('cq-title').value.trim();
      if (!title) { alert('やることを書いてください'); return; }
      L.addCustom(title, Number($('cq-amount').value) || 0, $('cq-unit').value, today());
      state.addOpen = false; commit();
    },
    'q-remove'(el) { L.removeFromToday(el.dataset.m, today()); commit(); },
    help() { showHelp(); },
  };

  /** ログイン・登録して、すぐ同期する */
  async function auth(kind) {
    const email = $('a-email').value.trim(), pass = $('a-pass').value;
    state.message = '';
    try { await Auth[kind](email, pass); await runSync(); } catch (e) { state.message = e.message; render(); }
  }

  /** 値が変わったとき(select・設定の入力) */
  function onChange(el) {
    if (el.dataset.actChange === 'slot') {
      const w = Number(el.dataset.w), p = Number(el.dataset.p);
      S.all('timetable').filter(t => t.weekday === w && t.period === p).forEach(t => S.remove('timetable', t.id));
      if (el.value) S.put('timetable', S.newID(), { weekday: w, period: p, subject: el.value });
      commit();
    } else if (el.dataset.actChange === 'score-kind') {
      $('sform').dataset.kind = el.value;
    } else if (el.dataset.actChange === 'periods') {
      state.periods = Number(el.value); render();
    } else if (el.dataset.set) {
      const s = L.settings();
      s[el.dataset.set] = el.dataset.time ? toMin(el.value) : Number(el.value) || 0;
      S.put('settings', 'main', s); commit();
    }
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    ev.preventDefault();
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.id === 'import-json' && el.files[0]) {
      try { state.importMessage = L.importJSON(JSON.parse(await el.files[0].text())); }
      catch (e) { state.importMessage = 'JSONを読めませんでした(' + e.message + ')'; }
      commit();
      return;
    }
    if (el.dataset.act === 'task') { ACTIONS.task(el); return; }
    if (el.dataset.act === 'quota') { L.toggleDone(el.dataset.m, today()); commit(); return; }
    if (el.dataset.actChange || el.dataset.set) onChange(el);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing && ev.target.id === 'new-subject') ACTIONS['add-subject']();
  });

  // ---------------- 前のバージョンのリンク(#d=)の取り込み ----------------

  /** アプリから共有された設定(前のバージョンの形)を、このブラウザのデータに入れる */
  function importLegacy(data) {
    const have = new Set(L.subjects().map(s => s.name));
    (data.subjects || []).forEach(name => { if (!have.has(name)) { const n = L.subjects().length; S.put('subjects', S.newID(), { name, colorIndex: n, order: n }); have.add(name); } });
    if (data.timetable && data.timetable.length && !S.all('timetable').length) data.timetable.forEach(t => S.put('timetable', S.newID(), { weekday: t.w, period: t.p, subject: t.s }));
    if (data.life) S.put('settings', 'main', { ...L.settings(), wake: data.life.wake, sleep: data.life.sleep, schoolStart: data.life.schoolStart, schoolEnd: data.life.schoolEnd, commute: data.life.commute, living: data.life.living });
    if (!S.all('weeklyEvents').length) (data.weekly || []).forEach(w => S.put('weeklyEvents', S.newID(), { title: w.t, weekday: w.w, start: w.s, end: w.e }));
    if (!S.all('events').length) (data.events || []).forEach(e => S.put('events', S.newID(), { title: e.t, kind: e.k, date: e.d, hasTime: false, start: 540, end: 900, subjects: e.subs || [], periodFrom: null, periodTo: null }));
    if (!S.all('scores').length) (data.scores || []).forEach(x => S.put('scores', S.newID(), { date: x.d, testName: x.t, subject: x.s, score: x.sc, max: x.mx, deviation: x.dev ?? null, fields: [] }));
    S.save();
  }

  (async () => {
    const payload = Bridge.hashPayload();
    if (payload && Bridge.supported) {
      const data = await Bridge.decode(payload);
      if (data && data.kind === 'planner') importLegacy(data);
      history.replaceState(null, '', location.pathname);
    }
    L.dedupe();   // 足りない教科を作り直す(ログインしていなくても)
    render();
    try { if (!localStorage.getItem('planner.seenHelp')) { localStorage.setItem('planner.seenHelp', '1'); showHelp(); } } catch (e) { /* なし */ }
    document.addEventListener('toggle', (ev) => { if (ev.target.matches && ev.target.matches('[data-time]')) state.showTime = ev.target.open; }, true);
    if (Auth.user && Sync.configured()) runSync();
    // 画面に戻ってきたら同期する
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !state.form) runSync(); });
  })();
})();
