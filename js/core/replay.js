/* ============================================================
   CORE: REPLAY MODE (Cakes' side; inert for players)
   Runs only on the one page load right after Settings > Import
   recording picked a session (or a jump reloaded into a checkpoint):
   the sessionStorage flag is read and removed on the first line, so any
   later reload is the normal game.

   Sandbox first: window.localStorage is swapped in one step for a copy
   whose writes do nothing and whose save key returns the recorded save.
   If that swap fails, nothing else happens and the real game boots.

   Then: the recorded dice (Rng state), Settings that shape pinned panels,
   and one virtual clock (performance.now / Date.now) driven by the
   recorded action times. The loop never runs; this file steps ticks with
   Loop.runBulk and dispatches each recorded action before its tick.
   Uses js/core/recorder.js helpers (OW.Recorder.util).
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, U = OW.Recorder && OW.Recorder.util;
  let flag = null;
  try { flag = JSON.parse(sessionStorage.getItem('orbweaver.replay.v1')); sessionStorage.removeItem('orbweaver.replay.v1'); } catch (e) {}
  if (!flag || !U) return;

  const real = window.localStorage;
  const box = { getItem: (k) => k === U.SAVE_KEY ? flag.raw : real.getItem(k), setItem() {}, removeItem() {}, clear() {}, key: (i) => real.key(i), get length() { return real.length; } };
  try { Object.defineProperty(window, 'localStorage', { value: box, configurable: true, writable: true }); } catch (e) { return; }
  if (window.localStorage !== box) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let vms = flag.vms;
  const date0 = flag.date - flag.vms;
  performance.now = () => vms;
  Date.now = () => date0 + vms;
  if (flag.cp == null) OW.Rng.setState(flag.rng); // session start: boot rolls exactly as recorded
  if (flag.prefs && OW.DisplayPrefs) Object.keys(flag.prefs).forEach((k) => flag.prefs[k] != null && OW.DisplayPrefs.set(k, flag.prefs[k]));

  const R = OW.Replay = { E: [], cps: [], paths: [], i: 0, speed: flag.speed || 1, playing: false, follow: true, sync: '✓ in sync' };
  // The loop never runs in replay; recorded Pause/Play presses only flip what isRunning() reports (main.js previews).
  let paused = true, booted = false;
  OW.Loop.start = () => { paused = false; if (!booted) { booted = true; boot(); } };
  OW.Loop.stop = () => { paused = true; };
  OW.Loop.isRunning = () => !paused;

  const clock = (T) => { const s = Math.floor(T / 5); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const $ = (sel) => R.bar.querySelector(sel);
  function render() {
    if (!R.bar) return;
    $('[data-r="play"]').textContent = R.playing ? '❚❚' : '▶';
    $('[data-r="follow"]').classList.toggle('on', R.follow);
    R.bar.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', String(R.speed) === b.dataset.speed));
    $('.replay-time').textContent = `${clock(OW.Rng.ticks)} / ${clock(R.meta ? R.meta.ticks : 0)}`;
    $('.replay-sync').textContent = R.sync;
    const scrub = $('.replay-scrub');
    if (R.meta && document.activeElement !== scrub) { scrub.max = R.meta.ticks; scrub.value = OW.Rng.ticks; }
  }
  function ui() {
    R.bar = document.createElement('div');
    R.bar.id = 'replay-bar';
    R.bar.innerHTML = `<div class="replay-log" hidden></div><div class="replay-strip"><button class="replay-log-btn" data-r="log" title="Earlier, now and the next hour; click a line to jump there">!</button><div class="replay-msgs"><span></span><span></span><span></span></div></div><div class="replay-banner">REPLAY — your save is untouched <span class="replay-note">Loading…</span></div>
      <div class="replay-controls"><button data-r="play">▶</button>${['1', '2', '5', '10', 'max'].map((s) => `<button data-speed="${s}">${s === 'max' ? 'Max' : s + '×'}</button>`).join('')}
      <button data-r="follow" title="Scroll to each action">Follow</button><input type="range" class="replay-scrub" min="0" max="0" value="0"><span class="replay-time"></span><span class="replay-sync"></span><span class="replay-seed"></span><button data-r="exit">Exit</button></div>`;
    document.body.appendChild(R.bar);
    document.body.classList.add('replaying');
    R.bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !R.meta) return;
      if (b.dataset.speed) R.speed = b.dataset.speed === 'max' ? 'max' : +b.dataset.speed;
      else if (b.dataset.r === 'play') R.playing ? pause() : play();
      else if (b.dataset.r === 'follow') R.follow = !R.follow;
      else if (b.dataset.r === 'log') R.log.hidden ? openLog() : (R.log.hidden = true);
      else if (b.dataset.r === 'exit') location.reload();
      render();
    });
    $('.replay-scrub').addEventListener('change', (e) => jump(+e.target.value));
    R.log = $('.replay-log');
    R.log.addEventListener('click', (e) => { const line = e.target.closest('[data-t]'); if (line && R.meta) { R.log.hidden = true; jump(+line.dataset.t); } });
  }

  /* ---- Action log: built from the replay's own screen, so nothing extra is ever recorded ---- */
  const LOG_MAX = 20000;
  const words = (n) => n ? n.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  function where(el) {
    const pin = el.closest('.pin-host'), row = el.closest('.settings-row');
    if (pin) return words(pin.querySelector('.modal-title'));
    if (el.closest('#card-modal-win')) return words(document.getElementById('card-modal-title'));
    if (el.closest('.card-wrap')) return words(el.closest('.card-wrap').querySelector('.card-name'));
    return row ? 'Settings · ' + words(row.querySelector('span')) : el.closest('#cheat-header') ? 'Cheat' : el.closest('#left-hand') ? 'Rail' : '';
  }
  R.lines = [];
  const lineText = (l) => `${clock(l.T)} · ${l.text}${l.held ? ` (held ×${l.held})` : ''}`;
  function logLine(T, text, el, c) {
    R.lines.push(R.lastLog = { el, T, text, held: 0, c });
    if (R.lines.length > LOG_MAX) R.lines.shift();
    paintLine();
  }
  // One line in the bar, newest first and brightest, like the message strip.
  function paintLine() { const n = R.lines.length; R.bar.querySelectorAll('.replay-msgs span').forEach((s, k) => { const l = R.lines[n - 1 - k]; s.textContent = l ? lineText(l) : ''; s.classList.toggle('rl-comment', !!(l && l.c)); }); }
  // Named from the control tapped, never from a container's text; empty space returns null (replayed, not logged).
  const CONTROL = 'button, input, select, textarea, .toggle-switch, [data-gm-tier], .card';
  function describe(e, el) {
    if (el.id === 'card-modal-scrim') return 'Closed window';
    const c = el.closest(CONTROL) || (words(el).length <= 30 && el.childElementCount <= 1 ? el : null);
    if (!c) return null;
    const what = e.t === 3 ? `typed "${e.x}"` : e.t === 4 ? `set "${e.x}"` : e.t === 5 ? '⏎' : c.classList.contains('card') ? 'open'
      : c.classList.contains('toggle-switch') ? 'switch' : words(c) || c.title || c.getAttribute('aria-label') || c.className.split(' ')[0];
    return [where(c), what].filter(Boolean).join(' · ');
  }
  // "!": Earlier (replayed), Now, and Next hour (recorded actions ahead, named from today's screen).
  function openLog() {
    const next = [], end = OW.Rng.ticks + 18000;
    for (let k = R.i; k < R.E.length && R.E[k].T <= end; k++) {
      const e = R.E[k], prev = next[next.length - 1], same = prev && prev.p === e.p;
      if (e.t === 12) { next.push({ p: -1, T: e.T, held: 0, text: `💬 "${e.x}"`, c: true }); continue; }
      if ([1, 6, 9, 10].includes(e.t) || (e.t === 5 && e.x !== 'Enter') || (same && [2, 3, 5].includes(e.t))) continue;
      if (same && e.t === 8) { prev.held += e.x; continue; }
      const el = U.resolve(R.paths[e.p]), text = el ? describe(e, el) : '? (inside a window not open yet)';
      if (text !== null) next.push({ p: e.p, T: e.T, held: e.t === 8 ? e.x : 0, text });
    }
    const add = (cls, text, T) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; if (T != null) d.dataset.t = T; R.log.appendChild(d); return d; };
    R.log.textContent = '';
    add('rl-h', 'Earlier'); R.lines.slice(0, -1).forEach((l) => add(l.c ? 'rl-comment' : '', lineText(l), l.T));
    add('rl-h', 'Now'); const now = R.lines.length ? add('rl-now', lineText(R.lines[R.lines.length - 1]), R.lastLog.T) : null;
    add('rl-h', 'Next hour'); next.forEach((l) => add(l.c ? 'rl-next rl-comment' : 'rl-next', lineText(l), l.T)); if (!next.length) add('rl-next', '—');
    R.log.hidden = false;
    if (now) R.log.scrollTop = now.offsetTop - R.log.clientHeight / 2;
  }
  // Read before dispatch: a click may close or rebuild what it names. Presses, holds, typing and Enter fold into one line.
  function logAction(e, el) {
    const same = R.lastLog && R.lastLog.el === el;
    if (e.t === 1 || e.t === 6 || (e.t === 2 && same) || (e.t === 5 && e.x !== 'Enter')) return;
    if (same && (e.t === 8 || e.t === 3 || e.t === 5)) {
      if (e.t === 8) R.lastLog.held += e.x;
      else if (e.t === 3) R.lastLog.text = R.lastLog.text.replace(/typed ".*"$/, `typed "${e.x}"`);
      else R.lastLog.text += ' ⏎';
      return paintLine();
    }
    const text = describe(e, el);
    if (text === null) return;
    logLine(e.T, text, el);
    if (e.t === 8) { R.lastLog.held = e.x; paintLine(); }
  }
  const note = (t) => { if (R.bar) $('.replay-note').textContent = t; };

  // Rail top bar (where the game's comment button sits): every comment in the session, with a count; click one to jump there.
  function commentsUI() {
    const bar = document.querySelector('.left-hand-topbar'), all = R.E.filter((e) => e.t === 12);
    if (!bar) return;
    const btn = document.createElement('button'), list = document.createElement('div');
    btn.className = 'replay-comments-btn'; btn.title = 'All comments';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 4h16v11H9l-5 4z"/></svg><span>${all.length}</span>`;
    list.className = 'replay-comments'; list.hidden = true;
    bar.insertBefore(btn, document.getElementById('pause-play-btn')); bar.appendChild(list);
    btn.addEventListener('click', () => {
      if (!list.hidden) return (list.hidden = true);
      list.textContent = all.length ? '' : 'No comments';
      const past = all.filter((e) => e.T <= OW.Rng.ticks).pop();
      all.forEach((e) => {
        const d = document.createElement('div');
        d.dataset.t = e.T; d.className = e === past ? 'rc-now' : e.T > OW.Rng.ticks ? 'rc-next' : '';
        d.textContent = `${clock(e.T)} · 💬 "${e.x}"`;
        list.appendChild(d);
      });
      list.hidden = false;
    });
    list.addEventListener('click', (e) => { const d = e.target.closest('[data-t]'); if (d) { list.hidden = true; jump(+d.dataset.t); } });
  }
  async function boot() {
    ui();
    try {
      const d = R.db = await U.openDB(U.IMPORT_DB);
      R.meta = await U.req(U.store(d, 'sessions').get(flag.sid));
      const [chunks, cps] = await U.sessionData(d, flag.sid);
      R.cps = cps.sort((a, b) => a.i - b.i);
      let T = 0, ms = 0;
      chunks.forEach((c) => { R.paths.push(...c.np); c.ev.forEach((a) => { T += a[0]; ms += a[1]; R.E.push({ T, ms, t: a[2], p: a[3], x: a[4] }); }); });
      if (flag.cp != null) { // checkpoint boot: the dice and pinned panels as they were at that moment
        OW.Rng.setState(flag.rng);
        R.i = R.E.findIndex((e) => e.t === 10 && e.x === flag.cp) + 1;
        (flag.pins || []).forEach((id) => {
          const m = OW.Mechanics.get(id);
          if (!m || !m.els) return;
          vms += 200; m.els.nameEl.click();
          vms += 200; const pin = document.getElementById('card-modal-pin'); if (pin) pin.click();
        });
      }
      const here = U.build();
      $('.replay-seed').textContent = 'Seed ' + R.meta.rng[0];
      note(R.meta.build === here ? '' : `Recorded on build ${R.meta.build}, you're on build ${here}. Replay may be inaccurate — load the build ${R.meta.build} zip for an exact replay.`);
      commentsUI();
      R.ready = true; R.mismatch = R.meta.build !== here;
      render();
      if (flag.T != null) await runTo(flag.T);
      if (flag.play) play();
    } catch (err) { note('Replay could not load: ' + err.message); }
  }

  /* ---- Driving ---- */
  const PE = window.PointerEvent || window.MouseEvent;
  // Flash the action; with Follow on, bring it into view (smooth at 1-2x, a jump at 5-10x, none at Max).
  function show(el, force) {
    el.classList.add('replay-flash'); setTimeout(() => el.classList.remove('replay-flash'), 250);
    R.last = el;
    if (!R.follow || (R.speed === 'max' && !force) || !el.getClientRects().length) return; // hidden: nothing to show
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > R.bar.getBoundingClientRect().top) el.scrollIntoView({ block: 'center', behavior: R.speed <= 2 ? 'smooth' : 'auto' });
  }
  function pause() { R.playing = false; if (R.last && R.last.isConnected) show(R.last, true); }
  function apply(e) {
    vms = Math.max(vms, e.ms);
    if (e.t === 9) { if (U.fingerprint() !== e.x) desync(); return; }
    if (e.t === 10) return;
    if (e.t === 12) return logLine(e.T, `💬 "${e.x}"`, null, true); // a tester's note: shown, never dispatched
    const el = U.resolve(R.paths[e.p]);
    if (!el) return desync();
    logAction(e, el);
    show(el);
    const fire = (type, init) => el.dispatchEvent(new ({ pointerdown: PE, pointerup: PE, click: MouseEvent, keydown: KeyboardEvent, blur: FocusEvent }[type] || Event)(type, { bubbles: type !== 'blur', cancelable: true, ...init }));
    const click = () => fire('click', { detail: e.x == null ? 1 : e.x });
    if (e.t === 7 || e.t === 11) { fire('pointerdown'); fire('pointerup'); if (e.t === 7) click(); }
    else if (e.t === 8) for (let k = 0; k < e.x; k++) fire('pointerdown', { bubbles: false });
    else if (e.t === 2) click();
    else if (e.t === 3 || e.t === 4) { if (el.type === 'checkbox') el.checked = !!e.x; else el.value = e.x; fire(U.TYPES[e.t]); }
    else if (e.t === 5) fire('keydown', { key: e.x });
    else fire(U.TYPES[e.t]);
  }
  function desync() {
    if (R.sync[0] === '✓') R.sync = '⚠ out of sync at ' + clock(OW.Rng.ticks);
    logLine(OW.Rng.ticks, '⚠ out of sync', null);
    const next = R.cps.find((c) => c.i > 0 && c.T > OW.Rng.ticks);
    if (next && !R.jumping) toCheckpoint(next, OW.Rng.ticks, R.playing); // re-sync from the next checkpoint
  }
  // Dispatch everything due now, then run up to `limit` ticks toward the next action. False at the end.
  async function advance(limit) {
    let due = false;
    while (!R.jumping && R.i < R.E.length && R.E[R.i].T <= OW.Rng.ticks) { apply(R.E[R.i++]); due = true; }
    if (due) await wait(0); // pinned panels finish their swap, as between real events
    if (R.jumping) return false;
    if (R.i >= R.E.length) { end(); return false; }
    const next = R.E[R.i], n = Math.min(next.T - OW.Rng.ticks, limit);
    if (n > 0) {
      vms = Math.max(vms, next.ms - 200 * (next.T - OW.Rng.ticks - n + 1)); // tick-time clock, never past the next action
      OW.Loop.runBulk(n);
    }
    return true;
  }
  async function runTo(T) {
    while (OW.Rng.ticks < T && await advance(Math.min(T - OW.Rng.ticks, 300))) await wait(0);
    render();
  }
  async function play() {
    R.playing = true; render();
    if (R.looping) return;
    R.looping = true;
    while (R.playing && await advance(R.speed === 'max' ? 300 : 1)) { render(); await wait(R.speed === 'max' ? 0 : 200 / R.speed); }
    R.looping = false; render();
  }
  async function end() {
    R.playing = false;
    const all = (await U.req(U.store(R.db, 'sessions').getAll())).sort((a, b) => a.start - b.start);
    const next = all[all.findIndex((s) => s.id === R.meta.id) + 1];
    if (next && next.link && next.link.ok && next.build === R.meta.build) { note('Continuing into the next session…'); R.jumping = true; U.replaySession(R.db, next, { play: true, speed: R.speed }); }
    else note('End of recording.' + (next ? ' Next session: ' + (next.link ? next.link.why : 'break') + '.' : ''));
    render();
  }
  // Forward with no closer checkpoint: fast-run. Otherwise reload into the nearest checkpoint at or before T.
  async function jump(T) {
    const cp = R.cps.filter((c) => c.T <= T).pop();
    if (T >= OW.Rng.ticks && (!cp || cp.T <= OW.Rng.ticks)) return runTo(T);
    if (cp) toCheckpoint(cp, T, R.playing);
  }
  async function toCheckpoint(cp, T, play) {
    R.jumping = true;
    if (cp.i === 0) return U.replaySession(R.db, R.meta, { T, play, speed: R.speed });
    const save = JSON.parse(await U.unz(cp.save));
    sessionStorage.setItem(U.REPLAY_KEY, JSON.stringify({ sid: R.meta.id, cp: cp.i, raw: OW.Save.encode(save), rng: cp.rng, date: save.savedAt,
      vms: cp.ms, prefs: cp.prefs, pins: cp.pins, T, play, speed: R.speed }));
    location.reload();
  }
  R.advance = advance; R.runTo = runTo; R.jump = jump; // test surface
})();
