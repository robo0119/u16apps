// 保存してあるデータを計画エンジンに渡す係(iOS版の PlannerService.swift / StudyService.swift と同じ手順)
(function (root) {
  'use strict';
  const E = root.Engine, S = root.Store;

  /** 生活時間などの設定(なければ iOS版と同じ初期値) */
  const DEFAULT_SETTINGS = { wake: 390, sleep: 1380, schoolStart: 500, schoolEnd: 950, commute: 20, living: 150,
    firstPeriodStart: 520, periodLength: 50, periodBreak: 10, lunchAfter: 4, lunchLength: 45, afterLast: 15 };

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
      const tests = S.all('events').filter(e => e.kind !== '行事' && e.date >= key).sort((a, b) => a.date.localeCompare(b.date));
      return L.subjects().map(sub => {
        const points = scores.filter(s => s.subject === sub.name).map(s => ({ date: s.date, score: s.score, max: s.max, deviation: s.deviation }));
        const next = tests.find(t => !t.subjects.length || t.subjects.includes(sub.name));
        return { name: sub.name, weakness: E.weakness(points), daysToTest: next ? E.daysBetween(key, next.date) : null, testName: next ? next.title : null };
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
    nextTest: (key) => S.all('events').filter(e => e.kind !== '行事' && e.date >= key).sort((a, b) => a.date.localeCompare(b.date))[0] || null,

    // ---- 教材・○△×・ストリーク(StudyService.swift)----

    /** モードの判定に使う予定(定期テスト=考査、行事=軽め) */
    modeEvents: () => S.all('events').filter(e => e.kind !== '模試')
      .map(e => ({ start: e.date, end: e.date, isExam: e.kind === '定期テスト', subjects: e.kind === '定期テスト' ? (e.subjects || []) : [] })),

    /** 教科ごとの苦手分野 */
    weakFields: () => E.weakFields(S.all('scores')),

    /** 教材をエンジンの形にする */
    materialPlans: () => L.materials().map(m => ({ id: m.id, subject: m.subject, total: m.total, done: m.done, deadline: m.deadline || null, route: m.route || [] })),

    /** 今日の記録を作る(あれば、あとから増えた教材のノルマだけ足す)。ノルマは1日の最初に決めて変えない */
    ensureDayLog(key) {
      const events = L.modeEvents();
      const plan = E.planQuota(L.materialPlans(), key, events, L.weakFields());
      let log = S.get('dayLogs', key);
      if (!log) log = { id: key, date: key, mode: E.modeOn(key, events), entries: [], reviewQuota: E.todaysQueue(S.all('attempts'), key).length };
      const known = new Set(log.entries.map(e => e.material));
      const added = plan.filter(q => !known.has(q.materialID)).map(q => ({ material: q.materialID, quota: q.quota, done: 0, from: q.from }));
      if (added.length || !S.get('dayLogs', key)) {
        log.entries = log.entries.concat(added);
        S.put('dayLogs', key, log);
        S.save();
      }
      return S.get('dayLogs', key);
    },

    /** 今日の教材(苦手分野 → 考査に出る教科 → ノルマの多い順) */
    todayMaterials(log) {
      const mats = Object.fromEntries(L.materials().map(m => [m.id, m]));
      const weak = L.weakFields();
      const exam = log.mode === '考査' ? E.examSubjects(log.date, L.modeEvents()) : new Set();
      const items = log.entries.filter(e => mats[e.material]).map(e => {
        const m = mats[e.material];
        const step = E.stepFor(e.from, m.route);
        const field = step ? step.field : null;
        return { m, e, field, weak: !!(field && weak[m.subject] && weak[m.subject].has(field)) };
      });
      const rank = (i) => i.weak ? 0 : (log.mode === '考査' && (exam === null || exam.has(i.m.subject)) ? 1 : 2);
      return items.sort((a, b) => rank(a) - rank(b) || b.e.quota - a.e.quota);
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
      S.put('materials', m.id, { ...m, done: Math.min(m.total, Math.max(0, m.done + count)) });
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
  };
  root.Logic = L;
})(window);
