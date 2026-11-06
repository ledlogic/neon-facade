import { prepare, buildModel, generate, scorePalette, nameFor, matchQuality } from './generator.js';

const STORE = 'neonfacade.feedback.v1';
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let D, committed = [], model, current = null;
const locks = [false, false, false, false, false];
let votes = [0, 0, 0, 0, 0];
let rating = 0;

// ---------- storage ----------
function localEntries() {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
}
function saveLocal(list) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { toast('Could not save to this browser'); }
}
const entryKey = e => `${e.ts}|${e.ids.join('.')}`;
function allEntries() {
  const seen = new Set(), out = [];
  for (const e of [...committed, ...localEntries()]) {
    if (!e || !Array.isArray(e.ids)) continue;
    const k = entryKey(e);
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}
function rebuildModel() { model = buildModel(allEntries()); }

// ---------- loading ----------
async function getJSON(name, fallback) {
  try {
    const r = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not load data/${name}.json`);
  }
}

async function init() {
  try {
    const [paints, colors, roles, schemes, names, fb] = await Promise.all([
      getJSON('paints'), getJSON('colors'), getJSON('roles'), getJSON('schemes'), getJSON('names'),
      getJSON('feedback', { entries: [] }),
    ]);
    D = prepare({ paints, colors, roles, schemes, names });
    committed = fb.entries || [];
  } catch (e) {
    $('#swatches').innerHTML = `<p class="error">${esc(e.message)}. If you opened index.html straight from disk, serve the folder instead (see README).</p>`;
    return;
  }
  rebuildModel();
  if (!loadFromUrl()) regenerate(false);
  bind();
  renderLearned();
  renderHistory();
}

// ---------- URL ----------
function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  const s = p.get('s');
  if (!s) return false;
  const ids = s.split('.');
  if (ids.length !== 5 || !ids.every((id, i) => D.byId[id] && D.byId[id].tone === D.roles[i].tone)) {
    toast('That link has colours this version does not know, generated a new set');
    return false;
  }
  const scheme = D.schemeById[p.get('k')] ? p.get('k') : D.schemes[0].id;
  setCurrent({ ids, scheme, notes: scorePalette(D, ids, D.schemeById[scheme], model).notes }, null);
  return true;
}
function setUrl(push) {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('s', current.ids.join('.'));
  u.searchParams.set('k', current.scheme);
  history[push ? 'pushState' : 'replaceState'](null, '', u);
}

// ---------- generation ----------
function regenerate(push = true, onlySlot = null) {
  const locked = current
    ? current.ids.map((id, i) => (onlySlot !== null ? (i === onlySlot ? null : id) : (locks[i] ? id : null)))
    : [null, null, null, null, null];
  const res = generate(D, model, {
    locked,
    temperature: parseFloat($('#temp').value),
    avoid: current?.ids.join('.'),
    scheme: onlySlot !== null ? current.scheme : undefined,
  });
  if (!res) { toast('No valid combination with those locks'); return; }
  setCurrent(res, push);
}

function setCurrent(res, push) {
  current = { ...res, name: nameFor(D, res.ids, res.scheme) };
  votes = [0, 0, 0, 0, 0];
  rating = 0;
  $('#note').value = '';
  render();
  if (push !== null) setUrl(push);
}

// ---------- rendering ----------
function paintRow(m) {
  const q = matchQuality(m.dE);
  const p = m.paint;
  const href = D.linkTemplate.replace('{code}', encodeURIComponent(p.code));
  const flag = p.hueConfirmed === false ? ' <span class="flag" title="Glow hue not confirmed from the manufacturer">?</span>' : '';
  return `<a class="paint" href="${href}" target="_blank" rel="noopener" title="${esc(q.label)}">
    <span class="dot" style="background:${p.hex}"></span>
    <span class="pn">${esc(p.name)}${flag}</span>
    <span class="code">${p.code}</span>
    <span class="de q${q.tier}">ΔE ${m.dE.toFixed(1)}</span></a>`;
}

function swatchHTML(c, role, slot) {
  const m = c.matches;
  let extra = '';
  if (role.tone === 'lit' && m.fluoro && m.fluoro.dE < 30) extra = `<p class="opt-label">Fluorescent option</p>${paintRow(m.fluoro)}`;
  else if (c.tags?.includes('metal') && m.metallic && !m.best.some(b => b.paint.kind === 'metallic')) extra = `<p class="opt-label">Metallic option</p>${paintRow(m.metallic)}`;
  const v = votes[slot];
  return `<article class="swatch ${role.tone} ${locks[slot] ? 'locked' : ''}" data-slot="${slot}">
    <div class="chip" style="--c:${c.hex}"><span class="role">${slot + 1} · ${esc(role.label)}</span></div>
    <div class="body">
      <h3>${esc(c.name)}</h3>
      <p class="usage">${esc(role.usage)}</p>
      <dl class="vals"><dt>HEX</dt><dd>${c.hex.toUpperCase()}</dd><dt>RGB</dt><dd>${c.rgb.join(', ')}</dd></dl>
      <div class="paints"><p class="opt-label">Warpaints Fanatic</p>${m.best.map(paintRow).join('')}${extra}</div>
      <div class="tools">
        <button class="tool" data-act="lock" aria-pressed="${locks[slot]}">${locks[slot] ? 'Locked' : 'Lock'}</button>
        <button class="tool" data-act="reroll">Reroll</button>
        <button class="tool vote ${v > 0 ? 'on' : ''}" data-act="up" aria-label="Good colour for this slot">▲</button>
        <button class="tool vote ${v < 0 ? 'on bad' : ''}" data-act="down" aria-label="Bad colour for this slot">▼</button>
      </div>
    </div></article>`;
}

function render() {
  const cols = current.ids.map(id => D.byId[id]);
  const scheme = D.schemeById[current.scheme];
  $('#setName').textContent = current.name;
  document.title = `${current.name} · Neon Facade`;
  $('#schemeLabel').textContent = scheme.label;
  $('#schemeNote').textContent = scheme.note;
  $('#notes').innerHTML = (current.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
  $('#strip').innerHTML = cols.map(c => `<span style="background:${c.hex}"></span>`).join('');
  $('#swatches').innerHTML = cols.map((c, i) => swatchHTML(c, D.roles[i], i)).join('');
  renderStars();
}

function renderStars() {
  document.querySelectorAll('#stars button').forEach(b => {
    const n = +b.dataset.n;
    b.classList.toggle('on', n <= rating);
    b.setAttribute('aria-checked', n === rating);
  });
}

function renderLearned() {
  const entries = Object.entries(model.color).sort((a, b) => b[1] - a[1]);
  const chip = ([id, v]) => {
    const c = D.byId[id];
    return c ? `<span class="lchip" title="${v.toFixed(2)}"><i style="background:${c.hex}"></i>${esc(c.name)}</span>` : '';
  };
  const likes = entries.filter(e => e[1] > 0.05).slice(0, 6).map(chip).join('');
  const dislikes = entries.filter(e => e[1] < -0.05).reverse().slice(0, 6).map(chip).join('');
  const schemes = Object.entries(model.scheme).sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `${esc(D.schemeById[id]?.label || id)} ${v > 0 ? '+' : ''}${v.toFixed(2)}`).join(', ');
  $('#learned').innerHTML = model.count
    ? `<p class="meta">${model.count} rated set${model.count === 1 ? '' : 's'} (${committed.length} from feedback.json, ${localEntries().length} in this browser)</p>
       <div class="lrow"><span class="lbl">Favouring</span>${likes || '<em>nothing yet</em>'}</div>
       <div class="lrow"><span class="lbl">Avoiding</span>${dislikes || '<em>nothing yet</em>'}</div>
       ${schemes ? `<p class="meta">Schemes: ${schemes}</p>` : ''}`
    : '<p class="meta">No feedback yet. Rate a few sets and the generator starts leaning toward what you like.</p>';
}

function renderHistory() {
  const list = localEntries().slice().reverse().slice(0, 24);
  $('#history').innerHTML = list.length ? list.map(e => {
    const cols = e.ids.map(id => D.byId[id]).filter(Boolean);
    const href = `?s=${e.ids.join('.')}&k=${encodeURIComponent(e.scheme || '')}`;
    return `<a class="hist" href="${href}"><span class="mini">${cols.map(c => `<i style="background:${c.hex}"></i>`).join('')}</span>
      <span class="hn">${esc(e.name || nameFor(D, e.ids, e.scheme))}</span>
      <span class="hs">${e.rating ? '★'.repeat(e.rating) + '☆'.repeat(5 - e.rating) : 'votes only'}</span></a>`;
  }).join('') : '<p class="meta">Sets you rate show up here, click one to bring it back.</p>';
}

// ---------- feedback ----------
function saveFeedback() {
  if (!rating && votes.every(v => v === 0)) { toast('Pick a star rating or vote on a swatch first'); return; }
  const entry = {
    ts: new Date().toISOString(),
    ids: current.ids.slice(),
    scheme: current.scheme,
    name: current.name,
    rating,
    votes: votes.slice(),
    note: $('#note').value.trim(),
  };
  const list = localEntries(); list.push(entry); saveLocal(list);
  rebuildModel(); renderLearned(); renderHistory();
  toast('Saved, generating the next set');
  regenerate(true);
}

function exportFeedback() {
  const data = { version: 1, exportedAt: new Date().toISOString(), note: 'Commit as data/feedback.json to ship this tuning with the site.', entries: allEntries() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'feedback.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importFeedback(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(incoming)) throw new Error('no entries');
    const list = localEntries();
    const keys = new Set(list.map(entryKey));
    let added = 0;
    for (const e of incoming) if (e && Array.isArray(e.ids) && !keys.has(entryKey(e))) { list.push(e); keys.add(entryKey(e)); added++; }
    saveLocal(list); rebuildModel(); renderLearned(); renderHistory();
    toast(`Imported ${added} entr${added === 1 ? 'y' : 'ies'}`);
  } catch { toast('That file is not a feedback export'); }
}

function paintList() {
  const lines = [`${current.name} (${D.schemeById[current.scheme].label})`, location.href, ''];
  current.ids.forEach((id, i) => {
    const c = D.byId[id], m = c.matches.best[0];
    let line = `${D.roles[i].label}: ${c.name} ${c.hex.toUpperCase()} -> Warpaints Fanatic ${m.paint.name} (${m.paint.code}, ΔE ${m.dE.toFixed(1)})`;
    if (D.roles[i].tone === 'lit' && c.matches.fluoro && c.matches.fluoro.dE < 30) line += `, glow: ${c.matches.fluoro.paint.name} (${c.matches.fluoro.paint.code})`;
    lines.push(line);
  });
  return lines.join('\n');
}

// ---------- events ----------
function bind() {
  $('#regen').addEventListener('click', () => regenerate(true));
  $('#copyLink').addEventListener('click', () => copy(location.href, 'Link copied'));
  $('#copyList').addEventListener('click', () => copy(paintList(), 'Paint list copied'));
  $('#saveRating').addEventListener('click', saveFeedback);
  $('#exportFb').addEventListener('click', exportFeedback);
  $('#importFb').addEventListener('change', e => { if (e.target.files[0]) importFeedback(e.target.files[0]); e.target.value = ''; });
  $('#resetFb').addEventListener('click', () => {
    if (confirm('Clear the feedback stored in this browser? Export first if you want to keep it.')) {
      saveLocal([]); rebuildModel(); renderLearned(); renderHistory(); toast('Local feedback cleared');
    }
  });
  $('#temp').addEventListener('input', e => { $('#tempVal').textContent = (+e.target.value).toFixed(1); });

  $('#stars').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const n = +b.dataset.n; rating = rating === n ? 0 : n; renderStars();
  });

  $('#swatches').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const slot = +b.closest('.swatch').dataset.slot;
    const act = b.dataset.act;
    if (act === 'lock') { locks[slot] = !locks[slot]; render(); }
    else if (act === 'reroll') { const keep = votes.slice(); regenerate(true, slot); votes = keep.map((v, i) => (i === slot ? 0 : v)); render(); }
    else if (act === 'up') { votes[slot] = votes[slot] === 1 ? 0 : 1; render(); }
    else if (act === 'down') { votes[slot] = votes[slot] === -1 ? 0 : -1; render(); }
  });

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (['TEXTAREA', 'INPUT', 'BUTTON', 'A', 'SELECT', 'LABEL'].includes(tag)) return;
    e.preventDefault(); regenerate(true);
  });

  window.addEventListener('popstate', () => { if (!loadFromUrl()) regenerate(false); });
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt('Copy this:', text); }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

init();
