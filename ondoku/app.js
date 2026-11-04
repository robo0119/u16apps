// Recito Web版(iOS版と同じ:練習・ライブラリ・記録・苦手)
// - 英文を声に出して読むと、読めた単語は緑、言えなかった単語は赤。正確さと速さを出す
// - アプリから共有されたリンク(#d=)なら、上達レポートを表示する
// 記録はこのブラウザの中だけに保存する(サーバーには送らない)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SCHEME = 'u16ondoku';
  const KEY = 'ondoku.passage';
  const HISTORY_KEY = 'ondoku.history';
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // 見本の英文(はじめての人がすぐ試せるように。やさしい順)
  const SAMPLES = [
    { label: 'はじめて', text: 'Reading aloud is a great way to learn English. When you read a text out loud, you practice listening, speaking, and reading at the same time. Try to read clearly and keep a steady pace.' },
    { label: '英検2級くらい', text: 'Many students use their smartphones to study after school. Some apps can check your pronunciation and show which words you missed. However, it is still important to practice every day, because a new habit takes time to build. Even ten minutes a day can make a big difference.' },
    { label: '英検準1級くらい', text: 'Researchers have found that people remember information better when they say it out loud. This is sometimes called the production effect. Because speaking requires us to plan, pronounce, and hear each word, the brain treats the material as more distinctive. As a result, reading aloud can be a surprisingly effective strategy for learners preparing for exams.' },
  ];

  // ---------------- 読み上げ(お手本) ----------------

  /** 英語の声を選ぶ(端末に入っている en-US の声のうち、名前に Premium・Enhanced・Natural があるものを優先) */
  function voice() {
    const list = speechSynthesis.getVoices().filter(v => v.lang && v.lang.replace('_', '-').startsWith('en-US'));
    return list.find(v => /premium|enhanced|natural/i.test(v.name)) || list.find(v => v.localService) || list[0] || null;
  }

  /** お手本の発音を読み上げる(ブラウザの読み上げ機能。端末の中で動く)rate:速さ(1がふつう) */
  function speak(text, rate = 0.85) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    const v = voice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  // ---------------- 採点(アプリの WordAligner.swift と同じ計算) ----------------

  const NUMBERS = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 20: 'twenty', 100: 'hundred', '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth' };
  // 比べる用の形:小文字・前後の記号を取る・数字を英単語に
  const normalize = (w) => { let s = w.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''); return NUMBERS[s] || s; };
  const tokenize = (text) => text.split(/[\s—–]+/).flatMap(w => { const p = w.split('-').filter(Boolean); return p.map((x, i) => ({ display: i < p.length - 1 ? x + '-' : x, norm: normalize(x) })); }).filter(t => t.norm);

  // 最長共通部分列(アプリの WordAligner.swift と同じ)
  // dp[i][j] = お手本の i 語目から後ろと、音読の j 語目から後ろで、順番どおりにそろう単語の最大数
  // 前からたどり、同じ単語ならその場で対応させる(同じ単語が何回も出ても、前のほうと対応する)
  function align(reference, spoken) {
    const ref = tokenize(reference), hyp = tokenize(spoken).map(t => t.norm);
    const n = ref.length, m = hyp.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ref[i].norm === hyp[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    // hyp[i] = お手本の i 語目に対応した、音読の何語目か(なければ -1。シャドーイングの遅れに使う)
    const pair = new Array(n).fill(-1);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (ref[i].norm === hyp[j]) { pair[i] = j; i++; j++; }
      else if (dp[i][j + 1] >= dp[i + 1][j]) j++; else i++;
    }
    return ref.map((t, i) => ({ ...t, ok: pair[i] >= 0, hyp: pair[i] }));
  }

  /** 読んでいる途中の色:読めた単語は緑、読めた単語より前で抜けた単語は赤、まだ先の単語は色なし */
  function live(reference, spoken) {
    const words = align(reference, spoken);
    let last = -1;
    words.forEach((w, i) => { if (w.ok) last = i; });
    return words.map((w, i) => w.ok ? 'read' : i < last ? 'miss' : 'todo');
  }

  /** 文の終わりの単語か(. ! ? で終わる。後ろの " ' ) は無視) */
  const endsSentence = (display) => /[.!?]$/.test(display.replace(/["'”’)]+$/, ''));

  /**
   * 採点の結果を作る(音読・シャドーイングで同じ形)
   * - 正確さ = 読めた単語 ÷ お手本の単語 × 100
   * - 速さ = 読めた単語 ÷ (話していた秒 ÷ 60)。飛ばした単語は数えないので、早口で飛ばしても速さは上がらない
   * - 文ごとの正確さ = その文の読めた単語 ÷ その文の単語 × 100
   */
  function makeResult(passage, spoken, seconds, extra = {}) {
    const words = align(passage, spoken);
    const read = words.filter(w => w.ok).length;
    const sentences = [];
    let cur = [];
    words.forEach((w, i) => { cur.push({ ...w, i }); if (endsSentence(w.display)) { sentences.push(cur); cur = []; } });
    if (cur.length) sentences.push(cur);
    return {
      passage, spoken, words, read, seconds,
      acc: words.length ? read / words.length * 100 : 0,
      wpm: seconds > 1 ? read / (seconds / 60) : 0,
      sentences: sentences.map(ws => ({ text: ws.map(w => w.display).join(' '), acc: ws.filter(w => w.ok).length / ws.length * 100, lag: null })),
      lag: null,
      ...extra,
    };
  }

  // ---------------- 苦手な音(アプリの SoundDiagnosis.swift と同じ) ----------------

  const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'but', 'or', 'is', 'are', 'was', 'it', 'as', 'by', 'with', 'from']);
  const SOUNDS = [
    { name: 'th の音', examples: 'think, the, mother', advice: '舌先を上の歯に当てて息を出す', test: w => w.includes('th') },
    { name: 'r と l', examples: 'read, light, problem, glass', advice: 'r は舌を丸める・l は舌先を歯の裏へ', test: w => /^(r|l)|[bcdfgkpt](r|l)/.test(w) },
    { name: 'v の音', examples: 'very, have, love', advice: '上の歯を下唇に当てて「ヴ」', test: w => w.includes('v') },
    { name: '語尾の子音', examples: 'played, cats, first, and', advice: '語尾の d・t・s に母音を付けない', test: w => /(ed|[^aeiou']s|st|nd|nt|ld|lt|ft|pt|ct)$/.test(w) },
    { name: '短いつなぎの単語', examples: 'a, the, of, to, in', advice: '弱く短く、でも飛ばさない', test: w => FUNCTION_WORDS.has(w) },
    { name: '長い単語', examples: 'important, information', advice: '音節に区切って練習(im-por-tant)', test: w => w.length >= 9 },
  ];
  /** 判定に必要な、そのグループの単語の最少の数(少なすぎると偶然に左右されるため) */
  const MIN_SAMPLES = 5;

  /**
   * 音のグループごとの、読めなかった割合
   * 1. 記録ごとに、お手本と音読を対応付け直して、単語ごとに読めたかを出す
   * 2. グループに入る単語の数(total)と、そのうち読めなかった数(missed)を数える
   * 3. 読めなかった割合 = missed ÷ total
   */
  function soundStats(results) {
    const words = results.flatMap(r => r.words);
    const overall = words.length ? words.filter(w => !w.ok).length / words.length : 0;
    const groups = SOUNDS.map(g => {
      const inGroup = words.filter(w => g.test(w.norm));
      const missed = inGroup.filter(w => !w.ok).map(w => w.norm);
      return { ...g, total: inGroup.length, missed: missed.length, rate: inGroup.length ? missed.length / inGroup.length : 0, missedWords: ranked(missed) };
    });
    // いちばん苦手な音 = 十分な数があり、読めなかった割合が一番高く、全体の平均より高いもの
    const weakest = groups.filter(g => g.total >= MIN_SAMPLES && g.missed > 0 && g.rate > overall).sort((a, b) => b.rate - a.rate)[0] || null;
    return { groups, overall, weakest };
  }

  /** 単語を、多く出てきた順に重なりなしで並べる(同じ回数ならアルファベット順) */
  function ranked(words) {
    const count = {};
    words.forEach(w => { count[w] = (count[w] || 0) + 1; });
    return Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b));
  }

  // ---------------- 記録(このブラウザの中だけ) ----------------

  /** 記録を読む(古い順) */
  function history() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }

  /** 結果を記録に残す(最新の300回まで) */
  function record(r, mode) {
    if (!r.words.length || !r.spoken.trim()) return;
    const list = history();
    list.push({ d: new Date().toISOString(), mode, passage: r.passage, spoken: r.spoken, acc: Math.round(r.acc * 10) / 10,
      wpm: Math.round(r.wpm), sec: Math.round(r.seconds), total: r.words.length, miss: [...new Set(r.words.filter(w => !w.ok).map(w => w.norm))] });
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-300))); } catch (e) { /* 容量など */ }
    if (window.RecitoLibrary) RecitoLibrary.record(r.passage, r.acc);
  }

  /** 同じ英文の前回の正確さ(今回の記録の1つ前。なければ null) */
  function previousAccuracy(passage) {
    const same = history().filter(h => h.passage === passage);
    return same.length >= 2 ? same[same.length - 2].acc : null;
  }

  // ---------------- 結果の表示(音読・シャドーイングで共通) ----------------

  /** 正確さに合わせたひとこと(95%以上・85%以上・70%以上・それ未満) */
  const grade = (acc) => acc >= 95 ? ['Excellent!', 'var(--good)'] : acc >= 85 ? ['Great!', 'var(--good)'] : acc >= 70 ? ['Good', 'var(--accent)'] : ['Keep going', 'var(--bad)'];

  /**
   * 速さの目安のバー:中高生の音読のちょうどよい速さ 100〜150語/分 を緑の帯にし、今回の速さに印
   * 位置 = 速さ ÷ 200(200語/分で右はし)
   */
  function paceBar(wpm) {
    const pos = Math.min(100, wpm / 200 * 100);
    const note = wpm === 0 ? '' : wpm < 100 ? 'もう少し速く' : wpm <= 150 ? 'ちょうどよい速さ' : '少し速すぎ';
    return `<div class="pace"><div class="pace-track"><span class="pace-ok"></span><i style="left:${pos}%"></i></div>
      <div class="pace-labels"><span>0</span><span>100</span><span>150</span><span>200語/分</span></div><p class="muted" style="margin:2px 0 0">${note}</p></div>`;
  }

  /** 結果のHTML。opts.mode:'read' か 'shadow'、opts.prev:前回の正確さ */
  function resultHTML(r, opts = {}) {
    if (!r.words.length || !r.spoken.trim()) return '<div class="card"><p class="warn">聞き取れませんでした。マイクに近づいて、もう一度どうぞ</p></div>';
    const [g, gc] = grade(r.acc);
    const missed = [...new Set(r.words.filter(w => !w.ok).map(w => w.norm))];
    const diff = opts.prev != null ? Math.round(r.acc - opts.prev) : null;
    const lagText = (x) => x == null ? '—' : `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}秒`;
    const showLag = opts.mode === 'shadow' && r.lag != null;
    const sound = soundStats([r]).weakest;
    return `<div class="card result">
      <div class="score">
        <div class="score-donut">${Charts.donut([{ label: 'ok', value: r.read, color: '#22994f' }, { label: 'miss', value: r.words.length - r.read, color: '#e2474f' }], { center: `${Math.round(r.acc)}`, sub: '% 正確' })}</div>
        <div class="score-side">
          <div class="grade" style="color:${gc}">${g}</div>
          ${diff != null ? `<div class="${diff >= 0 ? 'good' : 'bad'} diff">${diff >= 0 ? '↗' : '↘'} 前回より ${diff >= 0 ? '+' : ''}${diff}</div>` : ''}
          <div class="big">${Math.round(r.wpm)}</div><div class="muted">語 / 分(速さ)</div>
          <div class="facts"><span class="good">✓ ${r.read} 語 読めた</span><span class="bad">✕ ${r.words.length - r.read} 語 まだ</span><span class="muted">⏱ ${Math.round(r.seconds)} 秒</span>
            ${showLag ? `<span>↔ お手本から ${lagText(r.lag)}</span>` : ''}</div>
        </div>
      </div>
      ${paceBar(r.wpm)}
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><span class="muted">赤をタップで発音</span><button class="ghost" data-say="${esc(r.words.map(w => w.display).join(' '))}" data-rate="1">🔊 全文</button></div>
      <p class="words">${r.words.map(w => w.ok ? `<span class="w-ok">${esc(w.display)}</span>` : `<span class="w-miss" data-say="${esc(w.norm)}">${esc(w.display)}</span>`).join(' ')}</p>
    </div>
    ${missed.length ? `<div class="card"><h2>練習する単語</h2>${missed.map(w => `<button class="miss-chip" data-say="${esc(w)}">🔊 ${esc(w)}</button>`).join('')}
      <div class="row" style="margin-top:10px"><button class="secondary" data-ow="practice-missed">赤い単語だけで練習</button></div></div>` : ''}
    ${r.sentences.length > 1 ? `<div class="card"><h2>文ごとの正確さ</h2><table>
      ${r.sentences.map(s => `<tr><td class="sent">${esc(s.text)}</td><td class="num"><span class="pill ${s.acc >= 85 ? 'ok' : s.acc < 70 ? 'ng' : ''}">${Math.round(s.acc)}%</span></td>${showLag ? `<td class="num muted">${lagText(s.lag)}</td>` : ''}</tr>`).join('')}</table>
      ${showLag ? '<p class="muted">右は、お手本からの遅れ(目安)</p>' : ''}</div>` : ''}
    ${sound ? `<div class="card tip"><b>今回つまずいた音:${esc(sound.name)}</b><p>${esc(sound.advice)}(例:${esc(sound.examples)})</p></div>` : ''}`;
  }

  // ---------------- 練習の画面 ----------------

  const state = { tab: 'practice', mode: 'read', editing: false, listening: false, result: null };

  /** 英文(入力欄の中身) */
  const passage = () => $('passage').value.trim();

  /** 英文の表示(読む前・読んでいる途中は色つき) */
  function renderPassage(colors) {
    const words = tokenize(passage());
    $('count').textContent = `${words.length} 語`;
    $('pview').innerHTML = words.length
      ? words.map((w, i) => `<span class="pw ${colors ? colors[i] : ''}">${esc(w.display)}</span>`).join(' ')
      : '<span class="muted">英文を入れてください(✎ 編集 から貼り付け)</span>';
    $('pview').classList.toggle('hidden', state.editing);
    $('passage').classList.toggle('hidden', !state.editing);
    $('edit').textContent = state.editing ? '✓ 完了' : '✎ 編集';
    document.querySelectorAll('[data-sample]').forEach(b => b.classList.toggle('on', SAMPLES[Number(b.dataset.sample)].text === passage()));
  }

  /** 英文を入れかえる(見本・ライブラリ・苦手な単語から) */
  function usePassage(text, mode) {
    $('passage').value = text;
    $('passage').dispatchEvent(new Event('input'));
    state.result = null;
    $('result').innerHTML = '';
    if (mode) setMode(mode);
    showTab('practice');
    document.querySelector('.passage-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** 音読とシャドーイングを切りかえる */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('read-panel').classList.toggle('hidden', mode !== 'read');
    $('shadow').classList.toggle('hidden', mode !== 'shadow');
  }

  /**
   * 音読(マイク)
   * 聞き取った文が届くたびに、お手本と対応付けて色をつける。止めたら採点
   * 話していた秒 = 最後に文字が届いた時刻 − 最初に文字が届いた時刻 + 0.5秒(届かなければ、押していた長さ)
   */
  function setupMic() {
    if (!Recognition) return;
    let rec = null, started = 0, first = 0, lastAt = 0, text = '', kept = '', total = 0;

    /** 聞き取りを1回始める(途中で切れたら、それまでの文を kept に残して、もう一度これを呼ぶ) */
    const begin = () => {
      rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        const now = Array.from(e.results).map(r => r[0].transcript).join(' ');
        text = (kept + ' ' + now).trim();
        if (!first) first = Date.now();
        lastAt = Date.now();
        const colors = live(passage(), text);
        renderPassage(colors);
        $('progress').style.width = `${(colors.lastIndexOf('read') + 1) / Math.max(1, total) * 100}%`;
        // 最後の単語まで読めたら、少し待って止める
        if (colors[colors.length - 1] === 'read') setTimeout(stopListening, 700);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          $('mic-note').innerHTML = '<span class="bad">マイクが使えません。アドレスバーの🔒からマイクを許可してください</span>';
          state.listening = false;
        }
      };
      rec.onend = () => {
        // 黙っている時間が長いと、ブラウザが聞き取りを止めることがある → 2分までは、つなぎ直す
        if (state.listening && Date.now() - started < 120000) { kept = text; try { begin(); return; } catch (err) { /* 採点へ */ } }
        rec = null;
        state.listening = false;
        updateMic();
        const seconds = first && lastAt - first > 1000 ? (lastAt - first) / 1000 + 0.5 : (Date.now() - started) / 1000;
        finishRead(text, seconds);
      };
      rec.start();
    };

    /** 聞き取りを止める(止まったら onend で採点) */
    const stopListening = () => { if (rec && state.listening) { state.listening = false; rec.stop(); } };

    $('mic').onclick = () => {
      if (rec) { stopListening(); return; }
      if (!passage()) { state.editing = true; renderPassage(); return; }
      state.editing = false;
      speechSynthesis.cancel();
      text = ''; kept = ''; started = Date.now(); first = 0; lastAt = 0;
      total = tokenize(passage()).length;
      $('mic-note').textContent = '';
      $('progress').style.width = '0%';
      $('result').innerHTML = '';
      renderPassage(new Array(total).fill('todo'));
      state.listening = true;
      updateMic();
      begin();
    };
  }

  /** マイクのボタンの見た目 */
  function updateMic() {
    $('mic').classList.toggle('on', state.listening);
    $('mic').innerHTML = state.listening ? '<span class="stop"></span>' : '🎤';
    $('mic-label').textContent = state.listening ? '終わったらタップ' : 'タップして音読';
    $('progress-wrap').classList.toggle('hidden', !state.listening);
  }

  /** 音読を採点して、結果を出して記録する */
  function finishRead(spoken, seconds) {
    const r = makeResult(passage(), spoken, seconds);
    state.result = r;
    record(r, '音読');
    $('result').innerHTML = resultHTML(r, { mode: 'read', prev: previousAccuracy(r.passage) });
    renderPassage(r.words.map(w => w.ok ? 'read' : 'miss'));
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------- 記録の画面 ----------------

  /** 連続日数:今日(または昨日)から、1日も空けずに練習した日の数 */
  function streakDays(list) {
    const days = new Set(list.map(h => h.d.slice(0, 10)));
    const d = new Date();
    const key = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (!days.has(key(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /** 記録のタブ:回数・連続日数・正確さと速さのグラフ・最近の練習 */
  function renderHistory() {
    const list = history();
    if (!list.length) { $('tab-history').innerHTML = '<div class="card empty"><div class="big-icon">📈</div><b>まだ記録がありません</b><p class="muted">練習すると、ここに上達のグラフが出ます</p></div>'; return; }
    const t = (h) => new Date(h.d).getTime();
    const recent = list.slice(-5), avg = (a, k) => a.reduce((s, h) => s + h[k], 0) / a.length;
    $('tab-history').innerHTML = `
      <div class="stats-grid">
        <div class="stat-tile"><b>${list.length}</b><span>回 練習</span></div>
        <div class="stat-tile"><b>${streakDays(list)}</b><span>日 連続</span></div>
        <div class="stat-tile"><b>${Math.round(avg(recent, 'acc'))}%</b><span>最近5回の正確さ</span></div>
        <div class="stat-tile"><b>${Math.round(avg(recent, 'wpm'))}</b><span>最近5回の語/分</span></div>
      </div>
      <div class="grid">
        <div class="card"><h2>正確さ(%)</h2>${Charts.lines([{ label: '正確さ', color: '#22994f', points: list.map(h => ({ x: t(h), y: h.acc })) }], { yMax: 100 })}</div>
        <div class="card"><h2>速さ(語/分)</h2>${Charts.lines([{ label: '速さ', color: '#4a6fd1', points: list.map(h => ({ x: t(h), y: h.wpm })) }], { yMax: Math.max(60, Math.ceil(Math.max(...list.map(h => h.wpm)) / 20) * 20) })}</div>
      </div>
      <div class="card"><h2>最近の練習</h2>${list.slice(-15).reverse().map((h, i) => `<div class="hrow">
        <div><span class="mode-tag">${esc(h.mode)}</span> <span class="muted">${new Date(h.d).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <div class="hpass">${esc(h.passage.slice(0, 70))}${h.passage.length > 70 ? '…' : ''}</div></div>
        <div class="hnum"><b class="${h.acc >= 85 ? 'good' : h.acc < 70 ? 'bad' : ''}">${Math.round(h.acc)}%</b><span class="muted">${h.wpm}語/分</span>
          <button class="ghost" data-ow="again" data-i="${list.length - 1 - i}">もう一度</button></div></div>`).join('')}
        <p class="muted" style="margin-top:10px">記録はこのブラウザの中だけに保存されます <button class="ghost" data-ow="clear-history">記録を消す</button></p></div>`;
  }

  // ---------------- 苦手の画面 ----------------

  /** 苦手のタブ:苦手な音の診断(最近30回)と、苦手な単語ノート */
  function renderWeak() {
    const list = history().slice(-30);
    if (!list.length) { $('tab-weak').innerHTML = '<div class="card empty"><div class="big-icon">🔍</div><b>まだ記録がありません</b><p class="muted">何回か練習すると、苦手な音と単語がわかります</p></div>'; return; }
    const results = list.map(h => ({ words: align(h.passage, h.spoken) }));
    const { groups, overall, weakest } = soundStats(results);
    const count = {};
    results.flatMap(r => r.words).filter(w => !w.ok).forEach(w => { count[w.norm] = (count[w.norm] || 0) + 1; });
    const words = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).slice(0, 30);
    $('tab-weak').innerHTML = `
      <div class="card diag"><span class="muted">あなたの苦手な音</span>
        ${weakest ? `<div class="diag-name">${esc(weakest.name)}</div><b>ミス率 ${Math.round(weakest.rate * 100)}%(平均 ${Math.round(overall * 100)}%)</b><p>${esc(weakest.advice)}</p>
          <div>${weakest.missedWords.slice(0, 5).map(w => `<button class="miss-chip" data-say="${esc(w)}">🔊 ${esc(w)}</button>`).join('')}</div>`
          : '<div class="diag-name good">特に苦手な音はありません</div>'}</div>
      <div class="card"><h2>音ごとのミス率</h2>${Charts.bars(groups.map(g => ({ label: g.name, value: Math.round(g.rate * 100),
          color: g.total < MIN_SAMPLES ? 'color-mix(in srgb, var(--muted) 35%, transparent)' : g.rate > overall ? '#e2474f' : '#22994f', note: `${g.missed}/${g.total}` })), { max: 100 })}
        <p class="muted">赤 = 平均(${Math.round(overall * 100)}%)より多い・${MIN_SAMPLES}語未満は灰色。最近${list.length}回の練習から</p></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">苦手な単語</h2>
        ${words.length ? '<button data-ow="practice-weak">🎤 苦手な単語で練習</button>' : ''}</div>
        ${words.length ? `<div class="weak-list">${words.map(w => `<button class="weak-word" data-say="${esc(w)}"><span>🔊 ${esc(w)}</span><b>×${count[w]}</b></button>`).join('')}</div>` : '<p class="muted">なし</p>'}</div>`;
  }

  // ---------------- タブ ----------------

  /** タブを切りかえる(記録と苦手は開くたびに描き直す) */
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    ['practice', 'library', 'history', 'weak'].forEach(t => $(`tab-${t}`).classList.toggle('hidden', t !== tab));
    if (tab === 'history') renderHistory();
    if (tab === 'weak') renderWeak();
    try { localStorage.setItem('ondoku.tab', tab); } catch (e) { /* なし */ }
  }

  // ---------------- 上達レポート(アプリから共有されたリンク) ----------------

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
    $('report').innerHTML = `<main>
      <div class="card"><div class="row" style="justify-content:space-between">
        <div><span class="shared-badge">アプリから共有されたレポート</span><h2 style="font-size:1.4rem;margin:8px 0 0">音読の上達レポート</h2></div>
        <button class="no-print" onclick="window.print()">印刷する</button></div>
        <div class="stats" style="margin-top:12px">
          <div class="stat"><b>${recs.length}</b><span>回 練習</span></div>
          <div class="stat"><b>${Math.round(avg(last, 'acc'))}%</b><span>正確さ(最初 ${Math.round(avg(first, 'acc'))}%)</span></div>
          <div class="stat"><b>${Math.round(avg(last, 'wpm'))}</b><span>語/分(最初 ${Math.round(avg(first, 'wpm'))})</span></div>
        </div></div>
      <div class="grid">
        <div class="card"><h2>正確さ(%)</h2>${Charts.lines([{ label: '正確さ', color: '#22994f', points: recs.map(r => ({ x: t(r), y: r.acc })) }], { yMax: 100 })}</div>
        <div class="card"><h2>速さ(語/分)</h2>${Charts.lines([{ label: '速さ', color: '#4466cc', points: recs.map(r => ({ x: t(r), y: r.wpm })) }], { yMax: Math.max(60, Math.ceil(Math.max(...recs.map(r => r.wpm), 0) / 20) * 20) })}</div>
      </div>
      <div class="card"><h2>よく読めない単語</h2>
        ${misses.length ? misses.map(([w, c]) => `<button class="miss-chip" data-say="${esc(w)}">🔊 ${esc(w)} <small>×${c}</small></button>`).join('') : '<p class="muted">なし</p>'}
      </div></main>`;
  }

  // ---------------- アプリへ送る ----------------

  async function renderSend() {
    const text = passage();
    if (!text) { $('send').innerHTML = '<p class="muted">英文を入れると、QRコードが出ます</p>'; return; }
    if (!Bridge.supported) { $('send').innerHTML = '<p class="warn">このブラウザは非対応</p>'; return; }
    const payload = await Bridge.encode({ v: 1, kind: 'ondoku', passage: text });
    Bridge.renderSendPanel($('send'), Bridge.appLink(SCHEME, 'import', payload), 'iPhoneで読むとRecitoに入ります');
  }

  // ---------------- 操作 ----------------

  const ACTIONS = {
    'practice-missed'() { usePassage([...new Set(state.result.words.filter(w => !w.ok).map(w => w.norm))].join(' '), 'read'); },
    'practice-weak'() {
      const results = history().slice(-30).map(h => align(h.passage, h.spoken));
      usePassage(ranked(results.flat().filter(w => !w.ok).map(w => w.norm)).slice(0, 20).join(' '), 'read');
    },
    again(el) { usePassage(history()[Number(el.dataset.i)].passage, history()[Number(el.dataset.i)].mode === 'シャドーイング' ? 'shadow' : 'read'); },
    'clear-history'() { if (confirm('このブラウザの練習の記録を全部消しますか?')) { try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* なし */ } renderHistory(); } },
  };

  document.addEventListener('click', (ev) => {
    const say = ev.target.closest('[data-say]');
    if (say) { speak(say.dataset.say, Number(say.dataset.rate) || 0.85); return; }
    const act = ev.target.closest('[data-ow]');
    if (act) { ev.preventDefault(); ACTIONS[act.dataset.ow](act); return; }
    const tab = ev.target.closest('[data-tab]');
    if (tab) { showTab(tab.dataset.tab); return; }
    const mode = ev.target.closest('[data-mode]');
    if (mode) { setMode(mode.dataset.mode); return; }
    const sample = ev.target.closest('[data-sample]');
    if (sample) { usePassage(SAMPLES[Number(sample.dataset.sample)].text); return; }
  });

  function startApp() {
    $('samples').innerHTML = SAMPLES.map((s, i) => `<button class="chip" data-sample="${i}">${esc(s.label)}</button>`).join('');
    $('passage').value = Bridge.load(KEY, SAMPLES[0].text);
    $('passage').addEventListener('input', () => {
      Bridge.save(KEY, $('passage').value);
      if (!state.listening) renderPassage();
      clearTimeout(window.__t); window.__t = setTimeout(renderSend, 300);
    });
    $('edit').onclick = () => { state.editing = !state.editing; renderPassage(); if (state.editing) $('passage').focus(); };
    $('listen').onclick = () => speak(passage(), 0.9);
    if (!Recognition) {
      $('support').innerHTML = '<b>このブラウザは声の入力に対応していません。</b> Chrome・Edge・Safari で開いてください(iPad・iPhone は Safari)。';
      $('support').classList.remove('hidden');
      $('mic').disabled = true;
    }
    // 読み上げの声の一覧は、あとから届くことがある
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
    setupMic();
    updateMic();
    renderPassage();
    renderSend();
    setMode('read');
    let tab = 'practice';
    try { tab = localStorage.getItem('ondoku.tab') || 'practice'; } catch (e) { /* なし */ }
    showTab(['practice', 'library', 'history', 'weak'].includes(tab) ? tab : 'practice');
  }

  // シャドーイング・ライブラリ・テストから使えるように
  window.OndokuWeb = { align, tokenize, speak, live, makeResult, resultHTML, record, previousAccuracy, usePassage, soundStats, SAMPLES };

  (async () => {
    const payload = Bridge.hashPayload();
    const data = payload && Bridge.supported ? await Bridge.decode(payload) : null;
    if (data && data.kind === 'ondoku' && data.records) showReport(data); else startApp();
  })();
})();
