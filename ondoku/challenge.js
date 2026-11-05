// Recito Web版のチャレンジモード(英語の早口言葉で、正確さと時間を競う)
// iOS版の ChallengeRules.swift と同じお題・点数・称号・勝ち負け。ランキングはこのブラウザの中に保存する
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const W = window.OndokuWeb;
  const RANK_KEY = 'ondoku.challenge';
  const NAMES_KEY = 'ondoku.challengeNames';

  /** 昔から英語圏で親しまれている早口言葉(作者のわからない伝承のもの) */
  const TWISTERS = [
    { id: 'seashells', text: 'She sells seashells by the seashore.', stars: 1 },
    { id: 'lorry', text: 'Red lorry, yellow lorry, red lorry, yellow lorry.', stars: 2 },
    { id: 'newyork', text: 'Unique New York, unique New York, unique New York.', stars: 2 },
    { id: 'icecream', text: 'I scream, you scream, we all scream for ice cream.', stars: 1 },
    { id: 'bug', text: 'A big black bug bit a big black bear.', stars: 2 },
    { id: 'fuzzy', text: 'Fuzzy Wuzzy was a bear. Fuzzy Wuzzy had no hair.', stars: 1 },
    { id: 'bread', text: 'Fred fed Ted bread, and Ted fed Fred bread.', stars: 2 },
    { id: 'peter', text: 'Peter Piper picked a peck of pickled peppers.', stars: 3 },
    { id: 'betty', text: "Betty Botter bought some butter, but she said the butter's bitter.", stars: 3 },
    { id: 'woodchuck', text: 'How much wood would a woodchuck chuck if a woodchuck could chuck wood?', stars: 3 },
  ];

  /**
   * 点数(最大 1500点)= 正確さ(0〜100)× 10 × 速さの倍率
   * 速さの倍率 = 基準の秒 ÷ かかった秒(0.5〜1.5)、基準の秒 = 単語の数 × 0.4秒(1分に150語)
   * 例:10語を3秒で、正確さ90% → 4 ÷ 3 = 1.33倍 → 1200点
   */
  const speedFactor = (seconds, words) => Math.min(1.5, Math.max(0.5, words * 0.4 / Math.max(seconds, 0.1)));
  const points = (accuracy, seconds, words) => words > 0 && accuracy > 0 ? Math.round(Math.min(100, accuracy) * 10 * speedFactor(seconds, words)) : 0;

  /** 称号(点数で決まる。実在の試験の級は使わない) */
  function title(p) {
    if (p >= 1350) return ['早口の神', '👑'];
    if (p >= 1200) return ['舌の魔術師', '🪄'];
    if (p >= 1000) return ['なめらか名人', '🌊'];
    if (p >= 800) return ['スラスラ選手', '🏃'];
    if (p >= 600) return ['がんばり屋', '💪'];
    return ['これからの星', '🌱'];
  }

  /** 2人対戦の勝ち負け(1・2、引き分けは 0):点数 → 正確さ → 時間の短いほう */
  function winner(a, b) {
    if (a.points !== b.points) return a.points > b.points ? 1 : 2;
    if (a.accuracy !== b.accuracy) return a.accuracy > b.accuracy ? 1 : 2;
    if (a.seconds !== b.seconds) return a.seconds < b.seconds ? 1 : 2;
    return 0;
  }

  /** 撮影した文(練習の英文)をお題にするとき:最初の文(長ければ最初の25語) */
  function customText() {
    const first = (window.RecitoInterpret ? RecitoInterpret.sentencesOf($('passage').value) : [])[0];
    if (!first) return null;
    const w = first.split(/\s+/);
    return w.length > 25 ? w.slice(0, 25).join(' ') : first;
  }

  // ---------------- ランキング(このブラウザの中だけ) ----------------

  const ranking = () => { try { return JSON.parse(localStorage.getItem(RANK_KEY) || '[]'); } catch (e) { return []; } };
  /** 結果をランキングに足す(最新の500件まで) */
  function addRanking(r) {
    const list = ranking();
    list.push({ ...r, d: new Date().toISOString() });
    try { localStorage.setItem(RANK_KEY, JSON.stringify(list.slice(-500))); } catch (e) { /* 容量など */ }
  }
  /** 並べる:点数の高い順、同じなら正確さ、それも同じなら早い者 */
  const sorted = (list) => list.slice().sort((a, b) => b.points - a.points || b.accuracy - a.accuracy || a.seconds - b.seconds);

  // ---------------- 画面の状態 ----------------

  const names = (() => { try { return JSON.parse(localStorage.getItem(NAMES_KEY) || 'null') || ['プレイヤー1', 'プレイヤー2']; } catch (e) { return ['プレイヤー1', 'プレイヤー2']; } })();
  const state = { stage: 'setup', duel: false, topic: 'seashells', text: TWISTERS[0].text, player: 0, results: [], filter: 'all', showRanking: false, listening: false };
  let rec = null, joiner = null, started = 0, first = 0, lastAt = 0, finished = false;

  /** チャレンジのタブを描く */
  function render() {
    const box = $('tab-challenge');
    if (!box) return;
    if (state.showRanking) { box.innerHTML = rankingHTML(); return; }
    if (state.stage === 'setup') box.innerHTML = setupHTML();
    else if (state.stage === 'play') box.innerHTML = playHTML();
    else { box.innerHTML = resultHTML(); celebrate(); }
  }

  /** はじめの画面:ひとりで/2人で、ニックネーム、お題 */
  function setupHTML() {
    const custom = customText();
    const card = (id, text, label) => `<button class="ch-topic ${state.topic === id ? 'on' : ''}" data-ch="topic" data-id="${id}">
      <small>${label}</small><span>${esc(text)}</span>${state.topic === id ? '<i>✓</i>' : ''}</button>`;
    return `<div class="ch-head"><h2>英語の早口言葉を、正しく・速く!</h2><button class="secondary" data-ch="ranking">🏆 ランキング</button></div>
      <div class="seg ch-seg">${[[false, 'ひとりで'], [true, '2人で対戦']].map(([v, t]) => `<button class="${state.duel === v ? 'on' : ''}" data-ch="duel" data-v="${v}">${t}</button>`).join('')}</div>
      <input class="ch-name" id="ch-name0" value="${esc(names[0])}" placeholder="1人目のニックネーム" maxlength="16">
      ${state.duel ? `<input class="ch-name p2" id="ch-name1" value="${esc(names[1])}" placeholder="2人目のニックネーム" maxlength="16">` : ''}
      <h3>お題</h3>
      <div class="ch-topics">${TWISTERS.map(t => card(t.id, t.text, '★'.repeat(t.stars) + '☆'.repeat(3 - t.stars))).join('')}
        ${custom ? card('custom', custom, '📷 練習の英文') : ''}</div>
      <p class="muted">点数 = 正確さ × 10 × 速さの倍率(0.5〜1.5倍)。最大1500点</p>
      <div class="ch-sticky"><button class="ch-start" data-ch="start">▶ スタート</button></div>`;
  }

  /** 1人ぶんの挑戦の画面:大きなお題・時間・大きなマイク */
  function playHTML() {
    const tokens = W.tokenize(state.text);
    return `<div class="ch-play p${state.player}">
      <h2 class="ch-turn">${esc(names[state.player])} の番</h2>
      <div class="ch-text" id="ch-text">${tokens.map((t, i) => `<span data-i="${i}">${esc(t.display)}</span>`).join(' ')}</div>
      <div class="ch-timer" id="ch-timer">0.0 秒</div>
      <button class="ch-mic ${state.listening ? 'on' : ''}" data-ch="mic" aria-label="${state.listening ? '終わる' : '読み始める'}">${state.listening ? '<span class="stop"></span>' : '🎤'}</button>
      <p class="ch-tip" id="ch-tip">${state.listening ? '最後まで読むと自動で止まります' : 'タップしたら、一気に読もう!'}</p>
      <p class="bad" id="ch-err"></p>
      <button class="ghost" data-ch="quit">やめる</button></div>`;
  }

  /** 結果:称号カード(2人なら勝ち負け) */
  function resultHTML() {
    const r = state.results;
    let head = '';
    if (state.duel && r.length === 2) {
      const w = winner(r[0], r[1]);
      head = `<h2 class="ch-winner">${w ? `🏆 ${esc(r[w - 1].name)} の勝ち!` : '🤝 引き分け!'}</h2>`;
      r.forEach((x, i) => { x.crown = w === i + 1; });
    }
    return `${head}<div class="ch-cards">${r.map((x, i) => {
      const [name, emoji] = title(x.points);
      return `<div class="ch-card p${i} ${x.crown ? 'crown' : ''}" style="animation-delay:${i * 0.25}s">
        <div class="row" style="justify-content:space-between"><b class="ch-cname">${esc(x.name)} ${x.crown ? '👑' : ''}</b>${x.accuracy >= 100 ? '<span class="ch-perfect">PERFECT</span>' : ''}</div>
        <div class="ch-emoji">${emoji}</div><div class="ch-title">${esc(name)}</div>
        <div class="ch-points" data-to="${x.points}">0</div><div class="muted" style="margin-top:-8px">点</div>
        <div class="ch-stats"><div><b>${Math.round(x.accuracy)}%</b><small>正確さ</small></div><div><b>${x.seconds.toFixed(1)}秒</b><small>時間</small></div><div><b>×${speedFactor(x.seconds, x.words.length).toFixed(2)}</b><small>速さ</small></div></div>
        ${x.words.some(w => !w.ok) ? `<p class="bad">言えなかった:${x.words.filter(w => !w.ok).map(w => esc(w.display)).join(' ')}</p>` : ''}</div>`;
    }).join('')}</div>
    <div class="row ch-after"><button data-ch="again">↺ もう一度</button><button class="secondary" data-ch="ranking">🏆 ランキング</button><button class="ghost" data-ch="setup">お題をえらぶ</button></div>
    <canvas id="ch-confetti" class="ch-confetti"></canvas>`;
  }

  /** ランキング(ニックネーム付き。お題ごとにも。リセットできる) */
  function rankingHTML() {
    const list = sorted(ranking().filter(r => state.filter === 'all' || r.topic === state.filter)).slice(0, 20);
    return `<div class="ch-head"><h2>🏆 ランキング</h2><button class="secondary" data-ch="close-ranking">閉じる</button></div>
      <select id="ch-filter" class="ch-filter"><option value="all">すべてのお題</option>${TWISTERS.map(t => `<option value="${t.id}" ${state.filter === t.id ? 'selected' : ''}>${esc(t.text.slice(0, 30))}…</option>`).join('')}</select>
      <div class="card">${list.length ? list.map((r, i) => `<div class="ch-rank"><span class="ch-place">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
        <div style="flex:1"><b>${esc(r.name)}</b><div class="muted" style="font-size:.8rem">${esc(title(r.points)[0])}・${Math.round(r.accuracy)}%・${r.seconds.toFixed(1)}秒</div></div>
        <b class="ch-rpoints">${r.points}</b></div>`).join('') : '<p class="muted">まだ記録がありません</p>'}</div>
      <p style="text-align:center"><button class="danger" data-ch="reset">ランキングをリセット</button></p>`;
  }

  // ---------------- 読む(マイク) ----------------

  /** 読み始める:聞き取った文が届くたびに色をつけ、最後の単語まで読めたら少し待って止める */
  function startListening() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { $('ch-err').textContent = 'このブラウザは声の入力に対応していません(Chrome・Edge・Safari で開いてください)'; return; }
    speechSynthesis.cancel();
    joiner = W.makeJoiner(); started = Date.now(); first = 0; lastAt = 0; finished = false;
    state.listening = true;
    render();
    const begin = () => {
      rec = new Rec();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        joiner.receive(Array.from(e.results).map(r => r[0].transcript).join(' '));
        if (!first) first = Date.now();
        lastAt = Date.now();
        const colors = W.live(state.text, joiner.text());
        document.querySelectorAll('#ch-text span').forEach((el, i) => { el.className = colors[i] || ''; });
        if (colors[colors.length - 1] === 'read') setTimeout(finish, 600);
      };
      rec.onerror = (e) => { if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(e.error)) { const err = $('ch-err'); if (err) err.textContent = 'マイクが使えません(アドレスバーの🔒から許可してください)'; state.listening = false; } };
      // 黙ると止まることがあるので、読んでいるあいだはつなぎ直す
      rec.onend = () => { if (state.listening && !finished && Date.now() - started < 60000) { joiner.commit(); try { begin(); } catch (err) { finish(); } } };
      rec.start();
    };
    begin();
    tick();
  }

  /** 時間の表示を動かす */
  function tick() {
    const el = $('ch-timer');
    if (!el || !state.listening) return;
    el.textContent = `${((Date.now() - started) / 1000).toFixed(1)} 秒`;
    requestAnimationFrame(tick);
  }

  /**
   * 止めて採点する(1回だけ)
   * かかった秒 = 最後に文字が届いた時刻 − 最初に文字が届いた時刻 + 0.4秒(届かなければ押してからの時間)
   */
  function finish() {
    if (finished || state.stage !== 'play') return;
    finished = true;
    state.listening = false;
    if (rec) { rec.onend = null; try { rec.stop(); } catch (e) { /* もう止まっている */ } rec = null; }
    const spoken = joiner ? joiner.text() : '';
    const seconds = first && lastAt - first > 300 ? (lastAt - first) / 1000 + 0.4 : (Date.now() - started) / 1000;
    const words = W.align(state.text, spoken);
    const accuracy = words.length && spoken.trim() ? words.filter(w => w.ok).length / words.length * 100 : 0;
    const result = { name: names[state.player], topic: state.topic, accuracy, seconds, points: points(accuracy, seconds, words.length), words };
    state.results.push(result);
    addRanking({ name: result.name, topic: result.topic, accuracy: Math.round(accuracy * 10) / 10, seconds: Math.round(seconds * 10) / 10, points: result.points });
    if (state.duel && state.results.length === 1) { state.player = 1; } else { state.stage = 'result'; }
    render();
  }

  // ---------------- 演出 ----------------

  /** 点数を0から数えあげ、紙ふぶきを降らせる */
  function celebrate() {
    document.querySelectorAll('.ch-points').forEach((el, k) => {
      const to = Number(el.dataset.to), t0 = performance.now() + k * 250;
      const step = (now) => { const p = Math.min(1, Math.max(0, (now - t0) / 800)); el.textContent = Math.round(to * p); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    const canvas = $('ch-confetti');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = innerWidth, h = canvas.height = innerHeight;
    const colors = ['#e2474f', '#f08a24', '#f5c518', '#22994f', '#3478f6', '#9b51e0', '#ff6fa5'];
    const pieces = Array.from({ length: 110 }, () => ({ x: Math.random() * w, speed: 0.25 + Math.random() * 0.3, spin: (Math.random() - 0.5) * 12, size: 6 + Math.random() * 7, color: colors[Math.floor(Math.random() * colors.length)], delay: Math.random() * 0.8 }));
    const t0 = performance.now();
    // 落ちた高さ = 速さ × 時間 × 画面の高さ、左右に少しゆれる
    const frame = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      pieces.forEach(p => {
        const time = t - p.delay;
        if (time < 0) { alive = true; return; }
        const y = time * p.speed * h - 20;
        if (y > h + 20) return;
        alive = true;
        ctx.save(); ctx.translate(p.x + Math.sin(time * 3 + p.x) * 18, y); ctx.rotate(time * p.spin);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
      });
      if (alive && document.body.contains(canvas)) requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, h);
    };
    requestAnimationFrame(frame);
  }

  // ---------------- 操作 ----------------

  /** ニックネームを覚えておく */
  function saveNames() {
    ['ch-name0', 'ch-name1'].forEach((id, i) => { const el = $(id); if (el) names[i] = el.value.trim() || `プレイヤー${i + 1}`; });
    try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (e) { /* なし */ }
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-ch]');
    if (!el) return;
    if (state.stage === 'setup') saveNames();
    switch (el.dataset.ch) {
      case 'duel': state.duel = el.dataset.v === 'true'; break;
      case 'topic': state.topic = el.dataset.id; state.text = state.topic === 'custom' ? customText() : TWISTERS.find(t => t.id === state.topic).text; break;
      case 'start': case 'again': state.results = []; state.player = 0; state.stage = 'play'; break;
      case 'mic': if (state.listening) finish(); else startListening(); return;
      case 'quit': case 'setup':
        state.listening = false; finished = true;
        if (rec) { rec.onend = null; try { rec.stop(); } catch (e) { /* なし */ } rec = null; }
        state.results = []; state.stage = 'setup'; break;
      case 'ranking': state.showRanking = true; break;
      case 'close-ranking': state.showRanking = false; break;
      case 'reset': if (confirm('ランキングを全部消しますか?')) { try { localStorage.removeItem(RANK_KEY); } catch (e) { /* なし */ } } break;
    }
    render();
  });
  document.addEventListener('change', (ev) => { if (ev.target.id === 'ch-filter') { state.filter = ev.target.value; render(); } });

  window.RecitoChallenge = { render, points, title, winner, TWISTERS };
})();
