// ============================================================================
// Marrow House: browser story engine.
// Pure, dependency free, no DOM. Semantics mirror scripts/engine.mjs exactly
// (same ops, same truthiness, same fragment grammar, same whitespace tidy);
// the only deliberate differences are the state-first argument order of the
// exported API below and that unknown flags read as undefined (with a console
// warning) instead of throwing, so a stray flag never bricks a live run.
//
//   createState(defaults, meta)   -> flags object (defaults + read-only meta)
//   applySet(state, set)          -> new flags object
//   checkRequire(state, require)  -> boolean (AND of every condition)
//   renderText(text, state)       -> string with fragments resolved
//   visibleChoices(node, state)   -> [{...choice, locked}] honouring hideIfLocked
//
// Flag ops (choice.set):  literal (true, "treat", 3, null) or delta "+N" / "-N".
// Conditions (require):   true | false | literal | ">=N" | "<=N" | ">N" | "<N" | "!=value"
// Fragments:              {{#if expr}}..{{else}}..{{/if}}  {{#unless expr}}..{{else}}..{{/unless}}
// Interpolation:          {{name}} (only names in VARS; empty/null renders the VARS fallback)
// expr:                   flag | flag=value | flag!=value | flag>=N | flag<=N | flag>N | flag<N
// ============================================================================

const DELTA = /^[+-]\d+$/;
const NUM = /^-?\d+(\.\d+)?$/;

function warn(msg) { if (typeof console !== 'undefined') console.warn('[engine] ' + msg); }

/** Coerce a textual value ("true", "3", "null", "treat") to a JS value. */
export function coerce(raw) {
  const s = String(raw).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (NUM.test(s)) return Number(s);
  return s.replace(/^["']|["']$/g, '');
}

function truthy(v) { return !(v === false || v === null || v === undefined || v === 0 || v === ''); }

function readFlag(state, name, where) {
  if (!(name in state)) warn(`${where}: unknown flag "${name}"`);
  return state[name];
}

// ---------- state ----------

/** Fresh flags: story defaults overlaid with engine-injected meta flags. */
export function createState(defaults, meta) {
  return { ...(defaults || {}), ...(meta || {}) };
}

// ---------- set ----------

/** Apply a choice's set object. Returns a new state; never mutates. */
export function applySet(state, set) {
  const out = { ...state };
  for (const [name, raw] of Object.entries(set || {})) {
    if (!(name in out)) warn(`set: unknown flag "${name}"`);
    if (typeof raw === 'string' && DELTA.test(raw)) {
      const cur = out[name] ?? 0;
      if (typeof cur !== 'number') { warn(`set: delta "${raw}" on non-numeric flag "${name}"`); continue; }
      out[name] = cur + Number(raw);
    } else if (typeof raw === 'string' && /^[+-]/.test(raw)) {
      warn(`set: bad delta "${raw}" for "${name}"`);
    } else {
      out[name] = raw;
    }
  }
  return out;
}

// ---------- conditions ----------

/** Parse a require value into { op, value }. */
export function parseCondition(cond) {
  if (cond === true || cond === false || cond === null || typeof cond === 'number') return { op: '==', value: cond };
  if (typeof cond !== 'string') return { op: '==', value: cond };
  let m;
  if ((m = cond.match(/^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/))) return { op: m[1], value: Number(m[2]) };
  if ((m = cond.match(/^!=\s*(.+)$/))) return { op: '!=', value: coerce(m[1]) };
  return { op: '==', value: cond };
}

export function testCondition(cur, { op, value }) {
  switch (op) {
    case '==':
      if (value === true) return truthy(cur);
      if (value === false) return !truthy(cur);
      return cur === value;
    case '!=':
      if (value === true) return !truthy(cur);
      if (value === false) return truthy(cur);
      return cur !== value;
    case '>=': return typeof cur === 'number' && cur >= value;
    case '<=': return typeof cur === 'number' && cur <= value;
    case '>': return typeof cur === 'number' && cur > value;
    case '<': return typeof cur === 'number' && cur < value;
    case 'truthy': return truthy(cur);
  }
  return false;
}

/** True if every condition in require holds. */
export function checkRequire(state, require) {
  for (const [name, cond] of Object.entries(require || {})) {
    if (!testCondition(readFlag(state, name, 'require'), parseCondition(cond))) return false;
  }
  return true;
}

/** Choices to display: passing ones, plus locked ones with hideIfLocked === false. */
export function visibleChoices(node, state) {
  const out = [];
  for (const c of (node && node.choices) || []) {
    const ok = checkRequire(state, c.require);
    if (ok) out.push({ ...c, locked: false });
    else if (c.hideIfLocked === false) out.push({ ...c, locked: true });
  }
  return out;
}

// ---------- fragment expressions ----------

export function parseExpr(expr) {
  const s = String(expr).trim();
  const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:(>=|<=|!=|=|>|<)\s*(.+))?$/);
  if (!m) throw new Error(`bad expression "${s}"`);
  const [, flag, op, raw] = m;
  if (!op) return { flag, op: 'truthy', value: true };
  if (['>=', '<=', '>', '<'].includes(op)) {
    if (!NUM.test(raw.trim())) throw new Error(`bad expression "${s}" (${op} needs a number)`);
    return { flag, op, value: Number(raw) };
  }
  return { flag, op: op === '=' ? '==' : '!=', value: coerce(raw) };
}

export function evalExpr(expr, state) {
  const e = typeof expr === 'string' ? parseExpr(expr) : expr;
  return testCondition(readFlag(state, e.flag, 'fragment'), e);
}

// ---------- fragments ----------

const TAG = /\{\{\s*(#if|#unless)\s+([^}]*?)\s*\}\}|\{\{\s*else\s*\}\}|\{\{\s*\/(if|unless)\s*\}\}|\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}|\{\{|\}\}/g;

/** Variables allowed as {{var}} interpolations and their fallback when empty. */
export const VARS = { name: 'you' };
// ---------- the house's own names ----------
// Typed at the threshold (input: "name"). When the first word is one of the names the house knows, the engine stores
// the canonical spelling in `name` (so page and narration agree) and the key in `name_key`; otherwise name_key is "".
// The cast and family get their own foyer greeting (a1_foyer keys on name_key); the friends share one line.
export const KNOWN_NAMES = {
  douglas: 'Douglas', dina: 'Dina', raissa: 'Raissa', eric: 'Eric', victoria: 'Victoria', steven: 'Steven',
  glenn: 'Glenn', joe: 'Joe', riley: 'Riley', jack: 'Jack', lisa: 'Lisa', casey: 'Casey', neill: 'Neill', wade: 'Wade', ty: 'Ty',
  trudie: 'Trudie', j: 'J', sean: 'Sean', nico: 'Nico', dennis: 'Dennis', zach: 'Zach', matt: 'Matt', kevin: 'Kevin',
  georgia: 'Georgia', ethan: 'Ethan', jason: 'Jason',
};
const NAME_ALIASES = { doug: 'douglas', steve: 'steven', vicky: 'victoria', vicki: 'victoria', niko: 'nico', matthew: 'matt' };
/** { name, name_key } for a typed string: trimmed, max 24 chars; canonical spelling when the house knows the name. */
export function takeName(typed) {
  const name = String(typed ?? '').trim().slice(0, 24);
  const first = name.split(/\s+/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const key = KNOWN_NAMES[first] ? first : NAME_ALIASES[first] || '';
  return key ? { name: KNOWN_NAMES[key], name_key: key } : { name, name_key: '' };
}


/** Parse text into an AST of strings and { type, expr, then, else } blocks. Throws on bad markup. */
export function parseText(text) {
  const root = { children: [] };
  const stack = [root];
  let cur = root.children;
  let last = 0;
  const re = new RegExp(TAG.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) cur.push(text.slice(last, m.index));
    last = re.lastIndex;
    const tok = m[0];
    const top = stack[stack.length - 1];
    if (m[1]) {
      const node = { type: m[1].slice(1), expr: parseExpr(m[2]), raw: m[2], then: [], else: null };
      cur.push(node);
      stack.push(node);
      cur = node.then;
    } else if (/^\{\{\s*else/.test(tok)) {
      if (stack.length === 1) throw new Error('{{else}} outside a block');
      if (top.else) throw new Error(`second {{else}} in {{#${top.type} ${top.raw}}}`);
      top.else = [];
      cur = top.else;
    } else if (m[4]) {
      if (!(m[4] in VARS)) throw new Error(`unknown variable {{${m[4]}}}`);
      cur.push({ type: 'var', name: m[4] });
    } else if (m[3]) {
      if (stack.length === 1) throw new Error(`stray {{/${m[3]}}}`);
      if (top.type !== m[3]) throw new Error(`{{#${top.type} ${top.raw}}} closed by {{/${m[3]}}}`);
      stack.pop();
      const parent = stack[stack.length - 1];
      cur = parent === root ? root.children : parent.else ?? parent.then;
    } else {
      throw new Error(`malformed tag near "${text.slice(m.index, m.index + 30)}"`);
    }
  }
  if (last < text.length) cur.push(text.slice(last));
  if (stack.length > 1) throw new Error(`unclosed {{#${stack[stack.length - 1].type}}}`);
  return root.children;
}

function renderAst(ast, pick) {
  let s = '';
  for (const n of ast) {
    if (typeof n === 'string') { s += n; continue; }
    if (n.type === 'var') { s += pick(n); continue; }
    const branch = pick(n);
    if (branch) s += renderAst(branch, pick);
  }
  return s;
}

/** Tidy whitespace left behind by removed fragments; keep paragraph breaks. */
export function tidy(s) {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

/**
 * The branch a conditional AST node ({ type: 'if' | 'unless', expr, then, else }) takes under state: the same
 * decision renderText makes. Returns n.then, n.else, or null. Used by the narration player as collectRuns' pick.
 */
export function pickBranch(n, state) {
  let ok = evalExpr(n.expr, state);
  if (n.type === 'unless') ok = !ok;
  return (ok ? n.then : n.else) || null;
}

/** Render node text for the given flags. Malformed markup degrades to tag-stripped text. */
export function renderText(text, state) {
  let ast;
  try { ast = parseText(String(text ?? '')); }
  catch (e) { warn(`text: ${e.message}`); return tidy(String(text ?? '').replace(/\{\{[^}]*\}\}/g, '')); }
  return tidy(renderAst(ast, (n) => {
    if (n.type === 'var') {
      const v = state[n.name];
      return v === null || v === undefined || String(v).trim() === '' ? VARS[n.name] : String(v).trim();
    }
    let ok = evalExpr(n.expr, state);
    if (n.type === 'unless') ok = !ok;
    return ok ? n.then : n.else;
  }));
}
