// Narration segmentation, shared by scripts/narrate.mjs and site/narration-runs.js (keep the two copies identical).
// A "run" is the unit of prebaked audio: a paragraph-sized piece of text that lies between conditional boundaries.
// Conditional boundaries and blank lines break runs, so the set of all possible runs in a node is finite and small,
// and a rendered node is always a concatenation of runs that exist in the manifest.

/** FNV-1a 64-bit hex of a string (identical in Node and browsers). */
export function fnv64(str) {
  let h = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(str);
  for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}

export function normalizeRun(s) { return s.replace(/\s+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim(); }

/**
 * Collect runs from a parsed text AST (see engine parseText).
 * pick(node) -> the branch array to follow (render mode), or pass null to collect runs from EVERY branch (bake mode).
 * Each run: { text, hash, name } where name=true means the run interpolates {{name}} and is never narrated.
 */
export function collectRuns(ast, pick = null, out = []) {
  let cur = '';
  let hasName = false;
  const flush = () => {
    const t = normalizeRun(cur);
    if (t) out.push({ text: t, hash: fnv64(t), name: hasName });
    cur = ''; hasName = false;
  };
  for (const n of ast) {
    if (typeof n === 'string') {
      const parts = n.split(/\n[ \t]*\n/);
      parts.forEach((p, i) => { if (i > 0) flush(); cur += p; });
      continue;
    }
    if (n.type === 'var') { cur += ' you '; hasName = true; continue; }
    flush();
    if (pick) { const b = pick(n); if (b) collectRuns(b, pick, out); }
    else { collectRuns(n.then, null, out); if (n.else) collectRuns(n.else, null, out); }
  }
  flush();
  return out;
}
