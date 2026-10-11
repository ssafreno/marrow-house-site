// ============================================================================
// Marrow House: procedural house renderer (Three.js r170, no textures, no models).
// Everything below is generated in code. Canvas textures are drawn at runtime.
//
//   const house = createHouse(canvas, { small })
//   house.apply(sceneDirective)   crossfade to a new directive (~2.2 s)
//                                 scene.figures [{who, at}] fade with the scene; a kept figure glides to a new `at`
//   house.anchors(location, who)  the anchor names defined for a location (dev: figures cycle)
//   house.preview()               cycle every location with its default props
//   house.fadeTo(v, seconds)      global fade (title fade-up)
//   house.onFlash = (strength) => {}   lightning callback (thunder)
// ============================================================================
import * as THREE from 'three';
import { Reflector } from './vendor/Reflector.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

export const LOCATIONS = ['porch', 'foyer', 'parlor', 'kitchen', 'conservatory', 'stair', 'hall', 'nursery', 'mirror', 'attic', 'cellar', 'marrow', 'outside'];
export const PALETTE_NAMES = ['ember', 'bone', 'verdigris', 'bruise', 'void'];
export const CAMERAS = ['approach', 'drift', 'push', 'tilt', 'still', 'fall'];
export const PROPS = ['jackolantern', 'door', 'fireplace', 'portrait', 'clock', 'table', 'feast', 'chandelier', 'vines', 'moon', 'mirror', 'crib', 'trunk', 'candles', 'bones', 'roots', 'window', 'rain'];

// Five colours per palette: fog/ground, ambient, key light, emissive accent, highlight.
const PALETTES = {
  ember:     { fog: '#0e0704', amb: '#3c1c0a', key: '#ff9448', accent: '#ff6410', hi: '#ffd49a', keyI: 0.55, hemiI: 1.0 },
  bone:      { fog: '#13120f', amb: '#4c473c', key: '#ebe3cc', accent: '#d9cca6', hi: '#fffaf0', keyI: 0.6, hemiI: 1.1 },
  verdigris: { fog: '#05110f', amb: '#173d35', key: '#62c4ad', accent: '#2aa688', hi: '#b8f7e4', keyI: 0.55, hemiI: 1.0 },
  bruise:    { fog: '#0d0613', amb: '#301742', key: '#a66cd8', accent: '#9a2fa8', hi: '#f1c4ff', keyI: 0.55, hemiI: 1.0 },
  void:      { fog: '#020203', amb: '#08090c', key: '#9fd8ff', accent: '#10131a', hi: '#a8dcff', keyI: 0.35, hemiI: 0.35 },
};

const DEFAULT_DIRECTIVE = { location: 'outside', palette: 'bone', fog: 0.3, lightning: 0, camera: 'drift', props: null, music: 'drone', heartbeat: 0, flicker: 0, figures: null };

// ---------------------------------------------------------------- utilities
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let R = seeded(1031);
const rr = (a, b) => a + (b - a) * R();
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const PALMATS = []; // materials whose emissive/colour follows the palette
function pal(m, key, mix, prop = null) {
  const p = prop || (m.isMeshStandardMaterial ? 'emissive' : 'color');
  const base = p === 'uniform:color' ? m.uniforms.color.value.clone() : m[p].clone();
  m.userData.pal = { key, mix, prop: p, base };
  PALMATS.push(m);
  return m;
}
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.85, metalness: o.m ?? 0, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    map: o.map || null, side: o.side ?? THREE.FrontSide, flatShading: !!o.flat, transparent: !!o.transparent,
    opacity: o.opacity ?? 1, vertexColors: !!o.vc, depthWrite: o.depthWrite ?? true,
  });
}
function glow(color, o = {}) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 1, blending: THREE.AdditiveBlending, depthWrite: false, side: o.side ?? THREE.FrontSide, fog: o.fog ?? true, map: o.map || null });
}
function mesh(geo, m, x = 0, y = 0, z = 0, parent = null) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); if (parent) parent.add(o); return o;
}
function box(w, h, d, m, x, y, z, parent) { return mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent); }
function M4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new V3(sx, sy, sz));
}
function mergeGeos(list) {
  const parts = list.map(([g, m]) => { const gg = g.index ? g.toNonIndexed() : g.clone(); if (m) gg.applyMatrix4(m); g.dispose(); return gg; });
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function lathe(points, seg = 24) { return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
function noise3(x, y, z, s) {
  return Math.sin(x * 1.7 + s) * Math.cos(y * 2.3 + s * 1.3) * 0.5 + Math.sin(z * 2.9 + x * 1.1 + s * 0.7) * 0.3 + Math.sin((x + y + z) * 4.1 + s * 2.1) * 0.2;
}
function blob(r, seed, amp = 0.25, detail = 3) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    v.multiplyScalar(1 + amp * noise3(n.x * 2, n.y * 2, n.z * 2, seed));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function taperTube(curve, tubular, radius, radial, fn) {
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const p = g.attributes.position, c = new V3(), v = new V3();
  for (let i = 0; i <= tubular; i++) {
    curve.getPointAt(i / tubular, c);
    const s = fn(i / tubular);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(s).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------- canvas textures
const TEXCACHE = {};
function canvasTex(name, w, h, draw) {
  if (TEXCACHE[name]) return TEXCACHE[name];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const r0 = R; R = seeded(name.length * 7919 + 13); draw(g, w, h); R = r0;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  TEXCACHE[name] = t; return t;
}
function tex(name, rx = 1, ry = 1) {
  const base = TEXTURES[name]();
  const t = base.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t;
}
function stains(g, w, h, n, a = 0.08) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rr(10, 60);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(30,20,10,${a})`); grd.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
const TEXTURES = {
  damask: () => canvasTex('damask', 256, 256, (g, w, h) => {
    g.fillStyle = '#9a958c'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = '#8c877e'; g.fillRect(x + 24, 0, 16, h); }
    g.fillStyle = '#aaa59a';
    for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) {
      const cx = x + 32 + ((y / 64) % 2) * 0, cy = y + 32;
      g.beginPath(); g.moveTo(cx, cy - 18); g.quadraticCurveTo(cx + 14, cy, cx, cy + 18); g.quadraticCurveTo(cx - 14, cy, cx, cy - 18); g.fill();
      g.beginPath(); g.arc(cx, cy - 24, 3, 0, TAU); g.arc(cx, cy + 24, 3, 0, TAU); g.fill();
    }
    stains(g, w, h, 14, 0.12);
  }),
  stripes: () => canvasTex('stripes', 256, 256, (g, w, h) => {
    const cols = ['#b9aa9c', '#a7b1a8', '#c2b6a0'];
    for (let x = 0, i = 0; x < w; x += 32, i++) { g.fillStyle = cols[i % 3]; g.fillRect(x, 0, 32, h); }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = 8; y < h; y += 32) for (let x = 16; x < w; x += 64) { g.beginPath(); g.arc(x, y, 2.5, 0, TAU); g.fill(); }
    stains(g, w, h, 18, 0.1);
  }),
  planks: () => canvasTex('planks', 256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 32) {
      let x = -rr(0, 120);
      while (x < w) {
        const len = rr(90, 200), l = rr(0.75, 1.05);
        g.fillStyle = `rgb(${120 * l | 0},${100 * l | 0},${80 * l | 0})`; g.fillRect(x, y, len, 32);
        g.strokeStyle = 'rgba(40,25,15,0.25)'; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) { const yy = y + rr(4, 28); g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len / 3, yy + rr(-3, 3), x + len * 0.6, yy + rr(-3, 3), x + len, yy); g.stroke(); }
        g.fillStyle = 'rgba(20,10,5,0.7)'; g.fillRect(x, y, 2, 32);
        x += len;
      }
      g.fillStyle = 'rgba(15,8,4,0.8)'; g.fillRect(0, y, w, 2);
    }
    stains(g, w, h, 10, 0.15);
  }),
  checker: () => canvasTex('checker', 256, 256, (g, w, h) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#1c1a18' : '#cfc7b6'; g.fillRect(x * 64, y * 64, 64, 64); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
    stains(g, w, h, 20, 0.12);
  }),
  tiles: () => canvasTex('tiles', 256, 256, (g, w, h) => {
    g.fillStyle = '#5c5a54'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const l = rr(0.9, 1); g.fillStyle = `rgb(${210 * l | 0},${208 * l | 0},${198 * l | 0})`; g.fillRect(x + 2, y + 2, 28, 28); }
    stains(g, w, h, 16, 0.18);
  }),
  stone: () => canvasTex('stone', 256, 256, (g, w, h) => {
    g.fillStyle = '#3a3632'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 28) {
      let x = -rr(0, 40);
      while (x < w) { const bw = rr(36, 70), l = rr(0.7, 1.1); g.fillStyle = `rgb(${110 * l | 0},${104 * l | 0},${96 * l | 0})`; g.fillRect(x + 3, y + 3, bw - 6, 22); x += bw; }
    }
    stains(g, w, h, 30, 0.2);
  }),
  clapboard: () => canvasTex('clapboard', 128, 128, (g, w, h) => {
    for (let y = 0; y < h; y += 16) { const l = rr(0.85, 1); g.fillStyle = `rgb(${92 * l | 0},${86 * l | 0},${80 * l | 0})`; g.fillRect(0, y, w, 16); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, y + 14, w, 2); }
    stains(g, w, h, 8, 0.2);
  }),
  glow: () => canvasTex('glow', 64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }),
  shaft: () => canvasTex('shaft', 32, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.3, 'rgba(0,0,0,0)'); side.addColorStop(0.7, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, w, h);
  }),
};

// A procedurally painted face for the portrait canvas.
function faceTexture(seed) {
  const r0 = R; R = seeded(seed);
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  let grd = g.createRadialGradient(128, 130, 20, 128, 160, 220);
  grd.addColorStop(0, '#4a3f2c'); grd.addColorStop(1, '#120e09');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 320);
  // shoulders and collar
  g.fillStyle = '#16120e'; g.beginPath(); g.ellipse(128, 330, 120, 95, 0, 0, TAU); g.fill();
  g.fillStyle = '#d8cfb8'; g.beginPath(); g.moveTo(108, 240); g.lineTo(128, 275); g.lineTo(148, 240); g.closePath(); g.fill();
  // neck
  g.fillStyle = '#a89878'; g.fillRect(112, 190, 32, 55);
  // hair back
  g.fillStyle = '#1a140e'; g.beginPath(); g.ellipse(128, 128, 66, 84, 0, 0, TAU); g.fill();
  // face oval with shading
  grd = g.createRadialGradient(118, 120, 8, 128, 135, 70);
  grd.addColorStop(0, '#e6dcc4'); grd.addColorStop(0.7, '#b9a888'); grd.addColorStop(1, '#6e6048');
  g.fillStyle = grd; g.beginPath(); g.ellipse(128, 138, 50, 66, 0, 0, TAU); g.fill();
  // hair parting
  g.fillStyle = '#1a140e'; g.beginPath(); g.moveTo(74, 120); g.quadraticCurveTo(100, 50, 128, 72); g.quadraticCurveTo(156, 50, 182, 120); g.quadraticCurveTo(160, 82, 128, 86); g.quadraticCurveTo(96, 82, 74, 120); g.fill();
  // eye sockets
  for (const ex of [108, 148]) {
    grd = g.createRadialGradient(ex, 130, 1, ex, 130, 16);
    grd.addColorStop(0, 'rgba(10,6,4,0.95)'); grd.addColorStop(1, 'rgba(60,40,30,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(ex, 130, 16, 10, 0, 0, TAU); g.fill();
    g.fillStyle = '#0a0604'; g.beginPath(); g.ellipse(ex, 131, 7, 4.5, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,250,235,0.9)'; g.fillRect(ex + 1, 129, 2, 2);
  }
  // nose, mouth
  g.strokeStyle = 'rgba(70,50,35,0.6)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(130, 136); g.quadraticCurveTo(136, 160, 126, 166); g.stroke();
  g.strokeStyle = 'rgba(60,25,20,0.85)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(112, 182); g.quadraticCurveTo(128, 186 + rr(-4, 2), 144, 182); g.stroke();
  // craquelure and varnish
  g.strokeStyle = 'rgba(20,14,8,0.35)'; g.lineWidth = 0.6;
  for (let i = 0; i < 90; i++) { let x = R() * 256, y = R() * 320; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rr(-14, 14); y += rr(-14, 14); g.lineTo(x, y); } g.stroke(); }
  grd = g.createRadialGradient(128, 160, 60, 128, 160, 200);
  grd.addColorStop(0, 'rgba(80,60,20,0)'); grd.addColorStop(1, 'rgba(10,8,4,0.7)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 320);
  R = r0;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ============================================================== prop builders
// Each builder returns { obj, lights: [{pos, kind, i}], update(t, dt, ctx) }.
const B = {};

B.candles = (o = {}) => {
  const group = new THREE.Group();
  const pts = o.points || [];
  const n = pts.length;
  const wax = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 1, 10).translate(0, 0.5, 0), mat(0xe8dcc0, { r: 0.6, e: 0x2a1a08 }), n);
  const flames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6), pal(glow(0xffc070), 'accent', 0.3), n);
  const heights = [], tops = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = pts[i]; const h = o.h ? o.h : rr(0.12, 0.34); heights.push(h);
    wax.setMatrixAt(i, M4(x, y, z, 0, 0, 0, 1, h, 1));
    tops.push(new V3(x, y + h + 0.045, z));
  }
  const gpos = new Float32Array(n * 3); tops.forEach((p, i) => p.toArray(gpos, i * 3));
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  const glowPts = new THREE.Points(gg, pal(new THREE.PointsMaterial({ color: 0xffa040, size: 0.55, map: TEXTURES.glow(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), 'accent', 0.3));
  group.add(wax, flames, glowPts);
  const seeds = tops.map(() => R() * 100);
  const c = tops.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / Math.max(1, n));
  return {
    obj: group,
    lights: n ? [{ pos: c.add(new V3(0, 0.15, 0)), kind: 'candle', i: Math.min(1.6, 0.6 + n * 0.08) }] : [],
    update(t, dt, ctx) {
      const amp = 0.08 + ctx.flicker * 0.5;
      for (let i = 0; i < n; i++) {
        const s = seeds[i], j = Math.sin(t * 13 + s) * 0.5 + Math.sin(t * 23.7 + s * 3) * 0.3 + (R() - 0.5) * 0.4 * ctx.flicker;
        const sc = 1 + j * amp;
        flames.setMatrixAt(i, M4(tops[i].x + Math.sin(t * 7 + s) * 0.004 * (1 + ctx.flicker * 3), tops[i].y, tops[i].z, 0, 0, 0, sc * 0.9, sc * 2.1, sc * 0.9));
      }
      flames.instanceMatrix.needsUpdate = true;
      glowPts.material.size = 0.5 + Math.sin(t * 9) * 0.03 * (1 + ctx.flicker * 4);
    },
  };
};

B.jackolantern = (o = {}) => {
  const group = new THREE.Group();
  const updates = [];
  const lights = [];
  for (const [x, y, z, s, ry] of o.items || [[0, 0, 0, 0.6, 0]]) {
    const p = new THREE.Group(); p.position.set(x, y, z); p.scale.setScalar(s); p.rotation.y = ry || 0; group.add(p);
    const g = new THREE.SphereGeometry(0.5, 40, 24); const a = g.attributes.position; const v = new V3();
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i); const th = Math.atan2(v.z, v.x);
      const f = 1 - 0.075 * Math.pow(Math.abs(Math.sin(th * 5)), 0.6);
      v.x *= f; v.z *= f; v.y *= 0.78; v.y -= 0.05 * (1 - Math.min(1, Math.hypot(v.x, v.z) / 0.5)) * Math.sign(v.y);
      a.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    mesh(g, mat(0xc85a14, { r: 0.65, e: 0x2a0800 }), 0, 0.39, 0, p);
    mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 6), mat(0x3a4a1a), 0.02, 0.8, 0, p).rotation.z = 0.25;
    // carved face, projected onto the shell
    const shapes = [];
    const tri = (cx, cy, w, h, up = true) => { const sh = new THREE.Shape(); sh.moveTo(cx - w / 2, cy - (up ? h / 2 : -h / 2)); sh.lineTo(cx + w / 2, cy - (up ? h / 2 : -h / 2)); sh.lineTo(cx, cy + (up ? h / 2 : -h / 2)); sh.closePath(); return sh; };
    shapes.push(tri(-0.16, 0.1, 0.13, 0.12), tri(0.16, 0.1, 0.13, 0.12), tri(0, -0.01, 0.07, 0.07));
    const mouth = new THREE.Shape();
    mouth.moveTo(-0.26, -0.08);
    const teeth = [[-0.18, -0.13], [-0.13, -0.09], [-0.08, -0.15], [-0.02, -0.11], [0.04, -0.16], [0.1, -0.1], [0.15, -0.15], [0.2, -0.11], [0.26, -0.08]];
    teeth.forEach(([tx, ty]) => mouth.lineTo(tx, ty));
    mouth.quadraticCurveTo(0.12, -0.3, 0, -0.29); mouth.quadraticCurveTo(-0.14, -0.29, -0.26, -0.08);
    shapes.push(mouth);
    const fg = new THREE.ShapeGeometry(shapes, 6); const fa = fg.attributes.position;
    for (let i = 0; i < fa.count; i++) { const fx = fa.getX(i), fy = fa.getY(i); const zz = Math.sqrt(Math.max(0, 0.235 - fx * fx - (fy / 0.78) * (fy / 0.78) * 1.0)); fa.setXYZ(i, fx, fy, zz + 0.012); }
    const faceMat = pal(new THREE.MeshBasicMaterial({ color: 0xffb040 }), 'accent', 0.35);
    mesh(fg, faceMat, 0, 0.39, 0, p);
    const halo = new THREE.Sprite(pal(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xff8a20, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 'accent', 0.35));
    halo.scale.setScalar(1.4); halo.position.set(0, 0.36, 0.55); p.add(halo);
    const seed = R() * 10;
    updates.push((t, ctx) => { const f = 0.85 + 0.15 * Math.sin(t * 11 + seed) * (0.5 + ctx.flicker) + 0.05 * Math.sin(t * 29 + seed); halo.material.opacity = 0.3 * f * (halo.material.userData._fadeV ?? 1); });
    lights.push({ pos: new V3(x, y + 0.4 * s, z + 0.4 * s), kind: 'lantern', i: 0.8 });
  }
  return { obj: group, lights, update(t, dt, ctx) { updates.forEach((u) => u(t, ctx)); } };
};

B.door = (o = {}) => {
  const g = new THREE.Group();
  const wood = mat(o.color ?? 0x2b1712, { r: 0.55 });
  const trim = mat(0x1a120e, { r: 0.7 });
  box(0.14, 2.4, 0.16, trim, -0.62, 1.2, 0, g); box(0.14, 2.4, 0.16, trim, 0.62, 1.2, 0, g); box(1.38, 0.2, 0.18, trim, 0, 2.45, 0, g);
  const leak = pal(glow(0xffa050, { opacity: 0.8 }), 'accent', 0.5);
  if (o.ajar) mesh(new THREE.PlaneGeometry(0.05, 2.2), leak, 0.53, 1.12, -0.03, g);
  const hinge = new THREE.Group(); hinge.position.set(-0.55, 0, 0); g.add(hinge); hinge.rotation.y = o.ajar ? -0.28 : 0;
  const slab = new THREE.Group(); slab.position.x = 0.55; hinge.add(slab);
  box(1.08, 2.25, 0.07, wood, 0, 1.13, 0, slab);
  const panelM = mat(0x22120e, { r: 0.6 });
  for (const [px, py, ph] of [[-0.24, 1.75, 0.6], [0.24, 1.75, 0.6], [-0.24, 0.95, 0.75], [0.24, 0.95, 0.75], [-0.24, 0.35, 0.3], [0.24, 0.35, 0.3]]) box(0.36, ph, 0.03, panelM, px, py, 0.045, slab);
  mesh(new THREE.SphereGeometry(0.04, 12, 8), mat(0x8a6a2a, { r: 0.3, m: 0.9 }), 0.42, 1.05, 0.08, slab);
  if (o.knocker) { const k = mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 24), mat(0x6a5020, { r: 0.35, m: 0.9 }), 0, 1.55, 0.09, slab); }
  return { obj: g, lights: o.ajar ? [{ pos: new V3(0.4, 1.2, -0.4), kind: 'cold', i: 0.4 }] : [] };
};

B.fireplace = () => {
  const g = new THREE.Group();
  const stone = mat(0x5a544c, { r: 0.9, map: tex('stone', 1, 1) });
  box(0.45, 1.5, 0.6, stone, -1.15, 0.75, 0, g); box(0.45, 1.5, 0.6, stone, 1.15, 0.75, 0, g);
  box(2.75, 0.35, 0.62, stone, 0, 1.65, 0, g);
  box(3.0, 0.08, 0.75, mat(0x2a1a12, { r: 0.6 }), 0, 1.86, 0.02, g);
  box(2.6, 0.08, 0.9, stone, 0, 0.04, 0.2, g);
  box(1.85, 1.5, 0.05, mat(0x050302, { r: 1 }), 0, 0.75, -0.28, g);
  box(0.05, 1.5, 0.6, mat(0x0a0604), -0.9, 0.75, 0, g); box(0.05, 1.5, 0.6, mat(0x0a0604), 0.9, 0.75, 0, g);
  const logM = mat(0x2a1a10, { r: 0.95, e: 0x401000 });
  for (let i = 0; i < 3; i++) { const l = mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 8), logM, rr(-0.15, 0.15), 0.14 + i * 0.06, rr(-0.1, 0.05), g); l.rotation.z = Math.PI / 2; l.rotation.y = rr(-0.4, 0.4); }
  const flames = [];
  for (let i = 0; i < 7; i++) {
    const m = pal(glow(i % 2 ? 0xff7a20 : 0xffb050, { opacity: 0.75 }), 'accent', 0.35);
    const f = mesh(new THREE.ConeGeometry(rr(0.09, 0.16), rr(0.35, 0.65), 8, 1, true).translate(0, 0.3, 0), m, rr(-0.4, 0.4), 0.2, rr(-0.15, 0.08), g);
    flames.push({ f, s: R() * 10, h: f.scale.y });
  }
  const halo = new THREE.Sprite(pal(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xff7020, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), 'accent', 0.35));
  halo.scale.set(2.6, 1.8, 1); halo.position.set(0, 0.55, 0.2); g.add(halo);
  return {
    obj: g, lights: [{ pos: new V3(0, 0.6, 0.6), kind: 'fire', i: 1.6 }],
    update(t, dt, ctx) {
      for (const { f, s } of flames) { const k = 0.75 + 0.35 * Math.sin(t * (6 + s) + s) + 0.15 * Math.sin(t * 17 + s * 3) + (R() - 0.5) * 0.3 * ctx.flicker; f.scale.set(1, Math.max(0.2, k), 1); f.rotation.y = t * 0.6 + s; }
      halo.material.opacity = (0.42 + 0.08 * Math.sin(t * 9)) * (halo.material.userData._fadeV ?? 1);
    },
  };
};

B.portrait = (o = {}) => {
  const g = new THREE.Group();
  const frameM = mat(0x5e4a22, { r: 0.4, m: 0.75 });
  const W = 0.9, H = 1.12, t = 0.1;
  box(W + 2 * t, t, 0.08, frameM, 0, H / 2 + t / 2, 0, g); box(W + 2 * t, t, 0.08, frameM, 0, -H / 2 - t / 2, 0, g);
  box(t, H, 0.08, frameM, -W / 2 - t / 2, 0, 0, g); box(t, H, 0.08, frameM, W / 2 + t / 2, 0, 0, g);
  mesh(new THREE.PlaneGeometry(W, H), mat(0xffffff, { r: 0.55, map: faceTexture(o.seed ?? 7) }), 0, 0, 0.01, g);
  const glints = [];
  for (const ex of [-0.077, 0.077]) {
    const gm = pal(glow(0xffffff, { opacity: 0 }), 'hi', 0.6);
    glints.push(mesh(new THREE.CircleGeometry(0.012, 10), gm, ex * (W / 0.9) * 0.98, 0.065, 0.015, g));
  }
  const seed = R() * 50;
  return {
    obj: g, lights: [],
    update(t2) { const k = Math.max(0, Math.sin(t2 * 0.35 + seed) - 0.92) * 12; glints.forEach((m) => { m.material.userData.dyn = k; m.material.opacity = k * (m.material.userData._fadeV ?? 1); }); },
  };
};

B.clock = () => {
  const g = new THREE.Group();
  const wood = mat(0x3a2414, { r: 0.45 });
  box(0.7, 0.18, 0.45, wood, 0, 0.09, 0, g);
  box(0.56, 1.45, 0.36, wood, 0, 0.9, 0, g);
  box(0.68, 0.72, 0.44, wood, 0, 1.98, 0, g);
  const ped = mesh(new THREE.CylinderGeometry(0.0, 0.42, 0.22, 4, 1).rotateY(Math.PI / 4), wood, 0, 2.45, 0, g); ped.scale.set(1, 1, 0.55);
  mesh(new THREE.CircleGeometry(0.24, 32), mat(0xe2d8bc, { r: 0.5, e: 0x1a1508 }), 0, 2.0, 0.225, g);
  const tickM = mat(0x1a1410);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const tk = box(0.012, 0.04, 0.005, tickM, Math.sin(a) * 0.2, 2.0 + Math.cos(a) * 0.2, 0.228, g); tk.rotation.z = -a; }
  const handM = mat(0x0c0806, { r: 0.4, m: 0.5 });
  const hour = new THREE.Group(); hour.position.set(0, 2.0, 0.232); g.add(hour); box(0.02, 0.12, 0.005, handM, 0, 0.05, 0, hour);
  const minute = new THREE.Group(); minute.position.set(0, 2.0, 0.236); g.add(minute); box(0.012, 0.19, 0.005, handM, 0, 0.085, 0, minute);
  mesh(new THREE.PlaneGeometry(0.34, 0.9), mat(0x080605, { r: 0.1, m: 0.3 }), 0, 0.95, 0.182, g);
  const pend = new THREE.Group(); pend.position.set(0, 1.35, 0.15); g.add(pend);
  box(0.012, 0.6, 0.01, mat(0x8a6a2a, { m: 0.9, r: 0.3 }), 0, -0.3, 0, pend);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 20).rotateX(Math.PI / 2), mat(0xb08a3a, { m: 0.9, r: 0.25 }), 0, -0.62, 0, pend);
  return {
    obj: g, lights: [],
    update(t) {
      const mins = 47 + t / 8; // creeping toward midnight
      minute.rotation.z = -(mins / 60) * TAU;
      hour.rotation.z = -((11 + mins / 60) / 12) * TAU;
      pend.rotation.z = Math.sin(t * Math.PI) * 0.12;
    },
  };
};

B.table = (o = {}) => {
  const g = new THREE.Group();
  const wood = mat(0x2e1c12, { r: 0.5 });
  const L = o.len ?? 3.6;
  box(L, 0.08, 1.1, wood, 0, 0.78, 0, g);
  box(L * 0.92, 0.01, 0.5, mat(0x9a8f7a, { r: 0.9 }), 0, 0.825, 0, g);
  const legG = lathe([[0, 0], [0.06, 0], [0.05, 0.1], [0.035, 0.25], [0.06, 0.4], [0.035, 0.55], [0.045, 0.74], [0, 0.74]], 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(legG, wood, sx * (L / 2 - 0.15), 0, sz * 0.42, g);
  const chairM = mat(0x24150d, { r: 0.55 });
  const nch = Math.max(2, Math.round(L / 1.2));
  for (let i = 0; i < nch; i++) for (const side of [-1, 1]) {
    if (o.chairs === false) break;
    const c = new THREE.Group(); c.position.set(-L / 2 + (i + 0.5) * (L / nch), 0, side * 0.85); c.rotation.y = side > 0 ? 0 : Math.PI; c.rotation.y += rr(-0.15, 0.15); g.add(c);
    box(0.45, 0.05, 0.45, chairM, 0, 0.47, 0, c);
    for (const lx of [-0.19, 0.19]) for (const lz of [-0.19, 0.19]) box(0.04, 0.47, 0.04, chairM, lx, 0.235, lz, c);
    box(0.45, 0.85, 0.04, chairM, 0, 0.92, 0.21, c);
    const top = mesh(new THREE.ConeGeometry(0.06, 0.18, 4), chairM, 0, 1.43, 0.21, c);
  }
  return { obj: g, lights: [] };
};

B.feast = (o = {}) => {
  const g = new THREE.Group();
  const L = o.len ?? 3.6, y0 = 0.83;
  const plateM = mat(0xb8b0a0, { r: 0.35, m: 0.3 });
  const colors = [0x6b2a1c, 0x8a7a5a, 0x3d4a22, 0x5a1f3a, 0xa89c80, 0x2a1a12, 0x7a3a10, 0x4a0a14];
  const n = Math.round(L * 4);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.25 + (i / (n - 1)) * (L - 0.5) + rr(-0.08, 0.08), z = rr(-0.3, 0.3);
    if (R() < 0.6) mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.025, 20), plateM, x, y0 + 0.012, z, g);
    const r = rr(0.06, 0.15);
    const b = mesh(blob(r, R() * 40, rr(0.15, 0.4), 2), mat(pick(colors), { r: rr(0.25, 0.6) }), x, y0 + 0.03 + r * 0.6, z, g);
    b.scale.y = rr(0.5, 0.9);
  }
  // the centrepiece: something roasted, with bones
  const roast = mesh(blob(0.28, 3.3, 0.18, 3), mat(0x5a2210, { r: 0.35, e: 0x100200 }), 0, y0 + 0.2, 0, g); roast.scale.set(1.4, 0.7, 0.9);
  mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.03, 24), plateM, 0, y0 + 0.015, 0, g);
  const boneM = mat(0xddd2b6, { r: 0.6 });
  for (const s of [-1, 1]) { const bn = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.35, 8), boneM, s * 0.32, y0 + 0.3, 0.02, g); bn.rotation.z = s * 1.0; mesh(new THREE.SphereGeometry(0.04, 8, 6), boneM, s * 0.47, y0 + 0.4, 0.02, g); }
  const gob = lathe([[0, 0], [0.05, 0], [0.012, 0.02], [0.01, 0.1], [0.045, 0.14], [0.05, 0.22], [0.045, 0.22], [0.0, 0.15]], 16);
  const gobM = mat(0x7a6a3a, { r: 0.3, m: 0.85 });
  for (let i = 0; i < 6; i++) mesh(gob, gobM, -L / 2 + 0.4 + i * (L - 0.8) / 5, y0, (i % 2 ? 0.4 : -0.4), g);
  const cand = B.candles({ points: [[-L / 3, y0, 0.05], [0, y0, 0.32], [L / 3, y0, -0.05]], h: 0.3 });
  g.add(cand.obj);
  return { obj: g, lights: cand.lights, update: cand.update };
};

B.chandelier = (o = {}) => {
  const g = new THREE.Group();
  const drop = o.drop ?? 1.6;
  const iron = mat(0x1c1814, { r: 0.4, m: 0.8 });
  mesh(new THREE.CylinderGeometry(0.015, 0.015, drop, 6), iron, 0, -drop / 2, 0, g);
  const rig = new THREE.Group(); rig.position.y = -drop; g.add(rig);
  const rings = [[0.95, 0], [0.62, 0.32], [0.32, 0.6]];
  const pts = [];
  for (const [r, y] of rings) {
    const tor = mesh(new THREE.TorusGeometry(r, 0.025, 8, 64), iron, 0, y, 0, rig); tor.rotation.x = Math.PI / 2;
    const k = Math.round(r * 12);
    for (let i = 0; i < k; i++) { const a = (i / k) * TAU; pts.push([Math.cos(a) * r, y + 0.02, Math.sin(a) * r]); }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4; const A = new V3(Math.cos(a) * r, y, Math.sin(a) * r), Bp = new V3(0, 0.9, 0); const dv = Bp.clone().sub(A);
      const sp = mesh(new THREE.CylinderGeometry(0.008, 0.008, dv.length(), 4), iron, 0, 0, 0, rig); sp.position.copy(A).addScaledVector(dv, 0.5); sp.quaternion.setFromUnitVectors(new V3(0, 1, 0), dv.normalize());
    }
  }
  mesh(new THREE.SphereGeometry(0.09, 12, 8), iron, 0, 0.9, 0, rig);
  const cr = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.035), pal(mat(0xdfe8ff, { r: 0.05, m: 0.2, e: 0x222233 }), 'hi', 0.4), 24);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; cr.setMatrixAt(i, M4(Math.cos(a) * 0.95, -0.12, Math.sin(a) * 0.95, 0, a, 0, 1, 1.8, 1)); }
  rig.add(cr);
  const cand = B.candles({ points: pts, h: 0.12 });
  rig.add(cand.obj);
  const seed = R() * 10;
  return {
    obj: g, lights: [{ pos: new V3(0, -drop + 0.3, 0), kind: 'candle', i: 1.8 }],
    update(t, dt, ctx) { g.rotation.z = Math.sin(t * 0.4 + seed) * 0.015 * (1 + ctx.flicker); g.rotation.x = Math.cos(t * 0.33) * 0.012; cand.update(t, dt, ctx); },
  };
};

B.vines = (o = {}) => {
  const g = new THREE.Group();
  const W = o.w ?? 6, H = o.h ?? 4, n = o.n ?? 10;
  const stem = mat(0x26301a, { r: 0.8 });
  const leafG = new THREE.SphereGeometry(0.06, 6, 4).scale(1, 0.45, 0.12);
  const leafM = pal(mat(0x2f3f1c, { r: 0.7, side: THREE.DoubleSide }), 'accent', 0.08);
  const leaves = new THREE.InstancedMesh(leafG, leafM, n * 14);
  let li = 0;
  for (let i = 0; i < n; i++) {
    const pts = []; let x = rr(0, W), y = -0.1;
    const steps = Math.floor(rr(6, 11));
    for (let k = 0; k < steps; k++) { pts.push(new V3(x, y, rr(0.02, 0.12))); x += rr(-0.6, 0.6); y += rr(0.25, H / steps * 1.3); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r = rr(0.02, 0.045);
    g.add(new THREE.Mesh(taperTube(curve, 64, r, 5, (u) => 1 - u * 0.85), stem));
    for (let k = 0; k < 14 && li < leaves.count; k++) {
      const p = curve.getPointAt(rr(0.05, 1));
      leaves.setMatrixAt(li++, M4(p.x + rr(-0.05, 0.05), p.y, p.z + 0.03, rr(-1, 1), rr(-1, 1), rr(0, TAU), rr(0.7, 1.5), rr(0.7, 1.5), 1));
    }
  }
  leaves.count = li; g.add(leaves);
  return { obj: g, lights: [] };
};

B.moon = (o = {}) => {
  const g = new THREE.Group();
  const r = o.r ?? 3;
  const sg = new THREE.SphereGeometry(r, 32, 20);
  const col = new Float32Array(sg.attributes.position.count * 3); const v = new V3();
  for (let i = 0; i < sg.attributes.position.count; i++) {
    v.fromBufferAttribute(sg.attributes.position, i).normalize();
    const c = 0.82 + 0.18 * noise3(v.x * 3, v.y * 3, v.z * 3, 2) - 0.12 * Math.max(0, noise3(v.x * 7, v.y * 7, v.z * 7, 5));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mm = pal(new THREE.MeshBasicMaterial({ color: 0xf2ecd8, vertexColors: true, fog: false }), 'hi', 0.3);
  mesh(sg, mm, 0, 0, 0, g);
  const halo = new THREE.Sprite(pal(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xd8e0ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 'hi', 0.5));
  halo.scale.setScalar(r * (o.halo ?? 9)); g.add(halo);
  return { obj: g, lights: [], moon: true };
};

B.window = (o = {}) => {
  const g = new THREE.Group();
  const W = o.w ?? 1.2, H = o.h ?? 1.8;
  const frame = mat(0x1e1712, { r: 0.6 });
  box(W + 0.16, 0.1, 0.14, frame, 0, H / 2 + 0.05, 0, g); box(W + 0.3, 0.08, 0.24, frame, 0, -H / 2 - 0.04, 0.05, g);
  box(0.1, H, 0.14, frame, -W / 2 - 0.03, 0, 0, g); box(0.1, H, 0.14, frame, W / 2 + 0.03, 0, 0, g);
  box(0.05, H, 0.08, frame, 0, 0, 0.02, g); box(W, 0.05, 0.08, frame, 0, H * 0.12, 0.02, g); box(W, 0.04, 0.08, frame, 0, H * 0.38, 0.02, g); box(W, 0.04, 0.08, frame, 0, -H * 0.18, 0.02, g);
  const glass = pal(mat(0x05070a, { r: 0.08, m: 0.4, e: 0x223040 }), 'hi', 0.22);
  mesh(new THREE.PlaneGeometry(W, H), glass, 0, 0, 0.01, g);
  const shaftM = pal(new THREE.MeshBasicMaterial({ color: 0xaab8d0, map: TEXTURES.shaft(), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 'hi', 0.6);
  for (const a of [0, Math.PI / 2]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 4.5).translate(0, -2.25, 0), shaftM);
    sh.position.set(0, H / 2 - 0.1, 0.1); sh.rotation.set(-1.0, a, 0, 'YXZ'); g.add(sh);
  }
  return { obj: g, lights: [{ pos: new V3(0, 0, 1.0), kind: 'cold', i: 0.7 }], windowRect: { W, H } };
};

B.rain = (o = {}) => {
  const n = o.n ?? 1000; const W = o.w ?? 30, H = o.h ?? 20, D = o.d ?? 30;
  const pos = new Float32Array(n * 6), end = new Float32Array(n * 2), spd = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = rr(-W / 2, W / 2), y = rr(0, H), z = rr(-D / 2, D / 2), s = rr(0.8, 1.2) * (o.speed ?? 14);
    pos.set([x, y, z, x, y, z], i * 6); end.set([0, 1], i * 2); spd.set([s, s], i * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, h: { value: H }, len: { value: o.len ?? 0.5 }, color: { value: new THREE.Color(0x9fb0c8) }, opacity: { value: o.opacity ?? 0.35 } },
    vertexShader: `uniform float time,h,len; attribute float aEnd; attribute float aSpeed; varying float vA;
      void main(){ vec3 p=position; p.y=mod(p.y-time*aSpeed,h); p.y+=aEnd*len; p.x-=aEnd*len*0.12; vA=1.0-aEnd;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor=vec4(color, opacity*(0.25+0.75*vA)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  pal(m, 'hi', 0.3, 'uniform:color');
  const lines = new THREE.LineSegments(geo, m); lines.frustumCulled = false;
  return { obj: lines, lights: [], rain: true, update(t) { m.uniforms.time.value = t; } };
};

const MirrorShader = {
  name: 'MarrowMirror',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, opacity: { value: 1 }, time: { value: 0 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vPos;
    void main(){ vUv=textureMatrix*vec4(position,1.0); vPos=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float opacity, time; varying vec4 vUv; varying vec2 vPos;
    float h(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5); }
    void main(){
      vec4 uv=vUv; uv.x+=sin(vPos.y*9.0+time*0.6)*0.004*uv.w;
      vec3 c=texture2DProj(tDiffuse,uv).rgb*color;
      float spots=smoothstep(0.55,0.95,h(floor(vPos*38.0)))*0.35;
      float edge=smoothstep(0.35,0.8,length(vPos*vec2(1.2,0.75)));
      c*=1.0-spots-edge*0.5;
      gl_FragColor=vec4(c, opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

B.mirror = (o = {}) => {
  const g = new THREE.Group();
  const W = 1.5, H = 2.3;
  const outer = new THREE.Shape(); outer.moveTo(-W / 2 - 0.15, -0.15); outer.lineTo(W / 2 + 0.15, -0.15); outer.lineTo(W / 2 + 0.15, H - W / 2); outer.absarc(0, H - W / 2, W / 2 + 0.15, 0, Math.PI, false); outer.lineTo(-W / 2 - 0.15, -0.15);
  const inner = new THREE.Path(); inner.moveTo(-W / 2, 0); inner.lineTo(-W / 2, H - W / 2); inner.absarc(0, H - W / 2, W / 2, Math.PI, 0, true); inner.lineTo(W / 2, 0); inner.lineTo(-W / 2, 0);
  outer.holes.push(inner);
  const fg = new THREE.ExtrudeGeometry(outer, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 24 });
  mesh(fg, mat(0x5a4624, { r: 0.35, m: 0.8 }), 0, 0, 0, g);
  const glassShape = new THREE.Shape(); glassShape.moveTo(-W / 2, 0); glassShape.lineTo(W / 2, 0); glassShape.lineTo(W / 2, H - W / 2); glassShape.absarc(0, H - W / 2, W / 2, 0, Math.PI, false); glassShape.lineTo(-W / 2, 0);
  const size = o.small ? 256 : 512;
  const refl = new Reflector(new THREE.ShapeGeometry(glassShape, 24), { color: 0xd0d2da, textureWidth: size, textureHeight: size * 1.5, clipBias: 0.003, shader: MirrorShader, multisample: o.small ? 0 : 4 });
  refl.material.transparent = true;
  refl.position.z = 0.05; g.add(refl);
  refl.camera.layers.enable(REFLECT_LAYER); // the reflection figure lives only in the glass
  return { obj: g, lights: [], update(t) { refl.material.uniforms.time.value = t; } };
};

B.crib = () => {
  const g = new THREE.Group();
  const wood = mat(0xbfae90, { r: 0.6 });
  const L = 1.25, Wd = 0.68, H = 1.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { mesh(new THREE.CylinderGeometry(0.03, 0.03, H + 0.1, 8), wood, sx * L / 2, (H + 0.1) / 2, sz * Wd / 2, g); mesh(new THREE.SphereGeometry(0.045, 10, 8), wood, sx * L / 2, H + 0.13, sz * Wd / 2, g); }
  for (const y of [0.32, H]) { box(L, 0.04, 0.04, wood, 0, y, -Wd / 2, g); box(L, 0.04, 0.04, wood, 0, y, Wd / 2, g); box(0.04, 0.04, Wd, wood, -L / 2, y, 0, g); box(0.04, 0.04, Wd, wood, L / 2, y, 0, g); }
  const slats = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, H - 0.32, 6), wood, 40); let si = 0;
  for (let i = 1; i < 12; i++) { const x = -L / 2 + (i / 12) * L; slats.setMatrixAt(si++, M4(x, (H + 0.32) / 2, -Wd / 2)); slats.setMatrixAt(si++, M4(x, (H + 0.32) / 2, Wd / 2)); }
  for (let i = 1; i < 6; i++) { const z = -Wd / 2 + (i / 6) * Wd; slats.setMatrixAt(si++, M4(-L / 2, (H + 0.32) / 2, z)); slats.setMatrixAt(si++, M4(L / 2, (H + 0.32) / 2, z)); }
  slats.count = si; g.add(slats);
  box(L - 0.06, 0.1, Wd - 0.06, mat(0xd8d0c4, { r: 0.95 }), 0, 0.38, 0, g);
  const blanket = mesh(blob(0.3, 9, 0.2, 3), mat(0x9fa8b8, { r: 0.95 }), 0.15, 0.47, 0, g); blanket.scale.set(1.3, 0.25, 0.9);
  // the mobile
  const arm = new THREE.Group(); arm.position.set(L / 2, H + 0.1, 0); g.add(arm);
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), wood, 0, 0.3, 0, arm);
  box(0.5, 0.02, 0.02, wood, -0.25, 0.6, 0, arm);
  const mob = new THREE.Group(); mob.position.set(-0.5, 0.55, 0); arm.add(mob);
  const tor = mesh(new THREE.TorusGeometry(0.22, 0.008, 6, 32), wood, 0, 0, 0, mob); tor.rotation.x = Math.PI / 2;
  const star = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, r = i % 2 ? 0.025 : 0.06; i ? star.lineTo(Math.sin(a) * r, Math.cos(a) * r) : star.moveTo(0, r); }
  const starG = new THREE.ExtrudeGeometry(star, { depth: 0.01, bevelEnabled: false });
  const toyM = pal(mat(0xe8d8a0, { r: 0.5, e: 0x221a08 }), 'hi', 0.15);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.18, 3), wood, Math.cos(a) * 0.22, -0.09, Math.sin(a) * 0.22, mob);
    const s = mesh(i % 2 ? starG : new THREE.TorusGeometry(0.045, 0.014, 6, 16, Math.PI * 1.3), toyM, Math.cos(a) * 0.22, -0.22, Math.sin(a) * 0.22, mob);
  }
  return { obj: g, lights: [], update(t) { mob.rotation.y = t * 0.25; } };
};

B.trunk = () => {
  const g = new THREE.Group();
  const wood = mat(0x3a2414, { r: 0.6 }); const band = mat(0x2a2a2a, { r: 0.4, m: 0.8 });
  const L = 1.1, Wd = 0.6, H = 0.55;
  box(L, H, Wd, wood, 0, H / 2, 0, g);
  for (const x of [-0.35, 0.35]) box(0.06, H + 0.01, Wd + 0.02, band, x, H / 2, 0, g);
  const hinge = new THREE.Group(); hinge.position.set(0, H, -Wd / 2); g.add(hinge); hinge.rotation.x = -0.22;
  const lid = mesh(new THREE.CylinderGeometry(Wd / 2, Wd / 2, L, 20, 1, false, 0, Math.PI), wood, 0, 0, Wd / 2, hinge); lid.rotation.set(0, 0, Math.PI / 2);
  for (const x of [-0.35, 0.35]) { const b = mesh(new THREE.CylinderGeometry(Wd / 2 + 0.01, Wd / 2 + 0.01, 0.06, 20, 1, false, 0, Math.PI), band, x, 0, Wd / 2, hinge); b.rotation.set(0, 0, Math.PI / 2); }
  box(0.1, 0.12, 0.03, mat(0x8a6a2a, { m: 0.9, r: 0.3 }), 0, H - 0.08, Wd / 2 + 0.015, g);
  const seam = pal(glow(0xffb060, { opacity: 0.9 }), 'accent', 0.6);
  const s = mesh(new THREE.PlaneGeometry(L * 0.9, 0.06), seam, 0, H + 0.03, Wd / 2 - 0.02, g); s.rotation.x = -0.6;
  const halo = new THREE.Sprite(pal(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xffa040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), 'accent', 0.6));
  halo.scale.set(1.6, 0.5, 1); halo.position.set(0, H + 0.08, 0.1); g.add(halo);
  return { obj: g, lights: [{ pos: new V3(0, H + 0.3, 0.2), kind: 'pulse', i: 0.35 }], update(t) { halo.material.opacity = (0.25 + 0.12 * Math.sin(t * 1.3)) * (halo.material.userData._fadeV ?? 1); } };
};

B.bones = (o = {}) => {
  const g = new THREE.Group();
  const boneM = mat(0xd6ccb0, { r: 0.6 });
  const boneG = mergeGeos([
    [new THREE.CylinderGeometry(0.022, 0.02, 0.42, 8), M4(0, 0, 0)],
    [new THREE.SphereGeometry(0.035, 8, 6), M4(0.022, 0.21, 0)], [new THREE.SphereGeometry(0.035, 8, 6), M4(-0.022, 0.21, 0)],
    [new THREE.SphereGeometry(0.033, 8, 6), M4(0.02, -0.21, 0)], [new THREE.SphereGeometry(0.033, 8, 6), M4(-0.02, -0.21, 0)],
  ]);
  const n = o.n ?? 22, rad = o.r ?? 1.8;
  const bones = new THREE.InstancedMesh(boneG, boneM, n);
  for (let i = 0; i < n; i++) { const a = R() * TAU, d = Math.sqrt(R()) * rad; bones.setMatrixAt(i, M4(Math.cos(a) * d, 0.035, Math.sin(a) * d, Math.PI / 2, 0, rr(0, TAU), rr(0.7, 1.3), rr(0.7, 1.3), rr(0.7, 1.3))); }
  g.add(bones);
  const dark = mat(0x0a0806, { r: 1 });
  for (let i = 0; i < (o.skulls ?? 2); i++) {
    const s = new THREE.Group(); const a = R() * TAU, d = rr(0.3, rad * 0.8); s.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d); s.rotation.set(rr(-0.3, 0.3), rr(-1, 1), rr(-0.3, 0.3)); g.add(s);
    mesh(new THREE.SphereGeometry(0.11, 16, 12), boneM, 0, 0.03, -0.01, s).scale.set(1, 0.95, 1.15);
    box(0.13, 0.05, 0.1, boneM, 0, -0.07, 0.04, s);
    for (const ex of [-0.04, 0.04]) mesh(new THREE.SphereGeometry(0.03, 8, 6), dark, ex, 0.02, 0.1, s);
    mesh(new THREE.ConeGeometry(0.015, 0.03, 3), dark, 0, -0.02, 0.115, s).rotation.x = Math.PI;
  }
  return { obj: g, lights: [] };
};

B.roots = (o = {}) => {
  const g = new THREE.Group();
  const W = o.w ?? 8, H = o.h ?? 3.5, D = o.d ?? 8, n = o.n ?? 16;
  const m = pal(mat(0x2a1c12, { r: 0.85, e: 0x000000 }), 'accent', 0.06);
  const tendrils = [];
  for (let i = 0; i < n; i++) {
    const side = R();
    let p = side < 0.6 ? new V3(rr(-W / 2, W / 2), H, rr(-D / 2, D / 4)) : new V3(R() < 0.5 ? -W / 2 + 0.1 : W / 2 - 0.1, rr(H * 0.4, H), rr(-D / 2, D / 4));
    const pts = [p.clone()];
    const steps = 6 + Math.floor(R() * 5);
    for (let k = 0; k < steps; k++) { p = p.clone().add(new V3(rr(-0.6, 0.6) - p.x * 0.05, -rr(0.2, H / steps * 1.4), rr(-0.6, 0.6))); if (p.y < 0.05) { p.y = 0.05; } pts.push(p); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r = rr(0.04, 0.16);
    const t = new THREE.Mesh(taperTube(curve, 48, r, 6, (u) => 1 - u * 0.92), m);
    const pivot = new THREE.Group(); pivot.position.copy(pts[0]); t.position.copy(pts[0]).negate(); pivot.add(t); g.add(pivot);
    tendrils.push({ pivot, s: R() * 10 });
  }
  return { obj: g, lights: [], update(t) { for (const { pivot, s } of tendrils) { pivot.rotation.z = Math.sin(t * 0.3 + s) * 0.025; pivot.rotation.x = Math.cos(t * 0.23 + s) * 0.02; } } };
};

// ======================================================= architecture builders
function shell(room, o = {}) {
  const { w, h, d } = room;
  const wall = mat(o.wall ?? 0x6a6058, { map: o.wallTex ? tex(o.wallTex, Math.max(1, w / 2.2), Math.max(1, h / 2.2)) : null, side: THREE.BackSide, r: 0.9 });
  const floor = mat(o.floor ?? 0x5a4636, { map: o.floorTex ? tex(o.floorTex, w / (o.floorScale ?? 2.5), d / (o.floorScale ?? 2.5)) : null, side: THREE.BackSide, r: o.floorR ?? 0.75 });
  const ceil = mat(o.ceil ?? 0x24201c, { side: THREE.BackSide });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [wall, wall, ceil, floor, wall, wall]);
  m.position.y = h / 2;
  return m;
}
function wainscot(room, g, color = 0x2a1a12, height = 1.0) {
  const { w, d } = room; const m = mat(color, { r: 0.6 });
  box(w - 0.02, height, 0.05, m, 0, height / 2, -d / 2 + 0.03, g);
  box(0.05, height, d - 0.02, m, -w / 2 + 0.03, height / 2, 0, g);
  box(0.05, height, d - 0.02, m, w / 2 - 0.03, height / 2, 0, g);
  const rail = mat(0x1a100a, { r: 0.5 });
  box(w, 0.06, 0.09, rail, 0, height, -d / 2 + 0.05, g); box(0.09, 0.06, d, rail, -w / 2 + 0.05, height, 0, g); box(0.09, 0.06, d, rail, w / 2 - 0.05, height, 0, g);
}
function staircase(g, { x0, z0, steps, rise, run, width, dir = -1, axis = 'z', m, rail = true }) {
  const railM = mat(0x1e120c, { r: 0.45 });
  const bal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.025, 0.85, 6), railM, steps);
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * rise;
    const off = dir * i * run;
    const px = axis === 'z' ? x0 : x0 + off, pz = axis === 'z' ? z0 + off : z0;
    box(axis === 'z' ? width : run, y, axis === 'z' ? run : width, m, px, y / 2, pz, g);
    const bx = axis === 'z' ? px + width / 2 - 0.08 : px, bz = axis === 'z' ? pz : pz + width / 2 - 0.08;
    bal.setMatrixAt(i, M4(bx, y + 0.43, bz));
  }
  g.add(bal);
  if (rail) {
    const a = axis === 'z' ? new V3(x0 + width / 2 - 0.08, rise + 0.88, z0) : new V3(x0, rise + 0.88, z0 + width / 2 - 0.08);
    const b = axis === 'z' ? new V3(x0 + width / 2 - 0.08, steps * rise + 0.88, z0 + dir * (steps - 1) * run) : new V3(x0 + dir * (steps - 1) * run, steps * rise + 0.88, z0 + width / 2 - 0.08);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 4, 0.035, 6), railM));
  }
}
function tree(g, x, z, s, seed) {
  const r0 = R; R = seeded(seed);
  const parts = [];
  const grow = (pos, dir, len, rad, depth) => {
    const end = pos.clone().add(dir.clone().multiplyScalar(len));
    const mid = pos.clone().add(end).multiplyScalar(0.5);
    const cyl = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize());
    parts.push([cyl, new THREE.Matrix4().compose(mid, q, new V3(1, 1, 1))]);
    if (depth <= 0) return;
    const k = depth > 3 ? 2 : 3;
    for (let i = 0; i < k; i++) {
      const nd = dir.clone().add(new V3(rr(-0.9, 0.9), rr(-0.1, 0.5), rr(-0.9, 0.9))).normalize();
      grow(end, nd, len * rr(0.6, 0.8), rad * 0.62, depth - 1);
    }
  };
  grow(new V3(0, 0, 0), new V3(rr(-0.15, 0.15), 1, rr(-0.15, 0.15)).normalize(), 2.6, 0.32, 5);
  R = r0;
  const t = new THREE.Mesh(mergeGeos(parts), mat(0x14110e, { r: 0.95 }));
  t.position.set(x, 0, z); t.scale.setScalar(s); g.add(t);
}

const ARCH = {};
ARCH.sky = (ctx) => {
  const g = new THREE.Group();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    uniforms: { top: { value: new THREE.Color(0x000000) }, bottom: { value: new THREE.Color(0x222222) }, opacity: { value: 1 } },
    vertexShader: `varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top,bottom; uniform float opacity; varying vec3 vP; void main(){ float k=smoothstep(-0.05,0.55,vP.y); gl_FragColor=vec4(mix(bottom,top,k),opacity);
      #include <colorspace_fragment>
    }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 24, 12), m); sky.renderOrder = -10; g.add(sky);
  const n = ctx.small ? 300 : 900; const sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = R() * TAU, e = rr(0.08, 1.4); sp.set([Math.cos(a) * Math.cos(e) * 110, Math.sin(e) * 110, Math.sin(a) * Math.cos(e) * 110], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false })));
  return { obj: g, lights: [], update(t, dt, c) { m.uniforms.top.value.copy(c.pal.fog).multiplyScalar(0.35); m.uniforms.bottom.value.copy(c.pal.fog).lerp(c.pal.hi, 0.08).multiplyScalar(1.8); } };
};
ARCH.grounds = () => {
  const g = new THREE.Group();
  const gg = new THREE.CircleGeometry(90, 64, 0, TAU); gg.rotateX(-Math.PI / 2);
  const col = new Float32Array(gg.attributes.position.count * 3);
  for (let i = 0; i < gg.attributes.position.count; i++) { const x = gg.attributes.position.getX(i), z = gg.attributes.position.getZ(i); const k = 0.6 + 0.4 * noise3(x * 0.1, 0, z * 0.1, 1); col.set([0.11 * k, 0.11 * k, 0.08 * k], i * 3); }
  gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  mesh(gg, mat(0xffffff, { vc: true, r: 1 }), 0, 0, 0, g);
  const stoneM = mat(0x4a4640, { r: 0.9 });
  for (let z = -0.6; z < 10; z += 0.75) { const s = box(rr(0.9, 1.3), 0.06, rr(0.5, 0.65), stoneM, rr(-0.15, 0.15), 0.03, z, g); s.rotation.y = rr(-0.2, 0.2); }
  const picket = mergeGeos([[new THREE.BoxGeometry(0.08, 1.1, 0.04), M4(0, 0.55, 0)], [new THREE.ConeGeometry(0.06, 0.16, 4), M4(0, 1.18, 0, 0, Math.PI / 4)]]);
  const fence = new THREE.InstancedMesh(picket, mat(0x1a1a1a, { r: 0.5, m: 0.6 }), 120); let fi = 0;
  for (let x = -16; x <= 16; x += 0.3) { if (Math.abs(x) < 1.0) continue; fence.setMatrixAt(fi++, M4(x, 0, 10.5, rr(-0.05, 0.05), 0, rr(-0.06, 0.06))); }
  fence.count = fi; g.add(fence);
  box(32, 0.05, 0.05, mat(0x1a1a1a, { m: 0.6, r: 0.5 }), 0, 0.9, 10.5, g);
  tree(g, -9, -2, 1.5, 11); tree(g, 10, 3, 1.2, 23); tree(g, -14, 6, 1.0, 37); tree(g, 13, -10, 1.6, 41);
  const graveM = mat(0x5a5850, { r: 0.95 });
  for (const [x, z, ry, rz] of [[-6, 4, 0.2, 0.08], [-7.5, 6.5, -0.1, -0.12], [-4.8, 7.2, 0.3, 0.05], [6.5, 6, -0.25, -0.1], [8, 7.8, 0.1, 0.15]]) {
    const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.set(0, ry, rz); g.add(s);
    box(0.7, 0.9, 0.16, graveM, 0, 0.45, 0, s); const top = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.16, 16, 1, false, -Math.PI / 2, Math.PI), graveM, 0, 0.9, 0, s); top.rotation.x = Math.PI / 2;
  }
  return { obj: g, lights: [] };
};
ARCH.exterior = () => {
  const g = new THREE.Group();
  const siding = mat(0x7a7268, { r: 0.9, map: tex('clapboard', 4, 6) });
  const dark = mat(0x16141a, { r: 0.85 });
  const trimM = mat(0x2a2622, { r: 0.7 });
  box(11, 0.8, 9, mat(0x2a2826, { r: 0.95, map: tex('stone', 4, 1) }), 0, 0.4, -8.5, g);
  box(10, 6.5, 8, siding, 0, 4.05, -8.5, g);
  box(10.4, 0.18, 8.4, trimM, 0, 4.0, -8.5, g);
  const tri = new THREE.Shape(); tri.moveTo(-5.6, 0); tri.lineTo(5.6, 0); tri.lineTo(0, 4.2); tri.closePath();
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 8.8, bevelEnabled: false }), dark); roof.position.set(0, 7.3, -12.9); g.add(roof);
  const gable = new THREE.Shape(); gable.moveTo(-5, 0); gable.lineTo(5, 0); gable.lineTo(0, 3.75); gable.closePath();
  mesh(new THREE.ShapeGeometry(gable), siding, 0, 7.3, -4.48, g);
  // tower
  mesh(new THREE.CylinderGeometry(1.7, 1.7, 10, 8), siding, 5.2, 5.0, -5.4, g);
  mesh(new THREE.ConeGeometry(2.15, 4.8, 8), dark, 5.2, 12.4, -5.4, g);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), dark, 5.2, 15.4, -5.4, g);
  mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.2, 8), trimM, 5.2, 10.0, -5.4, g);
  box(0.9, 3.6, 0.9, mat(0x3a2a24, { r: 0.95 }), -3.4, 9.6, -9.5, g);
  // windows: glass slabs, some lit
  const lit = pal(mat(0x110a06, { e: 0xffa050, ei: 1.0 }), 'accent', 0.55);
  const unlit = mat(0x07080a, { r: 0.15, m: 0.5 });
  const win = (x, y, z, w, h, isLit, ry = 0) => {
    const wg = new THREE.Group(); wg.position.set(x, y, z); wg.rotation.y = ry; g.add(wg);
    box(w + 0.24, h + 0.24, 0.1, trimM, 0, 0, 0, wg);
    mesh(new THREE.PlaneGeometry(w, h), isLit ? lit : unlit, 0, 0, 0.06, wg);
    box(0.06, h, 0.04, trimM, 0, 0, 0.08, wg); box(w, 0.06, 0.04, trimM, 0, 0, 0.08, wg);
    return wg;
  };
  win(-2.9, 2.4, -4.47, 1.1, 1.7, true); win(2.6, 2.4, -4.47, 1.1, 1.7, false);
  win(-2.9, 5.6, -4.47, 1.0, 1.5, false); win(0, 5.6, -4.47, 1.0, 1.5, false);
  const figWin = win(2.6, 5.6, -4.47, 1.0, 1.5, true);
  const fig = new THREE.Shape(); fig.moveTo(-0.22, -0.75); fig.quadraticCurveTo(-0.24, -0.1, -0.12, -0.05); fig.absarc(0, 0.12, 0.13, -Math.PI * 0.8, Math.PI * 1.8, false); fig.quadraticCurveTo(0.24, -0.1, 0.22, -0.75); fig.closePath();
  mesh(new THREE.ShapeGeometry(fig), mat(0x020101, { r: 1 }), 0.15, 0, 0.07, figWin);
  const round = mesh(new THREE.CircleGeometry(0.55, 24), lit, 0, 8.6, -4.45, g);
  mesh(new THREE.TorusGeometry(0.58, 0.07, 6, 24), trimM, 0, 8.6, -4.44, g);
  win(5.2, 4.6, -3.65, 0.8, 1.4, true); win(5.2, 7.8, -3.65, 0.8, 1.3, false);
  // porch
  box(7.2, 0.3, 2.8, mat(0x2a221c, { r: 0.85, map: tex('planks', 3, 1) }), 0, 0.95, -3.1, g);
  for (let i = 0; i < 3; i++) box(2.4, 0.3, 0.4, mat(0x3a3430, { r: 0.9 }), 0, 0.15 + i * 0.3 - 0.0, -1.7 + 0.4 * (2 - i) + 0.2, g);
  box(7.6, 0.15, 3.3, dark, 0, 3.95, -3.0, g);
  for (const x of [-3.3, -1.25, 1.25, 3.3]) mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.85, 10), trimM, x, 2.5, -1.85, g);
  const bal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), trimM, 40); let bi = 0;
  for (let x = -3.3; x <= 3.3; x += 0.2) { if (Math.abs(x) < 1.3) continue; bal.setMatrixAt(bi++, M4(x, 1.45, -1.85)); }
  bal.count = bi; g.add(bal);
  box(2.05, 0.06, 0.08, trimM, -2.28, 1.82, -1.85, g); box(2.05, 0.06, 0.08, trimM, 2.28, 1.82, -1.85, g);
  box(1.2, 2.3, 0.05, mat(0x1e100c), 0, 2.25, -4.49, g);
  return { obj: g, lights: [{ pos: new V3(-2.9, 2.4, -3.6), kind: 'lantern', i: 0.5 }] };
};

function hallDoors(g, room) {
  const m = mat(0x2a1812, { r: 0.55 }), tr = mat(0x160e0a, { r: 0.6 });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const z = 8 - i * 6 + (s > 0 ? 3 : 0);
    const dg = new THREE.Group(); dg.position.set(s * (room.w / 2 - 0.04), 0, z); dg.rotation.y = -s * Math.PI / 2; g.add(dg);
    box(1.0, 2.2, 0.06, m, 0, 1.1, 0, dg); box(1.2, 0.12, 0.1, tr, 0, 2.26, 0, dg); box(0.1, 2.3, 0.1, tr, -0.55, 1.15, 0, dg); box(0.1, 2.3, 0.1, tr, 0.55, 1.15, 0, dg);
    mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0x8a6a2a, { m: 0.9, r: 0.3 }), 0.38, 1.0, 0.05, dg);
  }
}

// Each location: room box (indoor), camera, architecture, default props, prop placements.
const LOC = {
  outside: {
    cam: { p: [1.6, 2.1, 17], t: [0.6, 4.6, -6], fov: 45 }, outdoor: true, arch: ['sky', 'grounds', 'exterior'],
    defaults: ['moon', 'jackolantern'], dust: [30, 8, 30, 0, 0, 0],
  },
  porch: {
    cam: { p: [0.7, 2.0, 2.4], t: [0, 2.2, -4.4], fov: 52 }, outdoor: true, arch: ['sky', 'grounds', 'exterior'],
    defaults: ['jackolantern', 'door', 'moon'], dust: [8, 4, 6, 0, 1, -2],
  },
  foyer: { room: { w: 12, h: 8, d: 12 }, cam: { p: [2.6, 1.7, 5.0], t: [-0.6, 2.8, -3], fov: 56 }, arch: ['foyer'], defaults: ['chandelier', 'clock', 'portrait', 'candles'] },
  parlor: { room: { w: 10, h: 4.5, d: 9 }, cam: { p: [0.4, 1.55, 3.2], t: [0, 1.25, -4], fov: 52 }, arch: ['parlor'], defaults: ['fireplace', 'portrait', 'clock', 'candles'] },
  kitchen: { room: { w: 9, h: 4, d: 9 }, cam: { p: [1.4, 1.75, 3.4], t: [-0.4, 1.0, -2.5], fov: 54 }, arch: ['kitchen'], defaults: ['table', 'candles', 'window'] },
  conservatory: { room: { w: 10, h: 6, d: 10 }, cam: { p: [0.3, 1.7, 4.0], t: [0, 2.3, -4], fov: 56 }, arch: ['conservatory'], defaults: ['vines', 'moon', 'rain'], glass: true },
  stair: { room: { w: 6, h: 14, d: 10 }, cam: { p: [1.1, 1.3, 4.2], t: [-0.3, 4.6, -4], fov: 62 }, arch: ['stair'], defaults: ['portrait', 'candles', 'window', 'moon'] },
  hall: { room: { w: 4, h: 4, d: 28 }, cam: { p: [0, 1.65, 12.5], t: [0, 1.5, -14], fov: 50 }, arch: ['hall'], defaults: ['candles', 'door', 'window'] },
  nursery: { room: { w: 7, h: 3.5, d: 7 }, cam: { p: [1.3, 1.5, 2.6], t: [-0.6, 0.9, -2.5], fov: 56 }, arch: ['nursery'], defaults: ['crib', 'window', 'moon'] },
  mirror: { room: { w: 8, h: 5, d: 9 }, cam: { p: [0, 1.6, 2.4], t: [0, 1.55, -4.4], fov: 50 }, arch: ['mirrorroom'], defaults: ['mirror', 'candles'] },
  attic: { room: { w: 9, h: 5, d: 11 }, cam: { p: [1.0, 1.6, 4.0], t: [0, 1.7, -4.5], fov: 56 }, arch: ['attic'], defaults: ['trunk', 'window', 'moon'] },
  cellar: { room: { w: 9, h: 3.6, d: 10 }, cam: { p: [-1.5, 1.6, 3.8], t: [0.5, 0.9, -3.5], fov: 56 }, arch: ['cellar'], defaults: ['roots', 'bones', 'candles'] },
  marrow: { room: { w: 14, h: 9, d: 18 }, cam: { p: [0, 1.6, 5.5], t: [0, 2.4, -6], fov: 56 }, arch: ['marrow'], defaults: ['roots', 'bones'] },
};

ARCH.foyer = () => {
  const room = LOC.foyer.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'damask', wall: 0x5a5048, floorTex: 'checker', floor: 0xbbb4a6, floorR: 0.35, floorScale: 1.6 }));
  wainscot(room, g, 0x24160e, 1.2);
  staircase(g, { x0: -4.6, z0: 1.8, steps: 13, rise: 0.3, run: 0.48, width: 2.2, dir: -1, axis: 'z', m: mat(0x2a1a10, { r: 0.55 }) });
  box(12, 0.25, 1.8, mat(0x24160e, { r: 0.6 }), 0, 3.9, -5.1, g);
  const bal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), mat(0x1e120c), 50); let bi = 0;
  for (let x = -3.4; x <= 5.9; x += 0.25) bal.setMatrixAt(bi++, M4(x, 4.48, -4.25)); bal.count = bi; g.add(bal);
  box(9.4, 0.07, 0.1, mat(0x1e120c), 1.25, 4.95, -4.25, g);
  const rug = mesh(new THREE.CircleGeometry(2.0, 48), mat(0x4a1210, { r: 1 }), 0.8, 0.01, -0.4, g); rug.rotation.x = -Math.PI / 2;
  const rug2 = mesh(new THREE.RingGeometry(1.75, 1.9, 48), mat(0x8a6a2a, { r: 1 }), 0.8, 0.012, -0.4, g); rug2.rotation.x = -Math.PI / 2;
  const dg = B.door({ color: 0x1e100c }); dg.obj.position.set(1.5, 0, -5.98); g.add(dg.obj);
  return { obj: g, lights: [] };
};
ARCH.parlor = () => {
  const room = LOC.parlor.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'damask', wall: 0x6a3a34, floorTex: 'planks', floor: 0x7a6a5a }));
  wainscot(room, g, 0x2a1810, 1.0);
  const rug = box(4.6, 0.02, 3.2, mat(0x3a1418, { r: 1 }), 0, 0.01, -1.4, g);
  const cloth = mat(0x4a1a1e, { r: 0.95 });
  for (const s of [-1, 1]) {
    const c = new THREE.Group(); c.position.set(s * 1.8, 0, -1.4); c.rotation.y = s * 0.9 + Math.PI; g.add(c);
    box(0.9, 0.45, 0.85, cloth, 0, 0.225, 0, c); box(0.9, 0.9, 0.2, cloth, 0, 0.75, 0.38, c);
    box(0.15, 0.25, 0.85, cloth, -0.45, 0.55, 0, c); box(0.15, 0.25, 0.85, cloth, 0.45, 0.55, 0, c);
    const wing = mesh(new THREE.SphereGeometry(0.3, 12, 8), cloth, 0, 1.22, 0.38, c); wing.scale.set(1.5, 0.6, 0.6);
  }
  const st = mesh(lathe([[0, 0], [0.2, 0], [0.04, 0.05], [0.03, 0.55], [0.3, 0.58], [0.3, 0.62], [0, 0.62]], 20), mat(0x24140c, { r: 0.4 }), 0, 0, -0.9, g);
  return { obj: g, lights: [] };
};
ARCH.kitchen = () => {
  const room = LOC.kitchen.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'tiles', wall: 0x9a9888, floorTex: 'stone', floor: 0x6a645a, floorScale: 3 }));
  const wood = mat(0x3a2a1a, { r: 0.6 }), top = mat(0x5a5650, { r: 0.4 });
  box(7, 0.9, 0.7, wood, 0.5, 0.45, -4.1, g); box(7.1, 0.06, 0.76, top, 0.5, 0.93, -4.1, g);
  box(0.7, 0.9, 4, wood, 4.1, 0.45, -1.6, g); box(0.76, 0.06, 4.1, top, 4.1, 0.93, -1.6, g);
  for (const y of [1.9, 2.5]) box(6, 0.05, 0.3, wood, 0.5, y, -4.3, g);
  const jarM = pal(mat(0x3a4a2a, { r: 0.15, m: 0.1, transparent: true, opacity: 0.85, e: 0x0a1a08 }), 'accent', 0.25);
  for (let i = 0; i < 14; i++) { const y = i < 7 ? 1.93 : 2.53; mesh(new THREE.CylinderGeometry(rr(0.07, 0.11), rr(0.07, 0.11), rr(0.15, 0.3), 12).translate(0, 0.12, 0), jarM, -2.2 + (i % 7) * 0.85 + rr(-0.1, 0.1), y, -4.3, g); }
  const iron = mat(0x141414, { r: 0.5, m: 0.7 });
  box(1.4, 0.95, 0.8, iron, -3.7, 0.475, -2.5, g);
  for (const [x, z] of [[-3.95, -2.3], [-3.45, -2.3], [-3.95, -2.7], [-3.45, -2.7]]) { const r = mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 16), iron, x, 0.97, z, g); r.rotation.x = Math.PI / 2; }
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.1, 10), iron, -3.9, 2.45, -2.75, g);
  const rack = box(3, 0.05, 0.05, iron, 0, 3.1, -0.5, g);
  for (let i = 0; i < 6; i++) { const x = -1.3 + i * 0.52; mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 3), iron, x, 2.95, -0.5, g); const pot = mesh(lathe([[0, 0], [rr(0.12, 0.2), 0], [rr(0.14, 0.2), rr(0.12, 0.2)], [rr(0.13, 0.19), 0.2]], 18), mat(0x5a3a22, { m: 0.8, r: 0.35, side: THREE.DoubleSide }), x, 2.55, -0.5, g); }
  return { obj: g, lights: [] };
};
ARCH.conservatory = () => {
  const room = LOC.conservatory.room; const g = new THREE.Group();
  const floor = mesh(new THREE.PlaneGeometry(room.w, room.d), mat(0x6a6a60, { map: tex('checker', 4, 4), r: 0.3 }), 0, 0, 0, g); floor.rotation.x = -Math.PI / 2;
  const iron = mat(0x1c2420, { r: 0.4, m: 0.7 });
  for (let z = -room.d / 2; z <= room.d / 2; z += 2) {
    for (const s of [-1, 1]) box(0.08, 3.5, 0.08, iron, s * room.w / 2, 1.75, z, g);
    const arc = mesh(new THREE.TorusGeometry(room.w / 2, 0.05, 6, 32, Math.PI), iron, 0, 3.5, z, g); arc.scale.y = 0.5;
  }
  for (let x = -room.w / 2; x <= room.w / 2; x += 1.25) box(0.06, 3.5, 0.06, iron, x, 1.75, -room.d / 2, g);
  box(room.w, 0.06, 0.06, iron, 0, 3.5, -room.d / 2, g); box(room.w, 0.06, 0.06, iron, 0, 1.2, -room.d / 2, g);
  const glassM = pal(mat(0x203a38, { r: 0.05, m: 0.6, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, e: 0x050c0c }), 'hi', 0.05);
  mesh(new THREE.PlaneGeometry(room.w, 3.5), glassM, 0, 1.75, -room.d / 2, g);
  for (const s of [-1, 1]) { const p = mesh(new THREE.PlaneGeometry(room.d, 3.5), glassM, s * room.w / 2, 1.75, 0, g); p.rotation.y = Math.PI / 2; }
  const potM = mat(0x6a3a22, { r: 0.8 }), leafM = pal(mat(0x1e3a1a, { r: 0.7, flat: true }), 'accent', 0.06);
  for (const [x, z, s] of [[-3.5, -3, 1.3], [3.4, -2.5, 1.1], [-3.8, 1, 0.9], [3.6, 1.5, 1.2], [-1.2, -4, 0.8], [1.8, -4.1, 1.0]]) {
    mesh(lathe([[0, 0], [0.25, 0], [0.32, 0.5], [0.35, 0.55], [0, 0.55]], 16), potM, x, 0, z, g).scale.setScalar(s);
    for (let k = 0; k < 9; k++) { const l = mesh(new THREE.ConeGeometry(0.12, rr(0.8, 1.6), 4), leafM, x, 0.55 * s + 0.4, z, g); l.rotation.set(rr(-0.9, 0.9), rr(0, TAU), rr(-0.9, 0.9)); l.scale.setScalar(s); l.translateY(0.35 * s); }
    mesh(new THREE.IcosahedronGeometry(0.45 * s, 0), leafM, x, 0.9 * s, z, g);
  }
  const bench = box(2, 0.08, 0.5, mat(0x2a2a26, { m: 0.6, r: 0.5 }), 0, 0.45, -1.2, g);
  return { obj: g, lights: [] };
};
ARCH.stair = () => {
  const room = LOC.stair.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'damask', wall: 0x3e3a44, floorTex: 'planks', floor: 0x5a4a3a, ceil: 0x050505 }));
  wainscot(room, g, 0x1e140e, 1.0);
  const sm = mat(0x24160e, { r: 0.55 });
  staircase(g, { x0: -0.6, z0: 3.0, steps: 16, rise: 0.3, run: 0.45, width: 2.4, dir: -1, axis: 'z', m: sm });
  box(6, 0.3, 2.0, sm, 0, 4.65, -4.0, g);
  // second flight up the right wall, receding into darkness
  for (let i = 0; i < 14; i++) box(1.4, 0.3, 0.45, sm, 2.3, 4.95 + i * 0.3, -3.2 + i * 0.45, g);
  box(6, 0.3, 2.2, sm, 0, 9.2, 3.8, g);
  return { obj: g, lights: [] };
};
ARCH.hall = () => {
  const room = LOC.hall.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'damask', wall: 0x4a3e3a, floorTex: 'planks', floor: 0x6a5848 }));
  wainscot(room, g, 0x221410, 1.0);
  box(1.6, 0.015, room.d - 1, mat(0x4a1418, { r: 1 }), 0, 0.008, 0, g);
  hallDoors(g, room);
  return { obj: g, lights: [] };
};
ARCH.nursery = () => {
  const room = LOC.nursery.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'stripes', wall: 0x8a8478, floorTex: 'planks', floor: 0x8a7a68, ceil: 0x3a3632 }));
  const horse = new THREE.Group(); horse.position.set(1.6, 0, -1.6); horse.rotation.y = -0.7; g.add(horse);
  const hm = mat(0xd8cfc0, { r: 0.6 }), dm = mat(0x3a2418, { r: 0.6 });
  const rock = mesh(new THREE.TorusGeometry(1.2, 0.03, 6, 32, 0.9), dm, 0, 1.25, 0.18, horse); rock.rotation.z = -Math.PI / 2 - 0.45;
  const rock2 = mesh(new THREE.TorusGeometry(1.2, 0.03, 6, 32, 0.9), dm, 0, 1.25, -0.18, horse); rock2.rotation.z = -Math.PI / 2 - 0.45;
  const body = mesh(new THREE.CapsuleGeometry(0.17, 0.5, 6, 12), hm, 0, 0.62, 0, horse); body.rotation.z = Math.PI / 2;
  const head = mesh(new THREE.CapsuleGeometry(0.09, 0.22, 4, 10), hm, 0.42, 0.9, 0, horse); head.rotation.z = -0.6;
  for (const [x, z] of [[-0.25, 0.12], [0.25, 0.12], [-0.25, -0.12], [0.25, -0.12]]) mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.42, 6), hm, x, 0.32, z, horse);
  mesh(new THREE.SphereGeometry(0.025, 6, 4), mat(0x050505), 0.5, 0.97, 0.07, horse);
  const blockC = [0x8a3a3a, 0x3a5a8a, 0xb8a050, 0x4a7a4a];
  for (let i = 0; i < 6; i++) { const b = box(0.18, 0.18, 0.18, mat(blockC[i % 4], { r: 0.7 }), -0.5 + rr(-0.6, 0.6), 0.09 + (i === 5 ? 0.18 : 0), 0.3 + rr(-0.4, 0.3), g); b.rotation.y = rr(0, 1); }
  // a doll in a small chair, facing you
  const doll = new THREE.Group(); doll.position.set(-2.4, 0, -0.2); doll.rotation.y = 0.9; g.add(doll);
  box(0.4, 0.04, 0.4, dm, 0, 0.35, 0, doll); box(0.4, 0.45, 0.04, dm, 0, 0.58, -0.19, doll);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) box(0.03, 0.35, 0.03, dm, x, 0.175, z, doll);
  mesh(new THREE.ConeGeometry(0.16, 0.36, 12), mat(0x7a8aa0, { r: 0.9 }), 0, 0.55, 0, doll);
  mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(0xe8dccc, { r: 0.5 }), 0, 0.8, 0, doll);
  for (const ex of [-0.035, 0.035]) mesh(new THREE.SphereGeometry(0.014, 6, 4), mat(0x050505, { r: 0.1 }), ex, 0.82, 0.09, doll);
  return { obj: g, lights: [], update(t) { horse.rotation.z = Math.sin(t * 0.9) * 0.08; } };
};
ARCH.mirrorroom = () => {
  const room = LOC.mirror.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'damask', wall: 0x2e2a30, floorTex: 'planks', floor: 0x3a3028, ceil: 0x0a0a0a }));
  const drape = mat(0x3a0e14, { r: 0.95, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(1.4, 4.6, 24, 1); const pp = pg.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin(pp.getX(i) * 14) * 0.08);
    pg.computeVertexNormals();
    mesh(pg, drape, s * 1.85, 2.3, -room.d / 2 + 0.15, g);
  }
  const con = mat(0x1e140e, { r: 0.4 });
  box(1.8, 0.06, 0.45, con, 0, 0.85, -room.d / 2 + 0.35, g);
  for (const x of [-0.8, 0.8]) box(0.05, 0.85, 0.05, con, x, 0.425, -room.d / 2 + 0.35, g);
  // someone standing behind you, only visible in the glass
  const ghost = new THREE.Group(); ghost.position.set(0.55, 0, 3.6); ghost.rotation.y = Math.PI; g.add(ghost);
  const gm = pal(mat(0xd8d4cc, { r: 1, transparent: true, opacity: 0.6, e: 0x5a626e }), 'hi', 0.45);
  mesh(new THREE.ConeGeometry(0.36, 1.6, 16, 1, true), gm, 0, 0.8, 0, ghost);
  mesh(new THREE.SphereGeometry(0.14, 16, 12), gm, 0, 1.72, 0, ghost);
  return { obj: g, lights: [] };
};
ARCH.attic = () => {
  const room = LOC.attic.room; const g = new THREE.Group();
  const { w, h, d } = room;
  const fl = mesh(new THREE.PlaneGeometry(w, d), mat(0x5a4a3a, { map: tex('planks', 3, 4) }), 0, 0, 0, g); fl.rotation.x = -Math.PI / 2;
  const roofM = mat(0x2a221c, { r: 0.95, side: THREE.DoubleSide, map: tex('planks', 3, 4) });
  const slope = Math.hypot(w / 2, h - 1.2);
  const ang = Math.atan2(h - 1.2, w / 2);
  for (const s of [-1, 1]) { const p = mesh(new THREE.PlaneGeometry(slope, d), roofM, s * w / 4, (h + 1.2) / 2, 0, g); p.rotation.set(-Math.PI / 2, 0, -s * ang, 'ZYX'); }
  // gable walls
  const gs = new THREE.Shape(); gs.moveTo(-w / 2, 0); gs.lineTo(w / 2, 0); gs.lineTo(w / 2, 1.2); gs.lineTo(0, h); gs.lineTo(-w / 2, 1.2); gs.closePath();
  mesh(new THREE.ShapeGeometry(gs), mat(0x3a3028, { r: 0.95, map: tex('planks', 2, 2) }), 0, 0, -d / 2, g);
  const kw = mesh(new THREE.ShapeGeometry(gs), mat(0x3a3028, { r: 0.95, side: THREE.BackSide }), 0, 0, d / 2, g);
  for (const s of [-1, 1]) box(0.05, 1.2, d, mat(0x3a3028), s * w / 2, 0.6, 0, g);
  const beam = mat(0x24180f, { r: 0.8 });
  box(0.2, 0.25, d, beam, 0, h - 0.12, 0, g);
  for (let z = -d / 2 + 0.6; z < d / 2; z += 1.2) for (const s of [-1, 1]) { const r = box(slope, 0.18, 0.12, beam, s * w / 4, (h + 1.2) / 2 - 0.12, z, g); r.rotation.z = s * -ang; }
  for (let z = -d / 2 + 1.8; z < d / 2; z += 3.6) box(w * 0.55, 0.15, 0.15, beam, 0, 3.0, z, g);
  const sheet = mat(0xc8c2b4, { r: 1 });
  for (const [x, z, sx, sy, sz] of [[-2.8, -2.5, 1.2, 1.1, 0.8], [-3.0, 1.0, 0.8, 0.7, 0.8], [2.6, 1.6, 0.7, 1.3, 0.7]]) { const b = mesh(blob(0.6, x * z, 0.12, 3), sheet, x, sy * 0.5, z, g); b.scale.set(sx, sy, sz); }
  const dummy = new THREE.Group(); dummy.position.set(-1.6, 0, -3.6); dummy.rotation.y = 0.5; g.add(dummy);
  mesh(lathe([[0.0, 0], [0.18, 0.0], [0.03, 0.05], [0.03, 0.85], [0.17, 0.95], [0.22, 1.15], [0.17, 1.35], [0.2, 1.5], [0.08, 1.6], [0.04, 1.68], [0, 1.68]], 20), mat(0x6a5a48, { r: 0.8 }), 0, 0, 0, dummy);
  // cobwebs in corners
  const web = []; for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI / 2; web.push(0, 0, 0, Math.cos(a) * 0.9, -Math.sin(a) * 0.9, 0); }
  for (let r = 0.2; r < 0.9; r += 0.17) for (let i = 0; i < 8; i++) { const a1 = (i / 8) * Math.PI / 2, a2 = ((i + 1) / 8) * Math.PI / 2; web.push(Math.cos(a1) * r, -Math.sin(a1) * r, 0, Math.cos(a2) * r * 0.95, -Math.sin(a2) * r * 0.95, 0); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(web, 3));
  const wm = pal(new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.35 }), 'hi', 0.3);
  for (const [x, y, z, ry] of [[-w / 2 + 0.05, 1.2, -d / 2 + 0.05, 0], [0.1, h - 0.3, -d / 2 + 0.05, 0]]) { const l = new THREE.LineSegments(wg, wm); l.position.set(x, y, z); l.rotation.y = ry; g.add(l); }
  return { obj: g, lights: [] };
};
ARCH.cellar = () => {
  const room = LOC.cellar.room; const g = new THREE.Group();
  g.add(shell(room, { wallTex: 'stone', wall: 0x6a645c, floor: 0x2a2018, floorR: 1, ceil: 0x1a1816 }));
  const stone = mat(0x4a4640, { r: 0.95, map: tex('stone', 2, 1) });
  for (let z = -4; z <= 4; z += 2.5) { const a = mesh(new THREE.TorusGeometry(room.w / 2, 0.22, 6, 24, Math.PI), stone, 0, room.h - 2.0, z, g); a.scale.y = 0.45; for (const s of [-1, 1]) box(0.5, room.h - 2.0, 0.5, stone, s * (room.w / 2 - 0.2), (room.h - 2.0) / 2, z, g); }
  const barrel = lathe([[0, 0], [0.32, 0], [0.38, 0.2], [0.42, 0.45], [0.38, 0.7], [0.32, 0.9], [0, 0.9]], 18);
  const bm = mat(0x3a2414, { r: 0.8 });
  for (const [x, y, z, lay] of [[3.6, 0, -3.5, 0], [3.6, 0, -2.6, 0], [2.9, 0, -4.1, 0], [3.5, 0.95, -3.05, 0], [-3.6, 0.4, 1.8, 1]]) { const b = mesh(barrel, bm, x, y, z, g); if (lay) { b.rotation.z = Math.PI / 2; b.position.x += 0.45; } }
  for (const y of [0.9, 1.6, 2.3]) box(2.6, 0.05, 0.4, mat(0x2a1a10), -2.6, y, -4.75, g);
  const jarM = pal(mat(0x4a5a2a, { r: 0.15, transparent: true, opacity: 0.8, e: 0x182808 }), 'accent', 0.35);
  for (let i = 0; i < 12; i++) mesh(new THREE.CylinderGeometry(0.08, 0.08, rr(0.18, 0.3), 10).translate(0, 0.13, 0), jarM, -3.7 + (i % 4) * 0.7 + rr(-0.1, 0.1), [0.92, 1.62, 2.32][i % 3], -4.75, g);
  // the stair you came down
  for (let i = 0; i < 8; i++) box(1.2, 0.3, 0.4, mat(0x3a342c, { r: 0.95 }), -3.9, room.h - 0.3 - i * 0.42, 1.0 + i * 0.4, g);
  return { obj: g, lights: [] };
};
ARCH.marrow = (ctx) => {
  const g = new THREE.Group();
  const flesh = pal(mat(0x5a1418, { r: 0.35, m: 0.1, e: 0x1a0204 }), 'accent', 0.15);
  const floorG = new THREE.PlaneGeometry(16, 22, 48, 64); const fp = floorG.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, noise3(fp.getX(i) * 0.4, fp.getY(i) * 0.4, 0, 3) * 0.25 + Math.pow(Math.abs(fp.getX(i)) / 8, 3) * 2.5);
  floorG.computeVertexNormals();
  const fl = mesh(floorG, mat(0x3a0a0e, { r: 0.25, m: 0.1 }), 0, 0, -3, g); fl.rotation.x = -Math.PI / 2;
  const tun = new THREE.CylinderGeometry(6.5, 6.5, 24, 32, 32, true); const tp = tun.attributes.position; const v = new V3();
  for (let i = 0; i < tp.count; i++) { v.fromBufferAttribute(tp, i); const n = 1 + 0.12 * noise3(v.x * 0.4, v.y * 0.3, v.z * 0.4, 7); tp.setXYZ(i, v.x * n, v.y, v.z * n); }
  tun.computeVertexNormals();
  const tm = mesh(tun, mat(0x2a080a, { r: 0.4, side: THREE.BackSide }), 0, 2, -3, g); tm.rotation.x = Math.PI / 2;
  const ribM = mat(0xcfc2a0, { r: 0.5 });
  for (let i = 0; i < 9; i++) { const z = 5 - i * 2; const rib = mesh(new THREE.TorusGeometry(5.2 - i * 0.12, 0.2, 8, 40, Math.PI * 1.15), ribM, 0, 0.4, z, g); rib.rotation.z = -Math.PI * 0.075 + Math.sin(i) * 0.05; rib.scale.y = 1.15; }
  const vert = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.35, 0.8), ribM, 12);
  for (let i = 0; i < 12; i++) vert.setMatrixAt(i, M4(0, 6.35, 5.5 - i * 1.55, 0.1 * Math.sin(i), 0, 0)); g.add(vert);
  const core = new THREE.Group(); core.position.set(0, 2.6, -6); g.add(core);
  const coreM = pal(mat(0x7a0a10, { r: 0.3, e: 0xff2030, ei: 0.8 }), 'accent', 0.35);
  mesh(blob(1.25, 4.2, 0.28, ctx.small ? 3 : 4), coreM, 0, 0, 0, core);
  const halo = new THREE.Sprite(pal(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xff3030, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), 'accent', 0.35));
  halo.scale.setScalar(6); core.add(halo);
  const veinM = pal(mat(0x4a0a12, { r: 0.4, e: 0x400008 }), 'accent', 0.25);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU; const end = new V3(Math.cos(a) * 5.5, 2.6 + Math.sin(a) * 4.5, -6 + rr(-3, 6));
    if (end.y < 0) end.y = 0.1;
    const mid = new V3(0, 2.6, -6).lerp(end, 0.5).add(new V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)));
    g.add(new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3([new V3(0, 2.6, -6), mid, end]), 32, 0.16, 6, (u) => 1 - u * 0.75), veinM));
  }
  return {
    obj: g, lights: [{ pos: new V3(0, 2.6, -4.4), kind: 'pulse', i: 2.0 }],
    update(t, dt, c) { const p = c.beat; core.scale.setScalar(1 + p * 0.08); halo.material.opacity = (0.35 + p * 0.35) * (halo.material.userData._fadeV ?? 1); coreM.emissiveIntensity = 0.6 + p * 0.9; },
  };
};

// Generic prop placement inside a standard room (camera near +z looking toward -z).
function placeProp(loc, name, ctx) {
  const L = LOC[loc]; const room = L.room; const small = ctx.small;
  const P = (b, x, y, z, ry = 0, s = 1) => { b.obj.position.set(x, y, z); b.obj.rotation.y = ry; b.obj.scale.setScalar(s); return b; };
  // outdoor placements
  if (L.outdoor) {
    switch (name) {
      case 'jackolantern': return B.jackolantern({ items: loc === 'porch' ? [[-1.5, 1.1, -2.2, 0.62, 0.3], [1.6, 1.1, -2.3, 0.5, -0.4], [0.75, 0.6, -1.05, 0.42, -0.2], [-2.6, 1.1, -3.4, 0.4, 0.5]] : [[-1.2, 0, 1.5, 0.7, 0.2], [1.3, 0, 2.2, 0.55, -0.3], [-1.6, 1.1, -2.2, 0.6, 0.3], [1.6, 1.1, -2.3, 0.5, -0.4]] });
      case 'door': return P(B.door({ ajar: true, knocker: true }), 0, 1.1, -4.43);
      case 'moon': return P(B.moon({ r: 3.2 }), -22, 30, -75);
      case 'rain': return P(B.rain({ n: small ? 500 : 1600, w: 34, h: 22, d: 34, opacity: 0.3 }), 0, 0, 0);
      case 'window': return P(B.window({ w: 1.0, h: 1.5 }), -2.9, 5.6, -4.38);
      case 'candles': return B.candles({ points: [[-0.9, 1.1, -2.6], [-0.75, 1.1, -2.75], [0.9, 1.1, -2.7], [3.0, 1.1, -2.2], [-3.0, 1.1, -2.1]] });
      case 'portrait': return P(B.portrait({ seed: 3 }), -2.9, 2.4, -4.38, 0, 0.85);
      case 'clock': return P(B.clock(), 2.7, 1.1, -3.9, -0.2);
      case 'table': return P(B.table({ len: 2.4 }), 0, 0, 4);
      case 'feast': return P(B.feast({ len: 2.4 }), 0, 0, 4);
      case 'chandelier': return P(B.chandelier({ drop: 0.8 }), 0, 3.85, -3.0, 0, 0.6);
      case 'vines': return P(B.vines({ w: 10, h: 7, n: 16 }), -5, 0.8, -4.42);
      case 'mirror': return P(B.mirror({ small }), 2.4, 1.15, -4.42);
      case 'crib': return P(B.crib(), -2.4, 1.1, -3.4, 0.3, 0.9);
      case 'trunk': return P(B.trunk(), 2.3, 1.1, -3.4, -0.3);
      case 'bones': return P(B.bones({ r: 2.2 }), 0, 0, 3);
      case 'roots': return P(B.roots({ w: 10, h: 7, d: 3, n: 12 }), 0, 0.8, -3);
    }
  }
  const { w, h, d } = room;
  const ov = (OVERRIDES[loc] || {})[name];
  if (ov) return ov(ctx, room);
  switch (name) {
    case 'jackolantern': return B.jackolantern({ items: [[-1.2, 0, -d / 2 + 2, 0.6, 0.3], [1.4, 0, -d / 2 + 2.4, 0.5, -0.3]] });
    case 'door': return P(B.door({ ajar: true }), -w / 4, 0, -d / 2 + 0.03);
    case 'fireplace': return P(B.fireplace(), 0, 0, -d / 2 + 0.31);
    case 'portrait': return P(B.portrait({ seed: loc.length * 13 }), w / 4 + 0.3, 1.95, -d / 2 + 0.06);
    case 'clock': return P(B.clock(), -w / 2 + 0.7, 0, -d / 2 + 0.7, 0.35);
    case 'table': return P(B.table({ len: Math.min(3.6, w * 0.4) }), 0, 0, -0.6);
    case 'feast': return P(B.feast({ len: Math.min(3.6, w * 0.4) }), 0, 0, -0.6);
    case 'chandelier': return P(B.chandelier({ drop: Math.max(0.6, h - 3.0) }), 0, h, -0.6);
    case 'vines': {
      const g = new THREE.Group(); const a = B.vines({ w, h, n: 10 }); a.obj.position.set(-w / 2, 0, -d / 2 + 0.06); g.add(a.obj);
      const b = B.vines({ w: d * 0.8, h, n: 7 }); b.obj.position.set(-w / 2 + 0.06, 0, d / 4); b.obj.rotation.y = Math.PI / 2; g.add(b.obj);
      return { obj: g, lights: [] };
    }
    case 'window': return P(B.window({}), -w / 2 + 0.07, 1.75, -d / 4, Math.PI / 2);
    case 'moon': return P(B.moon({ r: 0.1 }), -w / 2 + 0.14, 2.25, -d / 4 + 0.25, Math.PI / 2);
    case 'rain': return P(B.rain({ n: 140, w: 0.02, h: 1.7, d: 1.1, speed: 1.2, len: 0.08, opacity: 0.5 }), -w / 2 + 0.12, 0.9, -d / 4, 0);
    case 'mirror': return P(B.mirror({ small }), 0, 0.95, -d / 2 + 0.06);
    case 'crib': return P(B.crib(), -w / 4 + 0.2, 0, -d / 2 + 1.3, 0.25);
    case 'trunk': return P(B.trunk(), w / 4, 0, -d / 4, -0.5);
    case 'bones': return P(B.bones({ r: Math.min(2.2, w / 4) }), 0.4, 0, -d / 4);
    case 'roots': return P(B.roots({ w, h, d, n: small ? 10 : 18 }), 0, 0, 0);
    case 'candles': {
      const pts = [];
      for (let i = 0; i < 5; i++) pts.push([w / 5 + rr(-0.2, 0.2), 0.95, -d / 2 + 1.5 + rr(-0.15, 0.15)]);
      for (let i = 0; i < 4; i++) pts.push([-w / 5 + rr(-0.6, 0.6), 0, -d / 2 + 1.7 + rr(-0.4, 0.4)]);
      const c = B.candles({ points: pts });
      const stand = box(0.6, 0.95, 0.45, mat(0x1e140e, { r: 0.5 }), w / 5, 0.475, -d / 2 + 1.5); c.obj.add(stand);
      return c;
    }
  }
  return null;
}
const OVERRIDES = {
  foyer: {
    candles: () => B.candles({ points: [[-3.8, 1.2 + 0.6, 0.6], [-3.8, 1.8 + 0.6, -0.6], [3.2, 0, -3.8], [3.4, 0, -3.6], [3.0, 0, -3.5], [-1.8, 3.9 + 0.13, -4.6], [2.4, 3.9 + 0.13, -4.6]] }),
    portrait: () => { const b = B.portrait({ seed: 21 }); b.obj.position.set(-1.0, 2.2, -5.97); b.obj.scale.setScalar(1.3); return b; },
    clock: () => { const b = B.clock(); b.obj.position.set(4.6, 0, -4.0); b.obj.rotation.y = -0.5; return b; },
    chandelier: (ctx, room) => { const b = B.chandelier({ drop: 3.2 }); b.obj.position.set(0.6, room.h, -0.6); return b; },
  },
  hall: {
    candles: () => { const pts = []; for (let z = 9; z > -13; z -= 4.5) for (const s of [-1, 1]) pts.push([s * 1.88, 1.7, z]); return B.candles({ points: pts, h: 0.18 }); },
    door: () => { const b = B.door({ ajar: true }); b.obj.position.set(0, 0, -13.97); return b; },
    window: () => { const b = B.window({ w: 1.0, h: 1.6 }); b.obj.position.set(1.93, 1.8, -10.5); b.obj.rotation.y = -Math.PI / 2; return b; },
    moon: () => { const b = B.moon({ r: 0.1 }); b.obj.position.set(1.86, 2.2, -10.7); b.obj.rotation.y = -Math.PI / 2; return b; },
    rain: () => { const b = B.rain({ n: 120, w: 0.02, h: 1.5, d: 0.9, speed: 1.2, len: 0.08, opacity: 0.5 }); b.obj.position.set(1.88, 1.05, -10.5); return b; },
    portrait: () => { const g = new THREE.Group(); for (let i = 0; i < 4; i++) { const p = B.portrait({ seed: 40 + i }); p.obj.position.set(i % 2 ? 1.95 : -1.95, 2.0, 5.5 - i * 6); p.obj.rotation.y = (i % 2 ? -1 : 1) * Math.PI / 2; p.obj.scale.setScalar(0.8); g.add(p.obj); g.userData.u = (g.userData.u || []).concat(p.update); } return { obj: g, lights: [], update: (t, dt, c) => g.userData.u.forEach((u) => u(t, dt, c)) }; },
    table: () => { const b = B.table({ len: 1.2, chairs: false }); b.obj.position.set(0, 0, 2); b.obj.rotation.y = Math.PI / 2; return b; },
    fireplace: () => { const b = B.fireplace(); b.obj.position.set(0, 0, -13.7); return b; },
    mirror: () => { const b = B.mirror({}); b.obj.position.set(-1.94, 0.9, -4); b.obj.rotation.y = Math.PI / 2; return b; },
  },
  stair: {
    portrait: () => { const g = new THREE.Group(); const ups = []; for (let i = 0; i < 4; i++) { const p = B.portrait({ seed: 60 + i }); p.obj.position.set(-2.95, 2.2 + i * 1.3, 2.0 - i * 1.9); p.obj.rotation.y = Math.PI / 2; p.obj.scale.setScalar(0.75); g.add(p.obj); ups.push(p.update); } return { obj: g, lights: [], update: (t, dt, c) => ups.forEach((u) => u(t, dt, c)) }; },
    candles: () => B.candles({ points: [[0.5, 0.3 * 2, 2.1], [0.5, 0.3 * 6, 0.3], [0.5, 0.3 * 10, -1.5], [-1.5, 4.8, -4.2], [-1.2, 4.8, -4.4], [1.2, 4.8, -4.6]] }),
    chandelier: (ctx, room) => { const b = B.chandelier({ drop: 6 }); b.obj.position.set(0, room.h, -1); return b; },
    window: () => { const b = B.window({ w: 1.0, h: 2.2 }); b.obj.position.set(0, 6.6, -4.93); return b; },
    moon: () => { const b = B.moon({ r: 0.13 }); b.obj.position.set(-0.2, 7.2, -4.86); return b; },
    rain: () => { const b = B.rain({ n: 140, w: 0.9, h: 2.0, d: 0.02, speed: 1.2, len: 0.08, opacity: 0.5 }); b.obj.position.set(0, 5.5, -4.88); return b; },
  },
  attic: {
    window: () => { const b = B.window({ w: 1.0, h: 1.0 }); b.obj.position.set(0, 2.9, -5.45); return b; },
    moon: () => { const b = B.moon({ r: 0.12 }); b.obj.position.set(0.15, 3.05, -5.4); return b; },
    rain: () => { const b = B.rain({ n: 110, w: 0.9, h: 0.9, d: 0.02, speed: 1.0, len: 0.07, opacity: 0.5 }); b.obj.position.set(0, 2.45, -5.4); return b; },
    trunk: () => { const b = B.trunk(); b.obj.position.set(0.6, 0, -2.0); b.obj.rotation.y = -0.25; return b; },
  },
  mirror: {
    candles: (ctx, room) => B.candles({ points: [[-0.7, 0.88, -room.d / 2 + 0.35], [-0.55, 0.88, -room.d / 2 + 0.4], [0.6, 0.88, -room.d / 2 + 0.35], [0.75, 0.88, -room.d / 2 + 0.3], [0.68, 0.88, -room.d / 2 + 0.42]] }),
    mirror: (ctx, room) => { const b = B.mirror({ small: ctx.small }); b.obj.position.set(0, 0.95, -room.d / 2 + 0.06); return b; },
  },
  conservatory: {
    moon: () => { const b = B.moon({ r: 1.8, halo: 5 }); b.obj.position.set(-10, 22, -45); return b; },
    rain: (ctx) => { const b = B.rain({ n: ctx.small ? 400 : 1200, w: 22, h: 14, d: 22, opacity: 0.28 }); b.obj.position.set(0, 0, -6); return b; },
    window: () => { const b = B.window({ w: 1.1, h: 1.7 }); b.obj.position.set(0, 1.9, -4.95); return b; },
    vines: (ctx, room) => { const g = new THREE.Group(); for (const [x, z, ry] of [[-5, -4.95, 0], [-4.95, 3, Math.PI / 2], [4.95, -4, -Math.PI / 2]]) { const v = B.vines({ w: 9, h: 4.5, n: 9 }); v.obj.position.set(x, 0, z); v.obj.rotation.y = ry; g.add(v.obj); } return { obj: g, lights: [] }; },
  },
  kitchen: {
    candles: () => B.candles({ points: [[-0.8, 0.83, -0.6], [0.0, 0.83, -0.4], [0.9, 0.83, -0.75], [2.0, 0.96, -4.1], [2.2, 0.96, -4.2], [4.0, 0.96, -1.0]] }),
  },
  cellar: {
    candles: () => B.candles({ points: [[-2.0, 0.93, -4.7], [-1.6, 0.93, -4.6], [3.6, 0.92, -3.1], [0.6, 0, -1.2], [0.8, 0, -1.0], [0.4, 0, -0.9], [-0.2, 0, -2.6]] }),
  },
  marrow: {
    candles: () => { const pts = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; pts.push([Math.cos(a) * 2.6, 0.1, -6 + Math.sin(a) * 2.6]); } return B.candles({ points: pts }); },
    bones: () => { const b = B.bones({ r: 3, n: 40, skulls: 4 }); b.obj.position.set(0, 0.1, -2.5); return b; },
    roots: () => { const b = B.roots({ w: 11, h: 7.5, d: 14, n: 22 }); b.obj.position.set(0, 0, -3); return b; },
  },
  nursery: {
    window: () => { const b = B.window({ w: 1.0, h: 1.4 }); b.obj.position.set(0.6, 1.7, -3.43); return b; },
    moon: () => { const b = B.moon({ r: 0.1 }); b.obj.position.set(0.4, 2.0, -3.38); return b; },
    rain: () => { const b = B.rain({ n: 110, w: 0.9, h: 1.3, d: 0.02, speed: 1.0, len: 0.07, opacity: 0.5 }); b.obj.position.set(0.6, 1.0, -3.38); return b; },
    crib: () => { const b = B.crib(); b.obj.position.set(-1.6, 0, -2.4); b.obj.rotation.y = 0.35; return b; },
  },
};

// ================================================================== figures
// scene.figures: [{ who, at }]. Five stylised low-poly people, a few hundred triangles each.
// Every figure carries a fresnel rim (palette `hi`) plus one faintly self-lit element so it reads in void/bruise.
export const FIGURE_WHO = ['host', 'pip', 'cook', 'dez', 'reflection'];
export const FIGURE_AT = ['door', 'window', 'crib', 'table', 'head', 'fire', 'stair', 'mirror', 'floor', 'chair', 'vines', 'trunk', 'far', 'beside'];
const REFLECT_LAYER = 1; // only mirrors' virtual cameras render this layer

// MeshStandardMaterial plus a view-space fresnel rim added to the emissive term.
function rimMat(color, o = {}) {
  const m = mat(color, o);
  const u = { rimColor: { value: new THREE.Color(0x8899aa) }, rimPow: { value: o.rimPow ?? 2.2 }, rimK: { value: o.rimK ?? 0.55 } };
  m.userData.rim = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor; uniform float rimPow, rimK;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), rimPow); totalEmissiveRadiance += rimColor * fr * rimK; }');
  };
  m.customProgramCacheKey = () => 'marrow-rim';
  return m;
}
function limb(a, b, r0, r1, m, parent, seg = 6) {
  const A = new V3(...a), Bv = new V3(...b); const dv = Bv.clone().sub(A); const len = dv.length();
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1), m);
  o.position.copy(A).addScaledVector(dv, 0.5); o.quaternion.setFromUnitVectors(new V3(0, 1, 0), dv.normalize());
  parent.add(o); return o;
}
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const hemiGeo = (r, ws = 8, hs = 3) => new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, Math.PI * 0.5);
function plate(w, hh, m, x, y, z, parent) { return mesh(new THREE.PlaneGeometry(w, hh), m, x, y, z + 0.008, parent); } // a flat decal facing +z
const shortYaw = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// Shared rig + controller: root (position/yaw) > sway (lean, breath) > parts; head group turns.
function figure(who, height, build, o = {}) {
  const root = new THREE.Group(); const sway = new THREE.Group(); root.add(sway);
  const head = new THREE.Group();
  const rims = [];
  const R0 = R; R = seeded(FIGURE_WHO.indexOf(who) * 101 + 7);
  const extra = build({ sway, head, rims }) || {};
  R = R0;
  if (o.layer) root.traverse((c) => c.layers.set(o.layer));
  const seed = Math.random() * 100;
  const st = { pos: new V3(), yaw: 0, sink: 0, from: new V3(), to: new V3(), fy: 0, ty: 0, fs: 0, ts: 0, gt: 1, dur: 1.5, hy: 0, hTarget: 0, nextTurn: 3 + Math.random() * 4, follow: null, hist: [] };
  const fig = {
    who, height, candle: extra.candle || null, flame: 1, state: st,
    place(a, glide) {
      st.follow = a.follow || null;
      if (glide && !st.follow) {
        st.from.copy(st.pos); st.to.copy(a.pos); st.fy = st.yaw; st.ty = st.yaw + shortYaw(a.yaw - st.yaw); st.fs = st.sink; st.ts = a.sink || 0;
        st.dur = Math.min(2.2, Math.max(1.5, 1.3 + st.from.distanceTo(st.to) * 0.08)); st.gt = 0;
      } else { st.pos.copy(a.pos); st.yaw = a.yaw; st.sink = a.sink || 0; st.gt = 1; st.hist.length = 0; }
    },
  };
  const tmpF = new V3();
  function update(t, dt, ctx) {
    if (st.follow && ctx.camera) {
      // the reflection: where the viewer stood a moment ago, a little late
      const cam = ctx.camera; cam.getWorldDirection(tmpF);
      st.hist.push({ t, x: cam.position.x, z: cam.position.z, yaw: Math.atan2(tmpF.x, tmpF.z) });
      while (st.hist.length > 2 && st.hist[1].t < t - (st.follow.lag ?? 0.35)) st.hist.shift();
      const h = st.hist[0];
      const off = st.follow.off || [0, 0, 0];
      const c = Math.cos(h.yaw), s = Math.sin(h.yaw); // rotate offset into the viewer's frame (+z = behind the viewer)
      st.pos.set(h.x - off[0] * c - off[2] * s, 0, h.z + off[0] * s - off[2] * c); // off = [right, 0, behind]
      st.yaw = h.yaw;
    } else if (st.gt < 1) {
      st.gt = Math.min(1, st.gt + dt / st.dur); const k = ease(st.gt);
      st.pos.lerpVectors(st.from, st.to, k); st.yaw = st.fy + (st.ty - st.fy) * k; st.sink = st.fs + (st.ts - st.fs) * k;
    }
    const gliding = st.gt < 1 ? Math.sin(Math.PI * st.gt) : 0;
    root.position.set(st.pos.x, st.pos.y - st.sink + gliding * 0.025, st.pos.z);
    root.rotation.y = st.yaw;
    // breath and sway, pivoting at the feet
    const br = Math.sin(t * 1.55 + seed);
    sway.scale.set(1 + br * 0.006, 1 + br * 0.008, 1 + br * 0.01);
    sway.rotation.z = Math.sin(t * 0.47 + seed) * 0.012 + Math.sin(t * 0.21 + seed * 2) * 0.008;
    sway.rotation.x = Math.sin(t * 0.36 + seed * 3) * 0.009 - gliding * 0.04;
    // an occasional head turn
    st.nextTurn -= dt;
    if (st.nextTurn <= 0) { st.hTarget = Math.random() < 0.45 ? 0 : (Math.random() - 0.5) * (o.turn ?? 0.9); st.nextTurn = 3.5 + Math.random() * 6; }
    st.hy += (st.hTarget - st.hy) * Math.min(1, dt * 2.2);
    head.rotation.y = st.hy; head.rotation.x = Math.sin(t * 0.3 + seed) * 0.03 + (o.nod ?? 0);
    // rim follows the palette
    for (const m of rims) m.userData.rim.rimColor.value.copy(ctx.pal.hi).lerp(ctx.pal.key, 0.35);
    if (extra.update) extra.update(t, dt, ctx, fig);
  }
  return { obj: root, lights: [], update, fig };
}

const FIG = {};
FIG.host = () => figure('host', 1.4, ({ sway, head, rims }) => {
  // Edwin, eleven, in a dead man's evening coat that reaches the floor
  const coat = rimMat(0x151318, { r: 0.6, rimK: 0.75 }); rims.push(coat);
  const lining = rimMat(0x38323e, { r: 0.35, m: 0.2, rimK: 0.4 }); rims.push(lining);
  const white = pal(mat(0xece6da, { r: 0.6, e: 0x2c2a26 }), 'hi', 0.18);
  const skin = rimMat(0xd9c4a8, { r: 0.65, rimK: 0.35 }); rims.push(skin);
  const black = mat(0x070506, { r: 0.9 });
  const body = new THREE.Group(); body.scale.z = 0.72; sway.add(body);
  mesh(lathe([[0.3, 0], [0.285, 0.08], [0.24, 0.42], [0.2, 0.74], [0.186, 0.94], [0.2, 1.06], [0.16, 1.13], [0.06, 1.16], [0, 1.16]], 9), coat, 0, 0, 0, body);
  // shirtfront, lapels and white tie in the open coat
  box(0.1, 0.25, 0.02, white, 0, 0.98, 0.138, sway);
  for (const s of [-1, 1]) { const l = box(0.04, 0.26, 0.02, lining, s * 0.065, 0.98, 0.143, sway); l.rotation.z = s * 0.22; }
  box(0.075, 0.026, 0.02, white, 0, 1.105, 0.142, sway);
  // shoulders cut for a grown man, drooping past his own
  for (const s of [-1, 1]) { const sh = box(0.2, 0.06, 0.2, coat, s * 0.15, 1.1, 0, sway); sh.rotation.z = -s * 0.28; }
  for (const s of [-1, 1]) {
    limb([s * 0.245, 1.07, 0], [s * 0.255, 0.68, 0.05], 0.062, 0.07, coat, sway, 6);
    // sleeves turned back three times
    for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.074 + i * 0.006, 0.074 + i * 0.006, 0.032, 7, 1, true), lining, s * 0.255, 0.69 + i * 0.034, 0.05, sway);
    const glove = mesh(ico(0.045, 0), white, s * 0.255, 0.615, 0.055, sway); glove.scale.set(0.85, 1.35, 0.65);
  }
  mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.05, 7), white, 0, 1.17, 0, sway); // wing collar
  head.position.set(0, 1.19, 0); sway.add(head);
  mesh(ico(0.1, 1), skin, 0, 0.105, 0, head).scale.set(0.95, 1.05, 1);
  const hair = mesh(hemiGeo(0.106, 8, 3), black, 0, 0.115, -0.006, head); hair.rotation.x = -0.28;
  for (const s of [-1, 1]) { const m = box(0.044, 0.017, 0.012, black, s * 0.022, 0.07, 0.095, head); m.rotation.z = s * 0.14; } // burnt-cork moustache
  for (const s of [-1, 1]) box(0.016, 0.01, 0.01, black, s * 0.034, 0.118, 0.094, head);
}, { turn: 0.8 });

FIG.pip = () => figure('pip', 1.1, ({ sway, head, rims }) => {
  // a child of 1953 under a bedsheet with two eye holes, barefoot
  const sheet = pal(rimMat(0xe4e0d4, { r: 0.95, e: 0x26262c, rimK: 0.7, side: THREE.DoubleSide }), 'hi', 0.14); rims.push(sheet);
  const skin = rimMat(0xdcc2a8, { r: 0.7, rimK: 0.3 }); rims.push(skin);
  const hole = new THREE.MeshBasicMaterial({ color: 0x030203 });
  const bg = lathe([[0.3, 0.075], [0.285, 0.13], [0.25, 0.32], [0.21, 0.55], [0.18, 0.72], [0.157, 0.8]], 12);
  const p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.08) { const a = Math.atan2(p.getX(i), p.getZ(i)); p.setY(i, 0.075 + Math.sin(a * 5 + 1) * 0.022 + Math.sin(a * 9) * 0.012); const k = 1 + Math.sin(a * 7 + 2) * 0.05; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  bg.computeVertexNormals();
  mesh(bg, sheet, 0, 0, 0, sway);
  head.position.set(0, 0.8, 0); sway.add(head);
  mesh(lathe([[0.157, 0], [0.152, 0.06], [0.146, 0.14], [0.12, 0.22], [0.07, 0.28], [0, 0.3]], 12), sheet, 0, 0, 0, head);
  for (const s of [-1, 1]) { const e = mesh(new THREE.CircleGeometry(0.027, 8), hole, s * 0.054, 0.155, 0.137, head); e.scale.set(0.8, 1.2, 1); e.rotation.y = s * 0.38; }
  for (const s of [-1, 1]) { box(0.062, 0.035, 0.125, skin, s * 0.075, 0.018, 0.26, sway); mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.08, 6), skin, s * 0.075, 0.05, 0.215, sway); }
}, { turn: 0.7, nod: 0.06 });

FIG.cook = () => figure('cook', 1.7, ({ sway, head, rims }) => {
  // Hester, 1931: tall, apron, sleeves rolled to the elbow
  const dress = rimMat(0x22252d, { r: 0.85, rimK: 0.7 }); rims.push(dress);
  const roll = rimMat(0x3a3e4a, { r: 0.8, rimK: 0.5 }); rims.push(roll);
  const apron = pal(rimMat(0xd6cfbc, { r: 0.9, e: 0x221f18, rimK: 0.4, side: THREE.DoubleSide }), 'hi', 0.12); rims.push(apron);
  const skin = rimMat(0xcfb092, { r: 0.7, rimK: 0.35 }); rims.push(skin);
  const hairM = mat(0x2a1d14, { r: 0.85 });
  const low = new THREE.Group(); low.scale.z = 0.82; sway.add(low);
  mesh(lathe([[0.31, 0], [0.29, 0.14], [0.25, 0.5], [0.2, 0.8], [0.16, 0.97], [0.15, 1.0], [0, 1.0]], 8), dress, 0, 0, 0, low);
  mesh(new THREE.LatheGeometry([[0.304, 0.16], [0.266, 0.5], [0.216, 0.8], [0.176, 0.97]].map(([r, y]) => new THREE.Vector2(r, y)), 5, -0.95, 1.9), apron, 0, 0, 0, low);
  mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.035, 8, 1, true), apron, 0, 0.99, 0, low);
  const up = new THREE.Group(); up.scale.z = 0.74; sway.add(up);
  mesh(lathe([[0.15, 0.98], [0.168, 1.1], [0.188, 1.3], [0.172, 1.4], [0.12, 1.45], [0.05, 1.48], [0, 1.48]], 8), dress, 0, 0, 0, up);
  mesh(new THREE.LatheGeometry([[0.18, 1.0], [0.2, 1.18], [0.205, 1.3]].map(([r, y]) => new THREE.Vector2(r, y)), 4, -0.55, 1.1), apron, 0, 0, 0, up);
  for (const s of [-1, 1]) {
    limb([s * 0.19, 1.4, 0], [s * 0.23, 1.12, -0.01], 0.052, 0.05, dress, sway, 6);
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.055, 7), roll, s * 0.23, 1.125, -0.01, sway);
    limb([s * 0.23, 1.11, -0.01], [s * 0.07, 1.0, 0.2], 0.038, 0.03, skin, sway, 6);
    mesh(ico(0.04, 0), skin, s * 0.055, 0.995, 0.215, sway);
  }
  mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.08, 6), skin, 0, 1.5, 0, sway);
  head.position.set(0, 1.53, 0); sway.add(head);
  mesh(ico(0.1, 1), skin, 0, 0.09, 0, head).scale.set(0.9, 1.06, 0.95);
  const hair = mesh(hemiGeo(0.104, 8, 3), hairM, 0, 0.1, -0.012, head); hair.rotation.x = -0.35;
  mesh(ico(0.055, 0), hairM, 0, 0.13, -0.1, head);
  for (const s of [-1, 1]) box(0.016, 0.01, 0.01, mat(0x0a0706), s * 0.033, 0.1, 0.088, head);
}, { turn: 0.7 });

FIG.dez = () => figure('dez', 1.75, ({ sway, head, rims }) => {
  // a 1979 teenager in a glow-in-the-dark skeleton suit, holding a small honest candle
  const suit = rimMat(0x0c0c10, { r: 0.75, rimK: 0.55, rimPow: 3.2 }); rims.push(suit);
  const bone = pal(mat(0xdfe3cf, { r: 0.6, e: 0x343c2c }), 'hi', 0.2);
  const dark = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const shoe = rimMat(0x6e685e, { r: 0.8, rimK: 0.3 }); rims.push(shoe);
  for (const s of [-1, 1]) {
    limb([s * 0.09, 0.92, 0], [s * 0.1, 0.07, 0.01], 0.072, 0.05, suit, sway, 6);
    plate(0.026, 0.34, bone, s * 0.093, 0.68, 0.068, sway);
    plate(0.045, 0.04, bone, s * 0.096, 0.48, 0.066, sway);
    plate(0.022, 0.32, bone, s * 0.098, 0.27, 0.058, sway);
    box(0.1, 0.07, 0.24, shoe, s * 0.1, 0.035, 0.04, sway);
  }
  box(0.3, 0.16, 0.18, suit, 0, 0.95, 0, sway);
  plate(0.17, 0.05, bone, 0, 0.96, 0.093, sway);
  const torso = mesh(new THREE.CylinderGeometry(0.195, 0.155, 0.5, 8), suit, 0, 1.22, 0, sway); torso.scale.z = 0.62;
  plate(0.022, 0.24, bone, 0, 1.28, 0.112, sway);
  for (let i = 0; i < 4; i++) { const w = 0.24 - i * 0.025; for (const s of [-1, 1]) { const r = plate(w / 2, 0.018, bone, s * w / 4 + s * 0.014, 1.38 - i * 0.055, 0.108 - i * 0.003, sway); r.rotation.z = s * 0.18; } }
  for (const s of [-1, 1]) {
    limb([s * 0.2, 1.42, 0], [s * 0.225, 1.17, 0.06], 0.048, 0.042, suit, sway, 6);
    limb([s * 0.225, 1.17, 0.06], [s * 0.05, 1.0, 0.27], 0.042, 0.034, suit, sway, 6);
    limb([s * 0.205, 1.4, 0.045], [s * 0.228, 1.19, 0.1], 0.01, 0.01, bone, sway, 4);
    limb([s * 0.215, 1.19, 0.1], [s * 0.055, 1.03, 0.29], 0.01, 0.009, bone, sway, 4);
    mesh(ico(0.036, 0), suit, s * 0.035, 1.0, 0.285, sway);
  }
  const candle = new THREE.Group(); candle.position.set(0, 1.02, 0.3); sway.add(candle);
  mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.11, 6).translate(0, 0.055, 0), mat(0xefe6cc, { r: 0.5, e: 0x3a2a10 }), 0, 0, 0, candle);
  const flame = mesh(ico(0.024, 1), glow(0xffd090), 0, 0.14, 0, candle);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEXTURES.glow(), color: 0xffa040, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(0.55); halo.position.y = 0.14; candle.add(halo);
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 6), suit, 0, 1.49, 0, sway);
  head.position.set(0, 1.5, 0); sway.add(head);
  mesh(ico(0.11, 1), suit, 0, 0.115, 0, head);
  const skull = mesh(ico(0.088, 1), bone, 0, 0.11, 0.055, head); skull.scale.set(0.95, 1.1, 0.6);
  for (const s of [-1, 1]) mesh(new THREE.CircleGeometry(0.022, 7), dark, s * 0.033, 0.13, 0.11, head);
  const nose = mesh(new THREE.CircleGeometry(0.012, 3), dark, 0, 0.09, 0.112, head); nose.rotation.z = Math.PI / 2 * 3;
  box(0.06, 0.012, 0.01, dark, 0, 0.055, 0.105, head);
  const fs = Math.random() * 10;
  return {
    candle: flame,
    update(t, dt, ctx, fig) {
      const k = 0.85 + 0.12 * Math.sin(t * 13 + fs) + 0.07 * Math.sin(t * 29.3 + fs * 2) + (Math.random() - 0.5) * 0.1 * (0.3 + ctx.flicker);
      fig.flame = k;
      flame.scale.set(0.9 * k, 2.0 * k, 0.9 * k); flame.position.x = Math.sin(t * 7 + fs) * 0.003;
      halo.material.opacity = 0.42 * k * (halo.material.userData._fadeV ?? 1);
    },
  };
}, { turn: 0.6, nod: 0.12 });

FIG.reflection = () => figure('reflection', 1.72, ({ sway, head, rims }) => {
  // the viewer's own dark shape, seen only in the glass
  const shade = rimMat(0x17151b, { r: 1, rimK: 1.1, rimPow: 1.8 }); rims.push(shade);
  for (const s of [-1, 1]) limb([s * 0.1, 0.94, 0], [s * 0.11, 0.0, 0.0], 0.078, 0.06, shade, sway, 6);
  const torso = mesh(new THREE.CylinderGeometry(0.21, 0.16, 0.62, 8), shade, 0, 1.2, 0, sway); torso.scale.z = 0.6;
  for (const s of [-1, 1]) limb([s * 0.22, 1.46, 0], [s * 0.25, 0.8, 0.02], 0.052, 0.04, shade, sway, 6);
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), shade, 0, 1.53, 0, sway);
  head.position.set(0, 1.55, 0); sway.add(head);
  mesh(ico(0.105, 1), shade, 0, 0.08, 0, head).scale.set(0.92, 1.08, 1);
  const eyes = [];
  for (const s of [-1, 1]) { const m = pal(glow(0xffffff, { opacity: 0.8 }), 'hi', 0.45); m.userData.dyn = 1; eyes.push(mesh(new THREE.CircleGeometry(0.014, 8), m, s * 0.034, 0.1, 0.1, head)); }
  const es = Math.random() * 20;
  return {
    update(t) {
      const g = 0.55 + 0.2 * Math.sin(t * 0.7 + es) + Math.max(0, Math.sin(t * 0.23 + es) - 0.9) * 4;
      for (const e of eyes) e.material.opacity = Math.min(1, g) * (e.material.userData._fadeV ?? 1);
    },
  };
}, { layer: REFLECT_LAYER, turn: 0.35 });

// ------------------------------------------------------------------ anchors
// [x, y, z, look?, opts?]. look: [x, z] the figure faces; omitted = faces the location camera.
// opts.table: only valid when the table prop is shown (else chair -> chair_free, others -> floor).
// opts.sit: sunk so a table hides the legs (reads as seated).
function marrowFloor(x, z) { return noise3(x * 0.4, -(z + 3) * 0.4, 0, 3) * 0.25 + Math.pow(Math.abs(x) / 8, 3) * 2.5; }
function genericAnchors(loc) {
  const { w, d } = LOC[loc].room; const Lt = Math.min(3.6, w * 0.4); const nch = Math.max(2, Math.round(Lt / 1.2));
  return {
    door: [-w / 4, 0, -d / 2 + 0.8],
    window: [-w / 2 + 0.75, 0, -d / 4, [-w / 2, -d / 4]],
    crib: [-w / 4 + 0.2, 0, -d / 2 + 0.6, [-w / 4 + 0.2, -d / 2 + 1.3]],
    table: [0.6, 0, -1.5, null, { table: true }],
    head: [-(Lt / 2 + 0.45), 0, -0.6, [0, 1.6], { table: true }],
    chair: [-Lt / 2 + Lt / (2 * nch), 0, -1.45, null, { table: true, sit: true }], // the first far-side chair, clear of the centrepiece
    fire: [0.5, 0, -d / 2 + 1.35],
    mirror: [0.25, 0, -d / 2 + 1.05, [0.25, -d / 2]],
    floor: [0.3, 0, -d * 0.12],
    vines: [-w / 2 + 0.85, 0, -d / 2 + 1.4],
    trunk: [w / 4 + 0.2, 0, -d / 4 - 0.75],
    far: [-0.7, 0, -d / 2 + 0.9],
  };
}
const OUTDOOR_ANCHORS = {
  door: [0, 1.1, -3.8], window: [-2.6, 1.1, -3.85, [-2.9, -4.5]], stair: [0.45, 0.6, -1.1], trunk: [2.9, 1.1, -3.0],
  crib: [-2.4, 1.1, -3.95, [-2.4, -3.4]], mirror: [2.4, 1.1, -3.6, [2.4, -4.4]], vines: [-1.6, 1.1, -3.9],
  table: [0.6, 0, 3.1, null, { table: true }], head: [-1.65, 0, 4, [0, 6], { table: true }], chair: [0, 0, 3.15, null, { table: true, sit: true }],
};
const ANCHORS = {
  outside: { ...OUTDOOR_ANCHORS, floor: [0.25, 0, 6.0], far: [0.4, 0, -0.2], beside: [-1.3, 0, 11.3] },
  porch: { ...OUTDOOR_ANCHORS, floor: [0.9, 1.1, -2.7], far: [2.7, 1.1, -3.9], beside: [-0.75, 0.3, -0.7] },
  foyer: { door: [1.5, 0, -5.1], stair: [-4.6, 2.7, -2.04], far: [-1.0, 4.03, -5.35], floor: [0.6, 0, -0.6], window: [-3.1, 0, -3.6, [-6, -3]] },
  parlor: { fire: [0.35, 0, -3.1], chair_free: [-1.3, 0, -2.05], far: [2.8, 0, -3.75], floor: [1.0, 0, -0.5] },
  kitchen: { fire: [0.6, 0, -3.05], window: [-2.65, 0, -1.35, [-4.5, -2.25]], door: [-3.75, 0, -3.65], far: [-0.9, 0, -3.3], floor: [-1.6, 0, 1.0], chair_free: [-1.2, 0, -2.05] },
  conservatory: { window: [0.1, 0, -4.25, [0.1, -5]], vines: [-2.75, 0, -1.7], floor: [1.4, 0, -0.5], chair_free: [1.45, 0, -1.55], far: [-2.3, 0, -3.7], door: [-2.4, 0, -4.25] },
  stair: { stair: [-0.6, 2.1, 0.3], head: [-1.0, 4.8, -4.0], window: [0.25, 4.8, -4.5, [0.25, -5]], far: [1.5, 4.8, -4.3], door: [1.6, 4.8, -4.4], floor: [2.0, 0, 0.2], beside: [-0.2, 0.9, 2.1] },
  hall: { door: [0, 0, -12.6], far: [0, 0, -8.5], floor: [-0.4, 0, 5.0], window: [1.25, 0, -10.5, [2, -10.5]], mirror: [-1.25, 0, -4, [-2, -4]], fire: [0.55, 0, -12.5],
    table: [0, 0, 0.85, null, { table: true }], head: [0, 0, 0.85, null, { table: true }], chair: [0, 0, 0.85, null, { table: true }], trunk: [1.2, 0, -7.75], vines: [-1.15, 0, -12.6] },
  nursery: { crib: [-1.75, 0, -3.05, [-1.6, -2.4]], window: [0.6, 0, -2.75, [0.6, -3.5]], chair_free: [-2.75, 0, -0.7], floor: [0.3, 0, -1.0], far: [-0.35, 0, -3.0], door: [-2.85, 0, -3.0], trunk: [2.45, 0, -2.4] },
  mirror: { mirror: [0.2, 0, -3.25, [0.2, -4.5]], floor: [1.3, 0, -1.6], far: [-2.5, 0, -3.6], door: [-2.0, 0, -3.7] },
  attic: { trunk: [0.95, 0, -2.85], window: [0, 0, -4.85, [0, -5.5]], far: [1.9, 0, -4.6], floor: [-0.5, 0, -0.9], door: [-2.2, 0, -4.7] },
  cellar: { floor: [0.9, 0, -2.0], far: [0.2, 0, -4.2], stair: [-2.2, 0, -0.6], trunk: [1.6, 0, -3.2], door: [-2.2, 0, -4.15] },
  marrow: { fire: [0.9, 0, -3.8], door: [-3.5, 0, -8.2], far: [2.4, 0, -7.4], floor: [1.3, 0, -2.6], vines: [-3.4, 0, -2.0] },
};
// the reflection ignores the room: it stands where the viewer stands (or just off them), seen in the glass
const REFLECTION_AT = { mirror: { off: [0, 0, 0.05] }, beside: { off: [0.75, 0, 0.15] }, far: { off: [0, 0, 1.7], lag: 0.6 }, door: { fixed: [-1.0, 0, 4.0] } };
const ANCHOR_CACHE = {};
function anchorTable(loc) {
  if (ANCHOR_CACHE[loc]) return ANCHOR_CACHE[loc];
  const L = LOC[loc];
  const A = { ...(L.room ? genericAnchors(loc) : {}), ...(ANCHORS[loc] || {}) };
  if (!A.beside) { // beside the viewer, a few steps ahead and to the left, whole figure in frame
    const p = L.cam.p, t = L.cam.t; let fx = t[0] - p[0], fz = t[2] - p[2]; const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
    // 3.4 m ahead and 1.1 m left; where the camera tilts up (foyer, conservatory, hall, marrow...) step further
    // ahead until the feet sit above the bottom edge with room for drift, without leaving the room
    const tilt = Math.atan2(t[1] - p[1], Math.hypot(t[0] - p[0], t[2] - p[2])), half = (L.cam.fov || 50) * Math.PI / 360;
    const R = L.room, at = (k) => [p[0] + fx * k + fz * 1.1, 0, p[2] + fz * k - fx * 1.1];
    const feetNdc = (q) => { const y = (loc === 'marrow' ? marrowFloor(q[0], q[2]) : 0) - p[1], h = Math.hypot(q[0] - p[0], q[2] - p[2]); return Math.tan(Math.atan2(y, h) - tilt) / Math.tan(half); };
    const inside = (q) => !R || (Math.abs(q[0]) < R.w / 2 - 0.6 && Math.abs(q[2]) < R.d / 2 - 0.8);
    let k = 3.4; while (k < 6.5 && feetNdc(at(k)) < -0.75 && inside(at(k + 0.1))) k += 0.1;
    A.beside = at(k);
  }
  return (ANCHOR_CACHE[loc] = A);
}
export function figureAnchors(loc, who) {
  if (who === 'reflection') return Object.keys(REFLECTION_AT);
  return Object.keys(anchorTable(loc)).filter((k) => k !== 'chair_free');
}
function anchorFor(loc, at, props, fig) {
  if (fig.who === 'reflection') {
    const r = REFLECTION_AT[at] || REFLECTION_AT.mirror;
    if (r.fixed) return { pos: new V3(...r.fixed), yaw: Math.PI, sink: 0 };
    return { pos: new V3(), yaw: Math.PI, follow: r };
  }
  const A = anchorTable(loc);
  let a = A[at];
  if (a && a[4] && a[4].table && !props.includes('table')) a = at === 'chair' ? A.chair_free : null;
  if (!a) a = A.floor || [0, 0, 0];
  const [x, y0, z, look, opt = {}] = a;
  const y = loc === 'marrow' ? marrowFloor(x, z) : y0;
  const cp = LOC[loc].cam.p; const tg = look || [cp[0], cp[2]];
  return { pos: new V3(x, y, z), yaw: Math.atan2(tg[0] - x, tg[1] - z), sink: opt.sit ? Math.max(0, 0.48 * fig.height - 0.45) : 0 };
}

// ================================================================ the house
export function createHouse(canvas, opts = {}) {
  const small = opts.small ?? Math.min(window.innerWidth, window.innerHeight) < 800;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.04);
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 260);

  const hemi = new THREE.HemisphereLight(0x444444, 0x111111, 0.8); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.5); key.position.set(-10, 20, -30); scene.add(key); scene.add(key.target);
  const pool = []; for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa66, 0, 14, 1.6); scene.add(l); pool.push({ l, spot: null, seed: Math.random() * 100 }); }
  const figLight = new THREE.PointLight(0xffb060, 0, 5, 1.4); scene.add(figLight); // Dez's candle; always present so the light count never changes

  // render target + post (vignette, grain, flash, fade)
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: small ? 0 : 4 });
  const post = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rt.texture }, time: { value: 0 }, fade: { value: 0 }, flash: { value: 0 }, dip: { value: 1 }, res: { value: new THREE.Vector2(1, 1) }, grain: { value: 0.045 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time,fade,flash,dip,grain; uniform vec2 res; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 uv=vUv; vec2 c=uv-0.5;
        vec3 col; float ca=0.0015*length(c)*2.0;
        col.r=texture2D(tDiffuse,uv+c*ca).r; col.g=texture2D(tDiffuse,uv).g; col.b=texture2D(tDiffuse,uv-c*ca).b;
        col*=dip;
        col+=flash*vec3(0.75,0.8,1.0)*0.55;
        float v=smoothstep(0.95,0.25,length(c*vec2(1.15,1.0)));
        col*=mix(0.18,1.0,v);
        gl_FragColor=vec4(col,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float n=hash(uv*res+fract(time*7.13)*91.7)-0.5;
        gl_FragColor.rgb+=n*grain;
        gl_FragColor.rgb*=fade;
      }`,
    depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene(); const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);

  // dust motes
  const dn = small ? 160 : 450;
  const dpos = new Float32Array(dn * 3), dseed = new Float32Array(dn);
  for (let i = 0; i < dn; i++) { dpos.set([Math.random() - 0.5, Math.random(), Math.random() - 0.5], i * 3); dseed[i] = Math.random(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
  const dustM = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, size: { value: 22 * dpr }, color: { value: new THREE.Color(0xffffff) }, opacity: { value: 0.0 }, box: { value: new V3(10, 4, 10) } },
    vertexShader: `uniform float time,size; uniform vec3 box; attribute float aSeed; varying float vA;
      void main(){ vec3 p=position*box; p.x+=sin(time*0.11+aSeed*6.28)*0.4; p.z+=cos(time*0.09+aSeed*12.0)*0.4; p.y=mod(p.y+time*0.025*(0.4+aSeed),box.y);
      vec4 mv=modelViewMatrix*vec4(p,1.0); gl_PointSize=size*(0.4+aSeed)/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; vA=0.5+0.5*sin(time*0.8+aSeed*40.0); }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor=vec4(color,(1.0-d*2.0)*opacity*vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dg, dustM); dust.frustumCulled = false; scene.add(dust);

  // ------------------------------------------------------------ fadables
  const ctx = { small, flicker: 0, beat: 0, pal: null, t: 0, camera };
  const fadables = new Map(); // key -> { obj, vis, target, mats, lights, update }
  function register(keyName, built) {
    if (!built) return null;
    const f = { key: keyName, obj: built.obj, vis: 0, target: 0, mats: [], lights: built.lights || [], update: built.update || null, moon: !!built.moon, rain: !!built.rain, fig: built.fig || null };
    f.obj.traverse((o) => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (m.userData._base) continue; m.userData._base = { op: m.uniforms && m.uniforms.opacity ? m.uniforms.opacity.value : m.opacity, tr: m.transparent }; f.mats.push(m); } });
    f.obj.visible = false;
    scene.add(f.obj);
    f.obj.updateMatrixWorld(true);
    fadables.set(keyName, f);
    return f;
  }
  function getArch(name) { return fadables.get('arch:' + name) || register('arch:' + name, ARCH[name](ctx)); }
  function getProp(loc, name) {
    const k = loc + ':' + name; if (fadables.has(k)) return fadables.get(k);
    try { return register(k, placeProp(loc, name, ctx)); } catch (e) { console.error('[house] prop failed', k, e); return null; }
  }
  function getFigure(loc, who) {
    const k = 'fig:' + loc + ':' + who; if (fadables.has(k)) return fadables.get(k);
    try { return register(k, FIG[who]()); } catch (e) { console.error('[house] figure failed', k, e); return null; }
  }
  function placeFigures(nd, visible, instant) {
    const out = []; const seen = new Set();
    for (const f of Array.isArray(nd.figures) ? nd.figures : []) {
      if (!f || typeof f !== 'object' || !FIGURE_WHO.includes(f.who) || (f.at !== undefined && !FIGURE_AT.includes(f.at))) { console.warn('[house] ignoring figure', JSON.stringify(f)); continue; }
      if (seen.has(f.who)) { console.warn('[house] duplicate figure', f.who); continue; }
      if (f.who === 'reflection' && !nd.props.includes('mirror')) { console.warn('[house] reflection needs a mirror in the scene'); continue; }
      const fg = getFigure(nd.location, f.who); if (!fg) continue;
      seen.add(f.who);
      fg.fig.place(anchorFor(nd.location, f.at || 'floor', nd.props, fg.fig), !instant && fg.vis > 0.02);
      visible.add(fg.key); out.push({ who: f.who, at: f.at || 'floor' });
    }
    nd.figures = out;
  }
  function applyVis(f) {
    const v = f.vis;
    f.obj.visible = v > 0.003;
    for (const m of f.mats) {
      const b = m.userData._base;
      m.userData._fadeV = v;
      if (m.uniforms && m.uniforms.opacity) m.uniforms.opacity.value = b.op * v;
      else if (m.userData.dyn === undefined) m.opacity = b.op * v;
      m.transparent = b.tr || v < 0.999;
    }
  }

  // ------------------------------------------------------------ directive state
  let dir = { ...DEFAULT_DIRECTIVE };
  let curLoc = null;
  const palCur = { fog: new THREE.Color(0), amb: new THREE.Color(0), key: new THREE.Color(0), accent: new THREE.Color(0), hi: new THREE.Color(0), keyI: 0.5, hemiI: 1 };
  ctx.pal = palCur;
  let palFrom = null, palTo = null;
  let fogFrom = 0.04, fogTo = 0.04;
  let trans = 1, transDur = 2.2, locChanged = false, lightsSwapped = true, lightFade = false, nodeTime = 0;
  let camFrom = null;
  let pendingSpots = [];
  let flashes = []; let flashVal = 0;
  let fadeV = 0, fadeFrom = 0, fadeTo = 1, fadeDur = 0.001, fadeT = 1;
  const api = { onFlash: null, scene, camera, renderer };

  function paletteColors(name) {
    const p = PALETTES[name] || PALETTES.bone;
    return { fog: new THREE.Color(p.fog), amb: new THREE.Color(p.amb), key: new THREE.Color(p.key), accent: new THREE.Color(p.accent), hi: new THREE.Color(p.hi), keyI: p.keyI, hemiI: p.hemiI };
  }
  function fogDensity(f, loc) { const L = LOC[loc]; return (L && L.outdoor ? 0.012 : 0.03) + clamp01(f) * (L && L.outdoor ? 0.06 : 0.14); }

  function collectSpots(loc, keys) {
    const spots = [];
    for (const k of keys) { const f = fadables.get(k); if (!f) continue; f.obj.updateMatrixWorld(true); for (const l of f.lights) spots.push({ pos: l.pos.clone().applyMatrix4(f.obj.matrixWorld), kind: l.kind, i: l.i }); }
    spots.sort((a, b) => b.i - a.i);
    return spots.slice(0, 4);
  }

  function apply(d, o = {}) {
    const nd = { ...DEFAULT_DIRECTIVE, ...(d || {}) };
    if (!LOC[nd.location]) { console.warn('[house] unknown location', nd.location); nd.location = 'foyer'; }
    if (!PALETTES[nd.palette]) nd.palette = 'bone';
    if (!CAMERAS.includes(nd.camera)) nd.camera = 'drift';
    let props = Array.isArray(nd.props) && nd.props.length ? nd.props.filter((p) => PROPS.includes(p)) : LOC[nd.location].defaults.slice();
    if (props.includes('feast') && !props.includes('table')) props.push('table');
    nd.props = props;
    const L = LOC[nd.location];
    const visible = new Set();
    for (const a of L.arch) { getArch(a); visible.add('arch:' + a); }
    for (const p of props) { if (getProp(nd.location, p)) visible.add(nd.location + ':' + p); }
    placeFigures(nd, visible, curLoc === null || o.instant);
    for (const [k, f] of fadables) f.target = visible.has(k) ? 1 : 0;
    locChanged = nd.location !== curLoc;
    const prevSpots = pool.map((p) => p.spot);
    pendingSpots = collectSpots(nd.location, [...visible]);
    const same = !locChanged && pendingSpots.length === prevSpots.filter(Boolean).length && pendingSpots.every((s, i) => prevSpots[i] && prevSpots[i].pos.distanceTo(s.pos) < 0.01);
    lightsSwapped = same; lightFade = !same;
    if (same) pendingSpots.forEach((s, i) => (pool[i].spot = s));
    palFrom = { fog: palCur.fog.clone(), amb: palCur.amb.clone(), key: palCur.key.clone(), accent: palCur.accent.clone(), hi: palCur.hi.clone(), keyI: palCur.keyI, hemiI: palCur.hemiI };
    palTo = paletteColors(nd.palette);
    fogFrom = scene.fog.density; fogTo = fogDensity(nd.fog, nd.location);
    camFrom = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    if (curLoc === null || o.instant) { // first apply (or debug): snap
      for (const c of ['fog', 'amb', 'key', 'accent', 'hi']) palCur[c].copy(palTo[c]); palCur.keyI = palTo.keyI; palCur.hemiI = palTo.hemiI; palFrom = palTo; fogFrom = fogTo; trans = 1; lightsSwapped = false; locChanged = true;
      for (const [k, f] of fadables) { f.vis = f.target; applyVis(f); }
      const pose = poseFor(nd, 0); camera.position.copy(pose.pos); camera.quaternion.copy(pose.quat); camera.fov = pose.fov; camera.updateProjectionMatrix();
      camFrom = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
      swapLights(nd); lightFade = false;
    } else trans = 0;
    // dust box
    curLoc = nd.location; dir = nd; nodeTime = 0;
    return nd;
  }
  function swapLights(nd) {
    pool.forEach((p, i) => { p.spot = pendingSpots[i] || null; if (p.spot) p.l.position.copy(p.spot.pos); });
    const L = LOC[nd.location];
    if (L.room) { dust.position.set(-0, 0, 0); dustM.uniforms.box.value.set(L.room.w, L.room.h, L.room.d); dust.position.set(0, 0, 0); }
    else { const b = L.dust; dustM.uniforms.box.value.set(b[0], b[1], b[2]); dust.position.set(b[3], b[4], b[5]); }
    lightsSwapped = true;
  }

  const dummy = new THREE.PerspectiveCamera();
  function poseFor(d, s) {
    const L = LOC[d.location];
    const P = new V3(...L.cam.p), T = new V3(...L.cam.t);
    let fov = L.cam.fov, roll = 0;
    const v = T.clone().sub(P);
    const e = (tau) => 1 - Math.exp(-s / tau);
    switch (d.camera) {
      case 'approach': P.addScaledVector(v, 0.3 * e(28)); break;
      case 'push': P.addScaledVector(v, 0.45 * e(8)); fov -= 6 * e(8); break;
      case 'drift': {
        const off = P.clone().sub(T);
        // lateral sweep is capped at about a fifth of the room's width so long narrow rooms (the hall) keep the camera inside
        let amp = 0.22;
        if (L.room) { const lat = Math.sin(amp) * off.length(), maxLat = L.room.w * 0.22; if (lat > maxLat) amp = Math.asin(Math.min(1, maxLat / off.length())); }
        const a = Math.sin(s * 0.05) * amp; off.applyAxisAngle(new V3(0, 1, 0), a); P.copy(T).add(off); P.y += Math.sin(s * 0.08) * 0.12; break;
      }
      case 'tilt': roll = 0.2 * e(22); P.addScaledVector(v, 0.06 * e(20)); break;
      case 'fall': { const drop = Math.min(P.y - 0.35, 2.0) * e(16); P.y -= drop; T.y += drop * 0.25; roll = 0.04 * e(16); break; }
      case 'still': default: break;
    }
    // breath / handheld
    P.x += Math.sin(s * 0.6) * 0.012; P.y += Math.sin(s * 0.43 + 1) * 0.01;
    dummy.position.copy(P); dummy.up.set(0, 1, 0); dummy.lookAt(T); dummy.rotateZ(roll);
    return { pos: P, quat: dummy.quaternion.clone(), fov };
  }

  function triggerFlash(strength = 1) {
    const now = ctx.t;
    flashes.push({ t: now, a: strength }); flashes.push({ t: now + rr(0.08, 0.16), a: strength * 0.6 });
    if (R() < 0.5) flashes.push({ t: now + rr(0.25, 0.45), a: strength * 0.8 });
    if (api.onFlash) try { api.onFlash(strength); } catch (e) { /* ignore */ }
  }

  function beatAt(t) {
    const bpm = 50 + clamp01(dir.heartbeat) * 90; const ph = (t * bpm / 60) % 1;
    return Math.exp(-ph * 22) + 0.6 * Math.exp(-Math.max(0, ph - 0.18) * 22) * (ph > 0.18 ? 1 : 0);
  }

  // ------------------------------------------------------------ loop
  let last = performance.now();
  function frame(now) {
    const realDt = Math.max(0, (now - last) / 1000); // uncapped: transitions and fades keep wall-clock time even when frames are throttled
    const dt = Math.min(0.1, realDt); last = now;
    ctx.t += dt; nodeTime += dt;
    const t = ctx.t;
    ctx.flicker = clamp01(dir.flicker); ctx.beat = dir.heartbeat > 0 || dir.location === 'marrow' ? beatAt(t) : 0;

    // transition progress
    if (trans < 1) { trans = Math.min(1, trans + realDt / transDur); }
    const k = ease(trans);
    if (palFrom && palTo) {
      for (const c of ['fog', 'amb', 'key', 'accent', 'hi']) palCur[c].copy(palFrom[c]).lerp(palTo[c], k);
      palCur.keyI = palFrom.keyI + (palTo.keyI - palFrom.keyI) * k; palCur.hemiI = palFrom.hemiI + (palTo.hemiI - palFrom.hemiI) * k;
    }
    scene.fog.density = fogFrom + (fogTo - fogFrom) * k;
    scene.fog.color.copy(palCur.fog); scene.background.copy(palCur.fog);
    if (!lightsSwapped && trans >= 0.5) swapLights(dir);
    let lightK = 1;
    if (lightFade) { lightK = trans < 0.5 ? 1 - trans * 2 : (trans - 0.5) * 2; if (trans >= 1) lightFade = false; }
    const dipV = locChanged && trans < 1 ? 1 - 0.6 * Math.sin(Math.PI * trans) : 1;

    // camera
    const pose = poseFor(dir, nodeTime);
    if (trans < 1 && camFrom) {
      camera.position.copy(camFrom.pos).lerp(pose.pos, k);
      camera.quaternion.copy(camFrom.quat).slerp(pose.quat, k);
      camera.fov = camFrom.fov + (pose.fov - camFrom.fov) * k;
    } else { camera.position.copy(pose.pos); camera.quaternion.copy(pose.quat); camera.fov = pose.fov; }
    // portrait screens: the room presets are vertical fovs tuned for landscape; keep the horizontal coverage of a 1.2 aspect
    if (camera.aspect < 1.2) { const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.2 / camera.aspect; camera.fov = Math.min(110, 2 * THREE.MathUtils.radToDeg(Math.atan(half))); }
    camera.updateProjectionMatrix();

    // fades
    const rate = dt / 1.6;
    for (const f of fadables.values()) {
      if (f.vis !== f.target) { f.vis = f.target > f.vis ? Math.min(f.target, f.vis + rate) : Math.max(f.target, f.vis - rate); applyVis(f); }
      if (f.obj.visible && f.update) f.update(t, dt, ctx);
    }

    // Dez's candle
    let cf = null; for (const f of fadables.values()) if (f.fig && f.fig.candle && f.vis > 0.003 && (!cf || f.vis > cf.vis)) cf = f;
    if (cf) { cf.fig.candle.getWorldPosition(figLight.position); figLight.intensity = 2.4 * cf.vis * cf.fig.flame; } else figLight.intensity = 0;

    // lightning
    if (dir.lightning > 0 && Math.random() < dt * dir.lightning * 0.3) triggerFlash(0.6 + Math.random() * 0.4);
    flashVal = 0;
    flashes = flashes.filter((f) => t - f.t < 1.5);
    for (const f of flashes) if (t >= f.t) flashVal += f.a * Math.exp(-(t - f.t) * 14);
    flashVal = Math.min(1.5, flashVal);

    // lights
    hemi.color.copy(palCur.hi).lerp(palCur.amb, 0.55); hemi.groundColor.copy(palCur.amb).multiplyScalar(0.5);
    hemi.intensity = palCur.hemiI * (LOC[dir.location].room ? 1.35 : 0.9) + flashVal * 2.5;
    key.color.copy(palCur.key); key.intensity = palCur.keyI * 0.9 + flashVal * 5;
    const moonF = [...fadables.values()].find((f) => f.moon && f.target > 0);
    if (moonF) { key.position.setFromMatrixPosition(moonF.obj.matrixWorld); key.target.position.copy(LOC[dir.location].room ? new V3(0, 0, 0) : new V3(0, 0, -4)); }
    for (const p of pool) {
      const s = p.spot; if (!s) { p.l.intensity = 0; continue; }
      const kd = LIGHT_KIND[s.kind] || LIGHT_KIND.candle;
      const base = kd.i * s.i;
      let fl = 1;
      if (s.kind === 'candle' || s.kind === 'fire' || s.kind === 'lantern') {
        const amp = 0.06 + ctx.flicker * 0.45;
        fl = 1 + amp * (Math.sin(t * 11 + p.seed) * 0.5 + Math.sin(t * 23.3 + p.seed * 2) * 0.3) + (Math.random() - 0.5) * amp * 0.6;
        if (ctx.flicker > 0.5 && Math.random() < dt * ctx.flicker * 0.8) fl *= 0.25;
      }
      if (s.kind === 'pulse') fl = 0.5 + ctx.beat * 0.9;
      p.l.intensity = base * fl * lightK;
      p.l.distance = kd.d;
      if (kd.c === 'hi') p.l.color.copy(palCur.hi); else if (kd.c === 'accent') p.l.color.copy(palCur.accent).lerp(new THREE.Color(0xff3020), 0.3);
      else p.l.color.set(kd.c).lerp(palCur.accent, 0.3);
    }

    // palette-tied materials
    for (const m of PALMATS) {
      const pp = m.userData.pal; const target = palCur[pp.key];
      if (pp.prop === 'uniform:color') m.uniforms.color.value.copy(pp.base).lerp(target, pp.mix);
      else m[pp.prop].copy(pp.base).lerp(target, pp.mix);
    }

    dustM.uniforms.time.value = t; dustM.uniforms.color.value.copy(palCur.hi);
    dustM.uniforms.opacity.value = (LOC[dir.location].room ? 0.32 : 0.12) * (dipV);

    // global fade
    if (fadeT < 1) { fadeT = Math.min(1, fadeT + realDt / fadeDur); fadeV = fadeFrom + (fadeTo - fadeFrom) * ease(fadeT); }
    post.uniforms.time.value = t; post.uniforms.flash.value = flashVal; post.uniforms.dip.value = dipV; post.uniforms.fade.value = fadeV;

    if (rt.width < 2 || rt.width !== Math.floor(Math.max(1, window.innerWidth) * dpr)) resize();
    if (window.innerWidth < 1 || window.innerHeight < 1) { raf = requestAnimationFrame(frame); return; }
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
    renderer.setRenderTarget(null); renderer.render(postScene, postCam);
    raf = requestAnimationFrame(frame);
  }
  const LIGHT_KIND = { candle: { c: 0xffa860, i: 7, d: 10 }, fire: { c: 0xff7a30, i: 14, d: 14 }, lantern: { c: 0xff8a2a, i: 5, d: 7 }, cold: { c: 'hi', i: 5, d: 10 }, pulse: { c: 'accent', i: 16, d: 16 } };

  function resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    rt.setSize(Math.floor(w * dpr), Math.floor(h * dpr)); post.uniforms.res.value.set(w * dpr, h * dpr);
  }
  window.addEventListener('resize', resize); resize();
  let raf = requestAnimationFrame(frame);

  let previewTimer = null;
  Object.assign(api, {
    apply,
    fadeTo(v, seconds = 1) { fadeFrom = fadeV; fadeTo = v; fadeDur = Math.max(0.001, seconds); fadeT = 0; },
    flash: triggerFlash,
    preview(ms = 6000) {
      if (previewTimer) { clearInterval(previewTimer); previewTimer = null; return 'preview stopped'; }
      let i = LOCATIONS.indexOf(curLoc);
      const step = () => { i = (i + 1) % LOCATIONS.length; const loc = LOCATIONS[i]; const d = { location: loc, palette: PALETTE_NAMES[i % 5], camera: CAMERAS[i % 6], fog: 0.35, props: null, flicker: 0.3, lightning: loc === 'outside' || loc === 'conservatory' ? 0.5 : 0 }; console.log('[house.preview]', d); apply(d); };
      step(); previewTimer = setInterval(step, ms); return 'preview running; call house.preview() again to stop';
    },
    anchors: figureAnchors,
    info() { return { location: curLoc, fadables: fadables.size, figures: (dir.figures || []).map((f) => f.who + '@' + f.at).join(' '), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs.length }; },
  });
  Object.defineProperty(api, 'directive', { get: () => dir });
  return api;
}
