// ============================================================================
// Marrow House: prebaked narration player.
// Plays the clips baked by scripts/narrate.mjs (narration/<voice>/<hash>.mp3 + manifest.json) for a rendered node,
// one at a time, and tells the page when each run starts and ends so the typewriter can keep pace with the voice.
// Segmentation is narration-runs.js, the same code the bake uses, so the hashes always agree.
//
//   const nar = createNarration({ voice: 'onyx', engine: { parseText, pickBranch }, dev });
//   await nar.ready;                       // nar.available is true once the manifest loaded
//   const s = nar.speakNode(node, flags, { onRunStart(i, seconds|null, info), onRunDuration(i, seconds), onRunEnd(i), onDone() });
//   s.runs                                 // [{ text, display, hash, name, audio }] in render order
//   s.hurry()                              // let the current clip finish, skip the rest of this node
//   nar.cancel()                           // stop now (node change, title, Return)
//   nar.prefetch(['a1_treat_hand'], storyNodes, flags)
//
// Runs without audio (they interpolate {{name}}, or the clip is missing or fails to load or play) still get
// onRunStart/onRunEnd, timed at the reading speed, so the page types them at its normal pace.
// ============================================================================

import { collectRuns } from './narration-runs.js';

const SILENT_CPS = 52;        // matches the page typewriter
const PUNCT = /[.,;:!?—]/;
const CACHE_MAX = 48;         // decoded blob URLs kept around
// 0.1s of silence, used to unlock the element inside a user gesture (iOS Safari).
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Reading-speed seconds for a string, weighting punctuation the way the typewriter lingers on it. */
export function readingSeconds(s) {
  let w = 0; for (const c of s) w += PUNCT.test(c) ? 6 : 1;
  return w / SILENT_CPS;
}

export function createNarration({ voice, engine, dev = false, base = 'narration' } = {}) {
  const dir = `${base}/${voice}`;
  const log = (...a) => { if (dev) console.log('[narration]', ...a); };
  const warnedMissing = new Set();
  const cache = new Map();           // hash -> Promise<objectURL | null>
  const el = new Audio();
  el.preload = 'auto';
  let manifest = null;
  let session = null;                // the node currently being spoken
  let unlocked = false;

  const api = { available: false, voice, manifest: null, ready: null };

  api.ready = fetch(`${dir}/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((m) => {
      if (!m || typeof m.clips !== 'object') throw new Error('manifest has no clips');
      manifest = m; api.manifest = m; api.available = true;
      log(`voice "${voice}": ${Object.keys(m.clips).length} clips`);
      return true;
    })
    .catch((e) => { api.available = false; log(`no prebaked voice "${voice}" (${e.message}); Web Speech stays`); return false; });

  // ---------- segmentation ----------
  /** Runs of the node's text as rendered under flags, each with the display text the page will show. */
  function runsFor(node, flags) {
    let ast;
    try { ast = engine.parseText(String(node.text ?? '')); } catch (e) { log('parse failed', node.id, e.message); return []; }
    const pick = (n) => engine.pickBranch(n, flags);
    const runs = collectRuns(ast, pick);
    // Same walk with {{name}} replaced by what renderText shows, for the typewriter. A name never contains a blank
    // line, so both walks break at the same places and the arrays line up one to one.
    const v = flags && flags.name;
    const shown = v === null || v === undefined || String(v).trim() === '' ? 'you' : String(v).trim();
    const sub = (a) => a.map((n) => (typeof n === 'string' ? n : n.type === 'var' ? ` ${shown} `
      : { ...n, then: sub(n.then), else: n.else ? sub(n.else) : null }));
    const disp = collectRuns(sub(ast), pick);
    return runs.map((r, i) => ({ ...r, display: disp.length === runs.length ? disp[i].text : r.text,
      audio: !r.name && !!(manifest && manifest.clips[r.hash]) }));
  }

  function missing(r, node) {
    if (r.name || !manifest || manifest.clips[r.hash] || warnedMissing.has(r.hash)) return;
    warnedMissing.add(r.hash);
    log(`no clip for run ${r.hash} in ${node.id}: "${r.text.slice(0, 60)}${r.text.length > 60 ? '…' : ''}"`);
  }

  // ---------- loading ----------
  function load(hash) {
    if (cache.has(hash)) { const p = cache.get(hash); cache.delete(hash); cache.set(hash, p); return p; } // LRU touch
    const url = `${dir}/${hash}.mp3`;
    log('fetch', url);
    const p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { log('clip failed', hash, e.message); cache.delete(hash); return null; });
    cache.set(hash, p);
    while (cache.size > CACHE_MAX) {
      const [old, op] = cache.entries().next().value;
      cache.delete(old);
      op.then((u) => { if (u && el.src !== u) URL.revokeObjectURL(u); });
    }
    return p;
  }

  // ---------- playback ----------
  function stopEl() {
    el.onended = el.onerror = el.onloadedmetadata = null;
    try { el.pause(); } catch (e) { /* ignore */ }
  }

  function wait(s, ms) { return new Promise((res) => { const t = setTimeout(res, ms); s.timers.push(t); s.wake = () => { clearTimeout(t); res(); }; }); }

  /** Play one clip to its end. Resolves true if it played, false if it could not (caller falls back to a timed gap). */
  function playClip(s, url, i) {
    return new Promise((resolve) => {
      if (s.dead) return resolve(true);
      let started = false;
      const finish = (ok) => { el.onended = el.onerror = el.onloadedmetadata = null; s.wake = null; resolve(ok); };
      s.wake = () => { stopEl(); resolve(true); };
      el.onloadedmetadata = () => {
        if (started && Number.isFinite(el.duration)) s.cb.onRunDuration?.(i, el.duration);
      };
      el.onended = () => finish(true);
      el.onerror = () => { log('decode error', s.runs[i].hash); finish(false); };
      el.src = url;
      el.currentTime = 0;
      el.play().then(() => {
        if (s.dead) { stopEl(); return resolve(true); }
        started = true;
        const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
        s.cb.onRunStart?.(i, d, { audio: true });
      }).catch((e) => { log('play() refused', e.name || e.message); finish(false); });
    });
  }

  async function run(s) {
    const { runs, node } = s;
    for (let i = 0; i < runs.length; i++) {
      if (s.dead) return;
      const r = runs[i];
      if (s.hurried) { s.cb.onRunStart?.(i, 0, { audio: false, hurried: true }); s.cb.onRunEnd?.(i); continue; }
      missing(r, node);
      let played = false;
      if (r.audio) {
        const url = await load(r.hash);
        if (s.dead) return;
        // preload ahead by one
        const next = runs.slice(i + 1).find((x) => x.audio);
        if (next) load(next.hash);
        if (url && !s.hurried) played = await playClip(s, url, i);
        else if (url && s.hurried) played = true; // hurried while fetching: skip silently
      }
      if (s.dead) return;
      if (!played && !s.hurried) {
        const secs = readingSeconds(r.display) + 0.3;
        s.cb.onRunStart?.(i, secs, { audio: false });
        await wait(s, secs * 1000);
      }
      if (s.dead) return;
      s.cb.onRunEnd?.(i);
    }
    if (!s.dead) { s.active = false; session = null; s.cb.onDone?.(); }
  }

  api.speakNode = (node, flags, cb = {}) => {
    api.cancel();
    const runs = runsFor(node, flags);
    const s = { node, runs, cb, dead: false, hurried: false, active: true, timers: [], wake: null };
    s.hurry = () => {
      if (!s.active || s.hurried) return;
      s.hurried = true; log('hurry: current clip plays out, rest skipped');
      // a silent gap has nothing to play out; end it now
      if (s.wake && el.paused) s.wake();
    };
    session = s;
    if (api.available) Promise.resolve().then(() => run(s));
    else { s.active = false; session = null; }
    return s;
  };

  api.cancel = () => {
    const s = session; session = null;
    if (s) { s.dead = true; s.active = false; s.timers.forEach(clearTimeout); if (s.wake) s.wake(); }
    stopEl();
  };

  api.prefetch = (nodeIds, storyNodes, flags) => {
    if (!api.available) return;
    for (const id of nodeIds || []) {
      const n = storyNodes && storyNodes[id];
      if (!n) continue;
      const first = runsFor(n, flags).find((r) => r.audio);
      if (first) { log('prefetch', id, first.hash); load(first.hash); }
    }
  };

  /** Call from a user gesture once so later play() calls are allowed on strict browsers. */
  api.unlock = () => {
    if (unlocked || session) return;
    unlocked = true;
    el.src = SILENCE;
    el.play().then(() => el.pause()).catch(() => { unlocked = false; });
  };

  api.runsFor = runsFor;
  Object.defineProperty(api, 'speaking', { get: () => !!(session && session.active) });
  return api;
}
