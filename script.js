/* ============================================================
   ORB WEAVER — CORE SHELL LOGIC
   This file only knows about the UI shell itself: opening/closing
   modals, collapsing sections, and the settings menu. It has zero
   game-mechanics knowledge and zero game state. Real mechanics get
   built on top of this later.
   ============================================================ */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);

  /* ---------------- Generic modal open/close ----------------
     Any modal on the page is just a `.modal-scrim` with an `.open`
     class toggle. Clicking the scrim itself (not its content) closes it. */
  function openModal(scrimEl) {
    if (scrimEl) scrimEl.classList.add('open');
  }
  function closeModal(scrimEl) {
    if (scrimEl) scrimEl.classList.remove('open');
  }
  function wireScrimClickToClose(scrimEl) {
    scrimEl.addEventListener('click', (e) => {
      if (e.target === scrimEl) closeModal(scrimEl);
    });
  }

  /* ---------------- Card detail modal ----------------
     Any element with [data-card-name] and [data-card-desc] opens the
     shared card-detail modal when clicked. This is the pattern real
     cards should follow once mechanics exist: no per-card modal HTML,
     just data attributes read by this one handler. */
  const cardModalScrim = el('card-modal-scrim');

  wireScrimClickToClose(cardModalScrim);
  el('card-modal-close').addEventListener('click', () => closeModal(cardModalScrim));

  // headerLeftEl: optional DOM element to place left of the title (e.g. steppers).
  // Pass null/undefined to clear the slot (static/placeholder cards).
  // themeClass: optional 'theme-*' class (e.g. 'theme-mule') applied to the
  // shared modal window, letting a mechanic recolor its own detail view.
  // Elements are looked up by id on every call (not cached) so a pinned
  // panel (js/core/pins.js) holding these ids for a moment receives the render.
  function openCardModal(name, descriptionHtml, headerLeftEl, subtitleHtml, themeClass) {
    const win = el('card-modal-win'), left = el('card-modal-header-left'), sub = el('card-modal-header-sub');
    el('card-modal-title').textContent = name || 'Card';
    el('card-modal-body').innerHTML = descriptionHtml || '';
    if (left.firstChild !== headerLeftEl) {
      left.innerHTML = '';
      if (headerLeftEl) left.appendChild(headerLeftEl);
    }
    if (sub) sub.innerHTML = subtitleHtml || '';
    // Strip every theme-* class, not a fixed list, so no theme (e.g. Sand Dunes) can stick.
    win.classList.remove(...[...win.classList].filter((c) => c.startsWith('theme-')));
    if (themeClass) win.classList.add(themeClass);
    openModal(el('card-modal-scrim'));
  }
  window.OrbWeaver = window.OrbWeaver || {};
  window.OrbWeaver.openCardModal = openCardModal;

  // Delegated click handling: any current or future element with
  // [data-card-name] opens the shared modal. No per-card listeners needed.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-card-name]');
    if (!trigger) return;
    if (e.target.closest('.card-steppers')) return; // steppers don't open the modal
    // Same ghost-click guard the real cards use (see js/core/cards.js).
    if (window.OrbWeaver.Cards && window.OrbWeaver.Cards.isGhostClick && window.OrbWeaver.Cards.isGhostClick()) return;
    openCardModal(trigger.dataset.cardName, trigger.dataset.cardDesc);
  });

  /* ---------------- Section collapse/expand ----------------
     Any `.section-label` toggles the `.card-grid` (or other content
     block) immediately following it in the DOM. */
  function setupSectionCollapse(labelEl) {
    const arrow = labelEl.querySelector('.section-collapse-arrow');
    const target = labelEl.nextElementSibling;
    if (!target) return;
    labelEl.addEventListener('click', () => {
      const collapsed = target.style.display === 'none';
      target.style.display = collapsed ? '' : 'none';
      if (arrow) arrow.classList.toggle('collapsed', !collapsed);
    });
  }
  document.querySelectorAll('.section-label').forEach(setupSectionCollapse);

  /* ---------------- Log modal ----------------
     Reads Footer's history on open (button or the message row itself
     opens it — see UI-SHELL-SUMMARY for the strip vs. modal split). */
  const logScrim = el('log-modal-scrim');
  const logBody = el('log-modal-body');
  wireScrimClickToClose(logScrim);
  el('log-modal-close').addEventListener('click', () => closeModal(logScrim));

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function openLogModal() {
    const history = window.OrbWeaver.Footer.getHistory();
    logBody.innerHTML = history.length
      ? history.map((h) => `<div class="log-row"><span class="log-row-ts">${fmtTime(h.ts)}</span><span class="log-row-text"></span></div>`).join('')
      : '<div class="log-empty">Nothing has happened yet.</div>';
    // Text set via textContent per row (not template string) to avoid
    // ever interpreting message text as HTML.
    logBody.querySelectorAll('.log-row-text').forEach((elx, i) => { elx.textContent = history[i].t; });
    openModal(logScrim);
  }
  el('log-modal-btn').addEventListener('click', openLogModal);
  el('context-footer-messages').addEventListener('click', openLogModal);

  /* ---------------- Settings modal ---------------- */
  const settingsScrim = el('settings-modal-scrim');
  wireScrimClickToClose(settingsScrim);
  el('settings-gear-btn').addEventListener('click', () => openModal(settingsScrim));
  el('settings-modal-close').addEventListener('click', () => closeModal(settingsScrim));

  /* ---------------- Pause/Play ----------------
     Flips the existing Loop start/stop switch. Nothing is saved —
     always resumes playing on a fresh load. */
  const pausePlayBtn = el('pause-play-btn');
  pausePlayBtn.addEventListener('click', () => {
    if (window.OrbWeaver.Loop.isRunning()) {
      window.OrbWeaver.Loop.stop();
      pausePlayBtn.classList.replace('icon-pause', 'icon-play');
      pausePlayBtn.title = 'Play';
      window.OrbWeaver.Footer.push('Paused.');
    } else {
      window.OrbWeaver.Loop.start();
      pausePlayBtn.classList.replace('icon-play', 'icon-pause');
      pausePlayBtn.title = 'Pause';
      window.OrbWeaver.Footer.push('Resumed.');
    }
    window.OrbWeaver.Rates.render(); // grey/un-grey rail rates now, not on the next second
  });

  /* ---------------- Display preferences ----------------
     Settings display controls (four sliders, rate unit, rail
     pill, the two Side pins switches and the Centered layout switch), stored under their own localStorage key so
     they survive export, import and erase — save.js only ever touches
     orbweaver.save.v1. Themes are applied as data-theme on <html>; the
     inline initializer in index.html's <head> uses this same mapping to
     beat the first paint. Everything here degrades to defaults rather
     than throwing when storage is blocked or the stored blob is junk. */
  const DKEY = 'orbweaver.display.v1';
  // Top of each slider is its MAX value, so these read bottom-to-top:
  // index 6 (top) is Original, index 0 (bottom) is Light.
  const THEMES = ['stone', 'dark5', 'dark4', 'dark3', 'dark2', 'dark1', 'original'];
  const THEME_NAMES = ['Light', '-5', '-4', '-3', '-2', '-1', 'Original'];
  // Font packages (style.css FONT PACKAGES), bottom-to-top like the theme slider: index 6 (top) is Original.
  const FONTS = ['gothic', 'futuristic', 'journal', 'typewriter', 'pixel', 'tome', 'original'];
  const FONT_NAMES = ['Gothic', 'Futuristic', 'Journal', 'Typewriter', 'Pixel', 'Tome', 'Original'];
  const root = document.documentElement;

  const clampPref = (v, lo, hi, dflt) =>
    typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;

  // rateUnit: 0 /s, 1 /min, 2 /hr (js/core/rates.js). rateRail: unit pill above Resources.
  // pins: Side pins switch (0 off, the default everywhere; 1 on).
  // pinMax: 5 pin max switch. pinPos: 0 auto, 1 Force right, 2 Force bottom. All read and written by js/core/pins.js.
  // offline: Offline progress switch (1 on, the default; 0 skips catch-up on the next load — js/core/save.js init).
  // adjPanels: 1 = lines draggable (Settings 'Lock panels' off); railW/gameW (px), stripH (vh): dragged sizes, 0 = default (js/core/panels.js).
  const prefs = { 'sidebar-text': 100, 'game-zoom': 100, tone: 6, font: 6, layout: 1, rateUnit: 0, rateRail: 0, pins: 0, pinMax: 1, pinPos: 0, adjPanels: 1, offline: 1, railW: 0, gameW: 0, stripH: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(DKEY)) || {};
    prefs['sidebar-text'] = clampPref(stored['sidebar-text'], 75, 125, 100);
    prefs['game-zoom'] = clampPref(stored['game-zoom'], 75, 125, 100);
    // tone replaces the old 4-step 'theme' key: Slightly lighter and New both become -1.
    prefs.tone = clampPref(stored.tone ?? [0, 5, 5, 6][clampPref(stored.theme, 0, 3, 3)], 0, 6, 6);
    prefs.font = clampPref(stored.font, 0, 6, 6);
    prefs.layout = clampPref(stored.layout, 0, 1, 1);
    prefs.rateUnit = clampPref(stored.rateUnit, 0, 2, 0);
    prefs.rateRail = clampPref(stored.rateRail, 0, 1, 0);
    prefs.pins = clampPref(stored.pins, 0, 1, 0);
    prefs.pinMax = clampPref(stored.pinMax, 0, 1, 1);
    prefs.pinPos = clampPref(stored.pinPos, 0, 2, 0);
    prefs.adjPanels = clampPref(stored.adjPanels, 0, 1, 1);
    prefs.offline = clampPref(stored.offline, 0, 1, 1);
    prefs.railW = clampPref(stored.railW, 0, 600, 0);
    prefs.gameW = clampPref(stored.gameW, 0, 8000, 0);
    prefs.stripH = clampPref(stored.stripH, 0, 60, 0);
  } catch (e) { /* absent, blocked or unparseable — defaults stand */ }

  function saveDisplay() {
    try { localStorage.setItem(DKEY, JSON.stringify(prefs)); } catch (e) {}
  }
  window.OrbWeaver.DisplayPrefs = { get: (k) => prefs[k], set: (k, v) => { prefs[k] = v; applyDisplay(); saveDisplay(); } };
  function applyDisplay() {
    root.style.setProperty('--sidebar-text', prefs['sidebar-text'] / 100);
    root.style.setProperty('--game-zoom', prefs['game-zoom'] / 100);
    root.setAttribute('data-theme', THEMES[prefs.tone]);
    root.setAttribute('data-font', FONTS[prefs.font]);
    document.body.classList.toggle('layout-centered', prefs.layout === 1);
    document.body.dataset.rates = prefs.rateUnit;
    document.body.classList.toggle('rate-rail', prefs.rateRail === 1);
    el('rate-rail-toggle').classList.toggle('on', prefs.rateRail === 1);
    el('layout-toggle').classList.toggle('on', prefs.layout === 1);
    el('offline-toggle').classList.toggle('on', prefs.offline === 1);
    document.querySelectorAll('[data-rate-unit]').forEach((b) => b.classList.toggle('on', +b.dataset.rateUnit === prefs.rateUnit));
    if (window.OrbWeaver.Rates) window.OrbWeaver.Rates.render();
  }

  /* The size sliders make the rest of Settings translucent while held,
     so the change is visible on the live game underneath. Pointer drags
     additionally snap to 100 near center; keyboard deliberately doesn't,
     so 99 and 101 stay selectable. */
  let pointerDragging = false, keyAdjusting = false;
  const refreshAdjust = () =>
    document.body.classList.toggle('settings-adjusting', pointerDragging || keyAdjusting);
  function endAdjust() {
    if (!pointerDragging && !keyAdjusting) return;
    pointerDragging = keyAdjusting = false;
    refreshAdjust();
  }

  // isSize: snaps to 100% on drag. dims: fades Settings while held so the game shows through.
  function wireSlider(id, key, label, isSize, dims = isSize) {
    const input = el(id + '-slider'), out = el(id + '-val');
    if (!input || !out) return;
    input.value = prefs[key];
    const render = () => {
      const text = label(prefs[key]);
      out.textContent = text;
      input.setAttribute('aria-valuetext', text);
    };
    input.addEventListener('input', () => {
      let v = input.valueAsNumber;
      if (isSize && pointerDragging && Math.abs(v - 100) <= 2) { v = 100; input.value = '100'; }
      prefs[key] = v;
      applyDisplay(); render(); saveDisplay();
    });
    if (dims) {
      input.addEventListener('pointerdown', () => { pointerDragging = true; refreshAdjust(); });
      input.addEventListener('pointerup', endAdjust);
      input.addEventListener('pointercancel', endAdjust);
      input.addEventListener('lostpointercapture', endAdjust);
      input.addEventListener('keydown', () => { keyAdjusting = true; refreshAdjust(); });
      input.addEventListener('keyup', endAdjust);
      // Blur ends keyboard adjusting only: pressing the other slider blurs this one *after* its pointerdown.
      input.addEventListener('blur', () => { keyAdjusting = false; refreshAdjust(); });
    }
    render();
  }

  wireSlider('sidebar-text', 'sidebar-text', (v) => v + '%', true);
  wireSlider('game-zoom', 'game-zoom', (v) => v + '%', true);
  wireSlider('display-theme', 'tone', (v) => THEME_NAMES[v], false);
  wireSlider('display-font', 'font', (v) => FONT_NAMES[v], false, true);
  // Default: the four sliders back to 100% / 100% / Original / Original (each slider's input handler saves and relabels).
  el('display-default-btn').addEventListener('click', () => {
    [['sidebar-text', 100], ['game-zoom', 100], ['display-theme', 6], ['display-font', 6]].forEach(([id, v]) => {
      const input = el(id + '-slider'); input.value = v; input.dispatchEvent(new Event('input'));
    });
  });

  // Rate unit pills (Settings and the optional rail copy) and the rail toggle.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate-unit]');
    if (b) prefs.rateUnit = +b.dataset.rateUnit;
    else if (e.target.id === 'rate-rail-toggle') prefs.rateRail = 1 - prefs.rateRail;
    else if (e.target.id === 'layout-toggle') prefs.layout = 1 - prefs.layout; // Centered layout switch (Settings > Side pins)
    else if (e.target.id === 'offline-toggle') prefs.offline = 1 - prefs.offline; // Offline progress switch
    else return;
    applyDisplay(); saveDisplay();
  });

  ['blur', 'pagehide'].forEach((evt) => window.addEventListener(evt, endAdjust));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endAdjust(); });
  el('settings-modal-close').addEventListener('click', endAdjust);
  settingsScrim.addEventListener('click', endAdjust);

  applyDisplay();

})();
