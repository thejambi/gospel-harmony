/* Harmony of the Gospels — reading checklist.
 * Vanilla JS, no build step. State lives in localStorage.
 *
 * Core idea: progress is recorded per VERSE, not per checkbox. Ticking any
 * passage (in the harmony or on an assignment sheet) marks its verses read,
 * and every other place that shows an overlapping passage updates with it.
 */
(() => {
  'use strict';

  const D = window.HARMONY_DATA;
  const GOSPELS = ['Mt', 'Mk', 'Lk', 'Jn'];
  const BOOK_NAME = { Mt: 'Matthew', Mk: 'Mark', Lk: 'Luke', Jn: 'John', Ac: 'Acts', Isa: 'Isaiah', Mal: 'Malachi', Heb: 'Hebrews', '1Co': '1 Corinthians' };
  const BOOK_ABBR = { Mt: 'Mt', Mk: 'Mk', Lk: 'Lk', Jn: 'Jn', Ac: 'Acts', Isa: 'Isa', Mal: 'Mal', Heb: 'Heb', '1Co': '1 Cor' };
  // Verses per chapter (standard English versification).
  const VC = {
    Mt: [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
    Mk: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
    Lk: [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
    Jn: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  };
  const SHEET_SHORT = ['', 'Birth & childhood', 'Baptist, baptism, temptation', 'Early Judean ministry', 'The Galilean ministry',
    'Training of the Twelve', 'The last six months', 'Route to Jerusalem', 'Passion Week: Mon–Wed', 'Passion Week: Thu–Sun'];
  const STORE_KEY = 'gospel-harmony:v1';

  /* ------------------------------------------------------------ utilities */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paras = (text) => String(text || '').split('\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
  const fmtInt = (n) => n.toLocaleString('en-US');
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ------------------------------------------------------------ references */
  const chapLen = (b, c) => (VC[b] ? VC[b][c - 1] : 200) || 0;

  function expand(ref) {
    const out = [];
    for (const [c1, v1, c2, v2] of ref.s) {
      for (let c = c1; c <= c2; c++) {
        const from = v1 == null || c > c1 ? 1 : v1;
        const to = v2 == null || c < c2 ? chapLen(ref.b, c) : v2;
        for (let v = from; v <= to; v++) out.push(c * 1000 + v);
      }
    }
    return [...new Set(out)];
  }

  function fmtSegs(ref) {
    // Merge adjacent single verses ("1:12, 13" -> "1:12–13") and print compactly.
    const segs = [];
    for (const s of ref.s) {
      const last = segs[segs.length - 1];
      if (last && s[1] != null && last[3] != null && s[0] === last[2] && s[0] === s[2] && s[1] === last[3] + 1) last[3] = s[3];
      else segs.push([...s]);
    }
    let prevC = null;
    return segs.map(([c1, v1, c2, v2]) => {
      let str;
      if (v1 == null) str = c1 === c2 ? `${c1}` : `${c1}–${c2}`;
      else if (c1 === c2) str = (c1 === prevC ? '' : `${c1}:`) + (v1 === v2 ? `${v1}` : `${v1}–${v2}`);
      else str = (c1 === prevC ? '' : `${c1}:`) + `${v1}–${c2}:${v2}`;
      prevC = c2;
      return str;
    }).join(', ');
  }
  const fmtRef = (ref) => `${BOOK_ABBR[ref.b]} ${fmtSegs(ref)}`;
  const longRef = (ref) => `${BOOK_NAME[ref.b]} ${fmtSegs(ref)}`;

  /* ------------------------------------------------------------ Scripture: BSB via fetch.bible
   * Each book is one static JSON file: contents[chapter][verse] = [open, verseHtml, close].
   * A range v1..v2 is open(v1) + verseHtml(v1..v2) + close(v2). Books are cached with the
   * Cache API so a passage read once is available offline afterwards.            */
  const FB_URL = 'https://v1.fetch.bible/bibles/eng_bsb/html/';
  const FB_BOOK = { Mt: 'mat', Mk: 'mrk', Lk: 'luk', Jn: 'jhn', Ac: 'act', Isa: 'isa', Mal: 'mal', Heb: 'heb', '1Co': '1co' };
  const FB_CACHE = 'bsb-v1';
  const books = new Map();

  function fetchBook(b) {
    if (!books.has(b)) {
      const url = FB_URL + FB_BOOK[b] + '.json';
      const p = (async () => {
        let cache = null;
        try {
          cache = await caches.open(FB_CACHE);
          const hit = await cache.match(url);
          if (hit) return (await hit.json()).contents;
        } catch (e) { cache = null; }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch.bible returned ${res.status}`);
        if (cache) cache.put(url, res.clone()).catch(() => {});
        return (await res.json()).contents;
      })();
      p.catch(() => books.delete(b));
      books.set(b, p);
    }
    return books.get(b);
  }

  // Only the handful of tags fetch.bible emits, with only the attributes we style.
  const SAFE_TAGS = new Set(['P', 'H3', 'H4', 'SUP', 'SPAN', 'BR', 'EM', 'I', 'B', 'STRONG']);
  const SAFE_ATTRS = new Set(['class', 'data-v', 'data-c']);
  function sanitize(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    (function walk(node) {
      for (const el of [...node.children]) {
        if (!SAFE_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
        for (const a of [...el.attributes]) if (!SAFE_ATTRS.has(a.name)) el.removeAttribute(a.name);
        walk(el);
      }
    })(t.content);
    // unwrap may expose new children of the parent; run once more for safety
    t.content.querySelectorAll('*').forEach((el) => { if (!SAFE_TAGS.has(el.tagName)) el.replaceWith(...el.childNodes); });
    return t.innerHTML;
  }

  function passageHtml(contents, ref) {
    return ref.s.map(([c1, v1, c2, v2]) => {
      let html = '', last = null;
      for (let c = c1; c <= c2; c++) {
        const ch = contents[c]; if (!ch) continue;
        const from = c === c1 && v1 != null ? v1 : 1;
        const to = c === c2 && v2 != null ? v2 : ch.length - 1;
        for (let v = from; v <= to; v++) {
          const cell = ch[v];
          if (!cell || !cell[1]) continue; // verse omitted by the BSB (footnoted at the prior verse)
          if (!last) html += cell[0];
          html += cell[1]; last = cell;
        }
      }
      // the source text has "( that is … )"-style padding inside some parentheses
      // (and a stray "vvv" in fetch.bible's Luke 9:33)
      return last ? (html + last[2]).replace(/\(\s*vvv\s*/g, '(').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')') : '';
    }).filter(Boolean).join('<div class="gap" aria-label="verses omitted">· · ·</div>');
  }

  // Registry of every passage the app can show. rid -> { ref, b, verses }
  const REFS = [];
  function reg(ref) { REFS.push({ ref, b: ref.b, verses: expand(ref) }); return REFS.length - 1; }

  /* ------------------------------------------------------------ state */
  const state = { read: {}, notes: {}, prefs: { view: 'harmony', sheet: 1, filter: 'all', footnotes: false } };

  function toRanges(set) {
    const a = [...set].sort((x, y) => x - y), r = [];
    for (const v of a) { const l = r[r.length - 1]; if (l && v === l[1] + 1) l[1] = v; else r.push([v, v]); }
    return r;
  }
  function serialize() {
    const read = {};
    for (const b in state.read) if (state.read[b].size) read[b] = toRanges(state.read[b]);
    return { app: 'gospel-harmony', version: 1, saved: new Date().toISOString(), read, notes: state.notes, prefs: state.prefs };
  }
  function hydrate(obj) {
    state.read = {};
    for (const b in obj.read || {}) {
      const s = new Set();
      for (const [x, y] of obj.read[b]) for (let v = x; v <= y; v++) s.add(v);
      state.read[b] = s;
    }
    state.notes = obj.notes || {};
    Object.assign(state.prefs, obj.prefs || {});
  }
  let storageOk = true;
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) hydrate(JSON.parse(raw)); }
    catch (e) { storageOk = false; }
  }
  const save = debounce(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); }
    catch (e) { if (storageOk) toast('Could not save — browser storage is unavailable. Export a backup to keep your work.'); storageOk = false; }
  }, 250);

  const bookSet = (b) => (state.read[b] || (state.read[b] = new Set()));
  function readCount(rid) { const r = REFS[rid], s = state.read[r.b]; if (!s) return 0; let n = 0; for (const v of r.verses) if (s.has(v)) n++; return n; }
  function status(rid) { const n = readCount(rid); return n === 0 ? '' : n >= REFS[rid].verses.length ? 'done' : 'part'; }

  let lastChange = null;
  function setRead(rids, on, label) {
    const changed = {};
    for (const rid of rids) {
      const r = REFS[rid], s = bookSet(r.b);
      for (const v of r.verses) {
        if (on && !s.has(v)) { s.add(v); (changed[r.b] ||= []).push(v); }
        if (!on && s.has(v)) { s.delete(v); (changed[r.b] ||= []).push(v); }
      }
    }
    lastChange = { changed, on };
    save(); refresh();
    if (!on && Object.keys(changed).length) toast(`Unmarked ${label}`, 'Undo', undo);
  }
  function undo() {
    if (!lastChange) return;
    const { changed, on } = lastChange;
    for (const b in changed) { const s = bookSet(b); for (const v of changed[b]) on ? s.delete(v) : s.add(v); }
    lastChange = null; save(); refresh();
  }

  /* notes: id -> { t: text, s: 'open' | 'resolved' | undefined, u: updated ms } */
  const NOTE_META = {}; // id -> { label, where, order, jump() }
  function noteBox(id, placeholder, meta) {
    NOTE_META[id] = meta;
    const n = state.notes[id] || {};
    const el = h(`<div class="notebox${n.t ? ' has' : ''}" data-note="${esc(id)}">
      <textarea rows="2" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${esc(n.t || '')}</textarea>
      <div class="note-status" role="group" aria-label="Note status">
        <button data-s="" aria-pressed="${!n.s}">Note</button>
        <button data-s="open" aria-pressed="${n.s === 'open'}">Open question</button>
        <button data-s="resolved" aria-pressed="${n.s === 'resolved'}">Resolved</button>
      </div>
    </div>`);
    const ta = $('textarea', el);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 44) + 'px'; };
    requestAnimationFrame(grow);
    ta.addEventListener('input', () => {
      grow();
      const cur = state.notes[id] || {};
      cur.t = ta.value; cur.u = Date.now();
      if (!cur.t.trim() && !cur.s) delete state.notes[id]; else state.notes[id] = cur;
      el.classList.toggle('has', !!ta.value.trim());
      mirrorNote(id, el);
      save(); syncNoteMarks();
    });
    $$('.note-status button', el).forEach((b) => b.addEventListener('click', () => {
      const cur = state.notes[id] || { t: '' };
      cur.s = b.dataset.s || undefined; cur.u = Date.now();
      state.notes[id] = cur;
      $$('.note-status button', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      mirrorNote(id, el);
      save(); syncNoteMarks();
    }));
    return el;
  }
  // The same note can be open twice (e.g. in the reader and on the page beneath it).
  function mirrorNote(id, from) {
    const n = state.notes[id] || {};
    $$('.notebox').forEach((box) => {
      if (box === from || box.dataset.note !== id) return;
      const ta = $('textarea', box);
      if (ta.value !== (n.t || '')) ta.value = n.t || '';
      box.classList.toggle('has', !!(n.t || '').trim());
      $$('.note-status button', box).forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.s || undefined) === n.s)));
    });
  }
  const hasNote = (id) => !!(state.notes[id] && state.notes[id].t && state.notes[id].t.trim());
  function syncNoteMarks() {
    const open = Object.entries(state.notes).filter(([, n]) => n.s === 'open' && n.t && n.t.trim()).length;
    const badge = $('#open-count');
    badge.hidden = !open; badge.textContent = open; badge.title = `${open} open question${open === 1 ? '' : 's'}`;
    $$('[data-has-note]').forEach((el) => {
      const ids = el.dataset.hasNote.split(' ');
      const st = ids.map((i) => state.notes[i]).filter((n) => n && n.t && n.t.trim());
      el.classList.toggle('noted', st.length > 0);
      el.classList.toggle('open-q', st.some((n) => n.s === 'open'));
    });
  }

  /* ------------------------------------------------------------ indexing */
  const SECTIONS = [];      // in order: { n, sec, part, rids: [Mt,Mk,Lk,Jn] (rid|null), extra: [{rid, cf}] }
  const PARTS = [];         // { part, unit, secs: [n...] }
  const SEC_BY_N = {};
  const verseToSecs = {};   // "Mt:14013" -> [n...]

  D.units.forEach((unit) => unit.parts.forEach((part) => {
    const P = { part, unit, secs: [] };
    PARTS.push(P);
    part.items.forEach((it) => {
      if (it.t !== 'sec') return;
      const S = { n: it.n, sec: it, part: P, rids: [null, null, null, null], extra: [] };
      for (const ref of it.refs) {
        const rid = reg(ref);
        const gi = GOSPELS.indexOf(ref.b);
        if (gi >= 0 && !ref.cf && S.rids[gi] == null) S.rids[gi] = rid;
        else S.extra.push({ rid, cf: !!ref.cf });
        if (gi >= 0 && !ref.cf) for (const v of REFS[rid].verses) (verseToSecs[ref.b + ':' + v] ||= new Set()).add(it.n);
      }
      S.req = [...S.rids.filter((r) => r != null), ...S.extra.filter((x) => !x.cf).map((x) => x.rid)];
      SECTIONS.push(S); SEC_BY_N[it.n] = S; P.secs.push(it.n);
    });
  }));

  const HARMONY_VERSES = (() => { let n = 0; for (const k in verseToSecs) n++; return n; })();

  // Sheets: register readings, cross-reference to harmony sections by verse overlap.
  const GROUPS = {}; // gid -> { sheet, g }
  const SHEETS = D.sheets.map((sheet) => {
    let qseq = 0;
    const groups = [];
    sheet.items.forEach((g, gi) => {
      if (!g.r) return;
      g.gid = `g-${sheet.n}-${gi}`;
      GROUPS[g.gid] = { sheet, g };
      g.r.forEach((r) => {
        r.rid = reg(r.ref);
        const secs = new Set();
        for (const v of REFS[r.rid].verses) for (const n of verseToSecs[r.ref.b + ':' + v] || []) secs.add(n);
        r.secs = [...secs].sort((a, b) => a - b);
        (r.q || []).forEach((q) => { q.id = `q:${sheet.n}:${++qseq}`; });
      });
      (g.q || []).forEach((q) => { q.id = `q:${sheet.n}:${++qseq}`; });
      g.secs = [...new Set(g.r.flatMap((r) => r.secs))].sort((a, b) => a - b);
      groups.push(g);
    });
    const req = groups.flatMap((g) => g.r.filter((r) => !r.opt).map((r) => r.rid));
    return { sheet, groups, req };
  });
  // section n -> [{ sheet, group }]
  const SEC_SHEETS = {};
  SHEETS.forEach(({ sheet, groups }) => groups.forEach((g) => g.secs.forEach((n) => {
    const list = (SEC_SHEETS[n] ||= []);
    if (!list.some((x) => x.sheet === sheet && x.group === g)) list.push({ sheet, group: g });
  })));

  const ridsDone = (rids) => rids.length > 0 && rids.every((r) => status(r) === 'done');
  const secDone = (S) => ridsDone(S.req);

  function rangeList(nums) {
    const out = [];
    for (const n of nums) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); }
    return out.map(([a, b]) => (a === b ? `§${a}` : `§${a}–${b}`));
  }

  /* ------------------------------------------------------------ harmony view */
  const ICON_READ = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 4.5h5.2c1 0 1.8.8 1.8 1.8V16c0-.8-.7-1.5-1.5-1.5H3zM17 4.5h-5.2c-1 0-1.8.8-1.8 1.8V16c0-.8.7-1.5 1.5-1.5H17z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function passageBtn(rid, opts = {}) {
    const ref = REFS[rid].ref;
    const label = opts.short ? fmtSegs(ref) : fmtRef(ref);
    return `<button class="p" data-r="${rid}" ${opts.g ? `data-g="${opts.g}"` : ''} aria-pressed="false" title="Mark ${esc(fmtRef(ref))} read"><span class="tick" aria-hidden="true"></span>${opts.g ? `<span class="pg">${opts.g}</span>` : ''}<span class="pr">${esc(label)}</span></button>`;
  }

  function renderHarmony() {
    const root = $('#harmony');
    const frag = document.createDocumentFragment();
    D.units.forEach((unit) => {
      frag.append(h(`<div class="unit"><span class="unit-k">${esc(unit.title)}</span><span class="unit-q">“${esc(unit.quote)}”</span><span class="unit-r">${esc(unit.ref)}</span></div>`));
      unit.parts.forEach((part) => {
        const P = PARTS.find((x) => x.part === part);
        const pi = PARTS.indexOf(P);
        const head = h(`<header class="part" id="part-${pi}">
          <blockquote class="part-q">“${esc(part.quote)}”<cite>${esc(part.ref)}</cite></blockquote>
          <p class="part-sub">${esc(part.subtitle)}</p>
          <p class="part-prog" data-part="${pi}"></p>
        </header>`);
        frag.append(head);
        if (part.note.length) frag.append(h(`<div class="hinge major"><span class="hinge-k">Note</span>${paras(part.note.join('\n'))}</div>`));
        part.items.forEach((it) => {
          if (it.t === 'group') frag.append(h(`<div class="group lv-${it.level || 'a'}">${it.label ? `<span class="glabel">${esc(it.label)}</span>` : ''}${esc(it.text)}</div>`));
          else if (it.t === 'note') frag.append(h(`<div class="hinge${it.aside ? ' aside' : ''}">${it.aside ? '' : '<span class="hinge-k">Note</span>'}${paras(it.text)}</div>`));
          else if (it.t === 'day') frag.append(h(`<div class="day">${esc(it.text.toLowerCase())}</div>`));
          else frag.append(secRow(SEC_BY_N[it.n]));
        });
      });
    });
    root.replaceChildren(frag);
  }

  function secRow(S) {
    const it = S.sec;
    const cells = S.rids.map((rid, i) => (rid == null
      ? `<span class="p none" aria-hidden="true"><span class="pg">${GOSPELS[i]}</span></span>`
      : passageBtn(rid, { short: true, g: GOSPELS[i] }))).join('');
    const extras = S.extra.map((x) => (x.cf
      ? `<button class="cf" data-read="${x.rid}">cf. ${esc(fmtRef(REFS[x.rid].ref))}</button>`
      : passageBtn(x.rid))).join(' ');
    const allRefs = S.req;
    const el = h(`<article class="sec lv-${it.level || 'a'}${it.meanwhile ? ' meanwhile' : ''}" id="s${S.n}" data-n="${S.n}" data-has-note="s:${S.n}">
      <button class="sec-n" aria-label="Mark all of section ${S.n} read" title="Mark the whole section read">${S.n}</button>
      <div class="sec-t">
        <button class="sec-title" aria-expanded="false">${it.label ? `<span class="slabel">${esc(it.label)}</span> ` : ''}${esc(it.title)}<span class="dot-note" aria-hidden="true"></span></button>
        ${extras ? `<div class="extras">${extras}</div>` : ''}
      </div>
      <div class="cells">${cells}</div>
      <button class="readall" data-read="${allRefs.join(',')}" data-sec="${S.n}" title="${allRefs.length > 1 ? `Read all ${allRefs.length} accounts side by side` : 'Read this passage'}" aria-label="Read section ${S.n}">${ICON_READ}${allRefs.length > 1 ? `<span>${allRefs.length}</span>` : ''}</button>
    </article>`);
    el._S = S;
    return el;
  }

  function expandSection(el) {
    const S = el._S;
    let more = $('.sec-more', el);
    const btn = $('.sec-title', el);
    if (more) { more.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    more = h('<div class="sec-more"></div>');
    if (S.sec.note) more.append(h(`<div class="bk-note"><span class="hinge-k">Bookman</span>${paras(S.sec.note)}</div>`));
    const links = (SEC_SHEETS[S.n] || []).map(({ sheet, group }) =>
      `<button class="xref" data-sheet="${sheet.n}" data-gid="${group.gid}">Sheet ${sheet.n}${group.h ? ` · ${esc(trimHead(group.h))}` : ''}</button>`);
    if (links.length) more.append(h(`<div class="xrefs"><span class="muted">Study notes:</span> ${links.join(' ')}</div>`));
    more.append(noteBox(`s:${S.n}`, `Your notes on §${S.n} — observations, differences between the accounts, questions…`, noteMetaSec(S)));
    el.append(more);
    if (matchMedia('(hover: hover)').matches) $('textarea', more).focus({ preventScroll: true });
  }
  const trimHead = (s) => s.replace(/^([IVX]+|[A-Z]|\d+|[a-z])\.\s*/, '').replace(/\s+/g, ' ');
  const noteMetaSec = (S) => ({ label: `§${S.n}`, where: S.sec.title, order: S.n * 10, jump: () => goSection(S.n, true) });

  function goSection(n, open) {
    setView('harmony');
    const el = $('#s' + n);
    if (!el) return;
    if (open && !$('.sec-more', el)) expandSection(el);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flash(el);
  }
  function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  /* ------------------------------------------------------------ coverage fingerprint */
  const FP = { canvas: null, rows: [], vertical: true, rowH: 3, colW: 9, gap: 4, view: [0, 0] };

  function fpLayout() {
    const c = FP.canvas, rail = c.parentElement;
    FP.vertical = window.matchMedia('(min-width: 1000px)').matches;
    const partGaps = PARTS.length - 1;
    if (FP.vertical) {
      const top = c.getBoundingClientRect().top - rail.getBoundingClientRect().top;
      const avail = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 120) - top - 100;
      FP.rowH = Math.max(1.6, Math.min(4, (avail - partGaps * FP.gap) / SECTIONS.length));
      FP.colW = 12;
      FP.w = FP.colW * 4 + 3 * 2; FP.h = FP.rowH * SECTIONS.length + partGaps * FP.gap;
    } else {
      const W = rail.clientWidth;
      FP.gap = 2;
      FP.colW = Math.max(1, (W - partGaps * FP.gap) / SECTIONS.length);
      FP.rowH = 6;
      FP.w = W; FP.h = FP.rowH * 4 + 3;
    }
    // position of each section
    let off = 0, pi = 0;
    FP.rows = SECTIONS.map((S, i) => {
      const p = PARTS.indexOf(S.part);
      if (p !== pi) { off += FP.gap; pi = p; }
      const pos = off + i * (FP.vertical ? FP.rowH : FP.colW);
      return { S, pos };
    });
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(FP.w * dpr); c.height = Math.round(FP.h * dpr);
    c.style.width = FP.w + 'px'; c.style.height = FP.h + 'px';
    fpDraw();
  }

  function fpDraw() {
    const c = FP.canvas; if (!c || !FP.rows.length) return;
    const ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(document.documentElement);
    const col = { unread: css.getPropertyValue('--fp-unread').trim(), part: css.getPropertyValue('--fp-part').trim(), done: css.getPropertyValue('--fp-done').trim(), view: css.getPropertyValue('--fp-view').trim() };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, FP.w, FP.h);
    const [v0, v1] = FP.view;
    if (v1 >= v0 && FP.rows[v0] && FP.rows[v1]) {
      ctx.fillStyle = col.view;
      const a = FP.rows[v0].pos, b = FP.rows[v1].pos + (FP.vertical ? FP.rowH : FP.colW);
      if (FP.vertical) ctx.fillRect(0, a - 1, FP.w, b - a + 2); else ctx.fillRect(a - 1, 0, b - a + 2, FP.h);
    }
    for (const { S, pos } of FP.rows) {
      S.rids.forEach((rid, g) => {
        if (rid == null) return;
        const st = status(rid);
        ctx.fillStyle = st === 'done' ? col.done : st === 'part' ? col.part : col.unread;
        if (FP.vertical) ctx.fillRect(g * (FP.colW + 2), pos, FP.colW, Math.max(1, FP.rowH - 0.6));
        else ctx.fillRect(pos, g * (FP.rowH + 1), Math.max(0.8, FP.colW - 0.3), FP.rowH);
      });
    }
  }

  function fpHit(evt) {
    const r = FP.canvas.getBoundingClientRect();
    const p = FP.vertical ? evt.clientY - r.top : evt.clientX - r.left;
    let best = null, bd = Infinity;
    for (const row of FP.rows) { const d = Math.abs(row.pos + (FP.vertical ? FP.rowH : FP.colW) / 2 - p); if (d < bd) { bd = d; best = row; } }
    return best;
  }

  function fpInit() {
    FP.canvas = $('#fingerprint');
    const tip = $('#rail-tip');
    FP.canvas.addEventListener('mousemove', (e) => {
      const row = fpHit(e); if (!row) return;
      const S = row.S;
      tip.hidden = false;
      tip.textContent = `§${S.n} · ${S.sec.title}`;
      const rr = FP.canvas.parentElement.getBoundingClientRect();
      if (FP.vertical) { tip.style.top = (e.clientY - rr.top - 10) + 'px'; tip.style.left = ''; }
      else { tip.style.left = Math.min(rr.width - 220, Math.max(0, e.clientX - rr.left - 110)) + 'px'; tip.style.top = ''; }
    });
    FP.canvas.addEventListener('mouseleave', () => { tip.hidden = true; });
    FP.canvas.addEventListener('click', (e) => { const row = fpHit(e); if (row) goSection(row.S.n); });
    window.addEventListener('resize', debounce(fpLayout, 120));
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking || state.prefs.view !== 'harmony') return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; fpViewport(); });
    }, { passive: true });
  }

  function fpViewport() {
    if (state.prefs.view !== 'harmony') return;
    const els = SECTIONS.map((S) => document.getElementById('s' + S.n));
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0, bot = window.innerHeight;
    let a = -1, b = -1;
    // binary search for first visible
    let lo = 0, hi = els.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (els[m].getBoundingClientRect().bottom < top) lo = m + 1; else hi = m - 1; }
    a = lo;
    for (b = a; b < els.length && els[b].getBoundingClientRect().top < bot; b++);
    FP.view = [Math.min(a, els.length - 1), Math.max(a, b - 1)];
    fpDraw();
  }

  /* ------------------------------------------------------------ assignment sheets */
  function renderSheetNav() {
    const nav = $('#sheet-nav');
    nav.replaceChildren(...SHEETS.map(({ sheet }) => h(`<button data-sheet="${sheet.n}" aria-current="false">
      <span class="sn">${sheet.n}</span><span class="st">${esc(SHEET_SHORT[sheet.n])}</span><span class="bar"><i></i></span>
    </button>`)));
  }

  function renderSheet(n) {
    const { sheet, groups } = SHEETS[n - 1];
    const root = $('#sheet');
    const frag = document.createDocumentFragment();
    frag.append(h(`<header class="sheet-head">
      <p class="sheet-k">Assignment sheet ${sheet.n} of ${SHEETS.length}</p>
      <h2>${esc(sheet.title)}</h2>
      <p class="sheet-prog" data-sheet-prog="${sheet.n}"></p>
    </header>`));
    sheet.intro.forEach((t) => frag.append(h(`<div class="hinge major"><span class="hinge-k">Note</span>${paras(t)}</div>`)));
    sheet.items.forEach((g) => {
      if (g.t === 'focus') { frag.append(h(`<div class="day">${esc(g.text)}</div>`)); return; }
      if (g.t === 'note') { frag.append(h(`<div class="hinge"><span class="hinge-k">Note</span>${paras(g.text)}</div>`)); return; }
      frag.append(groupEl(sheet, g));
    });
    if (sheet.essay) {
      frag.append(h(`<details class="essay"><summary><span class="hinge-k">Essay</span> ${esc(sheet.essay.title)} <span class="muted">— Dr. Bookman on reconciling Matthew 1 and Luke 3</span></summary>
        <div class="essay-body">${sheet.essay.paras.map((p) => /^[A-Z’' ]{12,}$/.test(p) ? `<h4>${esc(p.toLowerCase())}</h4>` : `<p>${esc(p)}</p>`).join('')}</div></details>`));
    }
    const end = h(`<section class="sheet-end"><h3>Questions and points of confusion</h3><p class="muted">From the bottom of the paper sheet: record anything that suggested itself as you read these passages.</p></section>`);
    end.append(noteBox(`sheet:${sheet.n}`, 'Write your questions here. Mark one as an open question to keep it in your Notebook until it is answered.', noteMetaSheet(sheet)));
    frag.append(end);
    const next = SHEETS[n] ? h(`<button class="btn next-sheet" data-sheet="${n + 1}">Next: Sheet ${n + 1} · ${esc(SHEET_SHORT[n + 1])} →</button>`) : null;
    if (next) frag.append(next);
    root.replaceChildren(frag);
    $$('#sheet-nav button').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.sheet === n)));
    const cur = $(`#sheet-nav button[data-sheet="${n}"]`), nav = $('#sheet-nav');
    if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: cur.offsetLeft - nav.offsetLeft - 16, behavior: 'smooth' });
    refresh();
  }

  const lastSec = (sheet) => Math.max(0, ...SHEETS[sheet.n - 1].groups.flatMap((g) => g.secs));
  const noteMetaSheet = (sheet) => ({ label: `Sheet ${sheet.n}`, where: `Questions and points of confusion — ${SHEET_SHORT[sheet.n]}`, order: lastSec(sheet) * 10 + 9, jump: () => goSheet(sheet.n, null, `sheet:${sheet.n}`) });

  function groupEl(sheet, g) {
    const bare = !g.r.length && !g.note && !(g.q && g.q.length);
    const el = h(`<section class="sg lv${g.lv}${bare ? ' bare' : ''}" id="${g.gid}"></section>`);
    if (g.h) el.append(h(`<h3 class="sg-h">${esc(g.h)}</h3>`));
    if (g.note) el.append(h(`<div class="bk-note">${paras(g.note)}</div>`));
    if (g.r.length) {
      const list = h('<ul class="readings"></ul>');
      g.r.forEach((r) => list.append(readingEl(sheet, g, r)));
      el.append(list);
      const refs = g.r.map((r) => r.ref);
      if (refs.length > 1) el.append(h(`<button class="readall wide" data-read="${g.r.map((r) => r.rid).join(',')}" data-gid="${g.gid}">${ICON_READ}<span>Read all ${refs.length} side by side</span></button>`));
    }
    if (g.q && g.q.length) el.append(questionsEl(sheet, g, g.q));
    return el;
  }

  function readingEl(sheet, g, r) {
    const xr = r.secs.length ? rangeList(r.secs).slice(0, 4).map((t) => `<button class="xref" data-sec="${t.match(/\d+/)[0]}">${t}</button>`).join(' ') : '';
    const li = h(`<li class="reading">
      <div class="r-main">
        ${passageBtn(r.rid)}
        ${r.opt ? '<span class="badge">optional</span>' : ''}
        ${r.fixed ? `<span class="badge fixed" title="The printed sheet reads “${esc(r.src)}”, an evident typo">corrected</span>` : ''}
        <span class="r-x">${xr}</span>
        <button class="readall" data-read="${r.rid}" data-gid="${g.gid}" title="Read ${esc(fmtRef(r.ref))}" aria-label="Read ${esc(fmtRef(r.ref))}">${ICON_READ}</button>
      </div>
      ${r.note ? `<div class="r-note">${paras(r.note)}</div>` : ''}
      ${r.fn ? `<div class="r-note fn"><span class="hinge-k">Footnote</span>${paras(r.fn)}</div>` : ''}
    </li>`);
    if (r.q && r.q.length) li.append(questionsEl(sheet, g, r.q));
    return li;
  }

  function questionsEl(sheet, g, qs) {
    const ol = h('<ol class="qs"></ol>');
    qs.forEach((q) => {
      const li = h(`<li class="q" data-has-note="${q.id}"><div class="q-row"><span class="qn">${q.n}</span><p>${esc(q.q)}</p>
        <button class="respond" aria-expanded="false">Respond</button></div></li>`);
      const open = () => {
        if ($('.notebox', li)) return;
        li.append(noteBox(q.id, 'Your answer or observation…', noteMetaQ(sheet, g, q)));
        $('.respond', li).setAttribute('aria-expanded', 'true');
      };
      $('.respond', li).addEventListener('click', () => {
        const box = $('.notebox', li);
        if (box && !hasNote(q.id)) { box.remove(); $('.respond', li).setAttribute('aria-expanded', 'false'); return; }
        open(); $('textarea', li).focus();
      });
      if (hasNote(q.id) || (state.notes[q.id] && state.notes[q.id].s)) open();
      NOTE_META[q.id] = noteMetaQ(sheet, g, q);
      ol.append(li);
    });
    return ol;
  }
  const noteMetaQ = (sheet, g, q) => ({ label: `Sheet ${sheet.n} · Q${q.n}`, where: q.q, order: (g.secs[0] || lastSec(sheet)) * 10 + 5, jump: () => goSheet(sheet.n, g.gid, q.id) });

  function goSheet(n, gid, noteId) {
    state.prefs.sheet = n; save();
    setView('sheets');
    if (gid || noteId) {
      requestAnimationFrame(() => {
        let el = noteId ? $(`[data-note="${CSS.escape(noteId)}"]`) || $(`[data-has-note="${CSS.escape(noteId)}"]`) : null;
        el = el || (gid && document.getElementById(gid));
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flash(el.closest('.sg, .sheet-end') || el);
      });
    } else window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------------------ notebook */
  // Make sure every possible note has metadata, even if its sheet is not rendered.
  function indexNoteMeta() {
    SECTIONS.forEach((S) => { NOTE_META[`s:${S.n}`] = noteMetaSec(S); });
    SHEETS.forEach(({ sheet, groups }) => {
      NOTE_META[`sheet:${sheet.n}`] = noteMetaSheet(sheet);
      groups.forEach((g) => {
        (g.q || []).forEach((q) => { NOTE_META[q.id] = noteMetaQ(sheet, g, q); });
        g.r.forEach((r) => (r.q || []).forEach((q) => { NOTE_META[q.id] = noteMetaQ(sheet, g, q); }));
      });
    });
  }

  function noteEntries(filter) {
    return Object.entries(state.notes)
      .filter(([id, n]) => NOTE_META[id] && n.t && n.t.trim())
      .filter(([, n]) => filter === 'all' || (filter === 'open' ? n.s === 'open' : n.s === 'resolved'))
      .sort((a, b) => NOTE_META[a[0]].order - NOTE_META[b[0]].order);
  }

  function renderNotebook() {
    const f = state.prefs.filter;
    $$('.notebook-head .seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    const root = $('#notebook');
    const list = noteEntries(f);
    if (!list.length) {
      root.replaceChildren(h(`<div class="empty">${f === 'open' ? 'No open questions. When something puzzles you, write it in a section’s notes and mark it <em>Open question</em>.' : f === 'resolved' ? 'Nothing resolved yet.' : 'Nothing written yet. Tap a section title in the Harmony, or <em>Respond</em> to one of Dr. Bookman’s questions, to start your notebook.'}</div>`));
      return;
    }
    root.replaceChildren(...list.map(([id]) => {
      const m = NOTE_META[id];
      const card = h(`<article class="nb"><header><button class="nb-go">${esc(m.label)}</button><span class="nb-where">${esc(m.where)}</span></header></article>`);
      $('.nb-go', card).addEventListener('click', m.jump);
      card.append(noteBox(id, 'Note', m));
      return card;
    }));
  }

  function notebookMarkdown() {
    const lines = ['# Harmony of the Gospels — Notebook', '', `_Exported ${new Date().toLocaleDateString()}_`, ''];
    for (const [id, n] of noteEntries('all')) {
      const m = NOTE_META[id];
      lines.push(`## ${m.label}${n.s === 'open' ? ' — open question' : n.s === 'resolved' ? ' — resolved' : ''}`, '', `> ${m.where}`, '', n.t.trim(), '');
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------ refresh / continue */
  function nextTarget() {
    if (state.prefs.view === 'sheets') {
      for (let i = state.prefs.sheet - 1; i < SHEETS.length; i++) {
        for (const g of SHEETS[i].groups) for (const r of g.r) if (!r.opt && status(r.rid) !== 'done') return { sheet: SHEETS[i].sheet.n, gid: g.gid, rid: r.rid, label: fmtRef(r.ref) };
      }
      for (let i = 0; i < state.prefs.sheet - 1; i++) {
        for (const g of SHEETS[i].groups) for (const r of g.r) if (!r.opt && status(r.rid) !== 'done') return { sheet: SHEETS[i].sheet.n, gid: g.gid, rid: r.rid, label: fmtRef(r.ref) };
      }
      return null;
    }
    const S = SECTIONS.find((x) => !secDone(x));
    return S ? { sec: S.n, label: `§${S.n}` } : null;
  }

  function refresh() {
    // passage buttons
    const cache = {};
    $$('[data-r]').forEach((el) => {
      const rid = +el.dataset.r;
      const st = cache[rid] ?? (cache[rid] = status(rid));
      el.classList.toggle('done', st === 'done');
      el.classList.toggle('part', st === 'part');
      el.setAttribute('aria-pressed', st === 'done' ? 'true' : st === 'part' ? 'mixed' : 'false');
    });
    // sections
    $$('.sec').forEach((el) => {
      const S = el._S; if (!S) return;
      const done = secDone(S), any = S.req.some((r) => status(r) !== '');
      el.classList.toggle('done', done); el.classList.toggle('started', !done && any);
    });
    // parts
    $$('[data-part]').forEach((el) => {
      const P = PARTS[+el.dataset.part];
      const d = P.secs.filter((n) => secDone(SEC_BY_N[n])).length;
      el.textContent = d === P.secs.length ? `All ${d} sections read` : `${d} of ${P.secs.length} sections read`;
      el.classList.toggle('complete', d === P.secs.length);
    });
    // sheets
    $$('#sheet-nav button').forEach((b) => {
      const S = SHEETS[+b.dataset.sheet - 1];
      const d = S.req.filter((r) => status(r) === 'done').length;
      $('.bar i', b).style.width = (100 * d / S.req.length) + '%';
      b.classList.toggle('complete', d === S.req.length);
      b.title = `${d} of ${S.req.length} passages read`;
    });
    $$('[data-sheet-prog]').forEach((el) => {
      const S = SHEETS[+el.dataset.sheetProg - 1];
      const d = S.req.filter((r) => status(r) === 'done').length;
      el.textContent = `${d} of ${S.req.length} passages read`;
    });
    // summary
    let verses = 0;
    for (const k in verseToSecs) { const [b, v] = k.split(':'); if (state.read[b] && state.read[b].has(+v)) verses++; }
    const secs = SECTIONS.filter(secDone).length;
    $('#summary').innerHTML = `<span><b>${secs}</b> of 212 sections</span><span class="sep">·</span><span><b>${fmtInt(verses)}</b> of ${fmtInt(HARMONY_VERSES)} Gospel verses read</span>`;
    // continue
    const t = nextTarget();
    const c = $('#continue');
    c.disabled = !t;
    c.innerHTML = t ? `Continue <span class="c-at">${esc(t.label)}</span>` : 'All read';
    fpDraw();
    syncNoteMarks();
    refreshReader();
  }

  function doContinue() {
    const t = nextTarget(); if (!t) return;
    if (t.sec) { goSection(t.sec); return; }
    if (t.sheet !== state.prefs.sheet) { state.prefs.sheet = t.sheet; save(); renderSheet(t.sheet); }
    const el = $(`#${t.gid} [data-r="${t.rid}"]`) || document.getElementById(t.gid);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flash(el.closest('.reading') || el);
  }

  /* ------------------------------------------------------------ views */
  function setView(v) {
    state.prefs.view = v; save();
    $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $$('.view').forEach((s) => { s.hidden = s.id !== 'view-' + v; });
    if (v === 'sheets' && (!$('#sheet').firstChild || $('#sheet').dataset.n != state.prefs.sheet)) { renderSheet(state.prefs.sheet); $('#sheet').dataset.n = state.prefs.sheet; }
    if (v === 'notebook') renderNotebook();
    if (v === 'harmony') requestAnimationFrame(() => { fpLayout(); fpViewport(); });
    refresh();
  }

  /* ------------------------------------------------------------ toast + "did you read it?" */
  let toastTimer;
  function toast(msg, actionLabel, action, ms = 6000) {
    const t = $('#toast');
    const host = $('#reader').open ? $('#reader') : document.body; // stay above the modal
    if (t.parentElement !== host) host.append(t);
    t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button class="btn small">${esc(actionLabel)}</button>` : ''}<button class="x" aria-label="Dismiss">×</button>`;
    t.hidden = false;
    if (actionLabel) $('button.btn', t).addEventListener('click', () => { action(); t.hidden = true; });
    $('.x', t).addEventListener('click', () => { t.hidden = true; });
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ------------------------------------------------------------ parallel reader
   * Desktop: the accounts sit side by side in columns.
   * Phone: one account fills the screen; swipe (or tap a tab) to the next.   */
  const reader = { rids: [], pushed: false };
  const isPhone = () => matchMedia('(max-width: 780px)').matches;

  function readerContext(btn) {
    const rids = btn.dataset.read.split(',').map(Number);
    if (btn.dataset.sec) {
      const S = SEC_BY_N[+btn.dataset.sec];
      return { rids, kicker: `§${S.n}`, title: S.sec.title, bk: S.sec.note, noteId: `s:${S.n}`, noteMeta: noteMetaSec(S) };
    }
    if (btn.dataset.gid) {
      const { sheet, g } = GROUPS[btn.dataset.gid];
      const rs = g.r.filter((r) => rids.includes(r.rid));
      return {
        rids, kicker: `Sheet ${sheet.n}`, title: g.h ? trimHead(g.h) : sheet.title,
        bk: [g.note, ...rs.map((r) => r.note), ...rs.map((r) => r.fn)].filter(Boolean).join('\n'),
        sheet, g, qs: [...(g.q || []), ...rs.flatMap((r) => r.q || [])],
      };
    }
    const sec = btn.closest('.sec');
    return { rids, kicker: sec ? `§${sec._S.n}` : '', title: longRef(REFS[rids[0]].ref) };
  }

  function openReader(ctx) {
    const dlg = $('#reader');
    reader.rids = ctx.rids;
    const multi = ctx.rids.length > 1;
    const hasStudy = !!(ctx.bk || ctx.noteId || (ctx.qs && ctx.qs.length));
    const cols = ctx.rids.map((rid, i) => {
      const ref = REFS[rid].ref;
      return `<section class="rcol" data-i="${i}" aria-label="${esc(longRef(ref))}">
        <header class="rcol-h"><h3 title="${esc(longRef(ref))}">${esc(ctx.rids.length > 2 ? fmtRef(ref) : longRef(ref))}</h3>
          <button class="p rmark" data-r="${rid}" aria-pressed="false"><span class="tick" aria-hidden="true"></span><span class="pr"><span class="l-not">Mark read</span><span class="l-done">Read</span></span></button>
        </header>
        <div class="rtext" data-rid="${rid}"><p class="loading">Loading ${esc(BOOK_NAME[ref.b])}…</p></div>
      </section>`;
    }).join('');
    const tabs = multi ? `<nav class="rtabs" aria-label="Accounts">${ctx.rids.map((rid, i) =>
      `<button data-i="${i}" data-r-tab="${rid}" aria-current="${i === 0}"><b>${esc(BOOK_ABBR[REFS[rid].ref.b])}</b><span>${esc(fmtSegs(REFS[rid].ref))}</span></button>`).join('')}</nav>` : '';
    dlg.innerHTML = `<div class="r-wrap">
      <header class="r-head">
        <div class="r-title">${ctx.kicker ? `<span class="r-k">${esc(ctx.kicker)}</span>` : ''}<h2>${esc(ctx.title)}</h2></div>
        <div class="r-tools">
          ${hasStudy ? '<button class="btn small r-study" aria-expanded="false">Study notes</button>' : ''}
          <button class="btn small r-fn" aria-pressed="${!!state.prefs.footnotes}" title="Show the BSB translators’ footnotes">Footnotes</button>
          <button class="btn icon r-close" aria-label="Close reader"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </header>
      ${tabs}
      <div class="r-cols n${Math.min(ctx.rids.length, 5)}">${cols}</div>
      <aside class="r-study-panel" hidden></aside>
      ${multi ? '<footer class="r-foot"><button class="btn r-all"></button></footer>' : ''}
    </div>`;
    dlg.classList.toggle('show-fn', !!state.prefs.footnotes);

    const colsEl = $('.r-cols', dlg);
    const setTab = (i) => $$('.rtabs button', dlg).forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === i)));
    // Programmatic jumps switch scroll-snap off while they run; mandatory snapping can
    // otherwise interrupt a smooth scroll partway.
    let jumping = null;
    const goTab = (i) => {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      colsEl.style.scrollSnapType = 'none';
      colsEl.scrollTo({ left: i * colsEl.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
      setTab(i);
      clearTimeout(jumping);
      jumping = setTimeout(() => { colsEl.style.scrollSnapType = ''; jumping = null; }, smooth ? 700 : 50);
    };
    colsEl.addEventListener('scroll', () => { if (isPhone() && !jumping) setTab(Math.round(colsEl.scrollLeft / colsEl.clientWidth)); }, { passive: true });
    $$('.rtabs button', dlg).forEach((b) => b.addEventListener('click', () => goTab(+b.dataset.i)));
    // On a phone, marking one account read moves on to the next unread one.
    colsEl.addEventListener('click', (e) => {
      const m = e.target.closest('.rmark'); if (!m || !isPhone()) return;
      setTimeout(() => {
        if (status(+m.dataset.r) !== 'done') return;
        const i = +m.closest('.rcol').dataset.i;
        const next = ctx.rids.findIndex((r, j) => j > i && status(r) !== 'done');
        if (next > 0) goTab(next);
      }, 250);
    });

    $('.r-close', dlg).addEventListener('click', () => closeReader());
    $('.r-fn', dlg).addEventListener('click', (e) => {
      state.prefs.footnotes = !state.prefs.footnotes; save();
      e.currentTarget.setAttribute('aria-pressed', String(state.prefs.footnotes));
      dlg.classList.toggle('show-fn', state.prefs.footnotes);
    });
    const all = $('.r-all', dlg);
    if (all) all.addEventListener('click', () => setRead(ctx.rids, !ridsDone(ctx.rids), `${ctx.rids.length} passages`));
    const sb = $('.r-study', dlg);
    if (sb) sb.addEventListener('click', () => {
      const panel = $('.r-study-panel', dlg);
      if (!panel.firstChild) {
        if (ctx.bk) panel.append(h(`<div class="bk-note"><span class="hinge-k">Dr. Bookman</span>${paras(ctx.bk)}</div>`));
        if (ctx.qs && ctx.qs.length) panel.append(questionsEl(ctx.sheet, ctx.g, ctx.qs));
        if (ctx.noteId) panel.append(noteBox(ctx.noteId, 'Your notes — what each account adds, omits, or orders differently…', ctx.noteMeta));
      }
      panel.hidden = !panel.hidden;
      sb.setAttribute('aria-expanded', String(!panel.hidden));
    });

    document.body.classList.add('reading');
    if (!dlg.open) dlg.showModal();
    if (!reader.pushed) { history.pushState({ reader: 1 }, ''); reader.pushed = true; }
    colsEl.scrollLeft = 0;
    refresh();
    ctx.rids.forEach((rid) => loadPassage($(`.rtext[data-rid="${rid}"]`, dlg), rid));
  }

  async function loadPassage(box, rid) {
    const ref = REFS[rid].ref;
    try {
      const contents = await fetchBook(ref.b);
      box.innerHTML = sanitize(passageHtml(contents, ref)) || '<p class="muted">No text for this reference.</p>';
    } catch (err) {
      box.innerHTML = `<div class="r-err"><p>Couldn’t load ${esc(BOOK_NAME[ref.b])} from fetch.bible.${navigator.onLine ? '' : ' You appear to be offline; passages you have opened before still work offline.'}</p><button class="btn small">Try again</button></div>`;
      $('button', box).addEventListener('click', () => { box.innerHTML = '<p class="loading">Loading…</p>'; loadPassage(box, rid); });
    }
  }

  function refreshReader() {
    const d = $('#reader'); if (!d || !d.open) return;
    $$('[data-r-tab]', d).forEach((b) => b.classList.toggle('done', status(+b.dataset.rTab) === 'done'));
    const all = $('.r-all', d);
    if (all) {
      const done = ridsDone(reader.rids);
      all.textContent = done ? 'All read ✓' : `Mark all ${reader.rids.length} read`;
      all.classList.toggle('primary', !done);
    }
  }

  // Cleanup is done here rather than only in the dialog's `close` event, which some
  // embedded browsers never dispatch. Safe to call more than once.
  function closeReader(fromHistory) {
    const dlg = $('#reader');
    if (dlg.open) dlg.close();
    document.body.classList.remove('reading');
    if ($('#toast').parentElement !== document.body) document.body.append($('#toast'));
    if (reader.pushed) { reader.pushed = false; if (!fromHistory) history.back(); }
  }

  function wireReader() {
    const dlg = $('#reader');
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeReader(); }); // Esc
    dlg.addEventListener('close', () => closeReader());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeReader(); }); // backdrop
    window.addEventListener('popstate', () => { if (dlg.open) closeReader(true); });
    // Warm the cache when the pointer heads for a read button.
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-read]'); if (!b || b._warmed) return;
      b._warmed = true;
      b.dataset.read.split(',').forEach((rid) => fetchBook(REFS[+rid].b).catch(() => {}));
    });
  }

  /* ------------------------------------------------------------ events */
  function wire() {
    $$('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => { setView(b.dataset.view); window.scrollTo({ top: 0 }); }));
    $('#continue').addEventListener('click', doContinue);

    document.addEventListener('click', (e) => {
      const p = e.target.closest('button.p[data-r]');
      if (p) { const rid = +p.dataset.r; setRead([rid], status(rid) !== 'done', fmtRef(REFS[rid].ref)); return; }
      const sn = e.target.closest('.sec-n');
      if (sn) { const S = sn.closest('.sec')._S; setRead(S.req, !secDone(S), `§${S.n}`); return; }
      const st = e.target.closest('.sec-title');
      if (st) { expandSection(st.closest('.sec')); return; }
      const ra = e.target.closest('[data-read]');
      if (ra) { openReader(readerContext(ra)); return; }
      const xs = e.target.closest('.xref[data-sec]');
      if (xs) { goSection(+xs.dataset.sec); return; }
      const xg = e.target.closest('.xref[data-sheet]');
      if (xg) { goSheet(+xg.dataset.sheet, xg.dataset.gid); return; }
      const sb = e.target.closest('#sheet-nav button, .next-sheet');
      if (sb) { state.prefs.sheet = +sb.dataset.sheet; save(); renderSheet(state.prefs.sheet); $('#sheet').dataset.n = state.prefs.sheet; window.scrollTo({ top: 0 }); return; }
      const fb = e.target.closest('.notebook-head .seg button');
      if (fb) { state.prefs.filter = fb.dataset.filter; save(); renderNotebook(); return; }
      const menu = $('#menu');
      if (menu.open && !e.target.closest('#menu')) menu.open = false;
    });

    wireReader();

    $('#export').addEventListener('click', () => download(`gospel-harmony-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(serialize(), null, 1), 'application/json'));
    $('#export-md').addEventListener('click', () => download('gospel-harmony-notebook.md', notebookMarkdown(), 'text/markdown'));
    $('#import').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const obj = JSON.parse(await file.text());
        if (obj.app !== 'gospel-harmony') throw new Error('not a backup from this app');
        if (!confirm('Replace your current progress and notes with this backup?')) return;
        hydrate(obj); save(); renderAll(); toast('Backup restored.');
      } catch (err) { toast('That file could not be imported: ' + err.message); }
      e.target.value = '';
    });
    $('#reset').addEventListener('click', () => {
      if (!confirm('Clear all reading progress and notes in this browser? Export a backup first if you might want them back.')) return;
      state.read = {}; state.notes = {}; save(); renderAll(); toast('All progress cleared.');
    });

    // keep --header-h current for sticky offsets
    const hdr = $('.top');
    const setH = () => document.documentElement.style.setProperty('--header-h', hdr.getBoundingClientRect().height + 'px');
    new ResizeObserver(setH).observe(hdr); setH();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => fpDraw());
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function renderAll() {
    renderHarmony();
    renderSheetNav();
    $('#sheet').replaceChildren(); delete $('#sheet').dataset.n;
    setView(state.prefs.view);
  }

  /* ------------------------------------------------------------ boot */
  if (history.state && history.state.reader) history.replaceState(null, ''); // reloaded with the reader open
  load();
  indexNoteMeta();
  fpInit();
  wire();
  renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // exposed for debugging in the console
  window.__harmony = { state, SECTIONS, SHEETS, REFS, fmtRef };
})();
