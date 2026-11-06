// Pure generation logic: no DOM. Imported by app.js and by the node test.
import { hexToRgb, rgbToLab, labToLch, deltaE2000, hueDist, circularMean, hashStr, mulberry32 } from './color.js';

const withColor = o => { const rgb = hexToRgb(o.hex); const lab = rgbToLab(rgb); return { ...o, rgb, lab, lch: labToLch(lab) }; };
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function prepare(raw) {
  const paints = raw.paints.paints.filter(p => p.kind !== 'wash').map(withColor);
  const colors = raw.colors.colors.map(withColor);
  const byId = Object.fromEntries(colors.map(c => [c.id, c]));
  const pools = { dark: [], lit: [], accent: [] };
  colors.forEach(c => (pools[c.tone] || (pools[c.tone] = [])).push(c));
  colors.forEach(c => { c.matches = matchPaints(c, paints); });
  return {
    paints, colors, byId, pools,
    roles: raw.roles.roles,
    schemes: raw.schemes.schemes,
    schemeById: Object.fromEntries(raw.schemes.schemes.map(s => [s.id, s])),
    names: raw.names,
    linkTemplate: raw.paints.linkTemplate,
  };
}

export function matchPaints(c, paints) {
  const scored = paints.map(p => ({ paint: p, dE: deltaE2000(c.lab, p.lab) })).sort((a, b) => a.dE - b.dE);
  return {
    best: scored.filter(s => s.paint.kind !== 'fluoro').slice(0, 3),
    fluoro: scored.find(s => s.paint.kind === 'fluoro') || null,
    metallic: scored.find(s => s.paint.kind === 'metallic') || null,
  };
}

export function matchQuality(dE) {
  if (dE <= 4) return { tier: 1, label: 'Close match' };
  if (dE <= 8) return { tier: 2, label: 'Near match' };
  if (dE <= 14) return { tier: 3, label: 'Workable, adjust with a glaze' };
  return { tier: 4, label: 'Nearest available, mix or substitute' };
}

// ---------- learning from feedback ----------
// Each entry: { ts, ids:[5], scheme, rating:0-5 (0 = none), votes:[-1|0|1 x5], note, name }
export function buildModel(entries) {
  const color = {}, pair = {}, scheme = {};
  const add = (m, k, v) => { const e = m[k] || (m[k] = { s: 0, n: 0 }); e.s += v; e.n++; };
  let count = 0;
  for (const e of entries || []) {
    if (!e || !Array.isArray(e.ids) || e.ids.length !== 5) continue;
    count++;
    const rated = e.rating >= 1 && e.rating <= 5;
    const r = rated ? (e.rating - 3) / 2 : 0;
    e.ids.forEach((id, i) => {
      const v = (e.votes && e.votes[i]) || 0;
      if (rated || v) add(color, id, r + v);
    });
    if (rated) {
      add(pair, pairKey(e.ids[3], e.ids[4]), r);
      add(pair, pairKey(e.ids[0], e.ids[3]), r);
      add(pair, pairKey(e.ids[0], e.ids[4]), r * 0.5);
      add(pair, pairKey(e.ids[0], e.ids[1]), r * 0.5);
      if (e.scheme) add(scheme, e.scheme, r);
    }
  }
  const fin = (m, k) => Object.fromEntries(Object.entries(m).map(([id, { s, n }]) => [id, clamp(s / (n + k), -2, 2)]));
  return { color: fin(color, 2), pair: fin(pair, 2), scheme: fin(scheme, 3), count };
}

export const emptyModel = () => ({ color: {}, pair: {}, scheme: {}, count: 0 });

// ---------- scoring ----------
function tintHue(mode, p, q) {
  switch (mode) {
    case 'primary': return p.lch.h;
    case 'secondary': return q.lch.h;
    case 'complement': return (p.lch.h + 180) % 360;
    case 'between': return circularMean(p.lch.h, q.lch.h);
    default: return 280; // cool blue-black
  }
}

export function scorePalette(D, ids, scheme, model = emptyModel()) {
  const [f, st, a, p, q] = ids.map(id => D.byId[id]);
  let s = 0;
  const notes = [];

  // 1. neon harmony
  const diff = hueDist(p.lch.h, q.lch.h);
  const dev = (diff - scheme.hueOffset) / scheme.tolerance;
  s -= Math.min(dev * dev, 9);
  notes.push(`Neons ${Math.round(diff)}° apart, target ${scheme.hueOffset}°`);

  // 2. the facade must be genuinely dark
  s -= Math.max(0, f.lch.L - 24) / 5;

  // 3. structure separates from facade but stays in the same family
  const dL = Math.abs(st.lch.L - f.lch.L);
  if (dL < 4) s -= 1.5; else if (dL > 24) s -= (dL - 24) / 6; else s += 0.4;
  if (f.lch.C > 6 && st.lch.C > 6) s -= Math.max(0, hueDist(f.lch.h, st.lch.h) - 60) / 40;

  // 4. facade tint follows the scheme
  if (f.lch.C > 5) {
    const td = hueDist(f.lch.h, tintHue(scheme.darkTint, p, q));
    s -= (td / 90) * 0.9;
    notes.push(td < 50 ? `Facade leans ${scheme.darkTint === 'cool' ? 'cool' : 'toward the ' + scheme.darkTint + ' hue'}` : 'Facade tint contrasts the neons');
  } else {
    s -= 0.2;
    notes.push('Neutral facade');
  }

  // 5. lit vs dark contrast
  const contrast = Math.min(p.lch.L, q.lch.L) - f.lch.L;
  s += Math.min(contrast, 60) / 30;

  // 6. hardware accent should not compete with the neons or vanish into the facade
  if (deltaE2000(a.lab, p.lab) < 18 || deltaE2000(a.lab, q.lab) < 18) s -= 1.5;
  if (Math.abs(a.lch.L - f.lch.L) < 12) s -= 0.8;

  // 7. prefer colours you can actually buy close to
  for (const c of [f, st, a, p, q]) {
    let best = c.matches.best[0]?.dE ?? 30;
    if (c.tone === 'lit' && c.matches.fluoro) best = Math.min(best, c.matches.fluoro.dE);
    s -= Math.max(0, best - 10) / 12 * 0.5;
  }

  // 8. learned preferences
  const fb = ids.reduce((t, id) => t + (model.color[id] || 0), 0) * 0.9
    + (model.pair[pairKey(p.id, q.id)] || 0) * 1.5
    + (model.pair[pairKey(f.id, p.id)] || 0)
    + (model.pair[pairKey(f.id, q.id)] || 0) * 0.5
    + (model.scheme[scheme.id] || 0);
  s += fb;
  if (Math.abs(fb) > 0.05) notes.push(`Feedback ${fb > 0 ? '+' : ''}${fb.toFixed(2)}`);

  return { score: s, notes };
}

// ---------- generation ----------
function pickWeighted(items, wfn, rnd) {
  const w = items.map(wfn);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// locked: array of 5 ids or nulls. temperature: low = safe, high = wild.
export function generate(D, model = emptyModel(), opts = {}) {
  const rnd = opts.rng || Math.random;
  const locked = opts.locked || [null, null, null, null, null];
  const T = opts.temperature ?? 1;
  const scheme = opts.scheme
    ? D.schemeById[opts.scheme]
    : pickWeighted(D.schemes, s => (s.weight ?? 1) * Math.exp((model.scheme[s.id] || 0) * 1.5), rnd);

  const cands = [];
  for (let i = 0; i < 160; i++) {
    const ids = D.roles.map((role, slot) => locked[slot] ||
      pickWeighted(D.pools[role.tone], c => Math.exp((model.color[c.id] || 0) * 1.0), rnd).id);
    if (new Set(ids).size < 5) continue;
    if (opts.avoid && ids.join('.') === opts.avoid) continue;
    const sc = scorePalette(D, ids, scheme, model);
    cands.push({ ids, ...sc });
  }
  if (!cands.length) return null;
  const max = Math.max(...cands.map(c => c.score));
  const pick = pickWeighted(cands, c => Math.exp((c.score - max) / Math.max(0.05, T)), rnd);
  return { ids: pick.ids, scheme: scheme.id, score: pick.score, notes: pick.notes };
}

// ---------- names ----------
export function hueFamily(lch) {
  if (lch.C < 15) return 'white';
  const h = lch.h;
  if (h < 15 || h >= 325) return 'magenta';
  if (h < 50) return 'red';
  if (h < 75) return 'orange';
  if (h < 105) return 'yellow';
  if (h < 130) return 'lime';
  if (h < 165) return 'green';
  if (h < 195) return 'aqua';
  if (h < 240) return 'cyan';
  if (h < 295) return 'blue';
  return 'violet';
}

export function moodFamily(lch) {
  if (lch.C < 6) return 'neutral';
  const h = lch.h;
  if (h >= 240 && h < 300) return 'blue';
  if (h >= 300 || h < 10) return 'violet';
  if (h >= 165 && h < 240) return 'teal';
  if (h < 45) return 'red';
  if (h < 90) return 'warm';
  if (h < 135) return 'olive';
  return 'green';
}

export function nameFor(D, ids, schemeId) {
  const N = D.names;
  const rnd = mulberry32(hashStr(ids.join('.') + '|' + schemeId));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const hue = pick(N.hueWords[hueFamily(D.byId[ids[3]].lch)] || N.hueWords.white);
  const mood = pick(N.moodWords[moodFamily(D.byId[ids[0]].lch)] || N.moodWords.neutral);
  let name = pick(N.patterns)
    .replace('{place}', pick(N.places))
    .replace('{noun}', pick(N.nouns))
    .replace('{hue}', hue)
    .replace('{mood}', mood);
  // avoid "Sodium Sodium" style repeats
  const words = name.split(' ');
  if (new Set(words.map(w => w.toLowerCase())).size < words.length) name = `${hue} ${pick(N.nouns)}`;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
