// Recito Web版のシャドーイング(iOS版の ShadowingView.swift と同じ流れ)
// - リピート:全文のお手本を聞く → 言い終わったら録音 → 採点
// - シャドーイング:録音を始めてから0.5秒後にお手本を流し、同時について言う → 採点
// - 練習中は英文を見せず、音だけで行う。お手本は機械の読み上げか、自分で選んだ音声ファイル(端末の中だけで使う)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const { align, tokenize, speak } = window.OndokuWeb;
  const RATES = [0.7, 0.85, 1.0, 1.1, 1.2];
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const state = {
    mode: 'shadow',        // 'repeat' | 'shadow'
    rate: 1.0,
    audioURL: null,        // 選んだ音声ファイル(なければ機械の読み上げ)
    audioName: '',
    phase: 'idle',         // idle | listening | speaking | scoring | done
    turn: 0,
    passage: '',
    total: 0,
    modelCount: 0,         // お手本が何語目まで進んだか
    modelTimes: [],        // お手本が各単語を言い始めた時刻(録音開始からの秒)
    spoken: '',            // 聞き取った文(全部)
    hypTimes: [],          // 聞き取った各単語が最初に出てきた時刻(録音開始からの秒)
    recStart: 0,
    result: null,
  };
  let rec = null, joiner = null, audio = null, ticker = null;

  /** 英文の中で、各単語(tokenize と同じ区切り方)が何文字目から始まるか */
  function wordOffsets(text) {
    const out = [];
    const re = /[^\s—–-]+/g;
    let m;
    while ((m = re.exec(text))) if (tokenize(m[0]).length) out.push(m.index);
    return out;
  }

  /** 練習中か */
  const running = () => state.phase !== 'idle' && state.phase !== 'done';

  // ---- 進め方 ----

  /** 始める */
  function start() {
    state.passage = $('passage').value.trim();
    state.total = tokenize(state.passage).length;
    if (!state.total) return;
    const myTurn = ++state.turn;
    Object.assign(state, { result: null, modelCount: 0, modelTimes: new Array(state.total).fill(null), spoken: '', hypTimes: [] });
    joiner = OndokuWeb.makeJoiner();
    document.body.classList.add('shadowing');
    $('result').innerHTML = '';
    if (state.mode === 'repeat') {
      state.phase = 'listening';
      playModel(myTurn, false, () => beginSpeaking(myTurn));
    } else {
      state.phase = 'speaking';
      startRecording();
      setTimeout(() => {
        if (myTurn !== state.turn) return;
        // お手本が終わってから2秒は、追いつくのを待つ
        playModel(myTurn, true, () => setTimeout(() => finish(myTurn), 2000));
      }, 500);
      scheduleTimeout(myTurn);
    }
    render();
  }

  /** お手本を流す。mark が true なら、各単語を言い始めた時刻を記録する(遅れの計算用) */
  function playModel(myTurn, mark, onEnd) {
    if (state.audioURL) {
      // 音声ファイル:単語の時刻がわからないので、進み具合は 再生位置 ÷ 長さ × 単語数(遅れの採点はしない)
      audio = new Audio(state.audioURL);
      audio.playbackRate = state.rate;
      audio.onended = () => { stopTicker(); if (myTurn === state.turn) onEnd(); };
      audio.play().catch(() => { state.phase = 'idle'; document.body.classList.remove('shadowing'); render(); });
      ticker = setInterval(() => {
        if (audio && audio.duration) state.modelCount = Math.max(state.modelCount, Math.round(audio.currentTime / audio.duration * state.total));
        renderProgress();
      }, 200);
      return;
    }
    const offsets = wordOffsets(state.passage);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(state.passage);
    u.lang = 'en-US';
    u.rate = state.rate;
    // 単語を言い始めるたびに届く知らせ(charIndex = 文字の位置)から、何語目かを求める
    u.onboundary = (e) => {
      if (myTurn !== state.turn || (e.name && e.name !== 'word')) return;
      let idx = -1;
      for (let k = 0; k < offsets.length && offsets[k] <= e.charIndex; k++) idx = k;
      if (idx < 0) return;
      state.modelCount = Math.max(state.modelCount, idx + 1);
      if (mark && state.modelTimes[idx] == null && state.recStart) state.modelTimes[idx] = (Date.now() - state.recStart) / 1000;
      renderProgress();
    };
    u.onend = () => { if (myTurn === state.turn) { state.modelCount = state.total; onEnd(); } };
    speechSynthesis.speak(u);
  }

  /** リピート:お手本が終わったので、自分の番(録音)にする */
  function beginSpeaking(myTurn) {
    if (myTurn !== state.turn || state.phase !== 'listening') return;
    state.phase = 'speaking';
    startRecording();
    scheduleTimeout(myTurn);
    render();
  }

  /** 録音(音声認識)を始める。途中で切れたら、それまでの文を残してつなぎ直す */
  function startRecording() {
    state.recStart = Date.now();
    const begin = () => {
      rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        const now = Array.from(e.results).map(r => r[0].transcript).join(' ');
        // 返し直しがあっても、前の文を消さずにつなげる(最初のほうが赤くならないように)
        joiner.receive(now);
        state.spoken = joiner.text();
        // 新しく出てきた単語に、その時刻を付ける(あとから言い直されても、最初に出た時刻のまま)
        const n = tokenize(state.spoken).length, t = (Date.now() - state.recStart) / 1000;
        for (let j = state.hypTimes.length; j < n; j++) state.hypTimes[j] = t;
        renderProgress();
        transcriptChanged();
      };
      rec.onerror = (e) => { if (e.error === 'not-allowed') { state.error = 'マイクが使えません(ブラウザの設定で許可してください)'; cancel(); } };
      rec.onend = () => {
        if (state.phase === 'speaking') { joiner.commit(); try { begin(); } catch (err) { /* もう一度は始めない */ } }
      };
      rec.start();
    };
    state.error = '';
    begin();
  }

  /** 時間切れ:単語数 × 0.6秒 ÷ 速さ + 8秒(音声ファイルなら 長さ ÷ 速さ + 10秒)たっても終わらなければ、採点する */
  function scheduleTimeout(myTurn) {
    const limit = audio && audio.duration ? audio.duration / state.rate + 10 : state.total * 0.6 / state.rate + 8;
    setTimeout(() => finish(myTurn), limit * 1000);
  }

  /** リピートで、最後の単語まで読めたら、少し待って採点 */
  function transcriptChanged() {
    if (state.mode !== 'repeat' || state.phase !== 'speaking') return;
    const words = align(state.passage, state.spoken);
    if (!words.length || !words[words.length - 1].ok) return;
    const myTurn = state.turn;
    setTimeout(() => finish(myTurn), 800);
  }

  /** お手本と録音を止める */
  function stopAll() {
    speechSynthesis.cancel();
    if (audio) { audio.onended = null; audio.pause(); audio = null; }
    stopTicker();
    if (rec) { rec.onend = null; try { rec.stop(); } catch (e) { /* もう止まっている */ } rec = null; }
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  /** 途中でやめる */
  function cancel() {
    state.turn++;
    stopAll();
    state.phase = 'idle';
    document.body.classList.remove('shadowing');
    render();
  }

  /** 採点する */
  function finish(myTurn) {
    if (myTurn !== state.turn || (state.phase !== 'speaking' && state.phase !== 'listening')) return;
    state.phase = 'scoring';
    stopAll();
    state.result = score(state.passage, state.spoken, state.hypTimes, state.mode === 'shadow' && !state.audioURL ? state.modelTimes : []);
    state.phase = 'done';
    document.body.classList.remove('shadowing');
    // 結果は練習タブの共通の表示に出し、記録に残す(リピート・シャドーイングとも「シャドーイング」として)
    OndokuWeb.record(state.result, 'シャドーイング');
    render();
    $('result').innerHTML = OndokuWeb.resultHTML(state.result, { mode: state.mode, prev: OndokuWeb.previousAccuracy(state.passage) });
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- 採点(アプリの WordAligner・ReadingAnalyzer と同じ式)----

  /**
   * 採点の計算
   * - 正確さ = 読めた単語 ÷ 全部の単語 × 100
   * - 話していた秒 = 最後の単語が出た時刻 − 最初の単語が出た時刻(1秒以下なら、録音の長さ)
   * - 速さ = 読めた単語 ÷ (話していた秒 ÷ 60)
   * - 文ごとの遅れ = その文の(自分が言った時刻 − お手本が言い始めた時刻)の平均。全体の遅れは文の遅れの平均
   *   (Web は聞き取りの知らせが少し遅れて届くので、目安)
   */
  function score(passage, spoken, hypTimes, modelTimes) {
    const times = hypTimes.filter(t => t != null);
    let seconds = times.length ? times[times.length - 1] - times[0] : 0;
    if (seconds <= 1) seconds = (Date.now() - state.recStart) / 1000;
    const r = OndokuWeb.makeResult(passage, spoken, seconds);
    // 文ごとの遅れ:その文の単語ごとに(自分が言った時刻 − お手本が言い始めた時刻)を出して平均
    let k = 0;
    r.sentences.forEach(sent => {
      const n = OndokuWeb.tokenize(sent.text).length, diffs = [];
      for (let i = k; i < k + n; i++) {
        const w = r.words[i];
        if (w && w.ok && hypTimes[w.hyp] != null && modelTimes[i] != null) diffs.push(hypTimes[w.hyp] - modelTimes[i]);
      }
      sent.lag = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
      k += n;
    });
    const lags = r.sentences.map(x => x.lag).filter(x => x != null);
    r.lag = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;
    return r;
  }

  // ---- 画面 ----

  const ICON = { listening: '👂', speaking: '🗣️', scoring: '⏳', idle: '🎧', done: '🎧' };
  /** 真ん中の言葉 */
  function label() {
    if (state.phase === 'listening') return '聞いて';
    if (state.phase === 'speaking') return state.mode === 'shadow' ? 'ついて言って' : 'まねして言って';
    if (state.phase === 'scoring') return '採点中';
    return '英文を見ずに、音だけで';
  }

  /** 進み具合のバー(お手本・あなた)だけ描き直す */
  function renderProgress() {
    const box = $('sh-progress');
    if (!box) return;
    const total = Math.max(state.total, 1);
    const mine = state.phase === 'speaking' ? align(state.passage, state.spoken).filter(w => w.ok).length : 0;
    const bar = (name, v, color) => `<div class="sh-bar"><b>${name}</b><div class="bar-track"><div style="width:${Math.min(v, 1) * 100}%;background:${color}"></div></div></div>`;
    box.innerHTML = bar('お手本', state.modelCount / total, 'var(--accent)') + (state.phase === 'speaking' ? bar('あなた', mine / total, 'var(--good)') : '');
  }

  /** シャドーイングのカード全体を描く */
  function render() {
    const box = $('shadow');
    if (!box) return;
    if (!Recognition || !('speechSynthesis' in window)) { box.innerHTML = '<h2>シャドーイング</h2><p class="muted">このブラウザは声の入力に非対応(Chrome・Edge・Safari で使えます)</p>'; return; }
    const run = running();
    const seg = (act, items, cur) => `<div class="seg">${items.map(([v, t]) => `<button data-sh="${act}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    let html = `<p class="muted" style="margin:0">英文を見ずに、お手本の音だけを聞いて言います。リピート = 聞いてからまねる、シャドーイング = 少し遅れて同時に言う</p>`;
    if (!run) {
      html += seg('mode', [['repeat', 'リピート'], ['shadow', 'シャドーイング']], state.mode);
      html += seg('rate', RATES.map(r => [r, `${r}倍`]), state.rate);
      html += `<div class="row" style="margin-top:8px"><label class="secondary button" style="cursor:pointer">🎵 ${state.audioURL ? '音声を入れかえる' : '音声ファイルをお手本にする'}<input id="sh-audio" type="file" accept="audio/*" hidden></label>
        ${state.audioURL ? `<span class="muted">${esc(state.audioName)}</span><button class="danger" data-sh="noaudio">機械の声にもどす</button>` : ''}</div>`;
      if (state.audioURL) html += '<p class="muted">本物の音声がお手本(音声は端末の中だけ。遅れの採点はしません)</p>';
      if (state.mode === 'shadow') html += '<p class="sh-warn">🎧 イヤホン推奨(お手本の声がマイクに入らないように)</p>';
    }
    html += `<div class="sh-center"><div class="sh-circle ${run ? 'on' : ''} ${state.phase === 'speaking' ? 'speak' : ''}">${ICON[state.phase]}</div>
      <b>${label()}</b><span class="muted">${tokenize($('passage').value).length} 語</span></div>`;
    if (run) html += '<div id="sh-progress"></div>';
    if (state.error) html += `<p class="bad">${esc(state.error)}</p>`;
    html += '<div class="row" style="justify-content:center;margin-top:12px">' + (run
      ? `<button class="secondary" data-sh="cancel">✕ やめる</button>${state.phase === 'speaking' ? '<button data-sh="finish">✓ 終わる</button>' : ''}`
      : `<button data-sh="start">${state.phase === 'done' ? '↺ もう一度' : '▶ スタート'}</button>`) + '</div>';
    box.innerHTML = html;
    renderProgress();
  }

  const ACTIONS = {
    mode(el) { state.mode = el.dataset.v; state.phase = 'idle'; render(); },
    rate(el) { state.rate = Number(el.dataset.v); render(); },
    noaudio() { if (state.audioURL) URL.revokeObjectURL(state.audioURL); state.audioURL = null; render(); },
    start() { start(); },
    cancel() { cancel(); },
    finish() { finish(state.turn); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-sh]');
    if (!el) return;
    ev.preventDefault();
    ACTIONS[el.dataset.sh](el);
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'sh-audio' || !ev.target.files[0]) return;
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    state.audioURL = URL.createObjectURL(ev.target.files[0]);
    state.audioName = ev.target.files[0].name;
    render();
  });
  // 英文が変わったら、語数を描き直す(練習中は描き直さない)
  $('passage').addEventListener('input', () => { if (!running()) { if (state.phase === 'done') state.phase = 'idle'; render(); } });

  // テストで使えるように
  window.RecitoShadow = { score, wordOffsets, state, start, cancel, finish: () => finish(state.turn) };
  render();
})();
