// src/utils/reportCharts.ts
// Dependency-free SVG chart builders used by the PDF reports.

export interface BarSeries { name: string; color: string; }
export interface BarGroup { label: string; values: number[]; }

function compact(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}

export function svgGroupedBars(groups: BarGroup[], series: BarSeries[], width = 660, height = 230): string {
  const padL = 46, padB = 20, padT = 10;
  const maxV = Math.max(1, ...groups.flatMap(g => g.values));
  const gw = (width - padL) / Math.max(1, groups.length);
  const barW = Math.max(3, (gw - 8) / Math.max(1, series.length));
  const scale = (v: number) => (v / maxV) * (height - padB - padT);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, sans-serif">`;
  s += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let g = 0; g <= 4; g++) {
    const y = padT + ((height - padB - padT) * g) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${width - 4}" y2="${y}" stroke="#e5e5ea" stroke-width="1"/>`;
    s += `<text x="4" y="${y + 3}" font-size="8" fill="#8e8e93">${compact(maxV * (1 - g / 4))}</text>`;
  }
  groups.forEach((grp, gi) => {
    const gx = padL + gi * gw;
    grp.values.forEach((v, si) => {
      const h = Math.max(0.5, scale(v));
      s += `<rect x="${(gx + 4 + si * barW).toFixed(1)}" y="${(height - padB - h).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${series[si]?.color || '#0a84ff'}"/>`;
    });
    s += `<text x="${(gx + gw / 2).toFixed(1)}" y="${height - 6}" font-size="8" fill="#8e8e93" text-anchor="middle">${grp.label}</text>`;
  });
  s += '</svg>';
  return s;
}

export function svgLineChart(points: { label: string; value: number }[], color: string, width = 660, height = 200): string {
  const padL = 46, padB = 20, padT = 10;
  const maxV = Math.max(1, ...points.map(p => p.value));
  const stepX = points.length > 1 ? (width - padL - 12) / (points.length - 1) : 0;
  const yOf = (v: number) => padT + (1 - v / maxV) * (height - padB - padT);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, sans-serif">`;
  s += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  for (let g = 0; g <= 4; g++) {
    const y = padT + ((height - padB - padT) * g) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${width - 4}" y2="${y}" stroke="#e5e5ea" stroke-width="1"/>`;
    s += `<text x="4" y="${y + 3}" font-size="8" fill="#8e8e93">${compact(maxV * (1 - g / 4))}</text>`;
  }
  const coords = points.map((p, i) => `${(padL + i * stepX).toFixed(1)},${yOf(p.value).toFixed(1)}`);
  s += `<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
  points.forEach((p, i) => {
    const cx = padL + i * stepX;
    s += `<circle cx="${cx.toFixed(1)}" cy="${yOf(p.value).toFixed(1)}" r="2.5" fill="${color}"/>`;
    if (points.length <= 8 || i % 2 === 0) {
      s += `<text x="${cx.toFixed(1)}" y="${height - 6}" font-size="8" fill="#8e8e93" text-anchor="middle">${p.label}</text>`;
    }
  });
  s += '</svg>';
  return s;
}
