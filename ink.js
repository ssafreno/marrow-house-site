// ============================================================================
// Marrow House: hand-inked 2D canvas helpers shared by share.js and plan.js.
// Seeded randomness so a given run always draws the same wobble.
// ============================================================================

/** FNV-1a string hash -> uint32 seed. */
export function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One wobbly pen stroke from (x1,y1) to (x2,y2), with a little overshoot at the ends. */
export function wobble(r, x1, y1, x2, y2, amp = 1.2, step = 14) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
  const o1 = (r() - 0.3) * amp * 1.6, o2 = (r() - 0.3) * amp * 1.6; // overshoot
  const ax = x1 - ux * o1, ay = y1 - uy * o1, bx = x2 + ux * o2, by = y2 + uy * o2;
  const n = Math.max(2, Math.ceil(len / step));
  const pts = []; let drift = (r() - 0.5) * amp;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    drift = drift * 0.55 + (r() - 0.5) * amp;
    pts.push([ax + (bx - ax) * t + nx * drift, ay + (by - ay) * t + ny * drift]);
  }
  return pts;
}

/** Precompute a sketched polygon/polyline: `passes` slightly different wobbly traces of every edge. */
export function sketch(r, pts, { closed = true, amp = 1.2, step = 14, passes = 2 } = {}) {
  const lines = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      lines.push(wobble(r, a[0], a[1], b[0], b[1], amp * (p ? 1.4 : 1), step));
    }
  }
  return lines;
}

/** Wobbly circle as one closed polyline set. */
export function sketchCircle(r, cx, cy, rad, { amp = 1.4, passes = 2, segs = 40 } = {}) {
  const lines = [];
  for (let p = 0; p < passes; p++) {
    const pts = []; const start = r() * Math.PI * 2; let drift = 0;
    for (let i = 0; i <= segs + 2; i++) {
      const a = start + (i / segs) * Math.PI * 2;
      drift = drift * 0.7 + (r() - 0.5) * amp;
      pts.push([cx + Math.cos(a) * (rad + drift), cy + Math.sin(a) * (rad + drift)]);
    }
    lines.push(pts);
  }
  return lines;
}

/** Stroke a list of polylines with the current stroke style. */
export function ink(ctx, lines) {
  ctx.beginPath();
  for (const pts of lines) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
}

/** Trace a plain polygon path (for fills and clips). */
export function polyPath(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Text with letter spacing, using ctx.letterSpacing when the browser has it. */
export function spacedText(ctx, text, x, y, spacing) {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${spacing}px`;
    // letterSpacing adds trailing space after the last glyph; nudge centred text back.
    const nudge = ctx.textAlign === 'center' ? spacing / 2 : 0;
    ctx.fillText(text, x + nudge, y);
    ctx.letterSpacing = '0px';
    return;
  }
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  const align = ctx.textAlign;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = align;
}

/** Greedy word wrap to a max width; returns lines. */
export function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "Hoefler Text", Georgia, serif';
export const INK = '236, 227, 208';
export const EMBER = '224, 138, 74';
