// Recito Web版のライブラリ(英検・リスニング・模試の長文を保存し、iPhoneのRecitoと同期する)
// 項目名は iOS版(OndokuChecker/Sync/LibrarySync.swift)と同じ:title, category, text, createdAt, lastPracticed, bestAccuracy
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = Bridge.esc;
  const CATEGORIES = ['英検', 'リスニング', '模試の長文', '教科書', 'その他'];

  // ---- このページのデータ置き場(StudyPilot の store.js と同じ形。sync.js がこれを使う)----
  const KEY = 'ondoku.v2';
  const listeners = [];
  /** 保存してあるデータを読む */
  function load() {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { data = {}; }
    if (!data.passages) data.passages = {};
    return data;
  }
  const Store = {
    COLLECTIONS: ['passages'],
    SYNC_KEY: 'ondoku.sync',
    data: load(),
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 容量など */ } listeners.forEach(fn => fn()); },
    all(c) { return Object.entries(this.data[c]).map(([id, f]) => ({ id, ...f })); },
    get(c, id) { const f = this.data[c][id]; return f ? { id, ...f } : null; },
    put(c, id, fields) { const copy = { ...fields }; delete copy.id; this.data[c][id] = copy; return id; },
    remove(c, id) { delete this.data[c][id]; },
    newID() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase(); },
  };

  // ---- このブラウザのライブラリが、だれのものか ----
  // 別の人がログインしたとき、前の人の文章がその人のアカウントに送られないようにする
  const OWNER_KEY = 'ondoku.owner';
  /** ログインした人(uid)のライブラリにする:前に別の人のものだったら、このブラウザの文章を空にしてから同期する */
  function claim(uid) {
    let owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch (e) { /* なし */ }
    if (owner && owner !== uid) {
      Store.data.passages = {};
      try { localStorage.removeItem(Store.SYNC_KEY); } catch (e) { /* なし */ }
      Store.save();
    }
    try { localStorage.setItem(OWNER_KEY, uid); } catch (e) { /* なし */ }
  }
  /** メールアドレスの形か(@ の前後に文字があり、後ろに . がある) */
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  // ---- 段落の分け方(iOS版の PassageSplitter と同じ)----

  const wordCount = (t) => t.split(/[\s—–-]+/).filter(w => /[A-Za-z0-9]/.test(w)).length;
  /** 空行で分ける(なければ改行で)。90語より長い段落は、文の切れ目で90語以内に分ける */
  function paragraphs(text) {
    const norm = text.replace(/\r\n/g, '\n');
    let blocks = norm.split('\n\n');
    if (blocks.length === 1) blocks = norm.split('\n');
    return blocks.map(b => b.replace(/\n/g, ' ').trim()).filter(Boolean).flatMap(p => {
      if (wordCount(p) <= 90) return [p];
      const out = []; let cur = '';
      (p.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [p]).map(s => s.trim()).forEach(s => {
        const joined = cur ? cur + ' ' + s : s;
        if (cur && wordCount(joined) > 90) { out.push(cur); cur = s; } else cur = joined;
      });
      if (cur) out.push(cur);
      return out;
    });
  }

  // ---- 画面 ----

  const state = { editing: null, open: null, message: '', info: '', auth: 'login', busy: false };

  /** ライブラリの部分を描く */
  function render() {
    const user = Auth.user;
    const list = Store.all('passages').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let html = '<h2>ライブラリ</h2>';
    if (!Sync.configured()) html += '<p class="muted">同期の設定がありません</p>';
    else if (!user) {
      const signup = state.auth === 'signup';
      html += `<div class="auth-box">
        <div class="seg auth-seg"><button class="${signup ? '' : 'on'}" data-lib="mode" data-m="login">ログイン</button><button class="${signup ? 'on' : ''}" data-lib="mode" data-m="signup">新しく登録</button></div>
        <p class="muted" style="margin:6px 0 10px">${signup ? '文章はあなたのアカウントだけに保存されます' : 'iPhoneのRecitoと文章を同期できます'}</p>
        <form class="auth-form" data-form="auth">
          <input id="lib-email" type="email" placeholder="メールアドレス" autocomplete="username" inputmode="email" autocapitalize="off" required>
          <input id="lib-pass" type="password" placeholder="パスワード${signup ? '(6文字以上)' : ''}" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? 6 : 1}" required>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '…' : signup ? '登録してはじめる' : 'ログイン'}</button>
        </form>
        ${signup ? '' : '<button class="ghost" data-lib="reset" style="margin-top:4px">パスワードを忘れた</button>'}</div>`;
    } else {
      html += `<div class="account"><span class="avatar">${esc((user.email || '?')[0].toUpperCase())}</span>
        <div class="grow"><b>${esc(user.email)}</b><div class="muted">${Sync.isSyncing ? '同期中…' : Sync.lastError ? `<span class="bad">${esc(Sync.lastError)}</span>` : Sync.lastSync ? '同期済み' : 'ログイン中'}</div></div>
        <button class="secondary small" data-lib="sync">同期</button><button class="ghost small" data-lib="logout">ログアウト</button></div>`;
    }
    if (state.message) html += `<p class="bad">${esc(state.message)}</p>`;
    if (state.info) html += `<p class="good">${esc(state.info)}</p>`;
    if (state.editing) {
      const e = state.editing;
      html += `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
        <div class="row"><input id="lib-title" value="${esc(e.title)}" placeholder="題名(例:2024年度第2回 大問3)" style="flex:2;min-width:200px">
        <select id="lib-cat" style="flex:1;min-width:120px">${CATEGORIES.map(c => `<option ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <textarea id="lib-text" spellcheck="false" style="margin-top:8px;font-family:Georgia,serif;min-height:200px" placeholder="英文を貼り付け(空行で段落に分かれます)">${esc(e.text)}</textarea>
        <div class="row" style="margin-top:8px"><button data-lib="save">保存</button><button class="secondary" data-lib="cancel">やめる</button></div></div>`;
    } else {
      html += `<button data-lib="new">${Icon('plus')} 文章を追加</button>`;
    }
    CATEGORIES.forEach(cat => {
      const items = list.filter(p => (p.category || 'その他') === cat);
      if (!items.length) return;
      html += `<h3 style="margin:18px 0 6px">${esc(cat)}</h3>`;
      items.forEach(p => {
        const paras = paragraphs(p.text || '');
        html += `<div style="border-bottom:1px solid var(--line);padding:8px 0">
          <div class="row" style="justify-content:space-between"><div><b>${esc(p.title)}</b>
            <span class="muted">${wordCount(p.text || '')}語・${paras.length}段落${p.bestAccuracy != null ? `・最高 ${Math.round(p.bestAccuracy)}%` : ''}</span></div>
            <div class="row"><button class="secondary" data-lib="use" data-id="${p.id}" style="min-height:36px;padding:4px 12px">全文で練習</button>
            <button class="secondary" data-lib="shadow" data-id="${p.id}" style="min-height:36px;padding:4px 12px">全文をシャドーイング</button>
            <button class="secondary" data-lib="open" data-id="${p.id}" style="min-height:36px;padding:4px 12px">${state.open === p.id ? '閉じる' : '段落'}</button>
            <button class="secondary" data-lib="edit" data-id="${p.id}" style="min-height:36px;padding:4px 12px">編集</button>
            <button class="danger" data-lib="delete" data-id="${p.id}">消す</button></div></div>
          ${state.open === p.id ? paras.map((t, i) => `<p style="margin:8px 0"><button class="secondary" data-lib="para" data-id="${p.id}" data-i="${i}" style="min-height:32px;padding:2px 10px">段落${i + 1}で練習</button>
            <button class="secondary" data-lib="shadowpara" data-id="${p.id}" data-i="${i}" style="min-height:32px;padding:2px 10px">シャドーイング</button>
            <span class="muted">${esc(t.slice(0, 90))}${t.length > 90 ? '…' : ''}</span></p>`).join('') : ''}
        </div>`;
      });
    });
    $('library').innerHTML = html;
  }

  /** 練習タブの英文に入れる(mode:'read' か 'shadow'。シャドーイングは英文を見せずに始める) */
  function usePassage(text, mode) {
    window.OndokuWeb.usePassage(text, mode);
  }

  /** 練習の結果を残す(iOS版の record と同じ):その英文(全文か段落)を持つ文章の、最後に練習した日・最高の正確さ */
  function record(text, accuracy) {
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    const target = norm(text);
    const p = Store.all('passages').find(x => norm(x.text || '') === target || paragraphs(x.text || '').some(t => norm(t) === target));
    if (!p) return;
    Store.put('passages', p.id, { ...p, lastPracticed: Date.now(), bestAccuracy: Math.max(p.bestAccuracy ?? 0, accuracy) });
    commit();
  }

  /** 保存して同期する */
  async function commit() {
    Store.save();
    render();
    if (Auth.user) { await Sync.run(Store); render(); }
  }

  const ACTIONS = {
    /** ログインか登録をする(入力を確かめてから送る) */
    async login() {
      if (state.busy) return;
      const email = $('lib-email').value.trim(), pass = $('lib-pass').value;
      state.message = ''; state.info = '';
      if (!isEmail(email)) { state.message = 'メールアドレスの形が正しくありません'; render(); return; }
      if (state.auth === 'signup' && pass.length < 6) { state.message = 'パスワードは6文字以上にしてください'; render(); return; }
      if (!pass) { state.message = 'パスワードを入れてください'; render(); return; }
      state.busy = true; render();
      try {
        if (state.auth === 'signup') await Auth.signUp(email, pass); else await Auth.signIn(email, pass);
        claim(Auth.user.uid);
        await Sync.run(Store);
      } catch (e) { state.message = e.message; }
      state.busy = false;
      render();
    },
    mode(el) { state.auth = el.dataset.m; state.message = ''; state.info = ''; render(); },
    /** パスワードを決め直すメールを送る */
    async reset() {
      const email = ($('lib-email') && $('lib-email').value.trim()) || '';
      state.message = ''; state.info = '';
      if (!isEmail(email)) { state.message = '上にメールアドレスを入れてから押してください'; render(); return; }
      try { await Auth.resetPassword(email); state.info = 'パスワードを決め直すメールを送りました(届かなければ迷惑メールも見てください)'; }
      catch (e) { state.message = e.message; }
      render();
    },
    /** ログアウト:このブラウザから文章を消す(アカウントには残る) */
    logout() {
      if (!confirm('ログアウトしますか?(このブラウザの文章は消えます。アカウントには残っています)')) return;
      Auth.signOut();
      Store.data.passages = {};
      Store.save();
      try { localStorage.removeItem(OWNER_KEY); } catch (e) { /* なし */ }
      state.message = ''; state.info = 'ログアウトしました';
      render();
    },
    async sync() { if (Auth.user) claim(Auth.user.uid); render(); await Sync.run(Store); render(); },
    new() { state.editing = { id: null, title: '', category: '英検', text: '' }; render(); },
    edit(el) { state.editing = { ...Store.get('passages', el.dataset.id) }; render(); },
    cancel() { state.editing = null; render(); },
    save() {
      const text = $('lib-text').value.trim();
      if (!text) { alert('英文を入れてください'); return; }
      const e = state.editing;
      const id = e.id || Store.newID();
      const old = Store.get('passages', id);
      const title = $('lib-title').value.trim() || text.split(/\s+/).slice(0, 5).join(' ');
      Store.put('passages', id, { title, category: $('lib-cat').value, text,
        createdAt: old ? old.createdAt : Date.now(), lastPracticed: old ? old.lastPracticed ?? null : null, bestAccuracy: old ? old.bestAccuracy ?? null : null });
      state.editing = null;
      commit();
    },
    delete(el) { if (!confirm('この文章を消しますか?(iPhoneからも消えます)')) return; Store.remove('passages', el.dataset.id); commit(); },
    open(el) { state.open = state.open === el.dataset.id ? null : el.dataset.id; render(); },
    use(el) { usePassage(Store.get('passages', el.dataset.id).text, 'read'); },
    para(el) { usePassage(paragraphs(Store.get('passages', el.dataset.id).text)[Number(el.dataset.i)], 'read'); },
    shadow(el) { usePassage(Store.get('passages', el.dataset.id).text, 'shadow'); },
    shadowpara(el) { usePassage(paragraphs(Store.get('passages', el.dataset.id).text)[Number(el.dataset.i)], 'shadow'); },
  };

  // ログイン・登録のフォーム(Enter キーでも送れる)
  document.addEventListener('submit', (ev) => {
    if (!ev.target.closest('[data-form="auth"]')) return;
    ev.preventDefault();
    ACTIONS.login();
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-lib]');
    if (!el) return;
    ev.preventDefault();
    if (ACTIONS[el.dataset.lib]) ACTIONS[el.dataset.lib](el);
  });

  window.RecitoLibrary = { paragraphs, record };
  render();
  if (Auth.user) ACTIONS.sync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Auth.user && !state.editing) ACTIONS.sync(); });
})();
