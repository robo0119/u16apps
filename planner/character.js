// ノルマを終えると育つキャラ「ソラ」(このアプリのためのオリジナル。iOS版の PilotCharacterView と同じ形)
// 200 × 220 の中に描く。姿(stage 1〜4)で服と帽子が変わり、表情(mood)で目と口が変わる
(function (root) {
  'use strict';
  const SKIN = '#FFE3CF', HAIR = '#2B2F5C', INK = '#2B2F5C';
  /** 姿ごとの上着の色(見習い・ナビゲーター・パイロット・キャプテン) */
  const JACKET = { 1: '#7FA7FF', 2: '#4A6CF7', 3: '#8A5A34', 4: '#1F2A55' };

  /** 目(表情で変える)。cx:目の中心 */
  function eye(cx, mood) {
    if (mood === 'happy') return `<path d="M${cx - 9} 104 Q${cx} 93 ${cx + 9} 104" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    if (mood === 'sleepy') return `<path d="M${cx - 8} 103 Q${cx} 108 ${cx + 8} 103" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    return `<ellipse cx="${cx}" cy="102" rx="9" ry="12" fill="${INK}"/>
      <ellipse cx="${cx}" cy="104.5" rx="7" ry="9" fill="url(#iris)"/>
      <circle cx="${cx - 3}" cy="97" r="3.2" fill="#fff"/><circle cx="${cx + 3}" cy="107" r="1.6" fill="#fff"/>`;
  }

  /** 口(表情で変える) */
  function mouth(mood) {
    if (mood === 'happy') return `<path d="M91 121 Q100 134 109 121 Z" fill="#E2474F"/>`;
    if (mood === 'sleepy') return `<path d="M95 125 L105 125" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    return `<path d="M93 123 Q100 129 107 123" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }

  /** 姿ごとの帽子・小物 */
  function gear(stage) {
    if (stage === 2) return `<path d="M46 84 Q100 18 154 84" stroke="#30344a" stroke-width="6" fill="none"/>
      <rect x="38" y="80" width="15" height="28" rx="6" fill="#30344a"/><rect x="147" y="80" width="15" height="28" rx="6" fill="#30344a"/>
      <path d="M46 104 Q52 126 80 129" stroke="#30344a" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="82" cy="129" r="4" fill="#E2474F"/>`;
    if (stage === 3) return `<path d="M46 74 Q100 12 154 74 Q100 60 46 74 Z" fill="#7A4E2B"/>
      <path d="M50 58 L150 58" stroke="#5a3a20" stroke-width="5"/>
      <circle cx="82" cy="56" r="13" fill="#9fd3ff" stroke="#5a3a20" stroke-width="5"/><circle cx="118" cy="56" r="13" fill="#9fd3ff" stroke="#5a3a20" stroke-width="5"/>
      <circle cx="78" cy="52" r="3.5" fill="#fff"/><circle cx="114" cy="52" r="3.5" fill="#fff"/>`;
    if (stage === 4) return `<path d="M52 64 Q100 6 148 64 Z" fill="#1F2A55"/><ellipse cx="100" cy="66" rx="58" ry="9" fill="#11162e"/>
      <rect x="56" y="54" width="88" height="7" fill="#F5C518"/>
      <path d="M100 27 L104.5 37 L115 38 L107 45 L109.5 55 L100 49.5 L90.5 55 L93 45 L85 38 L95.5 37 Z" fill="#F5C518"/>
      <path d="M74 150 Q100 164 126 150 L132 164 Q100 178 68 164 Z" fill="#E2474F"/>`;
    return `<circle cx="140" cy="52" r="7" fill="#F5C518"/>`;   // 見習い:髪どめ
  }

  /** キャラの SVG。stage:1〜4、mood:'happy' | 'working' | 'normal' | 'sleepy' */
  function svg(stage, mood) {
    const j = JACKET[stage] || JACKET[1];
    const sparkle = (x, y, s) => `<path d="M${x} ${y - s} L${x + s * .3} ${y - s * .3} L${x + s} ${y} L${x + s * .3} ${y + s * .3} L${x} ${y + s} L${x - s * .3} ${y + s * .3} L${x - s} ${y} L${x - s * .3} ${y - s * .3} Z" fill="#F5C518"/>`;
    return `<svg class="sora sora-${mood}" viewBox="0 0 200 220" role="img" aria-label="キャラクターのソラ">
      <defs><linearGradient id="iris" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A6CF7"/><stop offset="1" stop-color="#9ad0ff"/></linearGradient></defs>
      <ellipse cx="100" cy="212" rx="46" ry="7" fill="rgba(0,0,0,.12)"/>
      <g class="sora-body">
        <path d="M58 210 Q58 150 100 150 Q142 150 142 210 Z" fill="${j}"/>
        <path d="M88 151 L100 170 L112 151 Z" fill="#fff"/>
        ${stage === 4 ? '<circle cx="122" cy="182" r="6" fill="#F5C518"/>' : ''}
        <ellipse cx="100" cy="86" rx="60" ry="56" fill="${HAIR}"/>
        <rect x="42" y="86" width="20" height="48" rx="10" fill="${HAIR}"/><rect x="138" y="86" width="20" height="48" rx="10" fill="${HAIR}"/>
        <circle cx="100" cy="97" r="54" fill="${SKIN}"/>
        <path d="M46 88 Q48 36 100 34 Q152 36 154 88 Q140 72 126 74 Q118 58 104 72 Q94 56 84 74 Q70 62 58 84 Z" fill="${HAIR}"/>
        ${eye(78, mood)}${eye(122, mood)}
        <ellipse cx="66" cy="119" rx="9" ry="4.5" fill="#ff9fb2" opacity=".55"/><ellipse cx="134" cy="119" rx="9" ry="4.5" fill="#ff9fb2" opacity=".55"/>
        ${mouth(mood)}
        ${gear(stage)}
      </g>
      ${mood === 'happy' ? `<g class="sora-sparkle">${sparkle(30, 60, 9)}${sparkle(170, 40, 7)}${sparkle(176, 120, 6)}</g>` : ''}
    </svg>`;
  }

  root.SoraCharacter = { svg };
})(window);
