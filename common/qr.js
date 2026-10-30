// QRコードを作る(外部ライブラリを使わない、自作の小さな版)
// 文字(URL)を「バイトモード」で入れて、白黒のマス目(true=黒)を作り、SVGにする。
// 仕組み:
//   1. 文字をバイト列にして、先頭に「種類(0100)」と「長さ」を付ける
//   2. 入りきる一番小さい大きさ(バージョン1〜40)を選ぶ
//   3. 読み取りミスを直すための「誤り訂正」データ(リード・ソロモン符号)を足す
//   4. 位置合わせの模様を描き、データをジグザグに並べ、読みやすくなる模様(マスク)を選ぶ
(function (global) {
  'use strict';

  // 誤り訂正のレベル(L:約7%直せる, M:約15%)
  const ECL = { L: { ordinal: 0, formatBits: 1 }, M: { ordinal: 1, formatBits: 0 } };

  // バージョンごとの「1ブロックあたりの誤り訂正の数」と「ブロック数」(QRコードの規格の表)
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  ];

  // バージョンの中で、データに使えるマスの数(位置合わせの模様などを引いた数)
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // データに使えるバイト数 = 使えるマス ÷ 8 − 誤り訂正の分
  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  // ---- リード・ソロモン符号(誤り訂正)----
  // GF(256) のかけ算(QRコードでは x^8 + x^4 + x^3 + x^2 + 1 = 0x11D を使う)
  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  // 割る数(生成多項式)を作る
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }
  // データを割った「あまり」が誤り訂正のデータになる
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
    }
    return result;
  }

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  // ---- 本体 ----
  function encodeText(text, minEcl) {
    const bytes = Array.from(new TextEncoder().encode(text));
    // 1〜2. 入りきる一番小さいバージョンを探す
    let ver, ecl = minEcl === 'L' ? ECL.L : ECL.M;
    for (ver = 1; ; ver++) {
      const lenBits = ver <= 9 ? 8 : 16;
      const needBits = 4 + lenBits + bytes.length * 8;
      if (needBits <= numDataCodewords(ver, ecl) * 8) break;
      if (ver >= 40) throw new Error('データが大きすぎてQRコードにできません');
    }
    // 余裕があれば、誤り訂正を強くする(L → M)
    const lenBits = ver <= 9 ? 8 : 16;
    if (ecl === ECL.L && 4 + lenBits + bytes.length * 8 <= numDataCodewords(ver, ECL.M) * 8) ecl = ECL.M;

    // 1. ビット列を作る:種類(0100=バイト)+ 長さ + データ + 終わりの0 + うめ草
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, lenBits);
    bytes.forEach(b => push(b, 8));
    const capacity = numDataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    // 3. ブロックに分けて誤り訂正を付け、互い違いに並べる
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const divisor = rsDivisor(blockEccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i]);
      });
    }

    // 4. マス目を作る
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    // タイミングの点線
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    // 角の大きな四角(位置検出パターン)
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // 小さな四角(位置合わせパターン)
    const alignPos = (() => {
      if (ver === 1) return [];
      const numAlign = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
      const result = [6];
      for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
      return result;
    })();
    const last = alignPos.length - 1;
    alignPos.forEach((ay, i) => alignPos.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // 形式情報(誤り訂正レベルとマスクの番号)を描く
    const drawFormat = (mask) => {
      const dataBits = (ecl.formatBits << 3) | mask;
      let rem = dataBits;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((dataBits << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, getBit(f, i));
      setFn(8, 7, getBit(f, 6)); setFn(8, 8, getBit(f, 7)); setFn(7, 8, getBit(f, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(f, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(f, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(f, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    // バージョン情報(バージョン7以上)
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFn(a, b, getBit(v, i)); setFn(b, a, getBit(v, i));
      }
    }
    // データを右下から2列ずつジグザグに置く
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }

    // マスク:8種類ためして、いちばん「読みやすい」(減点が少ない)ものを選ぶ
    const maskFn = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (!isFunction[y][x] && maskFn[m](x, y)) modules[y][x] = !modules[y][x];
    };
    // 減点:同じ色が5つ以上続く、2×2の同じ色、黒の割合が50%から離れている
    const penalty = () => {
      let p = 0, dark = 0;
      for (let y = 0; y < size; y++) {
        let runX = 1, runY = 1;
        for (let x = 0; x < size; x++) {
          if (modules[y][x]) dark++;
          if (x > 0) {
            if (modules[y][x] === modules[y][x - 1]) { runX++; if (runX === 5) p += 3; else if (runX > 5) p++; } else runX = 1;
            if (modules[x][y] === modules[x - 1][y]) { runY++; if (runY === 5) p += 3; else if (runY > 5) p++; } else runY = 1;
          }
          if (x < size - 1 && y < size - 1) {
            const c = modules[y][x];
            if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) p += 3;
          }
        }
      }
      const total = size * size;
      p += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let bestMask = 0, bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty();
      if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
      applyMask(m);  // 同じマスクをもう一度かけると元に戻る
    }
    applyMask(bestMask); drawFormat(bestMask);
    return { size, modules, version: ver };
  }

  // マス目を SVG の文字にする(まわりに4マスの白いすき間をとる)
  function toSVG(text, { ecl = 'M', color = '#000' } = {}) {
    const { size, modules } = encodeText(text, ecl);
    const border = 4, full = size + border * 2;
    let path = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (modules[y][x]) path += `M${x + border},${y + border}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">` +
      `<rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="${color}"/></svg>`;
  }

  global.QR = { encodeText, toSVG };
  if (typeof module !== 'undefined') module.exports = global.QR;
})(typeof window !== 'undefined' ? window : globalThis);
