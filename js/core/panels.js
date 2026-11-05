/* ============================================================
   CORE: PANELS (Settings > Panels)
   Three draggable lines: rail | cards, game | side pins column, and
   game / bottom pin strip. Untouched lines look exactly as before: each
   handle is an invisible hit strip over the existing border. A held line
   is 5px white with a grip tag. 'Adjust now' fades Settings and shows
   every line 5px dark until a tap anywhere else (that tap does nothing
   else). It works whether or not 'Lock panels' is on; that switch
   only stops lines being grabbed directly, outside Adjust now.
   Pref adjPanels: 1 = draggable (default), so Lock panels shows its inverse.

   Sizes live in display prefs (script.js): railW and gameW in px, stripH
   in vh, 0 = default. 'Default' is on while all three are 0; a drag
   turns it off and switching it on resets them. Never in the save.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, $ = (id) => document.getElementById(id), body = document.body, root = document.documentElement;
  const P = () => OW.DisplayPrefs;
  const rail = $('left-hand'), main = $('main-wrap'), dock = $('pin-dock');
  const adjT = $('panels-adj-toggle'), defT = $('panels-default-toggle'), nowBtn = $('panels-adjust-btn');
  const KEYS = { railW: ['--rail-w', 'px'], gameW: ['--game-w', 'px'], stripH: ['--strip-h', 'vh'] };
  const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v)));
  const lines = {};
  let adjusting = false, swallow = false;

  const setVar = (k, v) => (v ? root.style.setProperty(KEYS[k][0], v + KEYS[k][1]) : root.style.removeProperty(KEYS[k][0]));
  const apply = () => Object.keys(KEYS).forEach((k) => setVar(k, P().get(k)));
  const sync = () => {
    adjT.classList.toggle('on', P().get('adjPanels') !== 1); // Lock panels = not draggable
    defT.classList.toggle('on', Object.keys(KEYS).every((k) => !P().get(k)));
  };

  // New size for a line from the pointer position.
  const SIZE = {
    // Phones (<=700px) allow extremes: rail 60px up to all but 80px of cards.
    railW: (e) => { const r = rail.getBoundingClientRect(), ph = innerWidth <= 700, room = main.getBoundingClientRect().right - r.left; return clamp(e.clientX - r.left, ph ? 60 : 150, ph ? room - 80 : Math.min(420, room - 250)); },
    gameW: (e) => clamp(e.clientX, rail.getBoundingClientRect().right + 250, innerWidth - 200),
    stripH: (e) => clamp((innerHeight - e.clientY) / innerHeight * 100, 15, 60),
  };

  function place() {
    const show = adjusting || P().get('adjPanels') === 1;
    const r = rail.getBoundingClientRect(), m = main.getBoundingClientRect(), d = dock.getBoundingClientRect();
    const set = (k, on, x, y, w, h) => { const el = lines[k]; el.hidden = !on; if (on) Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); };
    set('railW', show && r.width > 0, r.right, m.top, 0, m.height);
    set('gameW', show && body.classList.contains('pins-side'), d.left, d.top, 0, d.height);
    set('stripH', show && body.classList.contains('pins-bottom'), d.left, d.top, d.width, 0);
  }

  function grab(e, k) {
    if (!adjusting && P().get('adjPanels') !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const el = lines[k];
    let v = P().get(k);
    el.classList.add('drag');
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    const move = (ev) => { v = SIZE[k](ev); setVar(k, v); place(); };
    const up = () => {
      el.classList.remove('drag');
      ['pointermove', 'pointerup', 'pointercancel'].forEach((t) => el.removeEventListener(t, t === 'pointermove' ? move : up));
      P().set(k, v);
      sync();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  Object.keys(KEYS).forEach((k) => {
    const el = document.createElement('div');
    el.className = 'panel-line' + (k === 'stripH' ? ' horiz' : '');
    el.hidden = true;
    el.innerHTML = '<i></i>';
    el.addEventListener('pointerdown', (e) => grab(e, k));
    body.appendChild(el);
    lines[k] = el;
  });

  /* ---- Adjust now: ends on the next tap that isn't on a line; that tap is swallowed ---- */
  const setAdjusting = (v) => { adjusting = v; body.classList.toggle('panels-adjust', v); place(); };
  nowBtn.addEventListener('click', () => setAdjusting(true));
  document.addEventListener('pointerdown', (e) => {
    swallow = false; // a swipe that ended Adjust now never clicks; don't eat the next tap instead
    if (!adjusting || e.target.closest('.panel-line')) return;
    e.preventDefault(); e.stopPropagation();
    swallow = true;
    setAdjusting(false);
  }, true);
  document.addEventListener('click', (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);

  /* ---- Switches ---- */
  adjT.addEventListener('click', () => { P().set('adjPanels', P().get('adjPanels') === 1 ? 0 : 1); sync(); place(); });
  defT.addEventListener('click', () => { Object.keys(KEYS).forEach((k) => P().set(k, 0)); apply(); sync(); place(); });

  // Lines follow every layout change, one frame later (placing them inside a
  // ResizeObserver callback while pins.js moves the dock trips the browser's loop error).
  let queued = false;
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; place(); }); } };
  window.addEventListener('resize', later);
  if (window.ResizeObserver) { const ro = new ResizeObserver(later); [rail, main, dock].forEach((el) => ro.observe(el)); }
  new MutationObserver(later).observe(body, { attributes: true, attributeFilter: ['class'] });

  // Display prefs live in script.js; read them once the page is ready.
  document.addEventListener('DOMContentLoaded', () => { apply(); sync(); place(); });

  OW.Panels = { isAdjusting: () => adjusting }; // test/debug surface only
})();
