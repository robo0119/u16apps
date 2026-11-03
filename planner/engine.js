// StudyPilot の計画エンジン(iOS版 StudyPlanner/Engine/*.swift と同じ計算)
// 式を変えるときは、Swift と JS の両方を直し、両方のテストを通すこと
(function (root) {
  'use strict';

  // ---- 日付(「yyyy-MM-dd」の文字で扱う。タイムゾーンに左右されない)----

  /** 文字 → その日の0時(端末の時刻) */
  const toDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  /** 日付 → 文字 */
  const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  /** n日後の文字 */
  const addDays = (key, n) => { const d = toDate(key); d.setDate(d.getDate() + n); return keyOf(d); };
  /** a から b まで何日か */
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  /** 曜日(Swift と同じ 1=日 … 7=土) */
  const weekdayOf = (key) => toDate(key).getDay() + 1;

  // ---- 使える時間(AvailableTime.swift)----

  const BREAK_RATIO = 1 / 6;

  /** 重なっている区間をまとめる */
  function merge(blocks) {
    const result = [];
    blocks.slice().sort((a, b) => a.start - b.start).forEach(b => {
      const last = result[result.length - 1];
      if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
      else result.push({ start: b.start, end: b.end });
    });
    return result;
  }

  /**
   * 勉強時間 = 起きている時間 − 学校 − 予定 − 生活 − 休憩
   * 休憩 = 空き時間 × 1/6(切り上げ)、勉強時間は5分単位に切り捨て
   */
  function availableTime(day) {
    const wake = day.wake;
    const sleep = day.sleep <= day.wake ? day.sleep + 1440 : day.sleep;
    const awake = sleep - wake;
    const clip = (b) => { const s = Math.max(b.start, wake), e = Math.min(b.end, sleep); return e > s ? { start: s, end: e } : null; };
    const school = day.school ? clip(day.school) : null;
    const schoolMinutes = school ? school.end - school.start : 0;
    const all = merge([school, ...day.events.map(clip)].filter(Boolean));
    const busy = all.reduce((s, b) => s + b.end - b.start, 0);
    const living = Math.min(day.livingMinutes, Math.max(0, awake - busy));
    const free = Math.max(0, awake - busy - living);
    const breaks = Math.ceil(free * BREAK_RATIO);
    const study = Math.max(0, Math.floor((free - breaks) / 5) * 5);
    return { awake, school: schoolMinutes, events: busy - schoolMinutes, living, breaks: free - study, study };
  }

  // ---- 時程(PeriodClock.swift)----

  /** 時程を作る(設定の項目名は Firestore と同じ) */
  function periodClock(s) {
    const c = { firstStart: s.firstPeriodStart ?? 520, length: s.periodLength ?? 50, breakLength: s.periodBreak ?? 10,
      lunchAfter: s.lunchAfter ?? 4, lunchLength: s.lunchLength ?? 45, afterLast: s.afterLast ?? 15 };
    // 始まり = 1時間目 + (p−1)×(コマ+休み)、昼休みより後は + (昼休み − 休み)
    c.start = (period) => { const p = Math.max(1, period); let m = c.firstStart + (p - 1) * (c.length + c.breakLength); if (p > c.lunchAfter) m += c.lunchLength - c.breakLength; return m; };
    c.end = (p) => c.start(p) + c.length;
    c.schoolEnd = (last) => c.end(last) + c.afterLast;
    c.block = (from, to) => ({ start: c.start(Math.min(from, to)), end: c.end(Math.max(from, to)) });
    return c;
  }

  // ---- ペースの調整(Adaptation.swift)----

  /** 調整率 = 最近の完了率 + 0.1(0.5〜1.0)。記録が3日未満なら1.0 */
  function loadFactor(days) {
    const used = days.filter(d => d.planned > 0);
    if (used.length < 3) return 1;
    const planned = used.reduce((s, d) => s + d.planned, 0);
    const done = used.reduce((s, d) => s + Math.min(d.done, d.planned), 0);
    return Math.min(1, Math.max(0.5, done / planned + 0.1));
  }
  const adjustedMinutes = (minutes, factor) => Math.floor(Math.floor(minutes * factor) / 5) * 5;

  // ---- 苦手度と優先度(Weakness.swift / Priority.swift)----

  /** 1回の成績の「できた度」= 得点率(偏差値があれば (偏差値−35)÷30×100 との平均) */
  function ability(p) {
    const rate = p.max > 0 ? Math.min(100, Math.max(0, p.score / p.max * 100)) : 0;
    if (p.deviation == null) return rate;
    return (rate + Math.min(100, Math.max(0, (p.deviation - 35) / 30 * 100))) / 2;
  }

  /** 苦手度 = 100 − 最近3回のできた度(3:2:1の重み)+ 10以上下がっていたら+10 */
  function weakness(points) {
    const recent = points.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(ability);
    if (!recent.length) return 50;
    const w = [3, 2, 1];
    let total = 0, sum = 0;
    recent.forEach((v, i) => { total += v * w[i]; sum += w[i]; });
    let result = 100 - total / sum;
    if (recent.length >= 2 && recent[1] - recent[0] >= 10) result += 10;
    return Math.min(100, Math.max(0, result));
  }

  /** 急ぎ度 = 1 + 2 × max(0, 14 − 日数) ÷ 14 */
  const urgency = (days) => (days == null || days < 0) ? 1 : 1 + 2 * Math.max(0, 14 - days) / 14;

  /** 優先度 = (0.3 + 0.7 × 苦手度 ÷ 100) × 急ぎ度 × (授業があれば1.1) */
  /** 優先度 = (0.3 + 0.7 × 苦手度 ÷ 100) × 急ぎ度 × 授業の倍率(1.1) × 文理の倍率(理系なら数学・理科が 1.2) */
  const priority = (s, hadClass) => (0.3 + 0.7 * Math.min(100, Math.max(0, s.weakness)) / 100) * urgency(s.daysToTest) * (hadClass ? 1.1 : 1) * (s.trackWeight || 1);

  // ---- 文系・理系(Track.swift)----

  const SCIENCE = ['数', '物理', '化学', '生物', '地学', '理科'];
  const HUMANITIES = ['国語', '現代文', '古文', '漢文', '古典', '言語文化', '論理国語', '文学', '社会', '歴史', '日本史', '世界史', '地理', '公共', '政治', '倫理'];
  const isScience = (name) => SCIENCE.some(w => name.includes(w));
  const isHumanities = (name) => HUMANITIES.some(w => name.includes(w));
  /** 主要教科か(理系:数学・理科・英語、文系:国語・社会・英語) */
  function isCore(track, name) {
    if (track === '理系') return isScience(name) || name.includes('英');
    if (track === '文系') return isHumanities(name) || name.includes('英');
    return false;
  }
  /** 計画の倍率:理系なら数学・理科を ×1.2、文系なら国語・社会を ×1.2 */
  function trackWeight(track, name) {
    if (track === '理系') return isScience(name) ? 1.2 : 1;
    if (track === '文系') return isHumanities(name) ? 1.2 : 1;
    return 1;
  }

  // ---- 考査の偏差値の目安(ScoreEstimate)----

  /** 標準正規分布で上位の割合が p になる z(Abramowitz & Stegun 26.2.23) */
  function zUpper(p) {
    const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
    if (q > 0.5) return -zUpper(1 - q);
    const t = Math.sqrt(-2 * Math.log(q));
    return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  }
  /**
   * 偏差値の目安
   * 1. 順位と人数があれば:p = (順位 − 0.5) ÷ 人数 → 偏差値 = 50 + 10 × z(上位 p)
   * 2. 平均点だけなら:偏差値 = 50 + 10 × (点数 − 平均点) ÷ (満点 × 0.15)
   * 3. どちらもなければ null。20〜80 におさめる
   */
  function estimateDeviation(score, max, average, rank, takers) {
    let v = null;
    if (rank != null && takers > 0 && rank >= 1 && rank <= takers) v = 50 + 10 * zUpper((rank - 0.5) / takers);
    else if (average != null && max > 0) v = 50 + 10 * (score - average) / (max * 0.15);
    return v == null ? null : Math.min(80, Math.max(20, v));
  }
  /** 苦手度に使う偏差値:模試の偏差値、なければ考査の順位・平均点から見積もった値 */
  const effectiveDeviation = (r) => r.deviation != null ? r.deviation : estimateDeviation(r.score, r.max, r.average, r.rank, r.takers);
  /** 模試か(種類が空なら名前に「模試」「模擬」があれば模試) */
  const isMock = (r) => r.kind ? r.kind === '模試' : /模試|模擬/.test(r.testName || '');

  // ---- 1日の時間の計画(PlanEngine.swift)----

  const MIN_TASK = 15, MAX_SUBJECTS = 4;

  /** 時間を優先度に比例して配る(5分単位・15分未満の教科は外す) */
  function allocate(total, priorities) {
    const result = priorities.map(() => 0);
    if (total < MIN_TASK || !priorities.length) return result;
    const order = priorities.map((_, i) => i).sort((a, b) => priorities[b] - priorities[a] || a - b);
    let count = Math.min(MAX_SUBJECTS, order.length, Math.floor(total / MIN_TASK));
    while (count > 0) {
      const chosen = order.slice(0, count);
      const sum = chosen.reduce((s, i) => s + priorities[i], 0);
      const units = Math.floor(total / 5);
      const exact = {}, given = {};
      chosen.forEach(i => { exact[i] = sum > 0 ? units * priorities[i] / sum : units / count; given[i] = Math.floor(exact[i]); });
      let spare = units - chosen.reduce((s, i) => s + given[i], 0);
      chosen.slice().sort((a, b) => (exact[b] - given[b]) - (exact[a] - given[a])).forEach(i => { if (spare > 0) { given[i]++; spare--; } });
      if (chosen.every(i => given[i] * 5 >= MIN_TASK)) { chosen.forEach(i => { result[i] = given[i] * 5; }); return result; }
      count--;
    }
    return result;
  }

  /** 勉強の内容 */
  function content(s) {
    if (s.daysToTest != null && s.daysToTest <= 3) return 'テスト範囲の総復習(間違えた問題の解き直し)';
    if (s.daysToTest != null && s.daysToTest <= 7) return 'テスト範囲の問題集';
    if (s.weakness >= 60) return '基礎の復習(教科書の例題)';
    if (s.weakness >= 40) return '問題集の復習';
    return '応用問題にチャレンジ';
  }

  /** 選んだ理由(1行) */
  function reason(s, rank, hadClass) {
    const parts = [`苦手度${Math.round(s.weakness)}`];
    if (s.daysToTest != null) {
      const name = s.testName || 'テスト';
      parts.push(s.daysToTest === 0 ? `今日が${name}` : `${name}まで${s.daysToTest}日`);
    } else parts.push('テストはまだ先');
    if (hadClass) parts.push('今日授業があった');
    if ((s.trackWeight || 1) > 1) parts.push('重点教科');
    return parts.join('・') + ` → 優先度${rank}位`;
  }

  /** 1日の計画:やり残しを先に入れ、残りを優先度の高い最大4教科に比例配分 */
  function plan(day, subjects, carryOver = [], usedMinutes = 0, factor = 1) {
    const breakdown = availableTime(day);
    let remaining = Math.max(0, adjustedMinutes(breakdown.study, factor) - usedMinutes);
    const tasks = [], leftover = [];
    carryOver.forEach(item => {
      const fit = Math.floor(Math.min(item.minutes, remaining) / 5) * 5;
      if (fit >= MIN_TASK || (fit > 0 && fit === item.minutes)) {
        tasks.push({ subject: item.subject, minutes: fit, content: item.content, reason: `前の日のやり残し(${item.minutes}分)を先に片付ける`, isCarryOver: true });
        remaining -= fit;
        if (item.minutes > fit) leftover.push({ subject: item.subject, minutes: item.minutes - fit, content: item.content });
      } else leftover.push(item);
    });
    const classes = day.classesToday || new Set();
    const ranked = subjects.map(s => [s, priority(s, classes.has(s.name))]).sort((a, b) => b[1] - a[1]);
    const minutes = allocate(remaining, ranked.map(r => r[1]));
    ranked.forEach(([s], rank) => {
      if (minutes[rank] > 0) tasks.push({ subject: s.name, minutes: minutes[rank], content: content(s), reason: reason(s, rank + 1, classes.has(s.name)), isCarryOver: false });
    });
    return { breakdown, tasks, leftover };
  }

  /** やり残しを、これからの日に入るだけ順に配る */
  function redistribute(items, capacities) {
    const perDay = capacities.map(() => []);
    const free = capacities.slice();
    const unplaced = [];
    items.forEach(original => {
      const item = { ...original };
      perDay.forEach((list, day) => {
        if (item.minutes <= 0) return;
        const fit = Math.floor(Math.min(item.minutes, free[day]) / 5) * 5;
        if (!(fit >= MIN_TASK || (fit > 0 && fit === item.minutes))) return;
        list.push({ subject: item.subject, minutes: fit, content: item.content });
        free[day] -= fit;
        item.minutes -= fit;
      });
      if (item.minutes > 0) unplaced.push(item);
    });
    return { perDay, unplaced };
  }

  // ---- モード(StudyMode.swift)----

  const EXAM_WINDOW = 14;
  const covers = (e, subject) => !e.subjects.length || e.subjects.includes(subject);
  const inExamWindow = (day, e) => addDays(e.start, -EXAM_WINDOW) <= day && day <= e.end;

  /** 日本の祝日(振替休日をふくむ。StudyMode.swift の Holidays と同じ) */
  const HOLIDAYS = new Set(['2026-11-03', '2026-11-23', '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-22',
    '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11',
    '2027-11-03', '2027-11-23', '2028-01-01', '2028-01-10', '2028-02-11', '2028-02-23', '2028-03-20']);

  /** モード:行事の日 → 軽め、考査の14日前〜最終日 → 考査、長期休み・祝日 → 休み、それ以外 → 通常 */
  function modeOn(day, events) {
    if (events.some(e => !e.isExam && !e.isVacation && e.start <= day && day <= e.end)) return '軽め';
    if (events.some(e => e.isExam && inExamWindow(day, e))) return '考査';
    if (events.some(e => e.isVacation && e.start <= day && day <= e.end)) return '休み';
    if (HOLIDAYS.has(day)) return '休み';
    return '通常';
  }

  /** 重み:軽め0.5、通常1.0、考査は考査に出る教科1.5・出ない教科0.5 */
  function weight(subject, day, events) {
    const mode = modeOn(day, events);
    if (mode === '軽め') return 0.5;
    if (mode === '通常' || mode === '休み') return 1;
    return events.some(e => e.isExam && covers(e, subject) && inExamWindow(day, e)) ? 1.5 : 0.5;
  }

  /** その日に考査期間の教科(全教科の考査があれば null) */
  function examSubjects(day, events) {
    const active = events.filter(e => e.isExam && inExamWindow(day, e));
    if (active.some(e => !e.subjects.length)) return null;
    return new Set(active.flatMap(e => e.subjects));
  }

  // ---- 逆算ノルマ(Quota.swift)----

  /** 締め切り:自分で決めた日(過ぎていたら今日+6日)→ 次の考査の前日 → 今日+29日 */
  function deadline(m, today, events) {
    if (m.deadline) return m.deadline >= today ? m.deadline : addDays(today, 6);
    const next = events.filter(e => e.isExam && covers(e, m.subject) && e.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (next) { const before = addDays(next.start, -1); return before > today ? before : today; }
    return addDays(today, 29);
  }

  /** 今日のノルマ = 切り上げ(残り × 今日の重み ÷ 今日〜締め切りの重みの合計) */
  function quota(remaining, today, due, weightOf) {
    if (remaining <= 0) return 0;
    const w = weightOf(today);
    if (w <= 0) return 0;
    let total = 0;
    for (let d = today; d <= due; d = addDays(d, 1)) total += weightOf(d);
    if (total <= 0) return remaining;
    return Math.min(remaining, Math.ceil(remaining * w / total));
  }

  /** その問題番号が入っているルートの区切り */
  const stepFor = (problem, route) => (route || []).find(s => s.from <= problem && problem <= s.to) || null;

  /** 役割ごとに今日のノルマを出すか:メイン・毎日はいつも、考査用は考査モードで考査に出る教科だけ、補助・後回しは出さない */
  function isActive(m, today, events) {
    const role = m.role || 'メイン';
    if (role === '補助' || role === '後回し') return false;
    if (role === '考査用') {
      if (modeOn(today, events) !== '考査') return false;
      const subs = examSubjects(today, events);
      return subs === null || subs.has(m.subject);
    }
    return true;
  }

  /** 教材ごとの今日のノルマ(苦手分野 → 考査に出る教科 → ノルマの多い順)。総問題数が未定(0)なら、毎日やるものだけ1日1回 */
  function planQuota(materials, today, events, weakFields) {
    const exam = examSubjects(today, events);
    const isExamDay = modeOn(today, events) === '考査';
    const list = [];
    materials.forEach(m => {
      if (!isActive(m, today, events)) return;
      const due = deadline(m, today, events);
      if (!(m.total > 0)) {
        if (m.isDaily) list.push({ materialID: m.id, subject: m.subject, quota: 1, from: m.done + 1, to: m.done + 1, field: null, isWeakField: false, deadline: due });
        return;
      }
      const remaining = Math.max(0, m.total - m.done);
      const q = quota(remaining, today, due, d => weight(m.subject, d, events));
      if (q <= 0) return;
      const from = m.done + 1;
      const step = stepFor(from, m.route);
      const field = step ? step.field : null;
      const weak = !!(field && weakFields[m.subject] && weakFields[m.subject].has(field));
      list.push({ materialID: m.id, subject: m.subject, quota: q, from, to: m.done + q, field, isWeakField: weak, deadline: due });
    });
    const rank = (q) => q.isWeakField ? 0 : (isExamDay && (exam === null || exam.has(q.subject)) ? 1 : 2);
    return list.sort((a, b) => rank(a) - rank(b) || b.quota - a.quota);
  }

  // ---- 解き直し(ReviewQueue.swift)----

  const AFTER = { '○': null, '△': 3, '×': 1 };

  /** 問題ごとのいちばん新しい記録 */
  function latest(attempts) {
    const map = new Map();
    attempts.forEach(a => {
      const key = `${a.material}#${a.no}`;
      const old = map.get(key);
      if (old && (old.date > a.date || (old.date === a.date && (old.at || 0) > (a.at || 0)))) return;
      map.set(key, a);
    });
    return map;
  }

  /** 今日までに解き直す問題(×は翌日、△は3日後) */
  function reviewDue(attempts, today) {
    const list = [];
    latest(attempts).forEach(a => {
      const after = AFTER[a.mark];
      if (after == null) return;
      const due = addDays(a.date, after);
      if (due <= today) list.push({ material: a.material, no: a.no, lastMark: a.mark, lastDate: a.date, due });
    });
    return list.sort((a, b) => a.due.localeCompare(b.due) || (a.lastMark === '×' ? 0 : 1) - (b.lastMark === '×' ? 0 : 1) || a.no - b.no);
  }

  /** 今日のキュー(今日より前の記録で決まる) */
  const todaysQueue = (attempts, today) => reviewDue(attempts.filter(a => a.date < today), today);

  /** 今日のキューのうち、今日解き直した数 */
  function reviewDoneToday(attempts, today) {
    const todays = new Set(attempts.filter(a => a.date === today).map(a => `${a.material}#${a.no}`));
    return todaysQueue(attempts, today).filter(r => todays.has(`${r.material}#${r.no}`)).length;
  }

  // ---- 苦手分野(WeakField.swift)----

  const rateOf = (f) => f.max > 0 ? f.score / f.max * 100 : 0;

  /** 苦手:得点率60%未満、または 教科の平均 − 10 以下 */
  function weakIn(fields) {
    const list = (fields || []).filter(f => f.max > 0);
    const maxSum = list.reduce((s, f) => s + f.max, 0);
    if (maxSum <= 0) return [];
    const avg = list.reduce((s, f) => s + f.score, 0) / maxSum * 100;
    return list.filter(f => rateOf(f) < 60 || rateOf(f) <= avg - 10).sort((a, b) => rateOf(a) - rateOf(b));
  }

  /** 教科ごとの苦手分野(教科ごとに、分野別がある最新の結果) scores: [{date, subject, fields}] */
  function weakFields(scores) {
    const latestBy = {};
    scores.filter(s => s.fields && s.fields.length).forEach(s => {
      if (latestBy[s.subject] && latestBy[s.subject].date >= s.date) return;
      latestBy[s.subject] = s;
    });
    const result = {};
    Object.keys(latestBy).forEach(subject => {
      const names = weakIn(latestBy[subject].fields).map(f => f.name);
      if (names.length) result[subject] = new Set(names);
    });
    return result;
  }

  // ---- ストリーク(Streak.swift)----

  const TICKET_EVERY = 7, MAX_TICKETS = 2;

  /** 達成:やった数 × 5 ≧ ノルマ × 4(80%以上) */
  const isAchieved = (quota, done) => quota > 0 && done * 5 >= quota * 4;

  /**
   * ストリーク:最初の記録の日から今日まで1日ずつ
   * ノルマ0 → 数えない / 達成 → +1(7の倍数でチケット+1、最大2)/ 未達成 → チケットがあれば自動で使う、なければ0
   * 今日はまだ途中なら途切れさせない
   */
  function streak(days, today, useTickets = true, protectedDays = new Set()) {
    const byDay = {};
    days.forEach(d => { byDay[d.date] = d; });
    const keys = Object.keys(byDay).sort();
    if (!keys.length || keys[0] > today) return { current: 0, longest: 0, tickets: 0, status: {} };
    let current = 0, longest = 0, tickets = 0;
    const status = {};
    for (let day = keys[0]; day <= today; day = addDays(day, 1)) {
      const r = byDay[day];
      if (r && r.quota <= 0) status[day] = 'skipped';
      else if (r && isAchieved(r.quota, r.done)) {
        current++; longest = Math.max(longest, current); status[day] = 'achieved';
        if (useTickets && current % TICKET_EVERY === 0) tickets = Math.min(MAX_TICKETS, tickets + 1);
      } else if (day === today) status[day] = 'inProgress';
      else if (useTickets && tickets > 0) { tickets--; status[day] = 'ticket'; }
      else if (!useTickets && protectedDays.has(day)) status[day] = 'ticket';
      else { current = 0; status[day] = 'missed'; }
    }
    return { current, longest, tickets, status };
  }

  // ---- 毎日のノルマを自動で選ぶ(Schedule.swift と同じ決まり)----

  const OTHER_EVERY = 2;
  const WEEKEND_PICKS = [['数学', 3], ['英語', 2], ['物理', 1], ['化学', 1]];

  /** 単元の順に回すグループで、今日やる教材と単元を選ぶ(並び 0,1,0,2… で試し、1つ前の教材が終えた単元だけやれる) */
  function pipelinePick(members) {
    const stages = members.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : 1));
    if (!stages.length) return null;
    const pattern = [0];
    for (let s = 1; s < stages.length; s++) pattern.push(...(s === 1 ? [1] : [0, s]));
    const total = stages.reduce((n, x) => n + (x.unitsDone || 0), 0);
    const first = pattern[total % pattern.length];
    const allowed = (s) => { const u = stages[s].unitsDone || 0; return u < (stages[s].units || []).length && (s === 0 || u < (stages[s - 1].unitsDone || 0)); };
    for (const s of [first, ...stages.map((_, i) => i).filter(i => i !== first)]) {
      if (!allowed(s)) continue;
      const item = stages[s], unit = item.unitsDone || 0;
      return { item, unit, reason: s === 0 ? `${item.name}:これからの単元「${item.units[unit]}」` : `${item.name}:前の単元「${item.units[unit]}」をもう一度` };
    }
    return null;
  }

  /** 日の番号(2000年1月1日から何日目か) */
  const dayIndex = (key) => daysBetween('2000-01-01', key);

  /** 枠が、その日より前の平日に何回出たか(2000-01-01 は土曜なので曜日 = (k+6)%7、0=日 6=土)。N と 7 の最小公倍数で1周 */
  function weekdayOccurrences(index, shift, every) {
    if (index <= 0 || every <= 0) return 0;
    const hit = (k) => { const w = (k + 6) % 7; return w !== 0 && w !== 6 && (k + shift) % every === 0; };
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const cycle = every * 7 / gcd(every, 7);
    let per = 0; for (let k = 0; k < cycle; k++) if (hit(k)) per++;
    const full = Math.floor(index / cycle);
    let n = full * per;
    for (let k = full * cycle; k < index; k++) if (hit(k)) n++;
    return n;
  }

  // ---- 周回(Laps.swift と同じ)----

  /** どれかの周の期間に入っているか(周回の予定がなければ true。終えた周は出さない) */
  const lapInWindow = (laps, day) => !laps || !laps.length || laps.some(l => !l.done && l.start <= day && day <= l.end);

  /** 今の周回の状態:遅れ → 途中 → まだ → 全部終えた */
  function lapStatus(laps, day) {
    if (!laps || !laps.length) return null;
    const open = laps.filter(l => !l.done).sort((a, b) => a.lap - b.lap);
    const late = open.find(l => l.end < day);
    if (late) return { lap: late, state: 'late', days: daysBetween(late.end, day) };
    const now = open.find(l => l.start <= day && day <= l.end);
    if (now) {
      const length = Math.max(1, daysBetween(now.start, now.end) + 1);
      return { lap: now, state: 'running', days: daysBetween(day, now.end), progress: Math.min(1, daysBetween(now.start, day) / length) };
    }
    const next = open.find(l => l.start > day);
    if (next) return { lap: next, state: 'upcoming', days: daysBetween(day, next.start) };
    return { lap: null, state: 'finished' };
  }

  /** 表示用の1行(例:「1周目 あと12日」) */
  function lapLabel(s) {
    const lap = s.lap ? `${s.lap.lap}周目` : '';
    if (s.state === 'upcoming') return `${lap}まで あと${s.days}日`;
    if (s.state === 'running') return s.days === 0 ? `${lap} 今日まで` : `${lap} あと${s.days}日`;
    if (s.state === 'late') return `${lap} ${s.days}日遅れ`;
    return '全部の周を終えた';
  }

  /** その日に使える教材か(期間・役割・モード・周回) */
  function schedActive(item, day, events) {
    if (item.activeFrom && item.activeFrom > day) return false;
    if (item.activeUntil && item.activeUntil < day) return false;
    if (!lapInWindow(item.laps, day)) return false;
    if (item.role === '後回し') return false;
    if (item.role === '考査用') {
      if (modeOn(day, events) !== '考査') return false;
      const subs = examSubjects(day, events);
      return subs === null || subs.has(item.subject);
    }
    return true;
  }

  /** 自動で選ぶときの点 = 教科の優先度 × (1 + 前回からの日数 ÷ 7)。一度もやっていなければ30日 */
  function schedScore(item, day, priority) {
    const since = item.lastDone ? Math.max(0, daysBetween(item.lastDone, day)) : 30;
    return (priority[item.subject] ?? 1) * (1 + since / 7);
  }

  /**
   * その日のノルマ(平日:毎日・N日に1回・グループは交互・「その他」。土日:毎日 + 数学3・英語2・物理1・化学1)
   * 行事の日(軽め)は量を半分(切り上げ)
   */
  function schedule(items, day, events, priority = {}) {
    const mode = modeOn(day, events);
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const active = items.filter(i => schedActive(i, day, events)).sort(byOrder);
    const result = [], chosen = new Set();
    const add = (item, reason) => {
      if (chosen.has(item.id)) return;
      chosen.add(item.id);
      result.push({ id: item.id, amount: mode === '軽め' ? Math.floor((item.amount + 1) / 2) : item.amount, unit: item.unit,
        reason: mode === '軽め' ? reason + '(行事の日なので半分)' : reason });
    };
    const isDaily = (i) => i.everyDays === 1 && !i.group && !i.weekendOnly;
    active.filter(isDaily).forEach(i => add(i, '毎日'));
    const pipelines = {};
    active.filter(i => i.pipeline && i.group).forEach(i => { (pipelines[i.group] = pipelines[i.group] || []).push(i); });
    /** 単元の順に回すグループから1つ入れる */
    const addPipeline = (members) => {
      const pick = pipelinePick(members);
      if (!pick || chosen.has(pick.item.id)) return false;
      members.forEach(m => chosen.add(m.id));
      result.push({ id: pick.item.id, amount: 1, unit: '単元', reason: pick.reason, unitIndex: pick.unit });
      return true;
    };
    /** 土日だけの教材を入れる(グループは前回からの日数がいちばん長い1冊。同じなら並び順)。教科ごとの数を返す */
    const addWeekendOnly = () => {
      const used = {}, groups = {};
      active.filter(i => i.weekendOnly).forEach(i => { const k = i.group || '#' + i.id; (groups[k] = groups[k] || []).push(i); });
      Object.keys(groups).sort().forEach(k => {
        const members = groups[k];
        const since = (i) => i.lastDone ? daysBetween(i.lastDone, day) : 9999;
        const pick = members.slice().sort((a, b) => (since(b) - since(a)) || ((a.order || 0) - (b.order || 0)))[0];
        add(pick, members.length > 1 ? `土日:${k}(交互)` : '土日だけ');
        used[pick.subject] = (used[pick.subject] || 0) + 1;
      });
      return used;
    };
    const wd = weekdayOf(day);
    // 休み(冬休み・祝日など):N日に1回の教材とグループの枠を全部出し、「その他」も2つ
    const allDue = mode === '休み';
    if ((wd === 1 || wd === 7) && !allDue) {
      const picks = WEEKEND_PICKS, label = '土日';
      const used = addWeekendOnly();
      Object.keys(pipelines).sort().forEach(name => { if (addPipeline(pipelines[name])) used[pipelines[name][0].subject] = (used[pipelines[name][0].subject] || 0) + 1; });
      const cands = active.filter(i => !isDaily(i) && !i.pipeline && !i.weekendOnly);
      picks.forEach(([subject, count]) => {
        cands.filter(i => i.subject === subject && !chosen.has(i.id))
          .sort((a, b) => (schedScore(b, day, priority) - schedScore(a, day, priority)) || byOrder(a, b)).slice(0, Math.max(0, count - (used[subject] || 0)))
          .forEach(i => add(i, `${label}:${subject}を重点に、前回からの日数で選んだ`));
      });
      return result;
    }
    // 休みの日は、土日だけの教材も入れる
    if (allDue) addWeekendOnly();
    const slots = [];
    const sorted = items.slice().sort(byOrder).filter(i => !i.weekendOnly);
    const groups = {};
    sorted.filter(i => i.group).forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });
    sorted.filter(i => !i.group && i.everyDays >= 2).forEach(i => slots.push({ every: i.everyDays, members: [i], label: `${i.everyDays}日に1回` }));
    Object.keys(groups).sort().forEach(name => {
      const ev = groups[name].map(i => i.everyDays).filter(n => n > 0);
      const every = Math.max(1, ev.length ? Math.min(...ev) : 2);
      slots.push({ every, members: groups[name], label: `${name}(交互・${every}日に1回)` });
    });
    slots.push({ every: OTHER_EVERY, members: [], label: 'その他', other: true });
    const index = dayIndex(day), rank = {}, activeIDs = new Set(active.map(i => i.id));
    // 同じ N の枠を順にずらす(安定した並べ替え:N の小さい順、同じ N は上の順のまま)
    slots.map((s, k) => [s, k]).sort((a, b) => a[0].every - b[0].every || a[1] - b[1]).forEach(([slot]) => {
      const r = rank[slot.every] || 0;
      rank[slot.every] = r + 1;
      const shifted = index + r % slot.every;
      if (!allDue && shifted % slot.every !== 0) return;
      const label = allDue ? `休みの日:${slot.label}` : slot.label;
      if (slot.other) {
        for (let n = 0; n < (allDue ? 2 : 1); n++) {
          const pool = active.filter(i => i.everyDays === 0 && !i.group && !i.pipeline && !i.weekendOnly && !chosen.has(i.id));
          if (!pool.length) break;
          const best = pool.reduce((a, b) => schedScore(b, day, priority) > schedScore(a, day, priority) ? b : a);
          add(best, allDue ? '休みの日:その他(教科の優先度と、前回からの日数で選んだ)' : 'その他:教科の優先度と、前回からの日数で選んだ');
        }
      } else if (slot.members.some(i => i.pipeline)) {
        addPipeline(slot.members.filter(i => activeIDs.has(i.id)));
      } else if (slot.members.length === 1) {
        if (activeIDs.has(slot.members[0].id)) add(slot.members[0], label);
      } else {
        const members = slot.members.filter(i => activeIDs.has(i.id));
        if (!members.length) return;
        const turn = weekdayOccurrences(index, r % slot.every, slot.every);
        add(members[turn % members.length], label);
      }
    });
    return result;
  }

  const Engine = {
    dayIndex, weekdayOccurrences, pipelinePick, schedActive, schedScore, schedule, lapInWindow, lapStatus, lapLabel,
    toDate, keyOf, addDays, daysBetween, weekdayOf, merge, availableTime, periodClock, loadFactor, adjustedMinutes,
    ability, weakness, urgency, priority, allocate, isCore, trackWeight, estimateDeviation, effectiveDeviation, isMock, content, reason, plan, redistribute,
    modeOn, weight, examSubjects, inExamWindow, deadline, quota, stepFor, planQuota, isActive,
    latest, reviewDue, todaysQueue, reviewDoneToday, weakIn, weakFields, isAchieved, streak,
    MAX_TICKETS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
