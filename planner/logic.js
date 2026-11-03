// 保存してあるデータを計画エンジンに渡す係(iOS版の PlannerService.swift / StudyService.swift と同じ手順)
(function (root) {
  'use strict';
  const E = root.Engine, S = root.Store;

  /** 生活時間などの設定(なければ iOS版と同じ初期値) */
  const DEFAULT_SETTINGS = { wake: 390, sleep: 1380, schoolStart: 500, schoolEnd: 950, commute: 20, living: 150,
    firstPeriodStart: 520, periodLength: 50, periodBreak: 10, lunchAfter: 4, lunchLength: 45, afterLast: 15, track: '理系' };

  const L = {
    today: () => E.keyOf(new Date()),
    settings: () => ({ ...DEFAULT_SETTINGS, ...(S.data.settings.main || {}) }),
    subjects: () => S.all('subjects').sort((a, b) => a.order - b.order),
    materials: () => S.all('materials').sort((a, b) => (a.order || 0) - (b.order || 0)),

    // ---- 時間の計画(PlannerService.swift)----

    /**
     * その日の条件:学校(時間割にその曜日のコマがあれば。時間割が空なら月〜金)・予定・生活
     * 学校の終わり = その曜日の最後の時間目の終わり + 終礼(時程から)
     */
    dayContext(key) {
      const s = L.settings();
      const weekday = E.weekdayOf(key);
      const slots = S.all('timetable');
      const todays = slots.filter(t => t.weekday === weekday);
      const isSchool = slots.length ? todays.length > 0 : weekday >= 2 && weekday <= 6;
      const clock = E.periodClock(s);
      const schoolEnd = todays.length ? clock.schoolEnd(Math.max(...todays.map(t => t.period))) : s.schoolEnd;
      const school = isSchool ? { start: s.schoolStart - s.commute, end: schoolEnd + s.commute } : null;
      const events = S.all('weeklyEvents').filter(w => w.weekday === weekday).map(w => ({ start: w.start, end: w.end }));
      S.all('events').filter(e => e.date === key).forEach(e => {
        if (e.periodFrom != null && e.periodTo != null) events.push(clock.block(e.periodFrom, e.periodTo));
        else if (e.hasTime) events.push({ start: e.start, end: e.end });
      });
      return { wake: s.wake, sleep: s.sleep, school, events, livingMinutes: s.living, classesToday: new Set(todays.map(t => t.subject)) };
    },

    /** 教科ごとの苦手度と、次のテストまでの日数 */
    subjectStates(key) {
      const scores = S.all('scores');
      const track = L.settings().track;
      const tests = S.all('events').filter(e => (e.kind === '定期テスト' || e.kind === '模試') && e.date >= key).sort((a, b) => a.date.localeCompare(b.date));
      return L.subjects().map(sub => {
        const points = scores.filter(s => s.subject === sub.name).map(s => ({ date: s.date, score: s.score, max: s.max, deviation: E.effectiveDeviation(s) }));
        const next = tests.find(t => !t.subjects.length || t.subjects.includes(sub.name));
        return { name: sub.name, weakness: E.weakness(points), daysToTest: next ? E.daysBetween(key, next.date) : null, testName: next ? next.title : null, trackWeight: E.trackWeight(track, sub.name) };
      });
    },

    /** その日のタスク(待ちのやり残しは入れない) */
    tasks: (key) => S.all('tasks').filter(t => t.date === key && !t.pending),

    /** 計画で作ったタスクのID(2台で同じ日の計画を作っても同じIDになる) */
    taskID: (key, kind, i) => `${key}-${kind}-${i}`,

    /** 今日の計画がまだ無ければ作る */
    ensurePlan(key) {
      if (L.tasks(key).length) return;
      L.makePlan(key, [], 't');
    },

    /** 計画を作り直す(終わったタスクは残す。終わっていないやり残しは待ちに戻す) */
    regeneratePlan(key) {
      const current = L.tasks(key);
      const done = current.filter(t => t.done);
      current.filter(t => !t.done).forEach(t => {
        if (t.carry) S.put('tasks', t.id, { ...t, pending: true }); else S.remove('tasks', t.id);
      });
      L.makePlan(key, done, `r${Math.floor(Date.now() / 1000)}`);
    },

    /** 計画を作って保存する:やり残しを集める → 今日の計画 → 入らない分を7日間に配り直す */
    makePlan(key, keepDone, prefix) {
      const all = S.all('tasks').sort((a, b) => a.date.localeCompare(b.date));
      const carry = [];
      all.filter(t => t.date <= key && t.pending).forEach(t => { carry.push({ subject: t.subject, minutes: t.minutes, content: t.content }); S.remove('tasks', t.id); });
      all.filter(t => t.date < key && !t.done && !t.pending && !t.carried).forEach(t => {
        carry.push({ subject: t.subject, minutes: t.minutes, content: t.content });
        S.put('tasks', t.id, { ...t, carried: true });
      });
      const plan = E.plan(L.dayContext(key), L.subjectStates(key), carry,
        keepDone.reduce((s, t) => s + t.minutes, 0), E.loadFactor(L.recentResults(key)));
      plan.tasks.forEach((t, i) => S.put('tasks', L.taskID(key, prefix, i), {
        date: key, subject: t.subject, minutes: t.minutes, content: t.content, reason: t.reason,
        done: false, carry: t.isCarryOver, pending: false, carried: false }));
      if (plan.leftover.length) {
        const days = [1, 2, 3, 4, 5, 6, 7].map(n => E.addDays(key, n));
        const caps = days.map(d => Math.floor(E.availableTime(L.dayContext(d)).study / 2));
        const r = E.redistribute(plan.leftover, caps);
        const pend = (date, id, item) => S.put('tasks', id, { date, subject: item.subject, minutes: item.minutes, content: item.content,
          reason: 'やり残し', done: false, carry: true, pending: true, carried: false });
        r.perDay.forEach((items, d) => items.forEach((item, i) => pend(days[d], L.taskID(days[d], `p${key}`, i), item)));
        r.unplaced.forEach((item, i) => pend(days[6], L.taskID(days[6], `u${key}`, i), item));
      }
      S.save();
    },

    /** 最近7日(今日は入れない)の「計画した分」と「終わった分」 */
    recentResults(key) {
      const start = E.addDays(key, -7);
      const byDay = {};
      S.all('tasks').filter(t => t.date >= start && t.date < key && !t.pending).forEach(t => {
        const d = byDay[t.date] = byDay[t.date] || { planned: 0, done: 0 };
        d.planned += t.minutes; if (t.done) d.done += t.minutes;
      });
      return Object.values(byDay);
    },

    /** 次のテスト */
    nextTest: (key) => S.all('events').filter(e => (e.kind === '定期テスト' || e.kind === '模試') && e.date >= key).sort((a, b) => a.date.localeCompare(b.date))[0] || null,

    // ---- 教材・○△×・ストリーク(StudyService.swift)----

    /** モードの判定に使う予定(定期テスト=考査、行事=軽め) */
    modeEvents: () => S.all('events').filter(e => e.kind !== '模試')
      .map(e => ({ start: e.date, end: e.date, isExam: e.kind === '定期テスト', isVacation: e.kind === '長期休み', subjects: e.kind === '定期テスト' ? (e.subjects || []) : [] })),

    /**
     * 同じ名前の教科・同じ曜日と時間目の時間割が2つ以上あれば、1つにまとめる(iPhone と別々に作ると両方残るため)
     * 残すのは並び順がいちばん前(同じならIDの小さいほう)。消したものは同期で iPhone からも消える
     */
    dedupe() {
      let changed = false;
      const byName = {};
      S.all('subjects').forEach(s => { (byName[s.name] = byName[s.name] || []).push(s); });
      Object.values(byName).filter(l => l.length > 1).forEach(l => {
        const keep = l.slice().sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : 1))[0];
        l.filter(s => s.id !== keep.id).forEach(s => { S.remove('subjects', s.id); changed = true; });
      });
      const bySlot = {};
      S.all('timetable').forEach(t => { const k = `${t.weekday}-${t.period}`; (bySlot[k] = bySlot[k] || []).push(t); });
      Object.values(bySlot).filter(l => l.length > 1).forEach(l => {
        const keep = l.slice().sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        l.filter(t => t.id !== keep.id).forEach(t => { S.remove('timetable', t.id); changed = true; });
      });
      L.subjects().forEach((s, i) => { if (s.order !== i) { S.put('subjects', s.id, { ...s, order: i, colorIndex: i }); changed = true; } });
      if (changed) S.save();
      return changed;
    },

    /** 教科ごとの苦手分野 */
    weakFields: () => E.weakFields(S.all('scores')),

    /** 教材をエンジンの形にする */
    materialPlans: () => L.materials().map(m => ({ id: m.id, subject: m.subject, total: m.total, done: m.done, deadline: m.deadline || null,
      route: m.route || [], role: m.role || 'メイン', isDaily: !!m.daily || m.role === '毎日' })),

    /** 今日の記録を作る(あれば、あとから増えた教材のノルマだけ足す)。ノルマは1日の最初に決めて変えない */
    ensureDayLog(key) {
      const events = L.modeEvents();
      let log = S.get('dayLogs', key);
      const isNew = !log;
      // 祝日を足したなどでモードが変わったら、モードだけ直す
      const modeNow = E.modeOn(key, events);
      const modeChanged = log && log.mode !== modeNow;
      if (modeChanged) log.mode = modeNow;
      if (!log) log = { id: key, date: key, mode: E.modeOn(key, events), entries: [], reviewQuota: E.todaysQueue(S.all('attempts'), key).length };
      // 前のしくみ(問題数のノルマ)で作った今日の記録は、作り直す(まだ何もしていなければ)
      const old = log.entries.some(e => !e.unit && !e.reason) && log.entries.every(e => !e.done);
      if (old) log.entries = [];
      // 単元の順に回すグループは、その日1冊だけ(1冊終えると次の教材が選ばれるが、同じ日には足さない)
      const known = new Set(log.entries.map(e => e.material));
      const mats = L.materials();
      mats.filter(m => m.groupMode === '単元順' && m.group && known.has(m.id))
        .forEach(m => mats.filter(x => x.group === m.group).forEach(x => known.add(x.id)));
      const added = L.schedule(key).filter(q => !known.has(q.id))
        .map(q => ({ material: q.id, quota: 1, done: 0, from: q.unitIndex ?? 1, amount: q.amount, unit: q.unit, reason: q.reason }));
      if (added.length || isNew || old || modeChanged) {
        log.entries = log.entries.concat(added);
        S.put('dayLogs', key, log);
        S.save();
      }
      return S.get('dayLogs', key);
    },

    /** 教材ごとの、最後にやった日(1日の記録のチェックから) */
    lastDoneDates() {
      const r = {};
      S.all('dayLogs').forEach(log => log.entries.forEach(e => { if (e.done > 0 && (!r[e.material] || r[e.material] < log.date)) r[e.material] = log.date; }));
      return r;
    },

    /** その日のノルマ(Scheduler と同じ決まり。まだ保存しない) */
    schedule(key) {
      const last = L.lastDoneDates();
      const items = L.materials().map(m => ({ id: m.id, subject: m.subject, name: m.name, role: m.role || 'メイン',
        everyDays: m.every ?? 0, group: m.group || '', amount: m.amount || 0, unit: m.unit || 'ページ',
        activeFrom: m.activeFrom || null, activeUntil: m.activeUntil || null, order: (m.routeOrder || 0) * 1000 + (m.order || 0),
        lastDone: last[m.id] || null, laps: m.laps || [],
        pipeline: m.groupMode === '単元順' && !!m.group, units: (m.route || []).map(r => r.title), unitsDone: m.done || 0,
        weekendOnly: !!m.weekendOnly }));
      const priority = {};
      L.subjectStates(key).forEach(s => { priority[s.name] = E.priority(s, false); });
      return E.schedule(items, key, L.modeEvents(), priority);
    },

    /** 今日の教材(選ばれた順) */
    todayMaterials(log) {
      const mats = Object.fromEntries(L.materials().map(m => [m.id, m]));
      return log.entries.filter(e => e.quota > 0 && mats[e.material]).map(e => ({ m: mats[e.material], e }));
    },

    /** 自分で書いたノルマ(教材IDが「custom-」で始まる。外したものは出さない) */
    customEntries: (log) => log.entries.filter(e => e.material.startsWith('custom-') && e.quota > 0),

    /** 教材を今日のノルマに足す(外していたものなら戻す) */
    addToday(materialID, key) {
      const log = L.ensureDayLog(key), m = S.get('materials', materialID);
      const e = log.entries.find(x => x.material === materialID);
      if (e) e.quota = 1;
      else log.entries.push({ material: materialID, quota: 1, done: 0, from: m ? (m.done || 0) : 0, amount: m ? (m.amount || 0) : 0, unit: m ? (m.unit || '') : '', reason: '自分で追加' });
      S.put('dayLogs', key, log); S.save();
    },

    /** 自分で書いたノルマを足す(例:「スタサプ 力学」2講) */
    addCustom(title, amount, unit, key) {
      const log = L.ensureDayLog(key);
      log.entries.push({ material: 'custom-' + S.newID(), quota: 1, done: 0, from: 0, amount: Math.max(0, amount || 0), unit, reason: '自分で追加', title });
      S.put('dayLogs', key, log); S.save();
    },

    /** 今日のノルマから外す(選び直しで戻ってこないように、数を0にして残す) */
    removeFromToday(id, key) {
      const log = L.ensureDayLog(key);
      const e = log.entries.find(x => x.material === id);
      if (!e) return;
      e.quota = 0; e.done = 0;
      S.put('dayLogs', key, log); S.save();
    },

    /** 今日のその教材を「やった」にする/戻す */
    toggleDone(materialID, key) {
      const log = L.ensureDayLog(key);
      const e = log.entries.find(x => x.material === materialID);
      if (!e) return;
      e.done = e.done > 0 ? 0 : e.quota;
      // 単元の順に回す教材なら、終わった単元の数も進める/戻す
      if (e.unit === '単元') {
        const m = S.get('materials', materialID);
        if (m) {
          if (e.done > 0) m.done = Math.max(m.done || 0, e.from + 1); else if ((m.done || 0) === e.from + 1) m.done = e.from;
          S.put('materials', m.id, m);
        }
      }
      S.put('dayLogs', key, log);
      S.save();
    },

    /** 今日の解き直しキュー(まだのもの・苦手分野を先に) */
    todayReviews(key) {
      const attempts = S.all('attempts');
      const todays = new Set(attempts.filter(a => a.date === key).map(a => `${a.material}#${a.no}`));
      const mats = Object.fromEntries(L.materials().map(m => [m.id, m]));
      const weak = L.weakFields();
      return E.todaysQueue(attempts, key).filter(r => mats[r.material]).map(r => {
        const m = mats[r.material];
        const step = E.stepFor(r.no, m.route);
        const field = step ? step.field : null;
        return { r, m, field, weak: !!(field && weak[m.subject] && weak[m.subject].has(field)), done: todays.has(`${r.material}#${r.no}`) };
      }).sort((a, b) => (a.done - b.done) || ((a.weak ? 0 : 1) - (b.weak ? 0 : 1)));
    },

    /** ○△×を記録する(初めて解いた問題なら、教材の完了数と今日のやった数を+1) */
    record(mark, materialID, no, key) {
      const first = !S.all('attempts').some(a => a.material === materialID && a.no === no);
      S.put('attempts', S.newID(), { material: materialID, no, date: key, mark, at: Date.now() });
      if (first) L.addProgress(1, materialID, key);
      S.save();
    },

    /** 今日のその問題の記録を取り消す */
    undo(materialID, no, key) {
      const all = S.all('attempts').filter(a => a.material === materialID && a.no === no);
      const last = all.filter(a => a.date === key).sort((a, b) => b.at - a.at)[0];
      if (!last) return;
      S.remove('attempts', last.id);
      if (all.length === 1) L.addProgress(-1, materialID, key);
      S.save();
    },

    /** ○△×を付けずに進んだ数を足す(マイナスで戻す) */
    addProgress(count, materialID, key) {
      const m = S.get('materials', materialID);
      if (!m) return;
      // 総問題数が未定(0)の教材は、上限なしで数える
      const next = Math.max(0, m.done + count);
      S.put('materials', m.id, { ...m, done: m.total > 0 ? Math.min(m.total, next) : next });
      const log = L.ensureDayLog(key);
      const entry = log.entries.find(e => e.material === materialID);
      if (entry) { entry.done = Math.max(0, entry.done + count); S.put('dayLogs', key, log); }
      S.save();
    },

    /** その問題の今日の記録 */
    todaysMark(materialID, no, key) {
      const list = S.all('attempts').filter(a => a.material === materialID && a.no === no && a.date === key).sort((a, b) => b.at - a.at);
      return list[0] ? list[0].mark : null;
    },

    /** 1日の記録 → ストリーク用(ノルマ = 教材の合計 + 解き直し、やった数 = 教材の合計 + 解き直した数) */
    streakDays() {
      const attempts = S.all('attempts');
      return S.all('dayLogs').map(log => ({
        date: log.date,
        quota: log.entries.reduce((s, e) => s + e.quota, 0) + (log.reviewQuota || 0),
        done: log.entries.reduce((s, e) => s + e.done, 0) + Math.min(log.reviewQuota || 0, E.reviewDoneToday(attempts, log.date)),
      }));
    },

    /** 全体のストリーク */
    streak: (key) => E.streak(L.streakDays(), key),

    /** 教材ごとのストリーク(全体でチケットを使った日は途切れない) */
    materialStreak(materialID, overall, key) {
      const days = S.all('dayLogs').map(log => {
        const e = log.entries.find(x => x.material === materialID);
        return e ? { date: log.date, quota: e.quota, done: e.done } : null;
      }).filter(Boolean);
      const prot = new Set(Object.keys(overall.status).filter(d => overall.status[d] === 'ticket'));
      return E.streak(days, key, false, prot);
    },

    // ---- まとめた JSON の読み込み(iOS版の MaterialImporter.swift と同じ)----

    /**
     * 教材・予定・プロフィールを読み込む。教材のIDは「json-<id>」なので、何回読んでも二重にならず更新される
     * 総問題数・完了数は JSON に書いてあるときだけ上書き(入れた数を消さない)
     */
    importJSON(json) {
      if (!json || !Array.isArray(json.materials)) throw new Error('materials の一覧がありません');
      const sum = { added: 0, updated: 0, events: 0, subjects: 0 };
      json.materials.forEach(item => {
        if (item.subject && item.subject !== '全教科' && !L.subjects().some(s => s.name === item.subject)) {
          const n = L.subjects().length;
          S.put('subjects', S.newID(), { name: item.subject, colorIndex: n, order: n });
          sum.subjects++;
        }
      });
      let nextOrder = L.materials().reduce((m, x) => Math.max(m, x.order || 0), -1) + 1;
      json.materials.forEach(item => {
        if (!item.id || !item.name || !item.subject) return;
        const id = `json-${item.id}`;
        const old = S.get('materials', id);
        const role = ['メイン', '毎日', '考査用', '補助', '後回し'].includes(item.role) ? item.role : 'メイン';
        const kind = ['問題集', '参考書', '単語帳', '過去問', '教科書・副教材', 'ルーティーン', '映像授業'].includes(item.type) ? item.type : '問題集';
        const total = Number.isInteger(item.total ?? item.totalProblems) ? Math.max(0, item.total ?? item.totalProblems) : (old ? old.total : 0);
        const done = Number.isInteger(item.done) ? Math.max(0, item.done) : (old ? old.done : 0);
        S.put('materials', id, {
          ...(old || { route: [], deadline: null, order: nextOrder++ }),
          subject: item.subject, name: item.name, role, kind, period: item.period || '', note: item.note || '',
          routeOrder: Number.isInteger(item.route) ? item.route : null, total, done,
          daily: (old && old.daily) || role === '毎日',
        });
        // 1日の量・出す日・交互のグループ・期間(書いてあるときだけ)
        const m = S.get('materials', id);
        if (Number.isInteger(item.amount)) m.amount = Math.max(0, item.amount);
        if (typeof item.unit === 'string') m.unit = item.unit;
        if (Number.isInteger(item.every)) { m.every = Math.max(0, item.every); m.daily = item.every === 1; }
        if ('every' in item || 'group' in item) m.group = item.group || '';
        if ('every' in item || 'groupMode' in item) m.groupMode = item.groupMode || '';
        if ('every' in item || 'weekendOnly' in item) m.weekendOnly = !!item.weekendOnly;
        if (Array.isArray(item.units)) m.route = item.units.map((t, i) => ({ title: t, from: i + 1, to: i + 1, field: '' }));
        if ('every' in item || 'from' in item) m.activeFrom = item.from || null;
        if ('every' in item || 'until' in item) m.activeUntil = item.until || null;
        // 周回の予定(書いてあれば置きかえる。同じ周をもう終えていたら、終えた日は残す)
        if (Array.isArray(item.laps)) {
          const done = Object.fromEntries((m.laps || []).filter(l => l.done).map(l => [l.lap, l.done]));
          m.laps = item.laps.filter(l => l.start && l.end).map(l => ({ lap: l.lap, start: l.start, end: l.end, scope: l.scope || '', done: done[l.lap] || null }));
        }
        S.put('materials', id, m);
        if (old) sum.updated++; else sum.added++;
      });
      (json.removeEvents || []).forEach(id => S.remove('events', id));
      // 日付が決まっている予定(dates の日ごとに1件)
      (json.events || []).filter(item => item.id && Array.isArray(item.dates)).forEach(item => {
        item.dates.forEach(date => {
          const id = `json-${item.id}-${date}`;
          if (S.get('events', id)) return;
          S.put('events', id, { title: item.name, kind: item.kind || L.eventKind(item.name) || '行事', date, hasTime: false,
            start: 540, end: 900, subjects: [], periodFrom: null, periodTo: null });
          sum.events++;
        });
      });
      (json.events || []).filter(item => !item.dates).forEach(item => {
        const kind = L.eventKind(item.name || ''), when = L.parseWhen(item.when || '');
        if (!item.name || !kind || !when) return;
        const id = `json-ev-${item.name}-${item.when}`.replace(/\//g, '-');
        if (S.get('events', id)) return;
        S.put('events', id, { title: when.tentative ? `${item.name}(日付は仮)` : item.name, kind, date: when.date, hasTime: false,
          start: 540, end: 900, subjects: item.name.includes('英検') ? ['英語'] : [], periodFrom: null, periodTo: null });
        sum.events++;
      });
      if (json.profile) {
        const p = json.profile, lines = [];
        if (p.grade) lines.push(`学年:${p.grade}`);
        if (p.strong && p.strong.length) lines.push(`得意:${p.strong.join('、')}`);
        if (p.weak && p.weak.length) lines.push(`苦手:${p.weak.join('、')}`);
        if (p.english) lines.push(`英語:${p.english}`);
        S.put('settings', 'main', { ...L.settings(), profile: lines.join('\n') });
      }
      S.save();
      L.ensureDayLog(L.today());
      return `教材 ${sum.added}件追加・${sum.updated}件更新、予定 ${sum.events}件、教科 ${sum.subjects}件`;
    },

    /** 予定の種類:考査 → 定期テスト、模試・試験 → 模試、申込・締切 → 入れない、それ以外 → 行事 */
    eventKind(name) {
      if (/締切|申込/.test(name)) return null;
      if (/考査|定期テスト/.test(name)) return '定期テスト';
      if (/模試|試験|検定/.test(name)) return '模試';
      return '行事';
    },

    /** 日付:「2027-01-24」はその日、「2026年11月上旬/中旬/下旬/末」は5/15/25/28日(仮)、「2027年2月」は15日(仮) */
    parseWhen(text) {
      let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      const key = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (m) return { date: key(m[1], m[2], m[3]), tentative: false };
      m = text.match(/(\d{4})年(\d{1,2})月/);
      if (!m) return null;
      const day = /上旬/.test(text) ? 5 : /中旬/.test(text) ? 15 : /下旬/.test(text) ? 25 : /末/.test(text) ? 28 : 15;
      return { date: key(m[1], m[2], day), tentative: true };
    },
  };
  root.Logic = L;
})(window);
