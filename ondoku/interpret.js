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
  /** 副詞として使う単語(時・場所・頻度・程度) */
  const ADVERB_WORDS = set('yesterday today tomorrow tonight now then here there always often never sometimes usually also very too just still already not again soon really even only out away back aloud together abroad home');
  /** 程度の副詞(形容詞・副詞をくわしくする) */
  const DEGREE_ADVERBS = set('very too so really quite pretty extremely rather more most less much');
  /** 動詞のかたまりの間に入る副詞 */
  const MID_VERB_ADVERBS = set('not never always also just still already often usually really even only sometimes soon');
  /** よく使う形容詞(つづりからは形容詞とわからないもの) */
  const COMMON_ADJECTIVES = set('big small good bad new old great long short little young high low large right wrong happy sad easy hard nice kind free full true sure able hot cold warm cool fast slow early late black white red blue green yellow same different important interesting beautiful difficult steady clear real strong busy rich poor afraid glad ready tired favorite unique fuzzy bitter slippery loud quiet');
  /** 名詞節を始める語 */
  const NOUN_CLAUSE_STARTERS = set('that what how why whether who whom which');
  /** うしろに「目的語 + 補語」をとる動詞 */
  const COMPLEX_VERBS = set('make makes made call calls called name names named find finds found keep keeps kept leave leaves left consider considers considered think thinks thought');
  /** うしろに補語をとる動詞 */
  const LINKING_VERBS = set('am is are was were be been being become becomes became seem seems seemed look looks looked feel feels sound sounds get gets got remain remains stay stays turn turns grow grows grew appear appears');
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
    if (ADVERB_WORDS.has(w)) return 'adv';
    if (COMMON_ADJECTIVES.has(w)) return 'adj';
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
    if (prev && (SUBJECTS.has(prev) || prev === 'to' || MID_VERB_ADVERBS.has(prev) || (AUXILIARIES.has(prev) && !['is', 'are', 'was', 'were', 'am', 'be', 'been', 'being'].includes(prev)))) return 'verb';
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
          const groupContinues = tags[j - 1] === 'verb' || tags[j - 1] === 'to' || (MID_VERB_ADVERBS.has(w[j - 1]) && j >= 2 && tags[j - 2] === 'verb');
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


  // ---------------- 品詞(日本語)・文の要素(SVOC)・修飾(BracketRules.analyze と同じ) ----------------

  /** 要素の説明 */
  const ROLE_MEANING = { S: '主語:文の主人公(〜は・〜が)', V: '動詞:主語の動作や状態(〜する・〜である)', O: '目的語:動作の相手(〜を・〜に)',
    C: '補語:主語や目的語がどんなものか・どんな様子か', M: '修飾語:ほかの語をくわしくする' };

  /** 品詞の日本語の名前 */
  function partOfSpeech(words, tags, i) {
    const w = bare(words[i]), next = i + 1 < words.length ? tags[i + 1] : null;
    if (w === 'to') return next === 'verb' ? 'to不定詞の to' : '前置詞';
    if (AUXILIARIES.has(w) && next === 'verb') return '助動詞';
    if (['a', 'an', 'the'].includes(w)) return '冠詞';
    if (['which', 'who', 'whom', 'whose'].includes(w) && i > 0 && tags[i - 1] === 'noun') return '関係代名詞';
    if (['what', 'how', 'why'].includes(w)) return '疑問詞';
    return { noun: '名詞', pron: '代名詞', verb: '動詞', adj: '形容詞', adv: '副詞', det: '限定詞(名詞の前に付く語)', prep: '前置詞',
      conj: SUBORDINATORS.has(w) ? '従属接続詞' : '等位接続詞', num: '数詞', to: 'to' }[tags[i]] || 'その他';
  }

  /**
   * 品詞・要素・修飾の矢印を決める(iOS版と同じ手順)
   * 1. ヒントの記号で、文を節と句のまとまりに分ける(節の中も同じ手順で)
   * 2. 最初の動詞のかたまり = V、その前の名詞のまとまりの中心 = S、
   *    V のあとの名詞:be・become などなら C、そうでなければ O(make・call は2つめが C、それ以外は2つめも O)
   *    V のすぐあとの to不定詞・that / what の節 = O、それ以外の句・節・副詞 = M
   * 3. 矢印:形容詞 → 名詞、名詞のすぐあとの句・関係詞節 → その名詞、それ以外 → 動詞(程度の副詞は次の形容詞へ)
   * 4. 関係詞節の which・who は、すぐあとが動詞なら S、そうでなければ O
   */
  function analyze(sentence) {
    const words = wordsOf(sentence), tags = tagsOf(words), w = words.map(bare), n = words.length;
    const spans = hintsOf(sentence), roles = new Array(n).fill(null);
    let arrows = [];
    const isDemo = (x) => ['this', 'that', 'these', 'those'].includes(x);
    const isNominal = (i) => ['noun', 'pron', 'num'].includes(tags[i]) || (isDemo(w[i]) && i + 1 < n && tags[i + 1] === 'verb');
    /** lo..hi の中で i から始まるいちばん大きな記号(まとまり全体と同じものは除く) */
    const spanAt = (i, lo, hi) => spans.filter(s => s.start === i && s.end <= hi && s.end >= lo && !(s.start === lo && s.end === hi)).sort((a, b) => len(b) - len(a))[0] || null;

    function unit(lo, hi, skipFirst) {
      if (lo > hi) return;
      let i = skipFirst ? lo + 1 : lo, verb = null, linking = false, complex = false, objects = 0, lastNoun = null, hasSubject = false;
      let pending = [];
      /** 名詞のまとまり(形容詞は中心へ矢印、程度の副詞は形容詞へ) */
      const nounPhrase = (start) => {
        let j = start, head = null; const adjs = [];
        while (j <= hi && !spanAt(j, lo, hi) && (['det', 'adj', 'noun', 'num', 'pron'].includes(tags[j]) || isDemo(w[j])
            || (tags[j] === 'adv' && DEGREE_ADVERBS.has(w[j]) && j + 1 <= hi && tags[j + 1] === 'adj' && j > start))) {
          if (tags[j] === 'adv') { roles[j] = 'M'; arrows.push([j, j + 1]); j++; continue; }
          if (tags[j] === 'adj') adjs.push(j);
          if (isNominal(j) || tags[j] === 'noun') head = j;
          if (tags[j] === 'pron' && j === start && head === j) { j++; break; }
          if (endsWithPause(words[j])) { j++; break; }
          j++;
        }
        if (head == null) return null;
        adjs.filter(a => a < head).forEach(a => arrows.push([a, head]));
        return { head, end: j - 1 };
      };
      while (i <= hi) {
        const span = spanAt(i, lo, hi);
        if (span) {
          const first = w[span.start];
          if (span.kind === 'clause') {
            unit(span.start, span.end, true);
            const relative = RELATIVES.has(first) || (first === 'that' && lastNoun === span.start - 1);
            if (relative && lastNoun != null && lastNoun === span.start - 1) arrows.push([span.start, lastNoun]);
            else if (verb != null && objects === 0 && NOUN_CLAUSE_STARTERS.has(first)) { roles[span.start] = linking ? 'C' : 'O'; objects++; }
            else { roles[span.start] = 'M'; if (verb != null) arrows.push([span.start, verb]); else pending.push(span.start); }
          } else {
            for (let k = span.start + 1; k <= span.end;) { const np = nounPhrase(k); k = np ? np.end + 1 : k + 1; }
            if (first === 'to' && verb != null && objects === 0 && (lastNoun == null || lastNoun < verb) && !linking) { roles[span.start] = 'O'; objects++; }
            else if (lastNoun != null && lastNoun === span.start - 1) { roles[span.start] = 'M'; arrows.push([span.start, lastNoun]); }
            else { roles[span.start] = 'M'; if (verb != null) arrows.push([span.start, verb]); else pending.push(span.start); }
          }
          lastNoun = null; i = span.end + 1; continue;
        }
        if (verb == null && tags[i] === 'verb') {
          // V のかたまり:助動詞のあとに動詞が続くあいだ(間の not・never などは M)
          let j = i, last = i;
          while (j <= hi && !spanAt(j, lo, hi)) {
            if (tags[j] === 'verb') { if (j > i && !AUXILIARIES.has(w[last])) break; roles[j] = 'V'; last = j; }
            else if (tags[j] === 'adv' && MID_VERB_ADVERBS.has(w[j]) && AUXILIARIES.has(w[last]) && j + 1 <= hi && tags[j + 1] === 'verb') { roles[j] = 'M'; arrows.push([j, -1]); }
            else break;
            j++;
            if (endsWithPause(words[j - 1])) break;
          }
          verb = last;
          arrows = arrows.map(a => a[1] === -1 ? [a[0], last] : a);
          linking = LINKING_VERBS.has(w[last]); complex = COMPLEX_VERBS.has(w[last]);
          pending.forEach(p => arrows.push([p, last])); pending = [];
          i = Math.max(j, i + 1); lastNoun = null; continue;
        }
        // 動詞のあとの -ing(動名詞)は O(be などのあとなら C)
        if (verb != null && tags[i] === 'verb' && w[i].endsWith('ing') && !AUXILIARIES.has(w[verb])) {
          roles[i] = linking ? 'C' : 'O'; objects++; lastNoun = null; i++;
          if (!endsWithPause(words[i - 1]) && i <= hi) { const np = nounPhrase(i); if (np) i = np.end + 1; }
          continue;
        }
        if (tags[i] === 'adv') {
          roles[i] = 'M';
          if (i + 1 <= hi && DEGREE_ADVERBS.has(w[i]) && ['adj', 'adv'].includes(tags[i + 1])) arrows.push([i, i + 1]);
          else if (verb != null) arrows.push([i, verb]); else pending.push(i);
          i++; continue;
        }
        const np = nounPhrase(i);
        if (np) {
          if (verb == null) { if (!hasSubject) { roles[np.head] = 'S'; hasSubject = true; } }
          else if (linking) roles[np.head] = 'C';
          else if (objects >= 1 && complex) roles[np.head] = 'C';
          else { roles[np.head] = 'O'; objects++; }
          lastNoun = np.head; i = np.end + 1; continue;
        }
        if (tags[i] === 'adj' && verb != null && (linking || (complex && objects >= 1))) roles[i] = 'C';
        i++;
      }
      if (skipFirst && ['which', 'who', 'whom', 'that'].includes(w[lo]) && lo > 0 && (tags[lo - 1] === 'noun' || words[lo - 1].endsWith(','))) {
        roles[lo] = lo + 1 <= hi && tags[lo + 1] === 'verb' ? 'S' : (roles.slice(lo + 1, hi + 1).includes('O') ? null : 'O');
      }
    }
    unit(0, n - 1, false);
    const seen = new Set();
    arrows = arrows.filter(([f, t]) => f !== t && t >= 0 && !seen.has(f + '-' + t) && seen.add(f + '-' + t));
    return { words, tags, spans, roles, arrows };
  }

  /** 原形の目安(-s・-es・-ed・-ing を取る。よく使う不規則な形は表で) */
  function lemma(word) {
    const w = bare(word);
    const irregular = { is: 'be', am: 'be', are: 'be', was: 'be', were: 'be', been: 'be', has: 'have', had: 'have', did: 'do', does: 'do', went: 'go', gone: 'go', made: 'make', said: 'say', got: 'get', took: 'take', taken: 'take', came: 'come', saw: 'see', seen: 'see', knew: 'know', known: 'know', thought: 'think', bought: 'buy', found: 'find', gave: 'give', given: 'give', told: 'tell', felt: 'feel', became: 'become', left: 'leave', kept: 'keep', ran: 'run', wrote: 'write', written: 'write', ate: 'eat', children: 'child', men: 'man', women: 'woman', people: 'person', better: 'good', best: 'good', fed: 'feed', bit: 'bite' };
    if (irregular[w]) return irregular[w];
    const doubled = (st) => st.length >= 3 && st[st.length - 1] === st[st.length - 2] && !'aeiouls'.includes(st[st.length - 1]) ? st.slice(0, -1) : st;
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('ing') && w.length > 5) return doubled(w.slice(0, -3));
    if (w.endsWith('ed') && w.length > 4) { const st = w.slice(0, -2); return st.endsWith('i') ? st.slice(0, -1) + 'y' : doubled(st); }
    if (w.endsWith('es') && ['ch', 'sh', 'ss', 'x'].some(e => w.slice(0, -2).endsWith(e))) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    return w;
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

  /** 見せる/隠す(品詞・SVOC・矢印)はこのブラウザに覚えておく */
  const VIEW_KEY = 'ondoku.interpretView';
  const view = (() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') || { pos: true, roles: true, arrows: true }; } catch (e) { return { pos: true, roles: true, arrows: true }; } })();
  const state = { index: 0, tool: 'clause', showHint: false, sel: null, dragStart: null, passage: '', detail: null };

  /** 今の英文の文の一覧 */
  const sentences = () => sentencesOf(state.passage);

  /** 解釈のタブを描く */
  function render() {
    const box = $('tab-interpret');
    if (!box) return;
    state.passage = $('passage').value.trim();
    const list = sentences();
    if (!list.length) { box.innerHTML = `<div class="card empty"><div class="big-icon">${Icon('edit')}</div><b>英文がありません</b></div>`; return; }
    state.index = Math.min(state.index, list.length - 1);
    const sentence = list[state.index], words = wordsOf(sentence);
    const saved = loadAll();
    const spans = (saved[sentence] && saved[sentence].spans) || [];
    const m = marks(words.length, spans);
    const a = analyze(sentence);
    const open = (s) => `<b class="bk ${s.kind === 'clause' ? 'bk-c' : 'bk-p'}">${openOf(s)}</b>`;
    const close = (s) => `<b class="bk ${s.kind === 'clause' ? 'bk-c' : 'bk-p'}">${closeOf(s)}</b>`;
    const sel = state.sel;
    let html = `<div class="card">
      <div class="row" style="justify-content:space-between">
        <button class="ghost big-arrow" data-ip="prev" ${state.index === 0 ? 'disabled' : ''}><svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div style="text-align:center"><b style="font-size:1.1rem">${state.index + 1} / ${list.length} 文</b><div class="muted" style="font-size:.8rem">保存した文 ${list.filter(s => saved[s]).length}</div></div>
        <button class="ghost big-arrow" data-ip="next" ${state.index >= list.length - 1 ? 'disabled' : ''}><svg class="ic" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="seg" style="margin:12px 0">${[['clause', '［ ］節'], ['phrase', '( )句'], ['erase', '消す'], ['info', '調べる']].map(([k, t]) => `<button class="${state.tool === k ? 'on' : ''}" data-ip="tool" data-k="${k}">${t}</button>`).join('')}</div>
      <div class="ip-toggles">${[['pos', '品詞'], ['roles', 'SVOC'], ['arrows', '修飾の矢印']].map(([k, t]) => `<button class="ip-toggle ${view[k] ? 'on' : ''}" data-ip="view" data-k="${k}">${view[k] ? Icon('check') : ''} ${t}</button>`).join('')}</div>
      <p class="muted" style="margin:0 0 6px">${state.tool === 'info' ? '単語をタップ' : state.tool === 'erase' ? 'なぞって消す' : 'なぞって付ける'}</p>
      <div class="ip-wrap ${view.arrows ? 'with-arrows' : ''}"><svg id="ip-arrows" class="ip-arrows"></svg>
      <div id="ip-words" class="ip-words">${words.map((w, i) => {
        const role = view.roles ? a.roles[i] : null;
        const cross = view.arrows ? a.arrows.filter(([f]) => f === i) : [];
        return `<span class="iw ${sel && i >= sel[0] && i <= sel[1] ? 'sel' : ''}" data-i="${i}"><span class="iw-text">${m[i].before.map(open).join('')}${esc(w)}${m[i].after.map(close).join('')}</span>${view.pos || view.roles ? `<span class="iw-sub">${role ? `<b class="role role-${role}">${role}</b>` : ''}${view.pos ? `<small>${esc(partOfSpeech(a.words, a.tags, i).split('(')[0])}</small>` : ''}</span>` : ''}${cross.map(([, t]) => `<span class="iw-to" data-from="${i}" data-to="${t}">→ ${esc(bare(words[t]))}</span>`).join('')}</span>`;
      }).join(' ')}</div></div>
      ${view.arrows && a.arrows.length ? '<p class="muted" style="font-size:.78rem;color:#9b51e0;margin:6px 0 0">→ 修飾</p>' : ''}
    </div>
    <div class="row" style="gap:10px;margin-bottom:16px">
      <button style="flex:1" data-ip="speak">${Icon('speaker')} 区切って読む</button>
      <button class="secondary" style="flex:1" data-ip="hint">${Icon('bulb')} ${state.showHint ? 'ヒントを隠す' : 'ヒントとくらべる'}</button>
    </div>
    ${spans.length ? '<p style="text-align:center;margin-top:-6px"><button class="danger" data-ip="clear">この文の記号を全部消す</button></p>' : ''}`;
    if (state.showHint) {
      const hints = hintsOf(sentence), r = compare(spans, hints);
      const mm = marks(words.length, r.matched), mu = marks(words.length, r.onlyUser), mh = marks(words.length, r.onlyHint);
      const col = (list, cls, fn) => list.map(s => `<b class="bk ${cls}">${fn(s)}</b>`).join('');
      html += `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0;color:#f08a24">ヒントとくらべる</h2>
          <b style="font-size:1.4rem;color:${r.rate >= 0.8 ? 'var(--good)' : r.rate >= 0.5 ? '#f08a24' : 'var(--bad)'}">一致 ${Math.round(r.rate * 100)}%</b></div>
        <p class="ip-compare">${words.map((w, i) => col(mm[i].before, 'bk-ok', openOf) + col(mu[i].before, 'bk-me', openOf) + col(mh[i].before, 'bk-hint', openOf) + esc(w)
          + col(mh[i].after, 'bk-hint', closeOf) + col(mu[i].after, 'bk-me', closeOf) + col(mm[i].after, 'bk-ok', closeOf)).join(' ')}</p>
        <p style="font-weight:700;font-size:.85rem"><span class="good">一致 ${r.matched.length}</span>  <span style="color:#f08a24">＋ 自分だけ ${r.onlyUser.length}</span>  <span class="muted">− ヒントだけ ${r.onlyHint.length}</span></p>
        <p class="muted ip-serif">ヒント:${esc(renderText(words, hints))}</p></div>`;
    }
    if (state.detail != null && state.detail < words.length) html += detailHTML(a, state.detail, spans);
    box.innerHTML = html;
    bindDrag(sentence, spans);
    if (view.arrows) requestAnimationFrame(() => drawArrows(a.arrows));
  }

  /**
   * 修飾の矢印(同じ行の語どうし):修飾する語の上から、くわしくされる語の上へ、上にふくらむ曲線と矢じり
   * ふくらみの高さ = 18 + 2つの語の横の距離 × 0.08(最大 34)。ちがう行の語へは、曲線のかわりに語の下に「→ 語」と書く
   */
  function drawArrows(arrows) {
    const svg = $('ip-arrows'), box = svg && svg.parentElement;
    if (!svg) return;
    const base = box.getBoundingClientRect();
    svg.setAttribute('width', base.width); svg.setAttribute('height', base.height);
    const rect = (i) => { const el = box.querySelector(`.iw[data-i="${i}"] .iw-text`); return el ? el.getBoundingClientRect() : null; };
    let paths = '<defs><marker id="ip-head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9b51e0"/></marker></defs>';
    arrows.forEach(([f, t]) => {
      const a = rect(f), b = rect(t), label = box.querySelector(`.iw-to[data-from="${f}"][data-to="${t}"]`);
      if (!a || !b) return;
      const same = Math.abs(a.top - b.top) < a.height / 2;
      if (label) label.style.display = same ? 'none' : '';
      if (!same) return;
      const x1 = a.left + a.width / 2 - base.left, x2 = b.left + b.width / 2 - base.left, y = a.top - base.top + 4;
      const lift = Math.min(34, 18 + Math.abs(x2 - x1) * 0.08);
      paths += `<path d="M${x1},${y} Q${(x1 + x2) / 2},${y - lift} ${x2},${y}" fill="none" stroke="#9b51e0" stroke-opacity=".8" stroke-width="1.8" marker-end="url(#ip-head)"/>`;
    });
    svg.innerHTML = paths;
  }

  /** 単語のくわしい情報:発音・品詞・原形・文の中の役割・修飾・入っているまとまり・自分の音読で言えなかった回数 */
  function detailHTML(a, i, userSpans) {
    const word = bare(a.words[i]);
    const role = a.roles[i];
    let missed = 0;
    try { missed = JSON.parse(localStorage.getItem('ondoku.history') || '[]').filter(h => (h.miss || []).includes(word)).length; } catch (e) { /* なし */ }
    const around = userSpans.filter(s => s.start <= i && i <= s.end).map(s => [s, '自分の記号'])
      .concat(a.spans.filter(s => s.start <= i && i <= s.end).map(s => [s, 'ヒント'])).sort((x, y) => len(x[0]) - len(y[0]));
    return `<div class="card ip-detail" id="ip-detail">
      <div class="row" style="justify-content:space-between"><b class="ip-word">${esc(word)}</b><button class="ghost" data-ip="close-detail">閉じる</button></div>
      <div class="row"><button class="secondary" data-ip="say" data-w="${esc(word)}" data-rate="0.9">${Icon('speaker')} 発音</button><button class="secondary" data-ip="say" data-w="${esc(word)}" data-rate="0.5">ゆっくり</button></div>
      <table><tr><th>品詞</th><td>${esc(partOfSpeech(a.words, a.tags, i))}</td></tr><tr><th>原形</th><td>${esc(lemma(a.words[i]))}</td></tr>
        <tr><th>役割</th><td>${role ? `<b class="role role-${role}">${role}</b> ${esc(ROLE_MEANING[role])}` : '<span class="muted">なし</span>'}</td></tr>
        ${a.arrows.filter(([f]) => f === i).map(([, t]) => `<tr><th>修飾</th><td style="color:#9b51e0">「${esc(bare(a.words[t]))}」をくわしくしている</td></tr>`).join('')}
        ${a.arrows.filter(([, t]) => t === i).map(([f]) => `<tr><th>修飾</th><td style="color:#9b51e0">「${esc(bare(a.words[f]))}」にくわしくされている</td></tr>`).join('')}
        ${around.map(([s, who]) => `<tr><th>${s.kind === 'clause' ? '節' : '句'}</th><td class="ip-serif">${esc(openOf(s) + a.words.slice(s.start, s.end + 1).join(' ') + closeOf(s))} <small class="muted">${who}</small></td></tr>`).join('')}
        <tr><th>あなたの音読</th><td>言えなかった回数 ${missed}回</td></tr></table></div>`;
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
      if (state.tool === 'info') state.detail = lo;   // 調べる:タップした単語の詳しい情報
      else saveSentence(sentence, apply(spans, lo, hi, state.tool === 'erase' ? null : state.tool));
      render();
      if (state.tool === 'info') { const d = $('ip-detail'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
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
      case 'prev': state.index = Math.max(0, state.index - 1); state.detail = null; break;
      case 'next': state.index = Math.min(list.length - 1, state.index + 1); state.detail = null; break;
      case 'tool': state.tool = el.dataset.k; break;
      case 'view': view[el.dataset.k] = !view[el.dataset.k]; try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* なし */ } break;
      case 'close-detail': state.detail = null; break;
      case 'say': { if (!window.speechSynthesis) return; const u = new SpeechSynthesisUtterance(el.dataset.w); u.lang = 'en-US'; u.rate = Number(el.dataset.rate) || 0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); return; }
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
  window.RecitoInterpret = { analyze, lemma, partOfSpeech, render, hintsOf, renderText, wordsOf, sentencesOf, tagsOf, chunks, compare, apply,
    rendered: (sentence) => renderText(wordsOf(sentence), hintsOf(sentence)) };
})();
