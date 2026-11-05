/* ============================================================
   CORE: SIDE PINS
   Settings 'Side pins' pins card modals into a column right of the game
   (desktop) or a strip along the bottom (mobile). 'Force right' docks
   right everywhere (a phone splits: game left 60%, pins right 40%);
   'Force bottom' docks at the bottom everywhere and leaves Centered alone. Each panel is a full,
   live, clickable copy of its card's modal, steppers included.

   Off by default (desktop and mobile); both switches persist with
   display prefs (script.js OW.DisplayPrefs), never the save. While on
   with nothing pinned it only shows the pin icon: no column, no layout
   change, no per-tick work. The first pin opens the dock; a desktop side
   column moves a Centered layout to Free until it closes, and switching
   Centered back on there turns on Force bottom: the pins stay, in the strip. '5 pin max' caps pins
   at MAX; turning it back on keeps the top MAX.

   No mechanic knows about pins. While a panel is patched, rebuilt or
   interacted with, it briefly takes the real modal's element ids and
   cards.js treats its card as the open modal (Cards.swapOpen) — so every
   mechanic's own render/patch/handler code lands in the panel unchanged.
   A pointer hold keeps the swap until release (hold-to-repeat steppers).

   Handoff: opening a pinned card's real modal freezes its panel behind
   the scrim; on close the panel rebuilds. Cargo (isMule) cards are never
   pinnable; a pinned card that hides unpins. Pins themselves are never saved.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, C = OW.Cards;
  const MAX = 5, MIN_DOCK = 320; // pin cap; narrowest side column (px) worth showing
  const PATCH_MS = 0;            // min ms between a panel's live patches (0 = every refresh)
  const IDS = ['card-modal-scrim', 'card-modal-win', 'card-modal-title', 'card-modal-body', 'card-modal-header-left', 'card-modal-header-sub'];
  const $ = (id) => document.getElementById(id);
  const real = IDS.map($), body = document.body;
  const dock = $('pin-dock'), toggle = $('pins-toggle'), maxToggle = $('pins-max-toggle'), rightT = $('pins-right-toggle'), bottomT = $('pins-bottom-toggle'), pinBtn = $('card-modal-pin'), mainWrap = $('main-wrap');
  const pins = [];
  let on = false, capped = true, pos = 0, active = null, held = false, restoreCentered = false;

  const desktop = () => matchMedia('(min-width: 701px) and (hover: hover) and (pointer: fine)').matches;
  const find = (id) => pins.find((p) => p.m.id === id);
  const openMech = () => OW.Mechanics.all().find((m) => C.isModalOpenFor(m.id));
  const P = () => OW.DisplayPrefs; // script.js display prefs; layout 1 = Centered, 0 = Free
  const setLayout = (v) => { if (P().get('layout') !== v) P().set('layout', v); };
  // Side column starts under the header (log bar) whatever its height.
  const place = () => dock.style.setProperty('--pins-top', mainWrap.getBoundingClientRect().top + 'px');
  // One frame late: moving the column inside the observer's callback trips the browser's loop error.
  const ro = window.ResizeObserver ? new ResizeObserver(() => requestAnimationFrame(place)) : null;

  /* ---- Host swap ---- */
  function enter(p) {
    real.forEach((el) => el.removeAttribute('id'));
    p.els.forEach((el, i) => { el.id = IDS[i]; });
    p.prev = C.swapOpen(p.m.id);
    active = p;
  }
  function exit() {
    const p = active;
    if (!p) return;
    p.els.forEach((el) => el.removeAttribute('id'));
    real.forEach((el, i) => { el.id = IDS[i]; });
    C.swapOpen(real[0].classList.contains('open') ? p.prev : null); // real modal may have closed meanwhile
    active = null;
    // A handler "closed the modal" inside the panel — a panel never closes, it rebuilds.
    if (!p.host.classList.contains('open') && pins.includes(p)) withPin(p, () => build(p));
  }
  function withPin(p, fn) {
    if (active === p) return fn();
    const was = active;
    exit(); enter(p);
    try { fn(); } finally { exit(); if (was && pins.includes(was)) enter(was); }
  }

  function build(p) {
    const m = p.m;
    p.stale = false;
    m.els.modalSteppers = !m.stepperReady || m.stepperReady() ? C.modalSteppers(m) : null;
    p.win.classList.toggle('modal-wide', !!m.modalWide);
    C.rebuildOpenModal(m);
    C.refresh(m);
    C.paintBars(m);
  }

  // Cards.refresh / refreshOpenModal call this for any card not open in the real modal.
  function hook(m, rebuild) {
    const p = find(m.id);
    if (!p) return;
    if (!m.revealed) return unpin(p);
    if (body.classList.contains('pins-hidden')) { p.stale = true; return; }
    const now = performance.now();
    if (!rebuild && !p.stale && now - p.t < PATCH_MS) return;
    p.t = now;
    withPin(p, () => (rebuild || p.stale ? build(p) : (C.patchOpenModal(m), C.paintBars(m))));
  }

  /* ---- Layout: side column, phone split, bottom strip, or hidden when the side won't fit ---- */
  function fit() {
    const has = pins.length > 0, dt = desktop(), side = pos === 1 || (pos === 0 && dt); // pos: 0 auto, 1 right, 2 bottom
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-zoom')) || 1;
    const hide = has && side && dt && innerWidth < 260 + 410 * zoom + MIN_DOCK; // --game-frame-width + column
    const wasHidden = body.classList.contains('pins-hidden');
    body.classList.toggle('pins-side', has && side && !hide);
    body.classList.toggle('pins-split', has && side && !dt);
    body.classList.toggle('pins-bottom', has && !side);
    body.classList.toggle('pins-hidden', hide);
    // Only the desktop side column needs Free; Centered comes back when it goes.
    if (has && side && dt && P().get('layout') === 1) { restoreCentered = true; setLayout(0); }
    else if (restoreCentered && !(has && side && dt)) { restoreCentered = false; setLayout(1); }
    dock.classList.toggle('has-wide', pins.some((p) => p.m.modalWide)); // every panel as wide as the widest
    if (ro) { if (has) ro.observe(mainWrap); else ro.disconnect(); }
    if (has) place();
    if (wasHidden && !hide) pins.forEach((p) => hook(p.m, true));
  }

  /* ---- Pin / unpin ---- */
  function pin(m) {
    const host = document.createElement('div');
    host.className = 'pin-host open';
    host.innerHTML = `<div class="modal-win pin-win"><div class="modal-header">
      <button class="pin-btn on" title="Unpin">${pinBtn.innerHTML}</button>
      <div class="modal-header-top"><div class="modal-header-left"></div><div class="modal-title"></div></div>
      <div class="modal-header-sub"></div></div><div class="modal-body"></div></div>`;
    const q = (s) => host.querySelector(s);
    const p = { m, host, win: q('.pin-win'), t: 0, stale: true };
    p.els = [host, p.win, q('.modal-title'), q('.modal-body'), q('.modal-header-left'), q('.modal-header-sub')];
    q('.pin-btn').addEventListener('click', () => unpin(p));
    pins.push(p);
    dock.appendChild(host);
    C.setPinHook(hook);
    fit();
    hook(m, true);
  }
  function unpin(p) {
    if (active === p) exit();
    if (!pins.includes(p)) return;
    pins.splice(pins.indexOf(p), 1);
    p.host.remove();
    if (!C.isModalOpenFor(p.m.id)) p.m.els.modalSteppers = null;
    if (!pins.length) C.setPinHook(null);
    fit();
  }
  const unpinAll = (from = 0) => pins.slice(from).forEach(unpin);

  // Notice box left of (or under) the control that caused it; fades out (.pin-pop).
  function pop(el, text, left) {
    document.querySelectorAll('.pin-pop').forEach((d) => d.remove());
    const r = el.getBoundingClientRect(), d = document.createElement('div');
    d.className = 'sp-req-msg pin-pop';
    d.textContent = text;
    d.style.right = document.documentElement.clientWidth - (left ? r.left - 6 : r.right) + 'px';
    d.style.top = (left ? r.top + r.height / 2 : r.bottom + 6) + 'px';
    if (left) d.style.transform = 'translateY(-50%)';
    d.addEventListener('animationend', () => d.remove());
    body.appendChild(d);
  }

  // Real modal's pin button: hidden for cargo and placeholder modals, lit when pinned.
  function syncBtn() {
    const m = active ? OW.Mechanics.get(active.prev) : openMech();
    pinBtn.hidden = !m || !!(m.isMule || m.noPin); // noPin: cards whose controls start a cinematic
    pinBtn.classList.toggle('on', !!(m && find(m.id)));
  }
  pinBtn.addEventListener('click', () => {
    const m = openMech();
    if (!m || m.isMule || m.noPin) return;
    const p = find(m.id);
    if (p) { unpin(p); return syncBtn(); }
    if (capped && pins.length >= MAX) { pop(pinBtn, 'Pin limit reached', true); pinBtn.classList.add('shake'); return; }
    C.closeModal();
    pin(m);
  });
  pinBtn.addEventListener('animationend', () => pinBtn.classList.remove('shake'));

  /* ---- Panel events run inside the swap ---- */
  const leaveSoon = () => setTimeout(() => { if (!held) exit(); });
  ['pointerdown', 'click', 'input', 'change', 'keydown', 'keyup', 'focusin', 'focusout'].forEach((type) =>
    dock.addEventListener(type, (e) => {
      const p = pins.find((x) => x.host.contains(e.target));
      if (!p || (active !== p && C.isModalOpenFor(p.m.id))) return; // frozen during a handoff
      if (active !== p) { exit(); enter(p); }
      if (type === 'pointerdown') held = true;
      leaveSoon();
    }, true));
  ['pointerup', 'pointercancel'].forEach((t) => window.addEventListener(t, () => { if (held) { held = false; leaveSoon(); } }));

  // Handoff: a click that opens a pinned card's real modal marks its panel for rebuild on close.
  document.addEventListener('click', (e) => {
    const p = pins.length && pins.find((x) => x.m.els.wrap.contains(e.target));
    if (p && !e.target.closest('.card-steppers')) p.stale = true;
  }, true);
  document.addEventListener('click', () => { if (on) syncBtn(); });

  /* ---- Settings switches ---- */
  function setOn(v) {
    on = v;
    toggle.classList.toggle('on', v);
    body.classList.toggle('pins-on', v);
    if (!v) unpinAll();
  }
  toggle.addEventListener('click', () => { setOn(!on); P().set('pins', on ? 1 : 0); });
  maxToggle.addEventListener('click', () => {
    capped = !capped;
    maxToggle.classList.toggle('on', capped);
    P().set('pinMax', capped ? 1 : 0);
    if (capped) unpinAll(MAX); // keep the top MAX
    else pop(maxToggle, 'Could slow down game on low end systems');
  });
  function setPos(v) {
    pos = v;
    rightT.classList.toggle('on', v === 1);
    bottomT.classList.toggle('on', v === 2);
    if (pins.length) fit();
  }
  rightT.addEventListener('click', () => { setPos(pos === 1 ? 0 : 1); P().set('pinPos', pos); });
  bottomT.addEventListener('click', () => { setPos(pos === 2 ? 0 : 2); P().set('pinPos', pos); });
  window.addEventListener('resize', () => { if (pins.length) fit(); });
  $('game-zoom-slider').addEventListener('input', () => { if (pins.length) fit(); });

  // Display prefs live in script.js, which loads after this file.
  document.addEventListener('DOMContentLoaded', () => {
    setOn(P().get('pins') === 1);
    capped = P().get('pinMax') === 1;
    maxToggle.classList.toggle('on', capped);
    setPos(P().get('pinPos'));
    // Registered now, after script.js's own handler, so the layout pref has already flipped.
    document.addEventListener('click', (e) => {
      if (e.target.id === 'layout-toggle' && P().get('layout') === 1 && body.classList.contains('pins-side') && !body.classList.contains('pins-split')) { restoreCentered = false; setPos(2); P().set('pinPos', 2); }
    });
  });

  OW.Pins = { pins, isOn: () => on, pop }; // pop: shared notice box (cheats.js); the rest is a test/debug surface
})();
