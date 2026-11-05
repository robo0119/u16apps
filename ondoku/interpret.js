// Recito Web版の英文解釈モード(竹岡流:節 = ［ ］、句 = ( ))
// iOS版の BracketRules.swift と同じルール。ブラウザには Apple の品詞判定(NLTagger)がないので、
// 品詞は「よく使う単語の表」と「つづり・並び」から推定する(iOS版でも NLTagger が判定できない単語は同じ方法)
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const SAVE_KEY = 'ondoku.brackets';

  // ---------------- ルール(BracketRules.swift と同じ) ----------------

  const set = (s) => new Set(s.split(' '));
  /** 前置詞 */
  const PREPOSITIONS = set('in on at by for with from of about into onto over under between among through during without within across along around behind beyond toward towards against near upon like despite throughout beside besides below above inside outside per via except beneath');
  /** 従属接続詞(before・after・since・until・as は、うしろに主語と動詞があるときだけ節) */
  const SUBORDINATORS = set('because if when although though while since unless until before after as whether once whenever wherever whereas till');
  /** 関係代名詞・関係副詞 */
  const RELATIVES = set('who whom whose which where when');
  /** 疑問詞 */
  const QUESTION_WORDS = set('what how why where when who which whether if');
  /** 等位接続詞 */
  const COORDINATORS = set('and but or so yet nor');
  /** 冠詞・限定詞 */
  const DETERMINERS = set('a an the this that these those my your his her its our their some any no every each many much few several all both another other such');
  /** 人称代名詞など */
  const PRONOUNS = set('i you he she it we they me him us them this that these those someone something anyone anything everyone everything nobody nothing one yours mine ours theirs');
  /** be動詞・助動詞 */
  const AUXILIARIES = set("am is are was were be been being do does did have has had will would can could shall should may might must don't doesn't didn't can't won't isn't aren't wasn't weren't couldn't shouldn't wouldn't haven't hasn't i'm it's");
  /** 主語になる代名詞 */
  const SUBJECTS = set('i you he she it we they');
  /** うしろに that 節をとりやすい動詞・形容詞 */
  const THAT_TAKERS = set('think thinks thought know knows knew say says said believe believes believed hope hopes hoped feel feels felt find finds found show shows showed realize realized suggest suggests suggested mean means meant sure afraid glad true clear fact idea news is was are were learn learned notice noticed agree agreed explain explained');

  /** 比べる用の形(小文字・前後の記号を取る) */
  const bare = (w) => w.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  /** , ; : や文の終わりの記号で終わるか */
  const endsWithPause = (w) => /[,;:.!?]$/.test(w.replace(/["'”’)]+$/, ''));
  /** 文を単語に分ける */
  const wordsOf = (s) => s.split(/\s+/).filter(Boolean);
  /** 英文を文に分ける(. ! ? で区切る) */
  const sentencesOf = (text) => (text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?]["'”’)]*)\s+/).filter(s => /[A-Za-z0-9]/.test(s));

  /** 表にある単語の品詞(なければ null) */
  function override(w) {
    if (w === 'to') return 'to';
    if (AUXILIARIES.has(w)) return 'verb';
    if (PREPOSITIONS.has(w)) return 'prep';
    if (SUBORDINATORS.has(w) || COORDINATORS.has(w)) return 'conj';
    if (['this', 'that', 'these', 'those'].includes(w)) return null;
    if (DETERMINERS.has(w)) return 'det';
    if (PRONOUNS.has(w)) return 'pron';
    if (/^\d+$/.test(w)) return 'num';
    return null;
  }

  /**
   * つづりと並びから品詞を推定する(iOS版の guess と同じ)
   * 主語の代名詞・to・助動詞のすぐあと → 動詞、be のあとの -ing/-ed や -ous・-ful … → 形容詞、-ly → 副詞、-ing/-ed → 動詞、それ以外 → 名詞
   */
  function guess(w, prev) {
    if (prev && (SUBJECTS.has(prev) || prev === 'to' || (AUXILIARIES.has(prev) && !['is', 'are', 'was', 'were', 'am', 'be', 'been', 'being'].includes(prev)))) return 'verb';
    if (prev && ['is', 'are', 'was', 'were', 'am', 'be', 'been', 'very', 'so', 'too'].includes(prev) && /(ing|ed)$/.test(w)) return 'adj';
    if (/(ous|ful|ive|able|ible|al|ic|less)$/.test(w) && w.length > 4) return 'adj';
    if (/ly$/.test(w) && w.length > 3) return 'adv';
    if (/(ing|ed)$/.test(w)) return 'verb';
    return 'noun';
  }

  /** 単語ごとの品詞 */
  function tagsOf(words) {
    const tags = [];
    words.forEach((word, i) => { const w = bare(word); tags.push(override(w) || guess(w, i > 0 ? bare(words[i - 1]) : null)); });
    return tags;
  }

  /** ルール R1〜R7 で句と節の範囲を決める(BracketRules.hints と同じ順と条件) */
  function hintsOf(sentence) {
    const words = wordsOf(sentence), w = words.map(bare), tags = tagsOf(words), n = w.length;
    const spans = [];
    const isDemo = (x) => ['this', 'that', 'these', 'those'].includes(x);
    /** 名詞のまとまりの最後(なければ -1) */
    const npEnd = (i) => {
      if (i >= n) return -1;
      if (tags[i] === 'pron' && !isDemo(w[i])) return i;
      let j = i, last = -1;
      while (j < n && (['det', 'adj', 'noun', 'num', 'adv'].includes(tags[j]) || isDemo(w[j]))) {
        if (['noun', 'num'].includes(tags[j])) last = j;
        if (endsWithPause(words[j])) break;
        j++;
      }
      return last;
    };
    /** i から「主語 + 動詞」が始まるか */
    const startsClause = (i) => {
      let end = npEnd(i);
      if (end < 0 && i < n && tags[i] === 'pron') end = i;
      if (end < 0 || end + 1 >= n) return false;
      return tags[end + 1] === 'verb' || (tags[end + 1] === 'adv' && end + 2 < n && tags[end + 2] === 'verb');
    };
    /** 節の終わり(, ; の付いた単語・文の終わり。関係詞節は2つめの動詞の前) */
    const clauseEnd = (i, stopAtSecondVerb) => {
      let sawVerb = false;
      for (let j = i + 1; j < n; j++) {
        if (stopAtSecondVerb && tags[j] === 'verb') {
          const groupContinues = tags[j - 1] === 'verb' || tags[j - 1] === 'to' || (tags[j - 1] === 'adv' && j >= 2 && tags[j - 2] === 'verb');
          if (sawVerb && !groupContinues) return j - 1;
          sawVerb = true;
        }
        if (endsWithPause(words[j])) return j;
        if (tags[j] === 'conj' && COORDINATORS.has(w[j]) && sawVerb && j + 1 < n && startsClause(j + 1)) return j - 1;
      }
      return n - 1;
    };
    /** 動詞のうしろの目的語まで */
    const verbPhraseEnd = (v) => { const np = v + 1 < n && !endsWithPause(words[v]) ? npEnd(v + 1) : -1; return np >= 0 ? np : v; };

    for (let i = 0; i < n; i++) {
      const word = w[i];
      // R1 前置詞句
      if (tags[i] === 'prep' || (tags[i] === 'conj' && ['before', 'after', 'since', 'until', 'as', 'till'].includes(word) && !startsClause(i + 1))) {
        const end = i + 1 < n && !endsWithPause(words[i]) ? npEnd(i + 1) : -1;
        if (end >= 0) spans.push({ kind: 'phrase', start: i, end });
        continue;
      }
      // R2 不定詞句
      if (tags[i] === 'to' && i + 1 < n && (tags[i + 1] === 'verb' || (tags[i + 1] === 'noun' && !w[i + 1].endsWith('ing')))) {
        spans.push({ kind: 'phrase', start: i, end: verbPhraseEnd(i + 1) }); continue;
      }
      // R3 分詞句(主語の I・he などのあとは除く)
      if (i > 0 && tags[i] === 'verb' && /(ing|ed)$/.test(word) && (tags[i - 1] === 'noun' || (tags[i - 1] === 'pron' && !SUBJECTS.has(w[i - 1])))
          && !AUXILIARIES.has(w[i - 1]) && (!endsWithPause(words[i - 1]) || words[i - 1].endsWith(','))) {
        let end = verbPhraseEnd(i);
        if (end + 1 < n && tags[end + 1] === 'prep') { const pe = npEnd(end + 2); if (pe >= 0) end = pe; }
        spans.push({ kind: 'phrase', start: i, end }); continue;
      }
      // R4 副詞節
      if (tags[i] === 'conj' && SUBORDINATORS.has(word) && startsClause(i + 1)) {
        spans.push({ kind: 'clause', start: i, end: clauseEnd(i, i > 0) }); continue;
      }
      // R5 関係詞節
      if (i > 0 && (tags[i - 1] === 'noun' || words[i - 1].endsWith(',')) && (RELATIVES.has(word) || (word === 'that' && i + 1 < n && (tags[i + 1] === 'verb' || startsClause(i + 1))))) {
        spans.push({ kind: 'clause', start: i, end: clauseEnd(i, true) }); continue;
      }
      // R6 名詞節の that
      if (word === 'that' && i > 0 && (THAT_TAKERS.has(w[i - 1]) || tags[i - 1] === 'verb') && startsClause(i + 1)) {
        spans.push({ kind: 'clause', start: i, end: clauseEnd(i, false) }); continue;
      }
      // R7 疑問詞の名詞節
      if (i > 0 && QUESTION_WORDS.has(word) && (tags[i - 1] === 'verb' || tags[i - 1] === 'prep') && i + 1 < n) {
        spans.push({ kind: 'clause', start: i, end: clauseEnd(i, false) }); continue;
      }
    }
    return normalize(spans);
  }

  const same = (a, b) => a.kind === b.kind && a.start === b.start && a.end === b.end;
  const len = (s) => s.end - s.start + 1;
  const crosses = (s, r) => (s.start < r.start && s.end >= r.start && s.end < r.end) || (s.start > r.start && s.start <= r.end && s.end > r.end);
  const byStart = (a, b) => a.start - b.start || b.end - a.end;

  /** 同じ記号を1つにし、交差する記号を整える(句が節の外へはみ出したら節の終わりで切る、それでも交差すれば短いほうを捨てる) */
  function normalize(spans) {
    let list = [];
    spans.forEach(s => { if (!list.some(x => same(x, s))) list.push({ ...s }); });
    list.sort(byStart);
    list.forEach(s => {
      if (s.kind !== 'phrase') return;
      const outer = list.find(c => c.kind === 'clause' && c.start <= s.start && s.start <= c.end && s.end > c.end);
      if (outer) s.end = outer.end;
    });
    const result = [];
    list.sort((a, b) => len(b) - len(a)).forEach(s => { if (!result.some(r => crosses(s, r) || same(r, s))) result.push(s); });
    return result.sort(byStart);
  }

  /** 自分で付ける・消す(同じ記号がもうあれば消す、交差するものは新しいほうを残す) */
  function apply(spans, lo, hi, kind) {
    if (!kind) return spans.filter(s => s.end < lo || s.start > hi);
    const n = { kind, start: lo, end: hi };
    if (spans.some(s => same(s, n))) return spans.filter(s => !same(s, n));
    return spans.filter(r => !crosses(n, r)).concat([n]).sort(byStart);
  }

  /** 単語ごとの前後の記号(開きは外側から、閉じは内側から) */
  function marks(count, spans) {
    return Array.from({ length: count }, (_, i) => ({
      before: spans.filter(s => s.start === i).sort((a, b) => len(b) - len(a)),
      after: spans.filter(s => s.end === i).sort((a, b) => len(a) - len(b)),
    }));
  }
  const openOf = (s) => s.kind === 'clause' ? '［' : '(';
  const closeOf = (s) => s.kind === 'clause' ? '］' : ')';

  /** 記号を付けた文(文字だけ) */
  const renderText = (words, spans) => { const m = marks(words.length, spans); return words.map((w, i) => m[i].before.map(openOf).join('') + w + m[i].after.map(closeOf).join('')).join(' '); };

  /** 読み上げのまとまり(記号の切れ目で区切る。節の切れ目は0.5秒、句は0.3秒) */
  function chunks(words, spans) {
    const out = []; let cur = [];
    words.forEach((w, i) => {
      const opens = spans.filter(s => s.start === i && i > 0);
      if (opens.length && cur.length) { out.push({ text: cur.join(' '), pause: opens.some(s => s.kind === 'clause') ? 0.5 : 0.3 }); cur = []; }
      cur.push(w);
      const closes = spans.filter(s => s.end === i && i < words.length - 1);
      if (closes.length) { out.push({ text: cur.join(' '), pause: closes.some(s => s.kind === 'clause') ? 0.5 : 0.3 }); cur = []; }
    });
    if (cur.length) out.push({ text: cur.join(' '), pause: 0 });
    return out;
  }

  /** くらべる:一致率 = 両方にある記号 ÷ どちらかにある記号 */
  function compare(user, hint) {
    const matched = user.filter(u => hint.some(h => same(u, h)));
    const onlyUser = user.filter(u => !hint.some(h => same(u, h)));
    const onlyHint = hint.filter(h => !user.some(u => same(u, h)));
    const union = matched.length + onlyUser.length + onlyHint.length;
    return { matched, onlyUser, onlyHint, rate: union ? matched.length / union : 1 };
  }

  // ---------------- 保存(このブラウザの中だけ) ----------------

  const loadAll = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { return {}; } };
  /** 1文の記号と、ヒントとの一致率を保存する */
  function saveSentence(sentence, spans) {
    const all = loadAll();
    all[sentence] = { spans, match: compare(spans, hintsOf(sentence)).rate, at: new Date().toISOString() };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch (e) { /* 容量など */ }
  }

  // ---------------- 読み上げ(間を空ける) ----------------

  let speakTurn = 0;
  /** まとまりごとに読み上げ、まとまりのあとで決めた秒数だけ待つ */
  function speakChunks(list) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const turn = ++speakTurn;
    const next = (k) => {
      if (k >= list.length || turn !== speakTurn) return;
      const u = new SpeechSynthesisUtterance(list[k].text);
      u.lang = 'en-US'; u.rate = 0.85;
      u.onend = () => setTimeout(() => next(k + 1), list[k].pause * 1000);
      speechSynthesis.speak(u);
    };
    next(0);
  }

  // ---------------- 画面 ----------------

  const state = { index: 0, tool: 'clause', showHint: false, sel: null, dragStart: null, passage: '' };

  /** 今の英文の文の一覧 */
  const sentences = () => sentencesOf(state.passage);

  /** 解釈のタブを描く */
  function render() {
    const box = $('tab-interpret');
    if (!box) return;
    state.passage = $('passage').value.trim();
    const list = sentences();
    if (!list.length) { box.innerHTML = '<div class="card empty"><div class="big-icon">📝</div><b>英文がありません</b><p class="muted">練習のタブで英文を用意してください</p></div>'; return; }
    state.index = Math.min(state.index, list.length - 1);
    const sentence = list[state.index], words = wordsOf(sentence);
    const saved = loadAll();
    const spans = (saved[sentence] && saved[sentence].spans) || [];
    const m = marks(words.length, spans);
    const open = (s) => `<b class="bk ${s.kind === 'clause' ? 'bk-c' : 'bk-p'}">${openOf(s)}</b>`;
    const close = (s) => `<b class="bk ${s.kind === 'clause' ? 'bk-c' : 'bk-p'}">${closeOf(s)}</b>`;
    const sel = state.sel;
    let html = `<div class="card">
      <div class="row" style="justify-content:space-between">
        <button class="ghost big-arrow" data-ip="prev" ${state.index === 0 ? 'disabled' : ''}>◀</button>
        <div style="text-align:center"><b style="font-size:1.1rem">${state.index + 1} / ${list.length} 文</b><div class="muted" style="font-size:.8rem">保存した文 ${list.filter(s => saved[s]).length}</div></div>
        <button class="ghost big-arrow" data-ip="next" ${state.index >= list.length - 1 ? 'disabled' : ''}>▶</button>
      </div>
      <div class="seg" style="margin:12px 0">${[['clause', '［ ］節'], ['phrase', '( )句'], ['erase', '消す']].map(([k, t]) => `<button class="${state.tool === k ? 'on' : ''}" data-ip="tool" data-k="${k}">${t}</button>`).join('')}</div>
      <p class="muted" style="margin:0 0 6px">✍️ 単語をなぞると${state.tool === 'erase' ? '、重なる記号を消します' : '記号を付けます(同じ所をもう一度なぞると消えます)'}</p>
      <div id="ip-words" class="ip-words">${words.map((w, i) => `<span class="iw ${sel && i >= sel[0] && i <= sel[1] ? 'sel' : ''}" data-i="${i}">${m[i].before.map(open).join('')}${esc(w)}${m[i].after.map(close).join('')}</span>`).join(' ')}</div>
    </div>
    <div class="row" style="gap:10px;margin-bottom:16px">
      <button style="flex:1" data-ip="speak">🔊 区切って読む</button>
      <button class="secondary" style="flex:1" data-ip="hint">💡 ${state.showHint ? 'ヒントを隠す' : 'ヒントとくらべる'}</button>
    </div>
    ${spans.length ? '<p style="text-align:center;margin-top:-6px"><button class="danger" data-ip="clear">この文の記号を全部消す</button></p>' : ''}`;
    if (state.showHint) {
      const hints = hintsOf(sentence), r = compare(spans, hints);
      const mm = marks(words.length, r.matched), mu = marks(words.length, r.onlyUser), mh = marks(words.length, r.onlyHint);
      const col = (list, cls, fn) => list.map(s => `<b class="bk ${cls}">${fn(s)}</b>`).join('');
      html += `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0;color:#f08a24">💡 ヒントとくらべる</h2>
          <b style="font-size:1.4rem;color:${r.rate >= 0.8 ? 'var(--good)' : r.rate >= 0.5 ? '#f08a24' : 'var(--bad)'}">一致 ${Math.round(r.rate * 100)}%</b></div>
        <p class="ip-compare">${words.map((w, i) => col(mm[i].before, 'bk-ok', openOf) + col(mu[i].before, 'bk-me', openOf) + col(mh[i].before, 'bk-hint', openOf) + esc(w)
          + col(mh[i].after, 'bk-hint', closeOf) + col(mu[i].after, 'bk-me', closeOf) + col(mm[i].after, 'bk-ok', closeOf)).join(' ')}</p>
        <p style="font-weight:700;font-size:.85rem"><span class="good">✓ 一致 ${r.matched.length}</span>  <span style="color:#f08a24">＋ 自分だけ ${r.onlyUser.length}</span>  <span class="muted">− ヒントだけ ${r.onlyHint.length}</span></p>
        <p class="muted ip-serif">ヒント:${esc(renderText(words, hints))}</p>
        <p class="muted" style="font-size:.78rem">ヒントは品詞の推定とルールによる自動判定です(ブラウザでは単語の表とつづりから品詞を推定)。まちがうこともあるので、考える手がかりに使ってください</p></div>`;
    }
    html += `<p class="muted" style="font-size:.85rem"><span class="bk-c">［ ］節</span>:主語と動詞のあるまとまり(when / because / that / which … で始まる)<br>
      <span class="bk-p">( )句</span>:主語と動詞のないまとまり(前置詞 + 名詞、to + 動詞、名詞のうしろの -ing / -ed)</p>`;
    box.innerHTML = html;
    bindDrag(sentence, spans);
  }

  /** なぞる操作:触れた単語から、今触れている単語までを選び、指を離したら記号を付ける・消す */
  function bindDrag(sentence, spans) {
    const area = $('ip-words');
    const indexAt = (x, y) => { const el = document.elementFromPoint(x, y); const w = el && el.closest('.iw'); return w ? Number(w.dataset.i) : null; };
    const paint = () => area.querySelectorAll('.iw').forEach(el => { const i = Number(el.dataset.i); el.classList.toggle('sel', !!state.sel && i >= state.sel[0] && i <= state.sel[1]); });
    area.onpointerdown = (e) => {
      const i = indexAt(e.clientX, e.clientY);
      if (i == null) return;
      e.preventDefault();
      area.setPointerCapture(e.pointerId);
      state.dragStart = i; state.sel = [i, i]; paint();
    };
    area.onpointermove = (e) => {
      if (state.dragStart == null) return;
      const i = indexAt(e.clientX, e.clientY);
      if (i == null) return;
      state.sel = [Math.min(state.dragStart, i), Math.max(state.dragStart, i)]; paint();
    };
    area.onpointerup = () => {
      if (state.dragStart == null) return;
      const [lo, hi] = state.sel;
      state.dragStart = null; state.sel = null;
      saveSentence(sentence, apply(spans, lo, hi, state.tool === 'erase' ? null : state.tool));
      render();
    };
    area.onpointercancel = () => { state.dragStart = null; state.sel = null; paint(); };
  }

  /** ボタンの操作 */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-ip]');
    if (!el) return;
    const list = sentences(), sentence = list[state.index], words = sentence ? wordsOf(sentence) : [];
    const spans = (sentence && (loadAll()[sentence] || {}).spans) || [];
    switch (el.dataset.ip) {
      case 'prev': state.index = Math.max(0, state.index - 1); break;
      case 'next': state.index = Math.min(list.length - 1, state.index + 1); break;
      case 'tool': state.tool = el.dataset.k; break;
      case 'hint': state.showHint = !state.showHint; break;
      case 'clear': saveSentence(sentence, []); break;
      // 自分の記号がなければ、ヒントの記号で区切って読む
      case 'speak': speakChunks(chunks(words, spans.length ? spans : hintsOf(sentence))); return;
    }
    render();
  });

  // 英文が変わったら最初の文から
  $('passage').addEventListener('input', () => { state.index = 0; });

  // 練習のタブなどから描き直せるように。テストからルールを呼べるように
  window.RecitoInterpret = { render, hintsOf, renderText, wordsOf, sentencesOf, tagsOf, chunks, compare, apply,
    rendered: (sentence) => renderText(wordsOf(sentence), hintsOf(sentence)) };
})();
