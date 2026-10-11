// ============================================================================
// Marrow House: the ending card ("Keep this").
// A 1080x1350 hand-inked poster drawn on a 2D canvas, a PNG save, and a
// Wordle-style share line. No network, no dependencies beyond ink.js.
//
//   bindKeep(button, getRun)  wire a "Keep this" button to open the card
//   openCard(run)             show the overlay for a run
//   drawCard(canvas, run)     draw the poster into a canvas
//   shareText(run)            the one-line share string (plus URL)
//
// run = { ending, endingId, flags, path: [nodeId...], nodes: {id: node}, found, total }
// ============================================================================
import { hash, rng, wobble, sketch, sketchCircle, ink, polyPath, spacedText, wrap, SERIF, INK, EMBER } from './ink.js';

const W = 1080, H = 1350;
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", ' + SERIF;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

// ------------------------------------------------------------------ glyphs
/** Flag glyphs in a fixed order: candle, fed, mirror, a bell per knock, ribbon, clock. */
export function flagGlyphs(flags = {}) {
  const g = [];
  if (flags.candle) g.push('🕯️');
  if (flags.fed) g.push('🍽️');
  if (flags.mirror) g.push('🪞');
  const knocks = Math.max(0, Math.min(9, Number(flags.knocks ?? flags.knock) || 0));
  for (let i = 0; i < knocks; i++) g.push('🔔');
  if (flags.ribbon) g.push('🎀');
  if (flags.clock) g.push('🕰️');
  return g;
}

/** Acts visited, in order of first arrival. */
export function actsVisited(run) {
  const acts = [];
  for (const id of run.path || []) {
    const a = run.nodes?.[id]?.act;
    if (a && !acts.includes(a)) acts.push(a);
  }
  return acts;
}

function stanceWord(flags = {}) {
  const s = typeof flags.stance === 'string' ? flags.stance.trim() : '';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function shareUrl() {
  return location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.split(/[?#]/)[0];
}

/** MARROW HOUSE 🎃 Treat · 🕯️🪞🔔🔔 · "All Hallows" · 5/14 endings */
export function shareText(run) {
  const parts = [['🎃', stanceWord(run.flags)].filter(Boolean).join(' ')];
  const g = flagGlyphs(run.flags);
  if (g.length) parts.push(g.join(''));
  parts.push(`"${run.ending?.title || 'The End'}"`);
  if (run.total) parts.push(`${run.found}/${run.total} endings`);
  return `MARROW HOUSE ${parts.join(' · ')}\n${shareUrl()}`;
}

// ------------------------------------------------------------------ poster
// The drawing helpers below are exported so the 1200x630 link-preview image (site/share.png) can be redrawn
// from the same ink as the ending card.
export function inkStyle(ctx, a, w) { ctx.strokeStyle = `rgba(${INK}, ${a})`; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }

export function drawMoon(ctx, r, cx, cy, rad) {
  const glow = ctx.createRadialGradient(cx, cy, rad * 0.6, cx, cy, rad * 3.4);
  glow.addColorStop(0, `rgba(${INK}, 0.16)`); glow.addColorStop(1, 'rgba(7,5,4,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const face = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
  face.addColorStop(0, '#f1e9d6'); face.addColorStop(1, '#cdbf9f');
  ctx.save(); ctx.shadowColor = `rgba(${INK}, 0.45)`; ctx.shadowBlur = 70;
  ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, d = r() * rad * 0.75, cr = rad * (0.06 + r() * 0.16);
    ctx.fillStyle = `rgba(110, 92, 70, ${0.08 + r() * 0.1})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  inkStyle(ctx, 0.35, 1.6); ink(ctx, sketchCircle(r, cx, cy, rad + 2, { amp: 2.2 }));
}

export function drawBat(ctx, r, x, y, s) {
  inkStyle(ctx, 0.55, 2);
  const flap = (r() - 0.5) * 0.6;
  ink(ctx, [
    wobble(r, x - 22 * s, y - (6 + flap * 10) * s, x - 10 * s, y + 2 * s, 0.6, 6),
    wobble(r, x - 10 * s, y + 2 * s, x, y - 3 * s, 0.6, 6),
    wobble(r, x, y - 3 * s, x + 10 * s, y + 2 * s, 0.6, 6),
    wobble(r, x + 10 * s, y + 2 * s, x + 22 * s, y - (6 + flap * 10) * s, 0.6, 6),
  ]);
}

export function drawTree(ctx, r, x, y, len, ang, depth, lines) {
  const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
  lines.push({ pts: wobble(r, x, y, x2, y2, 1.6, 9), w: Math.max(0.8, depth * 0.9) });
  if (depth <= 0) return;
  const kids = depth > 3 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
  for (let i = 0; i < kids; i++) {
    const spread = (i - (kids - 1) / 2) * (0.5 + r() * 0.35);
    drawTree(ctx, r, x2, y2, len * (0.62 + r() * 0.16), ang + spread + (r() - 0.5) * 0.3, depth - 1, lines);
  }
}

export function drawHouse(ctx, r, ox, oy, s, litCount) {
  const P = (pts) => pts.map(([x, y]) => [ox + x * s, oy + y * s]);
  const shapes = {
    tower: P([[-270, 0], [-270, -430], [-160, -430], [-160, 0]]),
    spire: P([[-292, -430], [-215, -660], [-138, -430]]),
    body: P([[-160, 0], [-160, -300], [180, -300], [180, 0]]),
    chimney: P([[92, -400], [92, -510], [128, -510], [128, -370]]),
    roof: P([[-190, -300], [10, -478], [210, -300]]),
    wing: P([[180, 0], [180, -190], [330, -190], [330, 0]]),
    wingRoof: P([[164, -190], [255, -282], [346, -190]]),
    porchRoof: P([[-120, -128], [-138, -160], [138, -160], [120, -128]]),
    steps: P([[-70, 0], [-70, -16], [70, -16], [70, 0]]),
  };
  // Silhouette first, so the moon goes behind it.
  ctx.fillStyle = '#030202';
  for (const k of Object.keys(shapes)) { polyPath(ctx, shapes[k]); ctx.fill(); }

  // Roof hatching, clipped to each roof.
  for (const k of ['spire', 'roof', 'wingRoof']) {
    ctx.save(); polyPath(ctx, shapes[k]); ctx.clip();
    inkStyle(ctx, 0.12, 1.1);
    const xs = shapes[k].map((p) => p[0]), ys = shapes[k].map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const lines = [];
    for (let y = y0 + 8; y < y1; y += 11 + r() * 4) lines.push(wobble(r, x0, y, x1, y + (r() - 0.5) * 4, 1.2, 18));
    ink(ctx, lines); ctx.restore();
  }

  // Windows: [x, y, w, h] in house units (y is the top edge).
  const wins = [
    [-238, -380, 44, 54], [-238, -250, 44, 54], [-238, -120, 44, 54],
    [-115, -262, 50, 64], [-15, -262, 50, 64], [85, -262, 50, 64],
    [-140, -112, 46, 72], [94, -112, 46, 72], [224, -150, 62, 62],
  ];
  const order = wins.map((_, i) => i).sort(() => r() - 0.5);
  const lit = new Set(order.slice(0, Math.max(1, Math.min(wins.length, litCount))));
  wins.forEach(([x, y, w, h], i) => {
    const [[ax, ay]] = P([[x, y]]); const ww = w * s, hh = h * s;
    if (lit.has(i)) {
      ctx.save(); ctx.shadowColor = `rgba(${EMBER}, 0.9)`; ctx.shadowBlur = 28;
      ctx.fillStyle = `rgba(${EMBER}, ${0.7 + r() * 0.25})`; ctx.fillRect(ax, ay, ww, hh); ctx.restore();
      ctx.fillStyle = '#1a0d06'; ctx.fillRect(ax + ww / 2 - 1.5, ay, 3, hh); ctx.fillRect(ax, ay + hh * 0.45 - 1.5, ww, 3);
    } else {
      ctx.fillStyle = '#0c0907'; ctx.fillRect(ax, ay, ww, hh);
    }
    inkStyle(ctx, lit.has(i) ? 0.5 : 0.26, 1.4);
    ink(ctx, sketch(r, [[ax, ay], [ax + ww, ay], [ax + ww, ay + hh], [ax, ay + hh]], { amp: 0.8, step: 10, passes: 1 }));
  });
  // Round gable window and the door.
  const [[gx, gy]] = P([[10, -380]]);
  ctx.fillStyle = '#0c0907'; ctx.beginPath(); ctx.arc(gx, gy, 22 * s, 0, Math.PI * 2); ctx.fill();
  inkStyle(ctx, 0.3, 1.4); ink(ctx, sketchCircle(r, gx, gy, 22 * s, { amp: 0.8, passes: 1, segs: 18 }));
  const door = P([[-26, -16], [-26, -118], [26, -118], [26, -16]]);
  ctx.save(); ctx.shadowColor = `rgba(${EMBER}, 0.7)`; ctx.shadowBlur = 18; ctx.fillStyle = `rgba(${EMBER}, 0.22)`;
  polyPath(ctx, door); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#050302'; polyPath(ctx, P([[-26, -16], [-26, -118], [14, -112], [14, -22]])); ctx.fill();

  // Ink outlines over everything.
  inkStyle(ctx, 0.58, 2.2);
  for (const k of Object.keys(shapes)) ink(ctx, sketch(r, shapes[k], { amp: 1.6, step: 16 }));
  inkStyle(ctx, 0.42, 1.6); ink(ctx, sketch(r, door, { amp: 1, step: 10, passes: 1 }));
  // Porch posts and a finial on the spire.
  const posts = [-112, -40, 40, 112].map((x) => P([[x, -16], [x, -128]]));
  inkStyle(ctx, 0.45, 2); ink(ctx, posts.map(([a, b]) => wobble(r, a[0], a[1], b[0], b[1], 1, 10)));
  const [[fx, fy]] = P([[-215, -660]]);
  ink(ctx, [wobble(r, fx, fy, fx, fy - 26, 0.8, 8), wobble(r, fx - 8, fy - 14, fx + 8, fy - 14, 0.6, 8)]);
}

export function drawLantern(ctx, x, y, rad) {
  ctx.save(); ctx.shadowColor = `rgba(${EMBER}, 0.9)`; ctx.shadowBlur = 30;
  ctx.fillStyle = '#c96a2c'; ctx.beginPath(); ctx.ellipse(x, y, rad * 1.2, rad, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#ffcf7a';
  const tri = (cx, cy, w) => { ctx.beginPath(); ctx.moveTo(cx - w, cy + w * 0.6); ctx.lineTo(cx + w, cy + w * 0.6); ctx.lineTo(cx, cy - w * 0.6); ctx.fill(); };
  tri(x - rad * 0.45, y - rad * 0.2, rad * 0.24); tri(x + rad * 0.45, y - rad * 0.2, rad * 0.24);
  ctx.beginPath(); ctx.moveTo(x - rad * 0.6, y + rad * 0.3); ctx.lineTo(x + rad * 0.6, y + rad * 0.3); ctx.lineTo(x, y + rad * 0.62); ctx.fill();
  ctx.fillStyle = '#3a2a12'; ctx.fillRect(x - 2, y - rad - 6, 4, 8);
}

/** Draw the poster for a run into `canvas` (resized to 1080x1350). */
export function drawCard(canvas, run) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const r = rng(hash((run.path || []).join('|') + '#' + (run.endingId || '')));
  const groundY = 720;

  ctx.fillStyle = '#070504'; ctx.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = `rgba(${INK}, ${0.08 + r() * 0.35})`;
    ctx.fillRect(r() * W, r() * (groundY - 60), r() < 0.85 ? 1.5 : 2.5, r() < 0.85 ? 1.5 : 2.5);
  }
  drawMoon(ctx, r, 748, 268, 150);
  drawBat(ctx, r, 900, 180, 1.1); drawBat(ctx, r, 960, 238, 0.7); drawBat(ctx, r, 612, 150, 0.8);

  // bare tree, inked
  const tree = []; drawTree(ctx, r, 128, groundY + 4, 150, -Math.PI / 2 - 0.08, 6, tree);
  for (const b of tree) { inkStyle(ctx, 0.34, b.w); ink(ctx, [b.pts]); }

  // the house, lit windows = rooms found this run
  const rooms = new Set((run.path || []).map((id) => run.nodes?.[id]?.scene?.location).filter(Boolean));
  drawHouse(ctx, r, 500, groundY, 0.8, rooms.size);

  // hill, path and fence
  const hill = [[0, groundY + 18]];
  for (let x = 0; x <= W; x += 40) hill.push([x, groundY + 6 - Math.sin(x / 260) * 10 + (r() - 0.5) * 4]);
  hill.push([W, groundY + 18], [W, H], [0, H]);
  ctx.fillStyle = '#040302'; polyPath(ctx, hill); ctx.fill();
  const fade = ctx.createLinearGradient(0, groundY, 0, groundY + 120);
  fade.addColorStop(0, 'rgba(7,5,4,0)'); fade.addColorStop(1, '#070504');
  ctx.fillStyle = fade; ctx.fillRect(0, groundY, W, 120);
  inkStyle(ctx, 0.4, 2); ink(ctx, sketch(r, hill.slice(0, -3), { closed: false, amp: 1.4, step: 20, passes: 1 }));
  inkStyle(ctx, 0.22, 1.4);
  ink(ctx, [wobble(r, 476, groundY + 8, 410, groundY + 92, 1.6, 12), wobble(r, 524, groundY + 8, 600, groundY + 92, 1.6, 12)]);
  const fence = [];
  for (let x = 700; x < 1040; x += 30) fence.push(wobble(r, x, groundY + 6, x + (r() - 0.5) * 6, groundY - 34 - r() * 8, 0.8, 8));
  fence.push(wobble(r, 696, groundY - 22, 1044, groundY - 26, 1.4, 20), wobble(r, 696, groundY - 6, 1044, groundY - 8, 1.4, 20));
  inkStyle(ctx, 0.3, 1.6); ink(ctx, fence);
  drawLantern(ctx, 424, groundY - 8, 16);

  // ---------- words
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = 832;
  ctx.fillStyle = `rgba(${EMBER}, 0.75)`; ctx.font = `400 24px ${SERIF}`;
  spacedText(ctx, String(run.ending?.kind || '').toUpperCase(), W / 2, y, 12);
  y += 92;
  ctx.fillStyle = `rgb(${INK})`; ctx.font = `400 84px ${SERIF}`;
  for (const line of wrap(ctx, run.ending?.title || 'The End', 900).slice(0, 2)) { spacedText(ctx, line, W / 2, y, 6); y += 92; }
  y -= 22;
  ctx.fillStyle = `rgba(${INK}, 0.66)`; ctx.font = `italic 400 38px ${SERIF}`;
  for (const line of wrap(ctx, run.ending?.epitaph || '', 860).slice(0, 2)) { ctx.fillText(line, W / 2, y); y += 50; }

  // glyph trail: the door, then the flags this run carried out
  y = Math.max(y + 46, 1100);
  const glyphs = ['🎃', ...flagGlyphs(run.flags)];
  ctx.font = `48px ${EMOJI}`; ctx.fillStyle = '#fff';
  const gw = 66, gx0 = W / 2 - ((glyphs.length - 1) * gw) / 2;
  glyphs.forEach((g, i) => ctx.fillText(g, gx0 + i * gw, y));

  // acts visited: one inked mark per act, joined by a thread
  const acts = actsVisited(run);
  if (acts.length) {
    y += 54;
    const step = 90, ax0 = W / 2 - ((acts.length - 1) * step) / 2;
    inkStyle(ctx, 0.25, 1.4);
    if (acts.length > 1) ink(ctx, [wobble(r, ax0, y - 8, ax0 + (acts.length - 1) * step, y - 8, 1, 14)]);
    acts.forEach((a, i) => {
      const x = ax0 + i * step;
      ctx.fillStyle = '#070504'; ctx.beginPath(); ctx.arc(x, y - 8, 7, 0, Math.PI * 2); ctx.fill();
      inkStyle(ctx, 0.6, 1.6); ink(ctx, sketchCircle(r, x, y - 8, 7, { amp: 0.6, passes: 1, segs: 12 }));
      ctx.fillStyle = `rgba(${INK}, 0.38)`; ctx.font = `400 18px ${SERIF}`; spacedText(ctx, ROMAN[a] || String(a), x, y + 26, 3);
    });
    y += 26;
  }

  ctx.fillStyle = `rgba(${INK}, 0.5)`; ctx.font = `400 22px ${SERIF}`;
  if (run.total) spacedText(ctx, `${run.found} OF ${run.total} ENDINGS FOUND`, W / 2, Math.max(y + 58, 1232), 8);
  ctx.fillStyle = `rgba(${INK}, 0.3)`; ctx.font = `400 20px ${SERIF}`;
  spacedText(ctx, 'marrow house', W / 2, H - 58, 10);

  // grain, vignette, inked frame
  for (let i = 0; i < 7000; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(255,240,220,0.035)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(r() * W, r() * H, 1.4, 1.4);
  }
  const vig = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.35, W / 2, H * 0.5, H * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  inkStyle(ctx, 0.16, 1.6); ink(ctx, sketch(r, [[34, 34], [W - 34, 34], [W - 34, H - 34], [34, H - 34]], { amp: 1.4, step: 24 }));
  return canvas;
}

// ------------------------------------------------------------------ overlay
const CSS = `
.mh-card { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  padding: calc(20px + env(safe-area-inset-top, 0px)) 16px calc(20px + env(safe-area-inset-bottom, 0px));
  background: rgba(4,3,2,0.94); overflow-y: auto; opacity: 0; transition: opacity .6s ease; }
.mh-card.on { opacity: 1; }
.mh-card canvas { display: block; width: min(100%, 520px, calc((100vh - 150px) * 0.8)); height: auto; flex: none;
  box-shadow: 0 0 0 1px rgba(236,227,208,0.08), 0 20px 80px rgba(0,0,0,0.8); }
.mh-card .acts { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 28px; }
.mh-card button { font-size: 12px; letter-spacing: .35em; text-transform: uppercase; color: var(--ink-dim, #ccc); border-bottom: 1px solid rgba(236,227,208,0.18); padding: 8px 4px; transition: color .3s, border-color .3s; }
.mh-card button:hover, .mh-card button:focus-visible { color: var(--ink, #fff); outline: none; border-color: rgba(236,227,208,0.45); }
.mh-card button.done { color: var(--ember, #e08a4a); border-color: rgba(224,138,74,0.5); }
@media (pointer: coarse) { .mh-card button { min-height: 44px; } }
.mh-card .shareText { max-width: 520px; width: 100%; font: 13px/1.5 var(--serif, serif); color: var(--ink-dim, #ccc); background: rgba(236,227,208,0.04);
  border: 1px solid rgba(236,227,208,0.1); padding: 10px 12px; white-space: pre-wrap; user-select: all; -webkit-user-select: all; }
`;
let styled = false, overlay = null, lastFocus = null, keyGuard = null;
function ensureStyle() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

function slug(s) { return String(s || 'ending').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ending'; }

async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}

function flash(btn, label, ms = 2200) {
  const orig = btn.dataset.label || btn.textContent; btn.dataset.label = orig;
  btn.textContent = label; btn.classList.add('done');
  clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = orig; btn.classList.remove('done'); }, ms);
}

export function closeCard() {
  if (!overlay) return;
  const el = overlay; overlay = null;
  window.removeEventListener('keydown', keyGuard, true); keyGuard = null;
  el.classList.remove('on'); setTimeout(() => el.remove(), 600);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/** Open the card overlay for a run. */
export function openCard(run) {
  if (!run) return;
  ensureStyle(); closeCard();
  lastFocus = document.activeElement;
  const el = document.createElement('div'); el.className = 'mh-card';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Your ending card');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${run.ending?.title || 'The End'}. ${run.ending?.epitaph || ''}`);
  drawCard(canvas, run);
  const acts = document.createElement('div'); acts.className = 'acts';
  acts.innerHTML = '<button data-a="save">Save</button><button data-a="copy">Copy text</button><button data-a="close">Close</button>';
  const box = document.createElement('div'); box.className = 'shareText'; box.hidden = true;
  el.append(canvas, acts, box);
  document.body.appendChild(el); overlay = el;
  requestAnimationFrame(() => el.classList.add('on'));

  const text = shareText(run);
  acts.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    if (b.dataset.a === 'close') closeCard();
    if (b.dataset.a === 'save') {
      canvas.toBlob((blob) => {
        if (!blob) { flash(b, 'Could not save'); return; }
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = `marrow-house-${slug(run.ending?.title)}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        flash(b, 'Saved');
      }, 'image/png');
    }
    if (b.dataset.a === 'copy') {
      const ok = await copyText(text);
      if (ok) flash(b, 'Copied');
      else { flash(b, 'Select and copy'); box.textContent = text; box.hidden = false; }
    }
  });
  el.addEventListener('click', (e) => { if (e.target === el) closeCard(); });
  // While open, keys belong to the card: Escape closes; nothing reaches the ending screen behind it.
  keyGuard = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeCard(); }
    if (e.key !== 'Tab') e.stopPropagation();
    if (e.key === 'Tab') { // keep focus inside
      const bs = [...acts.querySelectorAll('button')]; const i = bs.indexOf(document.activeElement);
      e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1) + bs.length) % bs.length].focus();
    }
  };
  window.addEventListener('keydown', keyGuard, true);
  acts.querySelector('[data-a="save"]').focus({ preventScroll: true });
  return el;
}

/** Wire a "Keep this" button. getRun() returns the latest run. */
export function bindKeep(btn, getRun) {
  ensureStyle();
  btn.addEventListener('click', (e) => { e.stopPropagation(); openCard(getRun()); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
}
