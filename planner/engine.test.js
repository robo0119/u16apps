// 計画エンジン(engine.js)のテスト。iOS版の StudyRulesTests.swift と同じ例で、同じ答えになるか確かめる
// 実行:node web/planner/engine.test.js
'use strict';
const E = require('./engine.js');
let failed = 0, passed = 0;
/** 1つのテスト */
function test(name, fn) {
  try { fn(); passed++; console.log('✔', name); } catch (e) { failed++; console.log('✘', name, '\n   ', e.message); }
}
/** 等しいか確かめる */
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} 期待 ${b} / 実際 ${a}`);
}
const d = (m, day) => `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// ---- モード ----
const exam = { start: d(11, 20), end: d(11, 22), isExam: true, subjects: ['数学', '英語'] };
const festival = { start: d(11, 10), end: d(11, 11), isExam: false, subjects: [] };
test('考査の14日前から最終日までが考査モード', () => {
  eq(E.modeOn(d(11, 5), [exam]), '通常'); eq(E.modeOn(d(11, 6), [exam]), '考査');
  eq(E.modeOn(d(11, 22), [exam]), '考査'); eq(E.modeOn(d(11, 23), [exam]), '通常');
});
test('行事の日は軽め。考査期間と重なっても軽めが優先', () => {
  eq(E.modeOn(d(11, 10), [exam, festival]), '軽め'); eq(E.modeOn(d(11, 12), [exam, festival]), '考査');
});
test('考査モードでは、考査に出る教科の重みが上がる', () => {
  eq(E.weight('数学', d(11, 15), [exam]), 1.5); eq(E.weight('国語', d(11, 15), [exam]), 0.5); eq(E.weight('国語', d(11, 1), [exam]), 1);
});

// ---- ノルマ ----
test('通常の日だけなら、残り ÷ 日数(切り上げ)', () => {
  eq(E.quota(30, d(11, 1), d(11, 10), () => 1), 3); eq(E.quota(31, d(11, 1), d(11, 10), () => 1), 4);
});
test('軽めの日はノルマが減る', () => {
  const fest = { start: d(11, 1), end: d(11, 1), isExam: false, subjects: [] };
  const m = { id: 'a', subject: '数学', total: 30, done: 0, deadline: d(11, 10), route: [] };
  eq(E.planQuota([m], d(11, 1), [], {})[0].quota, 3); eq(E.planQuota([m], d(11, 1), [fest], {})[0].quota, 2);
});
test('締め切りがなければ、次の考査の前日まで', () => {
  const ex = { start: d(11, 20), end: d(11, 22), isExam: true, subjects: ['数学'] };
  eq(E.deadline({ subject: '数学', deadline: null }, d(11, 1), [ex]), d(11, 19));
  eq(E.deadline({ subject: '国語', deadline: null }, d(11, 1), [ex]), d(11, 30));
});
test('考査が近い教科は、考査に出ない教科よりノルマが多い', () => {
  const ex = { start: d(11, 20), end: d(11, 20), isExam: true, subjects: ['数学'] };
  const math = { id: 'm', subject: '数学', total: 60, done: 0, deadline: d(11, 30), route: [] };
  const jp = { id: 'j', subject: '国語', total: 60, done: 0, deadline: d(11, 30), route: [] };
  const plan = E.planQuota([jp, math], d(11, 10), [ex], {});
  eq(plan[0].materialID, 'm'); eq(plan.map(p => p.quota), [4, 2]);
});
test('苦手分野の問題が、いちばん上に出る', () => {
  const route = [{ title: '1章', from: 1, to: 20, field: '関数' }, { title: '2章', from: 21, to: 40, field: '確率' }];
  const a = { id: 'a', subject: '数学', total: 40, done: 20, deadline: d(11, 10), route };
  const b = { id: 'b', subject: '英語', total: 100, done: 0, deadline: d(11, 10), route: [] };
  const plan = E.planQuota([b, a], d(11, 1), [], { '数学': new Set(['確率']) });
  eq([plan[0].materialID, plan[0].field, plan[0].from], ['a', '確率', 21]);
});

test('後回し・補助はノルマに出ない。考査用は考査モードの日だけ、考査に出る教科で出る', () => {
  const ex = { start: d(11, 20), end: d(11, 20), isExam: true, subjects: ['数学'] };
  const m = (id, subject, role) => ({ id, subject, total: 30, done: 0, deadline: d(11, 30), route: [], role });
  const list = [m('main', '国語', 'メイン'), m('later', '国語', '後回し'), m('help', '数学', '補助'), m('examM', '数学', '考査用'), m('examJ', '国語', '考査用')];
  eq(E.planQuota(list, d(11, 1), [ex], {}).map(q => q.materialID), ['main']);
  eq(E.planQuota(list, d(11, 10), [ex], {}).map(q => q.materialID).sort(), ['examM', 'main']);
});
test('総問題数が未定の教材は、毎日やるものだけ「1日1回」', () => {
  const plan = E.planQuota([{ id: 'd', subject: '英語', total: 0, done: 3, route: [], role: '毎日', isDaily: true },
    { id: 'm', subject: '英語', total: 0, done: 0, route: [], role: 'メイン' }], d(11, 1), [], {});
  eq(plan.map(q => [q.materialID, q.quota]), [['d', 1]]);
});

// ---- 解き直し ----
const at = (no, date, mark, t = 0) => ({ material: 'a', no, date, mark, at: t });
test('×は翌日、△は3日後に出る。○は出ない', () => {
  const list = [at(1, d(11, 1), '×'), at(2, d(11, 1), '△'), at(3, d(11, 1), '○')];
  eq(E.reviewDue(list, d(11, 1)).length, 0);
  eq(E.reviewDue(list, d(11, 2)).map(r => r.no), [1]); eq(E.reviewDue(list, d(11, 4)).map(r => r.no), [1, 2]);
});
test('解き直して○になったら消え、また×なら次の日に出る', () => {
  const list = [at(1, d(11, 1), '×'), at(1, d(11, 2), '○'), at(2, d(11, 1), '×'), at(2, d(11, 2), '×')];
  eq(E.reviewDue(list, d(11, 3)).map(r => r.no), [2]);
});
test('今日のキューの数は、今日解き直しても変わらず、解いた数が増える', () => {
  const after = [at(1, d(11, 1), '×'), at(2, d(11, 1), '×'), at(1, d(11, 2), '○')];
  eq(E.todaysQueue(after, d(11, 2)).length, 2); eq(E.reviewDoneToday(after, d(11, 2)), 1);
});

// ---- 苦手分野 ----
test('60%未満、または教科の平均より10点以上低い分野が苦手', () => {
  eq(E.weakIn([{ name: '関数', score: 45, max: 50 }, { name: '図形', score: 33, max: 50 }, { name: '確率', score: 36, max: 50 }]).map(f => f.name), ['図形']);
  eq(E.weakIn([{ name: '長文', score: 5, max: 10 }]).map(f => f.name), ['長文']);
});
test('教科ごとに、いちばん新しい結果を使う', () => {
  const r = E.weakFields([{ date: d(10, 1), subject: '数学', fields: [{ name: '確率', score: 1, max: 10 }] },
    { date: d(9, 1), subject: '数学', fields: [{ name: '関数', score: 1, max: 10 }] }]);
  eq([...r['数学']], ['確率']);
});

// ---- ストリーク ----
const days = (n, missed = []) => Array.from({ length: n }, (_, i) => ({ date: E.addDays(d(11, 1), i), quota: 10, done: missed.includes(i) ? 0 : 8 }));
test('ノルマの80%以上で達成', () => {
  eq([E.isAchieved(10, 8), E.isAchieved(10, 7), E.isAchieved(4, 4), E.isAchieved(0, 3)], [true, false, true, false]);
});
test('連続日数と最長記録', () => {
  const r = E.streak(days(6, [3]), d(11, 6)); eq([r.longest, r.current, r.status[d(11, 4)]], [3, 2, 'missed']);
});
test('7日連続でチケット1枚。チケットがあれば途切れない', () => {
  const r = E.streak(days(9, [7]), d(11, 9)); eq([r.status[d(11, 8)], r.current, r.tickets], ['ticket', 8, 0]);
});
test('チケットは最大2枚', () => { const r = E.streak(days(28), d(11, 28)); eq([r.current, r.tickets], [28, 2]); });
test('今日まだ達成していなくても、途切れない', () => {
  const list = days(3); list[2].done = 0; const r = E.streak(list, d(11, 3)); eq([r.status[d(11, 3)], r.current], ['inProgress', 2]);
});
test('記録のない日はできなかった日。ノルマ0の日は数えない', () => {
  const r = E.streak([{ date: d(11, 1), quota: 5, done: 5 }, { date: d(11, 2), quota: 0, done: 0 }, { date: d(11, 4), quota: 5, done: 5 }], d(11, 4));
  eq([r.status[d(11, 2)], r.status[d(11, 3)], r.current], ['skipped', 'missed', 1]);
});

// ---- 時間の計画(PlanEngineTests.swift と同じ例)----
const hm = (h, m = 0) => h * 60 + m;
const schoolDay = (events = []) => ({ wake: hm(6, 30), sleep: hm(23), school: { start: hm(7, 50), end: hm(16, 10) }, events, livingMinutes: 150 });
test('使える時間の式:起きている − 学校 − 予定 − 生活 − 休憩', () => {
  const b = E.availableTime(schoolDay([{ start: hm(18), end: hm(20) }]));
  eq([b.awake, b.school, b.events, b.living], [990, 500, 120, 150]); eq(b.awake - b.school - b.events - b.living - b.breaks, b.study);
});
test('部活の日は勉強時間が短くなる', () => {
  const n = E.availableTime(schoolDay()), c = E.availableTime(schoolDay([{ start: hm(16, 10), end: hm(18, 30) }]));
  if (!(c.study < n.study)) throw new Error('短くならない'); eq(c.events, 140);
});
test('時間は優先度に比例して配られ、合計は使える時間をこえない', () => {
  const m = E.allocate(120, [2, 1, 1]); eq(m.reduce((s, x) => s + x, 0) <= 120, true); eq(m[0] >= m[1], true);
});
test('時程:5時間目 = 8:40 + 4×60 + 35 = 13:15', () => { eq(E.periodClock({}).start(5), hm(13, 15)); });

// ---- 毎日のノルマを自動で選ぶ(SchedulerTests.swift と同じ例)----
const it = (id, subject, every, o = {}) => ({ id, subject, name: id, role: o.role || 'メイン', everyDays: every, group: o.group || '', amount: 10, unit: 'ページ',
  activeFrom: o.from || null, activeUntil: o.until || null, order: o.order || 0, lastDone: o.last || null });
const weekdays = (from, to) => { const out = []; for (let k = from; k <= to; k++) { const w = E.weekdayOf(d(11, k)); if (w !== 1 && w !== 7) out.push(d(11, k)); } return out; };
test('毎日の教材は毎日、2日に1回の2つは日を分けて交互に出る', () => {
  const items = [it('daily', '英語', 1), it('a', '英語', 2, { order: 1 }), it('b', '英語', 2, { order: 2 })];
  weekdays(2, 6).forEach(day => { const ids = E.schedule(items, day, []).map(q => q.id); eq(ids.includes('daily'), true); eq(ids.includes('a') !== ids.includes('b'), true); });
});
test('グループは1つの枠を交互に使う', () => {
  const items = [it('polaris', '英語', 2, { group: '①', order: 1 }), it('ultimate', '英語', 2, { group: '①', order: 2 })];
  const seen = weekdays(2, 13).flatMap(day => E.schedule(items, day, []).map(q => q.id));
  eq(seen.includes('polaris') && seen.includes('ultimate'), true);
  eq(seen.every((x, i) => i === 0 || x !== seen[i - 1]), true);
});
test('期間が終わった教材と、後回しは出ない', () => {
  const items = [it('focus', '数学', 1, { until: d(11, 26) }), it('later', '英語', 1, { role: '後回し' })];
  eq(E.schedule(items, d(11, 26), []).map(q => q.id), ['focus']); eq(E.schedule(items, d(11, 27), []).length, 0);
});
test('「その他」は、前回からの日数が長いものを選ぶ', () => {
  const items = [it('recent', '英語', 0, { last: d(11, 1) }), it('old', '英語', 0, { last: d(10, 1) })];
  eq(weekdays(2, 6).flatMap(day => E.schedule(items, day, [])).map(q => q.id)[0], 'old');
});
test('土日は、毎日の教材に加えて数学3・英語2・物理1・化学1', () => {
  const items = [it('daily', '英語', 1)];
  for (let i = 0; i < 4; i++) items.push(it('m' + i, '数学', 2, { order: i }));
  for (let i = 0; i < 3; i++) items.push(it('e' + i, '英語', 3, { order: i }));
  items.push(it('p', '物理', 0), it('c', '化学', 0), it('j', '国語', 2));
  const ids = E.schedule(items, d(11, 7), []).map(q => q.id);
  eq([ids.includes('daily'), ids.filter(x => x[0] === 'm').length, ids.filter(x => x[0] === 'e').length, ids.includes('p'), ids.includes('c'), ids.includes('j')], [true, 3, 2, true, true, false]);
});
test('行事の日は量が半分', () => {
  eq(E.schedule([it('daily', '英語', 1)], d(11, 4), [{ start: d(11, 4), end: d(11, 4), isExam: false, subjects: [] }])[0].amount, 5);
});
test('日の番号は Swift と同じ(2000-01-01 から)', () => { eq(E.dayIndex('2000-01-02'), 1); eq(E.dayIndex('2026-11-02'), 9802); });

console.log(`\n${passed}件成功、${failed}件失敗`);
process.exit(failed ? 1 : 0);
