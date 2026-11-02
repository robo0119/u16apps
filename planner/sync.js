// StudyPilot Web版の同期(Firebase Authentication と Firestore の REST API。SDK は使わない)
// iOS版(StudyPlanner/Sync/SyncEngine.swift)と同じ手順:
// 1. 受け取る:前回より後に変わった文書(_u > 前回)を受け取り、このブラウザに反映(同じ文書はサーバーを優先)
// 2. 送る:前回そろえたときから変わった文書を送る。消した文書は「削除」の印(_d)を送る
// _u はサーバーの時刻(REQUEST_TIME)
(function (root) {
  'use strict';
  const AUTH_KEY = 'planner.auth';
  const STATE_KEY = 'planner.sync';
  const cfg = () => root.FIREBASE_CONFIG || {};
  const configured = () => !!(cfg().apiKey && cfg().projectId);
  const docsPath = () => `projects/${cfg().projectId}/databases/(default)/documents`;

  // ---- 値の変換(JS ⇔ Firestore)----

  /** JS の値 → Firestore の値 */
  function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    return { mapValue: { fields: toFields(v) } };
  }
  /** オブジェクト → Firestore の fields */
  function toFields(obj) { const f = {}; Object.keys(obj).forEach(k => { f[k] = toValue(obj[k]); }); return f; }

  /** Firestore の値 → JS の値 */
  function fromValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
    return null;
  }
  /** Firestore の fields → オブジェクト */
  function fromFields(f) { const o = {}; Object.keys(f || {}).forEach(k => { o[k] = fromValue(f[k]); }); return o; }

  /** 中身の指紋(キーを並べた JSON。変わったかどうかを比べる) */
  function fingerprint(obj) {
    const norm = (v) => Array.isArray(v) ? v.map(norm)
      : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {}) : v;
    return JSON.stringify(norm(obj));
  }

  // ---- HTTP ----

  /** サーバーのエラーコードを日本語にする */
  function message(code) {
    if (/^EMAIL_EXISTS/.test(code)) return 'このメールアドレスはもう登録されています';
    if (/^(INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND)/.test(code)) return 'メールアドレスかパスワードが違います';
    if (/^WEAK_PASSWORD/.test(code)) return 'パスワードは6文字以上にしてください';
    if (/^INVALID_EMAIL/.test(code)) return 'メールアドレスの形が正しくありません';
    if (/^TOO_MANY_ATTEMPTS/.test(code)) return 'しばらく待ってからやり直してください';
    if (code === 'PERMISSION_DENIED' || /insufficient permissions/.test(code)) return 'このデータを読み書きする権限がありません(ルールを確かめてください)';
    return `通信できませんでした(${code})`;
  }

  /** JSON を送って受け取る */
  async function send(url, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (json && json.error) || (Array.isArray(json) && json[0] && json[0].error) || {};
      throw new Error(message(e.message || e.status || `HTTP_${res.status}`));
    }
    return json;
  }

  // ---- ログイン ----

  let idToken = null, expiresAt = 0;
  const Auth = {
    /** ログイン中のユーザー({uid, email, refreshToken})。なければ null */
    get user() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } },
    set user(u) { if (u) localStorage.setItem(AUTH_KEY, JSON.stringify(u)); else localStorage.removeItem(AUTH_KEY); },

    /** 新しく登録 */
    signUp(email, password) { return this._sign('accounts:signUp', email, password); },
    /** ログイン */
    signIn(email, password) { return this._sign('accounts:signInWithPassword', email, password); },
    /** ログアウト(このブラウザのログイン情報と同期の記録を消す。データは残す) */
    signOut() { this.user = null; idToken = null; localStorage.removeItem(STATE_KEY); },

    async _sign(endpoint, email, password) {
      if (!configured()) throw new Error('Firebaseの設定がまだです');
      const j = await send(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${cfg().apiKey}`, { email, password, returnSecureToken: true });
      this.user = { uid: j.localId, email: j.email || email, refreshToken: j.refreshToken };
      idToken = j.idToken;
      expiresAt = Date.now() + (Number(j.expiresIn || 3600) - 120) * 1000;
    },

    /** 使えるIDトークン(期限が近ければ取り直す) */
    async token() {
      const u = this.user;
      if (!u) throw new Error('ログインしてください');
      if (idToken && Date.now() < expiresAt) return { uid: u.uid, token: idToken };
      const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${cfg().apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(u.refreshToken)}`,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(message((j.error && j.error.message) || 'TOKEN'));
      idToken = j.id_token;
      expiresAt = Date.now() + (Number(j.expires_in || 3600) - 120) * 1000;
      if (j.refresh_token && j.refresh_token !== u.refreshToken) this.user = { ...u, refreshToken: j.refresh_token };
      return { uid: u.uid, token: idToken };
    },
  };

  // ---- 同期 ----

  /** 前回の同期の記録 */
  function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; } }

  let running = null;
  const Sync = {
    configured,
    lastSync: null,
    lastError: null,
    get isSyncing() { return !!running; },

    /** 同期する(ログインしていなければ何もしない)。同時に2回は動かさない */
    run(store) {
      if (!configured() || !Auth.user) return Promise.resolve();
      if (!running) running = this._run(store).finally(() => { running = null; });
      return running;
    },

    async _run(store) {
      try {
        const { uid, token } = await Auth.token();
        let state = loadState();
        if (!state || state.uid !== uid) state = { uid, lastPull: '1970-01-01T00:00:00Z', known: {} };
        await pull(store, uid, token, state);
        await push(store, uid, token, state);
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        store.save();
        this.lastSync = new Date();
        this.lastError = null;
      } catch (e) {
        this.lastError = e.message;
      }
    },
  };

  /** 前回より後に変わった文書を受け取る */
  async function pull(store, uid, token, state) {
    const url = `https://firestore.googleapis.com/v1/${docsPath()}/users/${uid}:runQuery`;
    let newest = state.lastPull, newestTime = Date.parse(state.lastPull);
    for (const c of store.COLLECTIONS) {
      const rows = await send(url, { structuredQuery: {
        from: [{ collectionId: c }],
        where: { fieldFilter: { field: { fieldPath: '_u' }, op: 'GREATER_THAN', value: { timestampValue: state.lastPull } } },
      } }, token);
      (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!row.document) return;
        const id = row.document.name.split('/').pop();
        const fields = fromFields(row.document.fields);
        const u = fields._u;
        if (u && Date.parse(u) > newestTime) { newestTime = Date.parse(u); newest = u; }
        const deleted = !!fields._d;
        delete fields._u; delete fields._d;
        state.known[c] = state.known[c] || {};
        if (deleted) { store.remove(c, id); delete state.known[c][id]; }
        else { store.put(c, id, fields); state.known[c][id] = fingerprint(fields); }
      });
    }
    state.lastPull = newest;
  }

  /** 変わった文書と、消した文書の印を送る */
  async function push(store, uid, token, state) {
    const writes = [], done = [];
    const write = (c, id, fields) => ({
      update: { name: `${docsPath()}/users/${uid}/${c}/${id}`, fields: toFields(fields) },
      updateTransforms: [{ fieldPath: '_u', setToServerValue: 'REQUEST_TIME' }],
    });
    store.COLLECTIONS.forEach(c => {
      const known = state.known[c] || {};
      const local = store.data[c];
      Object.keys(local).forEach(id => {
        const print = fingerprint(local[id]);
        if (known[id] === print) return;
        writes.push(write(c, id, { ...local[id], _d: false }));
        done.push([c, id, print]);
      });
      Object.keys(known).forEach(id => {
        if (local[id]) return;
        writes.push(write(c, id, { _d: true }));
        done.push([c, id, null]);
      });
    });
    const url = `https://firestore.googleapis.com/v1/${docsPath()}:commit`;
    for (let i = 0; i < writes.length; i += 400) await send(url, { writes: writes.slice(i, i + 400) }, token);
    done.forEach(([c, id, print]) => {
      state.known[c] = state.known[c] || {};
      if (print === null) delete state.known[c][id]; else state.known[c][id] = print;
    });
  }

  root.Auth = Auth;
  root.Sync = Sync;
})(window);
