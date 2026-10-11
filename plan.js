// ============================================================================
// Marrow House: the floor plan revealed after an ending.
// Ink on dark paper, three storeys stacked plus the lawn. Rooms visited this
// run glow warm and are labelled; rooms seen on earlier runs are dim ink;
// rooms never seen are nearly invisible. Rooms light up in path order.
//
//   roomsVisited(path, nodes)   ordered unique scene.location values
//   mergeRooms(prev, rooms)     union for the persisted "seen" set
//   showPlan(host, run, opts)   draw and animate into a host element
// ============================================================================
import { hash, rng, wobble, sketch, ink, SERIF, INK, EMBER } from './ink.js';

export const ROOMS = ['porch', 'foyer', 'parlor', 'kitchen', 'conservatory', 'stair', 'hall', 'nursery', 'mirror', 'attic', 'cellar', 'marrow', 'outside'];
const NAMES = { mirror: 'mirror room', marrow: 'the marrow', outside: 'the lawn' };

/** Ordered, de-duplicated room ids for a path of node ids. */
export function roomsVisited(path, nodes) {
  const out = [];
  for (const id of path || []) {
    const loc = nodes?.[id]?.scene?.location;
    if (ROOMS.includes(loc) && !out.includes(loc)) out.push(loc);
  }
  return out;
}
export function mergeRooms(prev, rooms) { return ROOMS.filter((r) => (prev || []).includes(r) || (rooms || []).includes(r)); }

// ---------------------------------------------------------------- geometry
// Plan units: each storey is 100u wide. Logical canvas is 560 x 790 px.
const LW = 560, LH = 790, M = 30, K = (LW - 2 * M) / 100;
const STOREYS = [
  { label: 'upstairs', y: 50, rooms: {
    attic: [0, 0, 26, 36], nursery: [26, 0, 34, 22], mirror: [60, 0, 40, 22], hall: [26, 22, 74, 14] } },
  { label: 'ground floor', y: 284, rooms: {
    parlor: [0, 0, 34, 24], stair: [0, 24, 34, 16], foyer: [34, 0, 28, 40], conservatory: [62, 0, 38, 18], kitchen: [62, 18, 38, 22],
    porch: [32, 40, 32, 8], outside: [4, 50, 92, 10] } },
  { label: 'below', y: 632, rooms: { cellar: [0, 0, 62, 26], marrow: [62, 0, 38, 26] } },
];
const GEOM = {};
for (const s of STOREYS) for (const [id, [x, y, w, h]] of Object.entries(s.rooms)) {
  GEOM[id] = { x: M + x * K, y: s.y + y * K, w: w * K, h: h * K };
}

function buildStrokes(seed) {
  const r = rng(seed);
  const out = {};
  for (const id of ROOMS) {
    const g = GEOM[id]; const { x, y, w, h } = g;
    const box = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    let walls, detail = [];
    if (id === 'outside') {
      // no walls: a ragged hedge line and a dotted walk to a gate
      walls = [];
      for (let i = 0; i < 2; i++) walls.push(wobble(r, x, y + h - i * 3, x + w, y + h - i * 3 + (r() - 0.5) * 3, 2.4, 12));
      for (let i = 0; i < 9; i++) { const yy = y + 2 + i * (h - 4) / 9; detail.push(wobble(r, x + w / 2 - 1, yy, x + w / 2 + 1, yy + 2, 0.4, 4)); }
      detail.push(wobble(r, x + w / 2 - 22, y + h, x + w / 2 - 22, y + h - 12, 0.6, 6), wobble(r, x + w / 2 + 22, y + h, x + w / 2 + 22, y + h - 12, 0.6, 6));
    } else if (id === 'porch') {
      walls = sketch(r, [[x, y], [x, y + h], [x + w, y + h], [x + w, y]], { closed: false, amp: 1, step: 12 });
      for (let i = 1; i <= 2; i++) detail.push(wobble(r, x + w * 0.3, y + h + i * 4, x + w * 0.7, y + h + i * 4, 0.6, 10));
      for (let i = 1; i < 5; i++) detail.push(wobble(r, x + i * w / 5, y + h - 3, x + i * w / 5, y + h + 1, 0.4, 4));
    } else if (id === 'marrow') {
      walls = sketch(r, box, { amp: 1.1, step: 12 });
      const cx = x + w / 2, cy = y + h / 2;
      for (let i = -3; i <= 3; i++) { // ribs
        const pts = []; for (let t = 0; t <= 10; t++) { const a = Math.PI * (0.15 + 0.7 * t / 10); pts.push([cx + i * 9 + Math.cos(a) * 6, cy - h * 0.32 + Math.sin(a) * h * 0.62 + (r() - 0.5)]); }
        detail.push(pts);
      }
      detail.push(wobble(r, cx - 32, cy, cx + 32, cy, 1, 8));
    } else {
      walls = sketch(r, box, { amp: 1.1, step: 12 });
      if (id === 'stair') for (let i = 1; i < 8; i++) detail.push(wobble(r, x + i * w / 8, y + 4, x + i * w / 8, y + h - 4, 0.5, 8));
      if (id === 'conservatory') {
        for (let i = 1; i < 6; i++) detail.push(wobble(r, x + i * w / 6, y + 2, x + i * w / 6, y + h - 2, 0.5, 8));
        detail.push(wobble(r, x + 2, y + h / 2, x + w - 2, y + h / 2, 0.5, 10));
      }
      if (id === 'mirror') detail.push(wobble(r, x + w * 0.25, y + 4, x + w * 0.75, y + 4, 0.3, 10), wobble(r, x + w * 0.25, y + 6.5, x + w * 0.75, y + 6.5, 0.3, 10));
      if (id === 'parlor') detail.push(...sketch(r, [[x + w * 0.38, y], [x + w * 0.38, y + 8], [x + w * 0.62, y + 8], [x + w * 0.62, y]], { closed: false, amp: 0.5, step: 8, passes: 1 }));
      if (id === 'kitchen') detail.push(...sketch(r, [[x + w * 0.3, y + h * 0.4], [x + w * 0.7, y + h * 0.4], [x + w * 0.7, y + h * 0.65], [x + w * 0.3, y + h * 0.65]], { amp: 0.5, step: 8, passes: 1 }));
      if (id === 'nursery') detail.push(...sketch(r, [[x + 8, y + h - 22], [x + 30, y + h - 22], [x + 30, y + h - 8], [x + 8, y + h - 8]], { amp: 0.5, step: 6, passes: 1 }));
      if (id === 'attic') for (let i = 1; i < 5; i++) detail.push(wobble(r, x + 3, y + i * h / 5, x + w - 3, y + i * h / 5 - 10, 0.6, 10));
      if (id === 'cellar') for (const [fx, fy] of [[0.2, 0.3], [0.32, 0.62], [0.78, 0.4]]) {
        const pts = []; for (let t = 0; t <= 14; t++) { const a = (t / 14) * Math.PI * 2; pts.push([x + w * fx + Math.cos(a) * 7, y + h * fy + Math.sin(a) * 7]); }
        detail.push(pts);
      }
    }
    out[id] = { walls, detail };
  }
  return out;
}

// ---------------------------------------------------------------- paper
function paper(ctx, r) {
  ctx.fillStyle = '#100c09'; ctx.fillRect(0, 0, LW, LH);
  const g = ctx.createRadialGradient(LW / 2, LH * 0.45, 60, LW / 2, LH / 2, LH * 0.7);
  g.addColorStop(0, 'rgba(60,44,30,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(236,227,208,0.025)' : 'rgba(0,0,0,0.18)'; ctx.fillRect(r() * LW, r() * LH, 1, 1); }
  ctx.strokeStyle = 'rgba(236,227,208,0.025)'; ctx.lineWidth = 1;
  ink(ctx, Array.from({ length: 34 }, (_, i) => wobble(r, 0, 12 + i * 23.5, LW, 12 + i * 23.5 + (r() - 0.5) * 4, 1, 40)));
}

// ---------------------------------------------------------------- styles
const CSS = `
.mh-plan { width: min(100%, 460px, calc(80vh * ${LW / LH})); margin: 0 auto; }
.mh-plan canvas { display: block; width: 100%; height: auto; border-radius: 2px; box-shadow: 0 0 0 1px rgba(236,227,208,0.06), 0 18px 60px rgba(0,0,0,0.6); }
.mh-plan .cap { margin-top: 12px; font-size: 10px; letter-spacing: .32em; text-transform: uppercase; color: var(--ink-faint, #888); text-align: center; opacity: 0; transition: opacity 2s ease; }
.mh-plan .cap.on { opacity: 1; }
`;
let styled = false;
function ensureStyle() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
let active = null; // { raf, timer }

/**
 * Draw the plan into `host` and animate the reveal.
 * run: { path, nodes, prevRooms }  opts: { delay = 0 }
 */
export function showPlan(host, run, { delay = 0 } = {}) {
  ensureStyle();
  if (active) { cancelAnimationFrame(active.raf); clearTimeout(active.timer); active = null; }
  host.innerHTML = '';
  const wrapEl = document.createElement('div'); wrapEl.className = 'mh-plan';
  const canvas = document.createElement('canvas');
  const cap = document.createElement('div'); cap.className = 'cap';
  wrapEl.append(canvas, cap); host.appendChild(wrapEl);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(LW * dpr); canvas.height = Math.round(LH * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);

  const now = roomsVisited(run.path, run.nodes);
  const prev = new Set(run.prevRooms || []);
  const ever = mergeRooms([...prev], now);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Floor plan. Rooms found tonight: ${now.map((id) => NAMES[id] || id).join(', ') || 'none'}.`);
  cap.textContent = `${now.length} ${now.length === 1 ? 'room' : 'rooms'} tonight · ${ever.length} of ${ROOMS.length} ever`;

  const seed = hash('marrow-plan');
  const strokes = buildStrokes(seed);
  const bg = document.createElement('canvas'); bg.width = canvas.width; bg.height = canvas.height;
  const bctx = bg.getContext('2d'); bctx.scale(dpr, dpr); paper(bctx, rng(seed ^ 0x5eed));

  // trail through the rooms, consecutive repeats collapsed
  const trail = [];
  for (const id of run.path || []) {
    const loc = run.nodes?.[id]?.scene?.location;
    if (GEOM[loc] && trail[trail.length - 1] !== loc) trail.push(loc);
  }
  const STEP = 520, LIGHT = 900, BASE = 900;
  const litAt = {}; now.forEach((id, i) => (litAt[id] = BASE + i * STEP));
  const total = BASE + Math.max(0, now.length - 1) * STEP + LIGHT + 200;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bg, 0, 0); ctx.scale(dpr, dpr);
    const base = ease(t / BASE);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // storey labels
    ctx.textAlign = 'left'; ctx.font = `400 10px ${SERIF}`; ctx.fillStyle = `rgba(${INK}, ${0.32 * base})`;
    for (const s of STOREYS) { if ('letterSpacing' in ctx) ctx.letterSpacing = '3px'; ctx.fillText(s.label.toUpperCase(), M, s.y - 14); }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    const order = [...ROOMS].sort((a, b) => (now.includes(a) - now.includes(b)) || (prev.has(a) - prev.has(b)));
    for (const id of order) {
      const g = GEOM[id], st = strokes[id];
      const lit = id in litAt ? ease((t - litAt[id]) / LIGHT) : 0;
      const dim = prev.has(id) ? 0.3 : 0.035;
      const a = base * (dim + (0.8 - dim) * lit);
      if (lit > 0) { // warm glow
        const cx = g.x + g.w / 2, cy = g.y + g.h / 2, rad = Math.max(g.w, g.h) * 0.75;
        const gr = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        gr.addColorStop(0, `rgba(${EMBER}, ${0.2 * lit})`); gr.addColorStop(1, `rgba(${EMBER}, ${0.04 * lit})`);
        ctx.fillStyle = gr; ctx.fillRect(g.x, g.y, g.w, g.h);
      }
      ctx.strokeStyle = lit > 0 ? `rgba(${Math.round(236 - 12 * lit)}, ${Math.round(227 - 40 * lit)}, ${Math.round(208 - 90 * lit)}, ${a})` : `rgba(${INK}, ${a})`;
      ctx.lineWidth = 1.5; ink(ctx, st.walls);
      ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${INK}, ${a * (prev.has(id) || lit > 0 ? 0.7 : 0.4)})`; ink(ctx, st.detail);
      if (lit > 0) {
        ctx.textAlign = 'center'; ctx.font = `italic 400 13px ${SERIF}`; ctx.fillStyle = `rgba(${INK}, ${0.85 * lit})`;
        const ly = id === 'marrow' ? g.y + g.h - 9 : g.y + g.h / 2 + 4;
        const lx = id === 'outside' ? g.x + g.w * 0.25 : g.x + g.w / 2;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6; ctx.fillText(NAMES[id] || id, lx, ly); ctx.restore();
      }
    }
    // the trail, drawn as far as the lights have reached
    if (trail.length > 1) {
      ctx.save(); ctx.setLineDash([2, 6]); ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${EMBER}, 0.32)`; ctx.beginPath();
      for (let i = 1; i < trail.length; i++) {
        const k = ease((t - litAt[trail[i]] + 200) / 500); if (k <= 0) continue;
        const a = GEOM[trail[i - 1]], b = GEOM[trail[i]];
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2 + 12, bx = b.x + b.w / 2, by = b.y + b.h / 2 + 12;
        ctx.moveTo(ax, ay); ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k);
      }
      ctx.stroke(); ctx.restore();
    }
  }

  const state = { raf: 0, timer: 0 }; active = state;
  if (reduced) { frame(1e9); cap.classList.add('on'); return wrapEl; }
  frame(0);
  state.timer = setTimeout(() => {
    const t0 = performance.now();
    const loop = (ts) => {
      if (active !== state) return;
      const t = ts - t0; frame(t);
      if (t < total) state.raf = requestAnimationFrame(loop); else cap.classList.add('on');
    };
    state.raf = requestAnimationFrame(loop);
  }, delay);
  return wrapEl;
}
