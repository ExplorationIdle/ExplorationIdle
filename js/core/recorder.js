/* ============================================================
   CORE: SESSION RECORDER (optional; the game never depends on it)
   Watches, never steers. Each page load is a session: the save the game
   loaded, the RNG state (js/core/rng.js), the offline seconds and the
   Settings that shape pinned panels, then every trusted player action
   tagged with its tick (Rng.ticks). Same start + same inputs + same dice
   = the same game, replayed by js/core/replay.js.

   HOOKS — invisible from the files they touch:
   - document capture listeners (passive) for TYPES below
   - js/core/cards.js addHoldBehavior: timer repeats call Recorder.rep(btn)
   - window pagehide + document visibilitychange (added after boot, so the
     save's own close-save has already run when the chain hash is read)
   - one 1s interval (fingerprint every 60s of play, checkpoint every 30 min
     active / 4 h idle, IndexedDB flush every 10s)
   - Settings: #rec-row controls, #rec-dot and the log panel it builds
   Any error anywhere calls stop(), which removes every hook above.

   Storage: IndexedDB 'orbweaver-rec' (own quota, never the save's);
   memory fallback up to MEM_CAP. Toggle and last failure: KEY.
   Never registers with Save, so it is never part of a save.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, $ = (id) => document.getElementById(id);
  const KEY = 'orbweaver.recorder.v1', SAVE_KEY = 'orbweaver.save.v1', REPLAY_KEY = 'orbweaver.replay.v1';
  const DB = 'orbweaver-rec', IMPORT_DB = 'orbweaver-rec-import';
  const FP_TICKS = 300, CP_TICKS = 9000, CP_IDLE_TICKS = 72000; // 60s, 30 min, 4 h of play (0.2s ticks)
  const MEM_CAP = 12e6, LOG_MAX = 50;
  // 0-6 DOM events; 7 tap (down+up+click), 8 hold repeats, 9 fingerprint, 10 checkpoint, 11 down+up, 12 comment.
  const TYPES = ['pointerdown', 'pointerup', 'click', 'input', 'change', 'keydown', 'blur'];
  // Settings switches that change the game or pinned panels; every other Settings control is display only.
  const SETTINGS_KEPT = ['pins-toggle', 'pins-max-toggle', 'pins-right-toggle', 'pins-bottom-toggle', 'layout-toggle'];
  const SKIP = '#settings-gear-btn, .panel-line, #cheat-seed, #cheat-seed-apply, #rec-comment-btn, .rec-comment-box, [data-norec]'; // [data-norec]: fields a mechanic records itself (e.g. as a comment)
  const PREFS = ['pins', 'pinMax', 'pinPos', 'layout', 'offline'];

  /* ---- Shared helpers (also used by replay.js) ---- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
  function pathOf(el) { // nearest stable id, then child indexes; pinned panels swap ids, so they anchor on #pin-dock
    const dock = el.closest('#pin-dock'), idx = [];
    while (el.parentElement && !(el.id && (!dock || el === dock))) { idx.unshift([...el.parentElement.children].indexOf(el)); el = el.parentElement; }
    return (el.id ? '#' + el.id : 'html') + '/' + idx.join('/');
  }
  function resolve(path) {
    const [anchor, ...idx] = path.split('/');
    let el = anchor === 'html' ? document.documentElement : $(anchor.slice(1));
    for (const i of idx) { if (i === '' || !el) continue; el = el.children[+i]; }
    return el || null;
  }
  const fingerprint = () => hash(OW.Rng.draws + '|' + OW.Resources.all().map((r) => r.id + ':' + OW.Resources.get(r.id)).join(','));
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  function openDB(name) {
    return new Promise((ok, no) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('sessions', { keyPath: 'id' });
        r.result.createObjectStore('chunks', { keyPath: ['s', 'n'] });
        r.result.createObjectStore('cps', { keyPath: ['s', 'i'] });
      };
      r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); ok(r.result); };
      r.onerror = () => no(r.error); r.onblocked = () => no(new Error('database blocked'));
      setTimeout(() => no(new Error('database timeout')), 5000);
    });
  }
  const store = (db, name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  const range = (s) => IDBKeyRange.bound([s, -Infinity], [s, Infinity]);
  const sessionData = (db, s) => Promise.all([req(store(db, 'chunks').getAll(range(s))), req(store(db, 'cps').getAll(range(s)))]);
  async function zip(text) {
    if (!window.CompressionStream) return text;
    try { return await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); } catch (e) { return text; }
  }
  const unz = async (x) => typeof x === 'string' ? x : new Response(x.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const build = () => ($('build-version') || {}).textContent || '?';
  async function replaySession(d, s, extra) { // boot facts go in sessionStorage: replay.js needs them synchronously at load
    const cp0 = await req(store(d, 'cps').get([s.id, 0])), raw = (cp0 && await unz(cp0.save)) || null;
    sessionStorage.setItem(REPLAY_KEY, JSON.stringify({ sid: s.id, raw, rng: s.rng, date: raw && s.savedAt ? s.savedAt + Math.round(s.off * 1000) : s.date0, vms: 0, prefs: s.prefs, pins: [], ...extra }));
    location.reload();
  }
  const util = { hash, pathOf, resolve, fingerprint, openDB, store, range, sessionData, unz, req, build, replaySession, TYPES, REPLAY_KEY, SAVE_KEY, IMPORT_DB };

  /* ---- State ---- */
  let pref = { on: 1 };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) {}
  const savePref = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} };
  let on = false, db = null, sess = null, buf = [], paths = new Map(), newPaths = [], pending = [], total = 0, kept = 0;
  let flushing = false, writeOk = false, timer = null, calls = 0, fpTick = 0, cpTick = 0, cpN = 1, active = false;
  let lastT = 0, lastMs = 0, perf0 = 0, closeHooked = false, status = 'Off';
  const log = [];
  function note(msg) { log.unshift(new Date().toLocaleTimeString() + '  ' + msg); log.length = Math.min(log.length, LOG_MAX); renderLog(); }
  const setDot = () => { const d = $('rec-dot'), c = $('rec-comment-btn'); if (d) d.classList.toggle('on', on && writeOk); if (c) c.hidden = !(on && pref.comments); };

  /* ---- Capture ---- */
  function add(t, p, x) {
    const T = OW.Rng.ticks, ms = Math.round(performance.now() - perf0), last = buf[buf.length - 1];
    const same = last && last.T === T && last.p === p;
    active = true;
    if (t === 1 && same && last.t === 0) { last.t = 11; return; }
    if (t === 2 && same && last.t === 11) { last.t = 7; last.ms = ms; last.x = x; return; }
    if (t === 8 && same && last.t === 8) { last.x++; return; }
    buf.push({ T, ms, t, p, x });
  }
  function pathIdx(el) {
    const p = pathOf(el);
    if (!paths.has(p)) { paths.set(p, paths.size); newPaths.push(p); }
    return paths.get(p);
  }
  function capture(e) {
    try {
      const el = e.target;
      if (!e.isTrusted || !(el instanceof Element) || el.closest(SKIP)) return;
      if (e.type === 'click' && el.id === 'save-import-btn') { pref.end = 'save import'; savePref(); setTimeout(() => stop('save imported in place; recording resumes next load', false), 1500); }
      if (el.closest('#settings-modal-win') && !SETTINGS_KEPT.includes(el.id)) return;
      const field = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if ((e.type === 'keydown' || e.type === 'blur') && !field) return;
      const t = TYPES.indexOf(e.type);
      const x = t === 2 ? (e.detail === 1 ? undefined : e.detail) : t === 3 || t === 4 ? (el.type === 'checkbox' ? +el.checked : el.value) : t === 5 ? e.key : undefined;
      add(t, pathIdx(el), x);
    } catch (err) { stop('capture: ' + err.message); }
  }
  function rep(btn) { if (on && btn.isConnected) try { add(8, pathIdx(btn), 1); } catch (err) { stop('repeat: ' + err.message); } }

  /* ---- Fingerprints, checkpoints, flushing ---- */
  const queue = (name, rec) => pending.push({ name, rec, size: JSON.stringify({ ...rec, save: 0 }).length + (rec.save ? rec.save.size || rec.save.length : 0) });
  const held = () => pending.reduce((n, p) => n + p.size, 0);
  async function checkpoint(i, text) { // state is taken now; only the compression is awaited
    const cp = { s: sess.id, i, T: OW.Rng.ticks, ms: Math.round(performance.now() - perf0), rng: OW.Rng.getState(),
      prefs: prefs(), pins: OW.Pins ? OW.Pins.pins.map((p) => p.m.id) : [] };
    cp.save = await zip(text);
    queue('cps', cp); sess.cps = i + 1;
  }
  function prefs() { const P = OW.DisplayPrefs, o = {}; PREFS.forEach((k) => { o[k] = P ? P.get(k) : undefined; }); return o; }
  function everySecond() {
    try {
      if (!on) return;
      if (OW.Rng.fallback) return stop('seeded random fell back: ' + OW.Rng.fallback);
      if (!closeHooked && (OW.Loop.isRunning() || calls > 10)) {
        closeHooked = true;
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onHidden);
      }
      if (++calls % 10 || OW.Save.isLoading()) return;
      const T = OW.Rng.ticks, ms = Math.round(performance.now() - perf0);
      if (T - fpTick >= FP_TICKS) { fpTick = T; buf.push({ T, ms, t: 9, x: fingerprint() }); }
      if (T - cpTick >= (active ? CP_TICKS : CP_IDLE_TICKS)) {
        cpTick = T; active = false;
        const i = cpN++;
        buf.push({ T, ms, t: 10, x: i });
        checkpoint(i, JSON.stringify(OW.Save.serialize())).catch((err) => note('checkpoint failed: ' + err.message));
      }
      flush();
    } catch (err) { stop('tick: ' + err.message); }
  }
  function onHidden() { if (document.hidden) flush(); }
  async function flush() {
    if (!sess) return;
    try {
      sess.ticks = OW.Rng.ticks; sess.ms = Math.round(performance.now() - perf0); sess.end = Date.now();
      try { sess.last = hash(localStorage.getItem(SAVE_KEY) || ''); } catch (e) {} // read after the save's own close-save
      if (flushing) { if (db) store(db, 'sessions', 'readwrite').put(sess); return; }
      flushing = true;
      if (buf.length || newPaths.length) {
        const ev = buf.map((e) => { const a = [e.T - lastT, e.ms - lastMs, e.t, e.p]; if (e.x !== undefined) a.push(e.x); lastT = e.T; lastMs = e.ms; return a; });
        queue('chunks', { s: sess.id, n: sess.chunks++, ev, np: newPaths });
        buf = []; newPaths = [];
      }
      if (!db) { if (held() > MEM_CAP) stop('memory cap reached; recording paused (data kept for export)'); return; }
      const batch = pending.splice(0);
      try {
        const tx = db.transaction(['chunks', 'cps', 'sessions'], 'readwrite');
        batch.forEach((p) => { sess.bytes += p.size; tx.objectStore(p.name).put(p.rec); });
        tx.objectStore('sessions').put(sess);
        await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => no(tx.error || new Error('write aborted')); setTimeout(() => no(new Error('write timeout')), 10000); });
        if (!writeOk) note('Writes OK.');
        writeOk = true; status = 'Recording';
        total += batch.reduce((n, p) => n + p.size, 0);
        if (total > BUDGET) await budget();
      } catch (err) {
        pending.unshift(...batch); writeOk = false; status = 'Failed: ' + err.message;
        note('write failed: ' + err.message);
        if (held() > MEM_CAP) stop('database keeps failing; memory cap reached');
      }
    } catch (err) { stop('flush: ' + err.message); }
    finally { flushing = false; setDot(); }
  }
  const BUDGET = navigator.storage && navigator.storage.estimate ? 100e6 : 20e6; // no estimate API: old Safari, which may prompt
  async function budget() { // drop oldest whole sessions; recount the running total
    const all = (await req(store(db, 'sessions').getAll())).sort((a, b) => a.start - b.start);
    total = all.reduce((n, s) => n + (s.bytes || 0), 0); kept = all.length;
    for (const s of all) {
      if (total <= BUDGET || s.id === sess.id) break;
      const tx = db.transaction(['chunks', 'cps', 'sessions'], 'readwrite');
      tx.objectStore('chunks').delete(range(s.id)); tx.objectStore('cps').delete(range(s.id)); tx.objectStore('sessions').delete(s.id);
      total -= s.bytes || 0; kept--;
      note('Dropped oldest session to stay under budget.');
    }
  }

  /* ---- Start / stop ---- */
  function stop(reason, failure = true) {
    const was = on;
    on = false; writeOk = false; status = failure ? 'Failed: ' + reason : 'Off';
    TYPES.forEach((t) => document.removeEventListener(t, capture, true));
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHidden);
    clearInterval(timer);
    if (failure) { pref.fail = new Date().toLocaleString() + ': ' + reason; savePref(); }
    note((failure ? 'Stopped: ' : '') + reason);
    setDot();
    if (was && sess && db) flush();
  }
  function start() {
    if (!OW.Rng || OW.Rng.fallback) throw new Error('seeded random unavailable');
    perf0 = performance.now();
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {}
    sess = { id: Date.now().toString(36) + Math.floor(OW.Rng.native() * 1e6).toString(36), start: Date.now(), date0: Date.now(), build: build(),
      rng: OW.Rng.getState(), ticks: 0, ms: 0, chunks: 0, cps: 1, bytes: 0, prefs: null, off: 0, savedAt: null, link: null };
    on = true; status = 'Recording';
    TYPES.forEach((t) => document.addEventListener(t, capture, { capture: true, passive: true }));
    timer = setInterval(everySecond, 1000);
    // Boot facts known only after Save.init (main.js, DOMContentLoaded): offline seconds and display prefs.
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
      try {
        sess.prefs = prefs();
        sess.off = OW.DisplayPrefs && OW.DisplayPrefs.get('offline') === 0 ? 0 : OW.Save.getLastOfflineSeconds();
        if (raw) sess.savedAt = OW.Save.decode(raw).savedAt;
      } catch (err) { note('boot info: ' + err.message); }
    }));
    const cp0 = { s: sess.id, i: 0, T: 0, ms: 0, rng: sess.rng, pins: [] };
    const ready = zip(raw || '').then((z) => { cp0.save = z; queue('cps', cp0); });
    if (!window.indexedDB) { note('No database; recording to memory.'); return; }
    openDB(DB).then(async (d) => {
      await ready;
      const all = await req(store(d, 'sessions').getAll()), prev = all.sort((a, b) => b.start - a.start)[0];
      total = all.reduce((n, s) => n + (s.bytes || 0), 0); kept = all.length + 1;
      const ok = !!prev && !pref.gap && prev.last === hash(raw || '');
      sess.link = { ok, why: ok ? 'continues from previous' : !prev ? 'first recorded session' : pref.gap ? 'recorder was off' : !raw ? 'no save (erased or new)' : pref.end || 'save changed outside recording (rollback, other tab or import)' };
      delete pref.gap; delete pref.end; savePref();
      db = d;
      note('Recording. ' + (ok ? '✓ ' : 'Break: ') + sess.link.why);
      flush();
    }).catch((err) => { writeOk = false; status = 'Failed: ' + err.message; note('database unavailable (' + err.message + '); recording to memory'); setDot(); });
  }

  /* ---- Export / import ---- */
  async function exportBlob(which) {
    while (flushing) await new Promise((r) => setTimeout(r, 50));
    await flush();
    const now = Date.now(), parts = [];
    const list = db ? (await req(store(db, 'sessions').getAll())) : sess ? [sess] : [];
    for (const s of list.sort((a, b) => a.start - b.start)) {
      if (which === 'cur' ? s.id !== (sess && sess.id) : which === 'day' && s.end < now - 864e5) continue;
      const mine = (name) => pending.filter((p) => p.name === name && p.rec.s === s.id).map((p) => p.rec);
      const [chunks, cps] = db ? await sessionData(db, s.id) : [[], []];
      chunks.push(...mine('chunks')); cps.push(...mine('cps'));
      parts.push(JSON.stringify({ k: 's', ...s }) + '\n');
      chunks.forEach((c) => parts.push(JSON.stringify({ k: 'c', ...c }) + '\n'));
      for (const c of cps) parts.push(JSON.stringify({ k: 'p', ...c, save: await unz(c.save) }) + '\n');
    }
    if (!parts.length) return null;
    const blob = new Blob(parts);
    return window.CompressionStream ? new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob() : blob;
  }
  async function exportFile(which) {
    const blob = await exportBlob(which);
    if (!blob) return 'Nothing recorded yet.';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `orbweaver-recording-${new Date().toISOString().slice(0, 10)}.owrec`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'Recording exported.';
  }
  async function importFile(file) {
    const gz = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const stream = gz[0] === 0x1f && gz[1] === 0x8b ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    const d = await openDB(IMPORT_DB);
    const clear = d.transaction(['sessions', 'chunks', 'cps'], 'readwrite');
    ['sessions', 'chunks', 'cps'].forEach((n) => clear.objectStore(n).clear());
    let rest = '', count = 0, first = true;
    for (;;) { // line by line, one transaction per read, so a 1,000-hour file is never held whole
      const { value, done } = await reader.read();
      const lines = (rest + (value || '')).split('\n');
      rest = done ? '' : lines.pop();
      const tx = d.transaction(['sessions', 'chunks', 'cps'], 'readwrite');
      lines.forEach((line) => {
        if (!line.trim()) return;
        let rec; try { rec = JSON.parse(line); } catch (e) { rec = {}; }
        const name = { s: 'sessions', c: 'chunks', p: 'cps' }[rec.k];
        if (!name || (first && rec.k !== 's')) throw new Error('Not a recording file.');
        first = false; delete rec.k; if (name === 'sessions') count++;
        tx.objectStore(name).put(rec);
      });
      await new Promise((ok, no) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => no(tx.error || new Error('import write failed')); });
      if (done) break;
    }
    if (!count) throw new Error('Not a recording file.');
    return d;
  }
  async function showSessions(d) {
    const list = $('rec-list'), here = build();
    const all = (await req(store(d, 'sessions').getAll())).sort((a, b) => a.start - b.start);
    list.innerHTML = all.map((s, i) => `<button class="rec-pick" data-i="${i}">${new Date(s.start).toLocaleString()} · ${Math.round(s.ticks / 300)} min · ${s.build}${s.build === here ? '' : ' ⚠'} · ${s.link && s.link.ok ? '✓' : 'break'}</button>`).join('');
    list.querySelectorAll('.rec-pick').forEach((b) => b.addEventListener('click', () => replaySession(d, all[+b.dataset.i])));
  }

  /* ---- Settings UI ---- */
  function renderLog() {
    const p = $('rec-log');
    if (!p || p.hidden) return;
    p.querySelector('.rec-log-status').textContent = `${status} · ${(total / 1e6).toFixed(2)} MB stored · ${kept} sessions kept${pending.length ? ` · ${(held() / 1e6).toFixed(2)} MB in memory` : ''}${pref.fail ? ' · last failure ' + pref.fail : ''}`;
    p.querySelector('pre').textContent = log.join('\n');
  }
  /* ---- Comments: stamped with the game moment the box was opened; never replayed as input ---- */
  const stamp = () => ({ T: OW.Rng.ticks, ms: Math.round(performance.now() - perf0) });
  // Also public (Recorder.comment) for mechanics that file their own notes; false when not recording.
  function comment(text, at = stamp()) {
    if (!on || !text) return false;
    buf.push({ T: at.T, ms: at.ms, t: 12, p: -1, x: text });
    return true;
  }
  function wireComments() {
    const bar = document.querySelector('.left-hand-topbar'), toggle = $('rec-comments');
    if (!bar || !toggle) return;
    const make = (tag, props) => Object.assign(document.createElement(tag), props);
    const btn = make('button', { id: 'rec-comment-btn', className: 'rec-comment-btn', title: 'Add a comment', hidden: true,
      innerHTML: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 4h16v11H9l-5 4z"/></svg>' });
    const box = make('input', { className: 'rec-comment-box', maxLength: 500, placeholder: 'Comment, then Enter', hidden: true });
    const saved = make('span', { className: 'rec-comment-saved', textContent: 'Comment saved.' });
    bar.insertBefore(btn, $('pause-play-btn')); bar.append(box, saved);
    let at = null;
    const close = () => { box.hidden = true; at = null; };
    btn.addEventListener('click', () => { if (!on) return; at = stamp(); box.value = ''; box.hidden = false; box.focus(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return close();
      if (e.key !== 'Enter') return;
      const text = box.value.trim();
      if (at && comment(text, at)) { saved.classList.remove('show'); void saved.offsetWidth; saved.classList.add('show'); }
      close();
    });
    box.addEventListener('blur', close);
    const paint = () => { toggle.classList.toggle('on', !!pref.comments); toggle.classList.toggle('disabled', !pref.on); setDot(); };
    toggle.addEventListener('click', () => { if (!pref.on) return; pref.comments = pref.comments ? 0 : 1; savePref(); paint(); });
    $('rec-toggle').addEventListener('click', paint);
    paint();
  }
  function wireUI() {
    const row = $('rec-row'), dot = $('rec-dot'), toggle = $('rec-toggle'), msg = (t) => { $('rec-status').textContent = t; };
    if (!row) return;
    toggle.classList.toggle('on', !!pref.on);
    toggle.addEventListener('click', () => {
      pref.on = pref.on ? 0 : 1;
      if (!pref.on) { pref.gap = 1; stop('switched off', false); } else note('Recording starts on next load.');
      savePref(); toggle.classList.toggle('on', !!pref.on);
    });
    $('rec-export-btn').addEventListener('click', () => exportFile($('rec-range').value).then(msg, (err) => msg('Export failed: ' + err.message)));
    const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.owrec' });
    picker.addEventListener('change', () => picker.files[0] && importFile(picker.files[0]).then(showSessions).then(() => msg('Pick a session to replay.'), (err) => msg('Import failed: ' + err.message)));
    $('rec-import-btn').addEventListener('click', () => picker.click());
    const panel = document.createElement('div');
    panel.id = 'rec-log'; panel.className = 'rec-log'; panel.hidden = true;
    panel.innerHTML = '<div class="rec-log-status"></div><pre></pre><button class="action-btn">Copy log</button>';
    panel.querySelector('button').addEventListener('click', () => { try { navigator.clipboard.writeText(panel.textContent); } catch (e) {} });
    row.appendChild(panel); // inside the Recording section, under its controls
    dot.addEventListener('click', () => { panel.hidden = !panel.hidden; renderLog(); });
    row.hidden = false;
  }

  OW.Recorder = { rep, util, get on() { return on; }, get session() { return sess; }, log, comment, exportFile, flush, stop, pulse: everySecond, exportBlob, importFile }; // flush..importFile: test surface
  try {
    wireUI();
    wireComments();
    let replaying = false;
    try { replaying = !!sessionStorage.getItem(REPLAY_KEY); } catch (e) {}
    if (replaying) note('Replay mode; not recording.');
    else if (!pref.on) { pref.gap = 1; savePref(); note('Off.'); }
    else start();
  } catch (err) { stop('start: ' + err.message); }
  setDot();
})();
