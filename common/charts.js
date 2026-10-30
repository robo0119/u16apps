// 小さなグラフ(SVG)を作る道具。外部ライブラリは使わない
(function (global) {
  'use strict';
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const Charts = {
    // ドーナツ型の円グラフ
    // items:[{label, value, color}]、center:真ん中に出す文字
    // 角度 = その値 ÷ 合計 × 360°
    donut(items, { size = 220, center = '', sub = '' } = {}) {
      const total = items.reduce((s, i) => s + i.value, 0);
      const r = size / 2, inner = r * 0.58;
      let angle = -Math.PI / 2, paths = '';
      if (total > 0) {
        items.filter(i => i.value > 0).forEach(item => {
          const sweep = item.value / total * Math.PI * 2;
          if (sweep >= Math.PI * 2 - 1e-6) {   // 1つだけで100%のときは輪を描く
            paths += `<circle cx="${r}" cy="${r}" r="${(r + inner) / 2}" fill="none" stroke="${item.color}" stroke-width="${r - inner}"/>`;
          } else {
            const a2 = angle + sweep, large = sweep > Math.PI ? 1 : 0;
            const p = (rad, ang) => `${r + rad * Math.cos(ang)},${r + rad * Math.sin(ang)}`;
            paths += `<path d="M${p(r, angle)}A${r},${r} 0 ${large} 1 ${p(r, a2)}L${p(inner, a2)}A${inner},${inner} 0 ${large} 0 ${p(inner, angle)}Z" fill="${item.color}" stroke="var(--card)" stroke-width="2"/>`;
          }
          angle += sweep;
        });
      } else {
        paths = `<circle cx="${r}" cy="${r}" r="${(r + inner) / 2}" fill="none" stroke="var(--line)" stroke-width="${r - inner}"/>`;
      }
      return `<svg class="chart donut" viewBox="0 0 ${size} ${size}" role="img">${paths}
        <text x="${r}" y="${r - 4}" text-anchor="middle" class="donut-center">${esc(center)}</text>
        <text x="${r}" y="${r + 18}" text-anchor="middle" class="donut-sub">${esc(sub)}</text></svg>`;
    },

    // 横棒グラフ。items:[{label, value, color, note}]、max:いちばん長い棒の値
    bars(items, { max } = {}) {
      const top = max || Math.max(1, ...items.map(i => i.value));
      return `<div class="bars">${items.map(i => `
        <div class="bar-row">
          <span class="bar-label">${esc(i.label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, i.value / top * 100))}%;background:${i.color}"></span></span>
          <span class="bar-note">${esc(i.note ?? i.value)}</span>
        </div>`).join('')}</div>`;
    },

    // 折れ線グラフ。series:[{label, color, points:[{x: 日付の数, y}]}]、yMax:縦の最大
    lines(series, { height = 200, yMax = 100 } = {}) {
      const all = series.flatMap(s => s.points);
      if (!all.length) return '';
      const w = 600, pad = 30;
      const xs = all.map(p => p.x), minX = Math.min(...xs), maxX = Math.max(...xs);
      const sx = x => maxX === minX ? w / 2 : pad + (x - minX) / (maxX - minX) * (w - pad * 2);
      const sy = y => height - pad - y / yMax * (height - pad * 1.5);
      let grid = '';
      for (let g = 0; g <= 4; g++) {
        const y = sy(yMax * g / 4);
        grid += `<line x1="${pad}" x2="${w - pad}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="4" y="${y + 4}" class="axis">${Math.round(yMax * g / 4)}</text>`;
      }
      const lines = series.map(s => {
        const pts = s.points.slice().sort((a, b) => a.x - b.x);
        return `<polyline fill="none" stroke="${s.color}" stroke-width="3" points="${pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')}"/>` +
          pts.map(p => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4" fill="${s.color}"/>`).join('');
      }).join('');
      const legend = series.map(s => `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
      return `<svg class="chart lines" viewBox="0 0 ${w} ${height}">${grid}${lines}</svg><div class="legend">${legend}</div>`;
    },
  };
  global.Charts = Charts;
})(window);
