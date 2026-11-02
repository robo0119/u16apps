// StudyPilot Web版のデータ置き場(このブラウザの localStorage)
// コレクション名・項目名は Firestore(とiOS版)と同じ:{ コレクション: { ID: 項目 } }
(function (root) {
  'use strict';
  const KEY = 'planner.v2';
  const COLLECTIONS = ['subjects', 'timetable', 'settings', 'weeklyEvents', 'events', 'scores', 'tasks', 'materials', 'attempts', 'dayLogs'];

  /** 保存してあるデータを読む(なければ空) */
  function load() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { data = {}; }
    COLLECTIONS.forEach(c => { if (!data[c]) data[c] = {}; });
    return data;
  }

  const listeners = [];
  const Store = {
    COLLECTIONS,
    data: load(),

    /** 保存して、画面に知らせる */
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 容量がいっぱいなど */ }
      listeners.forEach(fn => fn());
    },
    /** 変わったら呼ぶ関数を登録する */
    onChange(fn) { listeners.push(fn); },

    /** コレクションの一覧({id, ...項目}) */
    all(c) { return Object.entries(this.data[c]).map(([id, f]) => ({ id, ...f })); },
    /** 1件 */
    get(c, id) { const f = this.data[c][id]; return f ? { id, ...f } : null; },
    /** 書く(id がなければ作る)。保存はしない(まとめて save する) */
    put(c, id, fields) { const copy = { ...fields }; delete copy.id; this.data[c][id] = copy; return id; },
    /** 消す */
    remove(c, id) { delete this.data[c][id]; },
    /** 新しいID */
    newID() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase(); },
    /** 全部消す(ログアウトのときなどには使わない) */
    clear() { COLLECTIONS.forEach(c => { this.data[c] = {}; }); this.save(); },
  };
  root.Store = Store;
})(window);
