// 「本屋で680円」のような文から、金額・何に・項目を取り出す
// iPhoneアプリの ExpenseParser.swift と同じ手順
(function (global) {
  'use strict';

  const CATEGORIES = ['食べ物', '本', '文房具', '遊び', 'その他'];

  // 項目ごとのキーワード(文の中に入っていたら、その項目と推定する)
  const KEYWORDS = {
    '食べ物': ['食べ', '飲み', 'ご飯', 'ごはん', '弁当', 'おにぎり', 'パン', 'お菓子', 'おかし', '菓子', 'アイス',
      'ジュース', 'お茶', '水', 'コーヒー', 'カフェ', 'ラーメン', 'うどん', 'そば', 'ハンバーガー', 'マック',
      'マクド', 'ポテト', 'チョコ', 'ガム', 'グミ', 'ケーキ', 'ドーナツ', 'からあげ', '唐揚げ', 'コンビニ',
      'スーパー', '自販機', '自動販売機', 'ランチ', 'おやつ', '牛丼', 'ピザ', 'たこ焼き', 'クレープ', 'タピオカ',
      // お店の名前(Apple Pay などで払ったときに使われる名前)
      'セブン', 'ローソン', 'ファミマ', 'ファミリーマート', 'ミニストップ', 'マクドナルド', 'モス', 'スタバ',
      'スターバックス', 'ミスド', 'サイゼ', 'すき家', '吉野家', 'seven', 'lawson', 'familymart', 'mcdonald', 'starbucks'],
    '本': ['本', '本屋', '書店', '漫画', 'マンガ', 'まんが', 'コミック', '雑誌', '参考書', '問題集', '小説',
      '絵本', '辞書', '図鑑', 'ドリル', '単語帳', 'TSUTAYA', 'ツタヤ', '紀伊國屋', 'ブックオフ', 'BOOKOFF'],
    '文房具': ['文房具', '文具', 'ノート', 'ペン', 'ボールペン', '鉛筆', 'えんぴつ', 'シャーペン', 'シャープペン',
      'シャー芯', '芯', '消しゴム', 'けしごむ', '定規', 'ものさし', 'ファイル', '筆箱', 'ふでばこ',
      'マーカー', '蛍光ペン', '付箋', 'ふせん', 'のり', 'はさみ', 'ハサミ', 'コンパス', '修正テープ', 'ルーズリーフ'],
    '遊び': ['ゲーム', 'カラオケ', '映画', 'ボウリング', 'ボーリング', 'ガチャ', '遊園地', 'ゲーセン', 'ゲームセンター',
      'プリクラ', '課金', 'おもちゃ', 'トレカ', 'カード', '遊び', '水族館', '動物園', 'ライブ', 'チケット', 'スポッチャ',
      'ラウンドワン', 'App Store', 'Nintendo', '任天堂', 'PlayStation'],
  };

  // 全角の数字とカンマを半角にし、数字の間のカンマを消す(例:「１，２００」→「1200」)
  function normalizeDigits(text) {
    let s = text.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/，/g, ',');
    return s.replace(/([0-9]),([0-9]{3})/g, '$1$2');
  }

  // 漢数字を数にする:「千」「百」「十」の前の数字をかけて足していく(六百八十 = 6×100 + 8×10 = 680)
  function kanjiNumber(text) {
    const digits = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    const units = { '十': 10, '百': 100, '千': 1000 };
    let total = 0, section = 0, current = -1;
    for (const ch of text) {
      if (ch in digits) current = current < 0 ? digits[ch] : current * 10 + digits[ch];
      else if (ch in units) { section += (current < 0 ? 1 : current) * units[ch]; current = -1; }
      else if (ch === '万') { section += Math.max(current, 0); total += (section === 0 ? 1 : section) * 10000; section = 0; current = -1; }
      else return null;
    }
    const result = total + section + Math.max(current, 0);
    return result > 0 ? result : null;
  }

  // 「何に」の部分をきれいにする:動詞・時の言葉・前後の助詞を取りのぞく
  function cleanItem(text) {
    let s = text;
    const verbs = ['を買いました', 'で買いました', '買いました', 'を買った', 'で買った', '買った', 'かった',
      'を使いました', 'で使いました', '使いました', 'を使った', 'で使った', '使った',
      'を払いました', '払いました', 'を払った', '払った', 'でした', 'だった', 'です'];
    verbs.forEach(v => { s = s.split(v).join(' '); });
    ['今日', 'きょう', '昨日', 'きのう', 'さっき', '今', '全部で', '合計'].forEach(w => { s = s.split(w).join(' '); });
    s = s.replace(/[。、]/g, ' ');
    const particles = new Set(['で', 'を', 'に', 'は', 'の', 'が', 'と', 'も']);
    return s.split(/\s+/).map(part => {
      let p = [...part];
      while (p.length > 1 && particles.has(p[p.length - 1])) p.pop();
      while (p.length > 1 && particles.has(p[0])) p.shift();
      if (p.length === 1 && particles.has(p[0])) return '';
      return p.join('');
    }).filter(Boolean).join(' ');
  }

  // 項目を推定する:文に入っている一番長いキーワードの項目(「何に」の部分を優先)
  function guessCategory(item, fullText) {
    const best = (text) => {
      let found = null, length = 0;
      CATEGORIES.forEach(cat => (KEYWORDS[cat] || []).forEach(word => {
        // 大文字・小文字の違いは気にしない(例:「SEVEN-ELEVEN」も「seven」で見つかる)
        if (text.toLowerCase().includes(word.toLowerCase()) && word.length > length) { found = cat; length = word.length; }
      }));
      return found;
    };
    return best(item) || best(fullText) || 'その他';
  }

  // 文を読み取って { amount, item, cat } を返す
  function parse(text) {
    const s = normalizeDigits(text);
    let amount = null, range = null, m;
    if ((m = s.match(/([0-9]+)\s*円/))) { amount = parseInt(m[1], 10); range = [m.index, m.index + m[0].length]; }
    else if ((m = s.match(/([〇零一二三四五六七八九十百千万]+)\s*円/))) { amount = kanjiNumber(m[1]); range = [m.index, m.index + m[0].length]; }
    else {
      const all = [...s.matchAll(/[0-9]+/g)];
      if (all.length) { const last = all[all.length - 1]; amount = parseInt(last[0], 10); range = [last.index, last.index + last[0].length]; }
    }
    const rest = range ? s.slice(0, range[0]) + ' ' + s.slice(range[1]) : s;
    const item = cleanItem(rest);
    return { amount, item, cat: guessCategory(item, s) };
  }

  const api = { CATEGORIES, parse, guessCategory, kanjiNumber };
  global.ExpenseParser = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
