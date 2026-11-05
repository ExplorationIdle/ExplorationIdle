/* ============================================================
   CORE: STRANGE SHARD — "Show your future": a temporary glimpse of
   upcoming cards. Visibility here never changes saved unlocks.

   Game side (loop clock, so Pause pauses and replays match): which cards
   (PREVIEW_IDS), their 20 → 10 s countdowns in document order, preview
   locks, and showing undiscovered location sections while their cards
   are up. A reload ends the glimpse. start() may run again (Dig Site, the
   Shard band's Near); only cards not yet revealed take part, and it
   returns how many. active(): a glimpse is still counting down.

   Look (js/core/motion.js scenes; skipped in replays, offline and hidden
   tabs, where cards simply appear and leave on time): the source card
   shakes, a jade light travels down the list with the camera trailing it,
   each card fades up as the light passes, and the camera rests on the
   last card it reveals. A card whose time ends dims and shrinks out so the cards below
   slide up; a borrowed section heading fades with its last card.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const MIN_DURATION = 10, MAX_DURATION = 20;
  const LIGHT = '124,196,176'; // Temple Ruins jade
  // The only cards a glimpse may show: the game as it stood when this list was frozen.
  // Cards added later stay out of "show your future" unless added here on purpose.
  const PREVIEW_IDS = new Set(['wood', 'stone', 'digsite', 'researchbench', 'marketstall', 'scoutspen',
    'mountains', 'quarry', 'wheatfieldcard', 'goldpanning', 'smeltershack', 'goldmine', 'mtn_scoutstable', 'collapsedpath', 'sdpulley']);
  // Tutorial-fade cards: hidden or a transparent, nameless slot. While their face is blank a
  // glimpse shows them fully (.ss-show) under this name; afterwards a held slot fades back.
  const FADED = { researchbench: 'Research Bench' };
  const active = new Map(), groups = new Map();

  function restoreGroup(id) {
    const g = groups.get(id);
    if (!g) return;
    // A discovery during the glimpse owns its section's visibility now.
    if (!(g.hidden && g.location.isDiscovered())) {
      g.grid.style.display = g.gridDisplay;
      if (g.arrow) g.arrow.classList.toggle('collapsed', g.collapsed);
      if (g.hidden && g.section) g.section.style.display = g.sectionDisplay;
    }
    groups.delete(id);
  }

  function finish(m, immediate = false) {
    const entry = active.get(m);
    if (!entry) return;
    active.delete(m);
    Object.entries(entry.saved).forEach(([key, descriptor]) => {
      if (descriptor) Object.defineProperty(m, key, descriptor);
      else delete m[key];
    });
    const wrap = m.els.wrap, g = groups.get(entry.group), faded = entry.faded;
    const last = !Array.from(active.values()).some((e) => e.group === entry.group);
    const done = () => { // inert stays until the card is gone, so a shrinking card can't be clicked
      if (entry.inert == null) wrap.removeAttribute('inert');
      else wrap.setAttribute('inert', entry.inert);
      wrap.classList.remove('ss-show');
      OW.Cards.applyVisibility(m);
      OW.Cards.refresh(m);
      if (last) restoreGroup(entry.group);
    };
    if ((m.revealed && !faded) || immediate) return done();
    OW.Motion.scene(async (s) => {
      s.own(wrap);
      if (faded && m.revealed) { // back to its own fade, keeping its slot
        wrap.classList.remove('ss-show');
        return s.anim(wrap, [{ opacity: 1 }, { opacity: +wrap.style.opacity || 0 }], { duration: 600 });
      }
      const label = last && g && g.hidden && g.section && g.section.querySelector('.section-label');
      if (label) s.anim(label, [{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: 200, fill: 'forwards' });
      await s.dissolve(wrap);
    }, done);
  }

  function clear() { Array.from(active.keys()).forEach((m) => finish(m, true)); }

  // from: the card that triggered the glimpse (it shakes and glows first).
  function start(from) {
    // Starting twice simply replaces the previous glimpse, never stacks locks.
    clear();
    const positions = new Map(Array.from(document.querySelectorAll('.card-wrap'), (el, i) => [el, i]));
    const eligible = OW.Mechanics.all().filter((m) => PREVIEW_IDS.has(m.id) && m.els && m.els.wrap && (!m.revealed || (FADED[m.id] && !m.cardName())))
      .sort((a, b) => positions.get(a.els.wrap) - positions.get(b.els.wrap));
    const labels = [];

    OW.Locations.all().forEach((location) => {
      const grid = document.getElementById('grid-' + location.id);
      if (!grid || !eligible.some((m) => grid.contains(m.els.wrap))) return;
      const section = document.getElementById(location.id + '-section');
      const arrow = grid.previousElementSibling && grid.previousElementSibling.querySelector('.section-collapse-arrow');
      const hidden = !location.isDiscovered();
      groups.set(location.id, { location, grid, section, arrow, hidden,
        gridDisplay: grid.style.display, sectionDisplay: section && section.style.display,
        collapsed: arrow && arrow.classList.contains('collapsed') });
      grid.style.display = '';
      if (arrow) arrow.classList.remove('collapsed');
      if (hidden && section) { section.style.display = ''; labels.push(section.querySelector('.section-label')); }
    });

    eligible.forEach((m, i) => {
      const duration = eligible.length < 2 ? MAX_DURATION :
        MAX_DURATION - (MAX_DURATION - MIN_DURATION) * i / (eligible.length - 1);
      const group = Array.from(groups.keys()).find((id) => groups.get(id).grid.contains(m.els.wrap));
      const saved = {}, faded = !!FADED[m.id] && !m.cardName();
      ['getUpgradeBarPct', 'hideUpgradeBar', '_previewLock', 'cardName'].forEach((key) => {
        saved[key] = Object.getOwnPropertyDescriptor(m, key);
      });
      const entry = { duration, remaining: duration, saved, group, faded, inert: m.els.wrap.getAttribute('inert') };
      active.set(m, entry);
      m._previewLock = true;
      m.getUpgradeBarPct = () => Math.max(0, entry.remaining / duration * 100);
      m.hideUpgradeBar = () => false;
      if (faded) { m.cardName = () => FADED[m.id]; m.els.wrap.classList.add('ss-show'); }
      m.els.wrap.setAttribute('inert', '');
      m.els.wrap.style.display = '';
      m.els.wrap.style.visibility = '';
      OW.Cards.refresh(m);
    });
    if (eligible.length) intro(from, eligible.map((m) => m.els.wrap), labels.filter(Boolean));
    return eligible.length;
  }

  // The light: travels from the first preview to the last; each card fades up as it passes.
  function intro(from, cards, labels) {
    OW.Motion.scene(async (s) => {
      const items = labels.concat(cards).map((el) => ({ el: s.hold(el) }));
      cards.forEach((c) => s.cls(c, 'mo-glow'));
      if (from) {
        s.cls(from, 'mo-glow'); s.shake(from, 3, 320);
        s.light([from], s.pos(from).y + from.offsetHeight / 2, LIGHT, 1);
        await s.wait(350);
      }
      items.forEach((it) => { const p = s.pos(it.el); it.y = p.y + p.h / 2; });
      const y0 = Math.min(...items.map((it) => it.y)), y1 = Math.max(...items.map((it) => it.y));
      let y = y0;
      s.follow(() => y, .14);
      await s.tween(Math.max(2500, Math.min(5000, 1200 + (y1 - y0) * 1.2)), (k) => {
        y = y0 + (y1 - y0) * s.ease.io(k);
        s.light(cards, y, LIGHT, 1);
        items.forEach((it) => { if (!it.shown && it.y <= y + 30) { it.shown = true; s.show(it.el); } });
      });
      await s.wait(500);
      s.unfollow(); // the view stays on the last card revealed
    });
  }

  OW.Mechanics.register({
    id: 'strangeshard', upkeepExempt: true,
    cardName: () => 'Strange Shard', getStatText: () => '',
    tick(goldAvailable, tickRate) {
      active.forEach((entry, m) => {
        entry.remaining -= tickRate;
        if ((m.revealed && !entry.faded) || entry.remaining <= 1e-9) finish(m);
      });
    }
  });
  // A reload/import ends the effect. Only Dig Site's intro completion persists.
  OW.Save.register('strangeshard', null, clear);
  OW.StrangeShard = { start, clear, active: () => active.size > 0 };
})();
