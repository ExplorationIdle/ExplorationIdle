/* ============================================================
   MECHANIC: BUILDERS BENCH → CAMP
   Not a resource — no left-hand row. Holds its slot from the start at 0%
   (.tut-fade); on the first wood held it shows at FADE_START%, fading
   to 100% at FADE_FULL wood (never drops back; seen is saved). No clicks
   and a blank face (name and status) until full. One track:

   Construction list (bottom bar, one item at a time): cards Camp can
   build for the player. Each item needs its full cost paid up front
   (no partial auto-collection) and drops off the list for good once
   built. Tents and Market Stall are available from the start; Trading
   Post and Tool Shed join when the Research Bench's Camp page calls
   upgrade(), which also renames the card "Camp" (saved; the list's own
   save keeps the unlocks). The top bar is an unused stub.

   Card face: "Click to open" until first opened; once opened, idle
   reads blank (Construction items may still be available); building
   reads "Building X – Ys".
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'buildersbench';

  const CONSTRUCTION_ITEMS = [
    { id: 'tents', name: 'Tents', desc: 'Pitch tents for more workers.', buildTime: 2, costRaw: '15 wood', startAvailable: true },
    { id: 'marketstall', name: 'Market Stall', desc: 'Sell goods for Gold.', buildTime: 10, costRaw: '75 wood', startAvailable: true },
    { id: 'scoutspen', name: "Trading Post", desc: 'Explore your surroundings.', buildTime: 5, costRaw: '50 wood, 50 stone' },
    { id: 'toolshed', name: 'Tool Shed', desc: 'Craft Tools for advanced work.', buildTime: 10, costRaw: '300 wood, 200 stone' }
  ];

  let opened = false, camp = false;
  let paused = false;
  let goldStarved = false;
  const FADE_START = 5, FADE_FULL = 4; // tutorial fade-in: % visible on first wood, wood for 100%
  let seen = 0, lit = false; // seen: most whole wood held, 0–FADE_FULL; lit: any wood ever held
  const shown = () => seen >= FADE_FULL;
  const fade = () => { const w = mechanic.els && mechanic.els.wrap; if (w) { w.style.opacity = !lit ? 0 : (FADE_START + (100 - FADE_START) * seen / FADE_FULL) / 100; w.style.pointerEvents = shown() ? 'auto' : 'none'; } };

  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Local to this card — a future tool changes only these three.
  let m = 1, p = 1, f = 0;

  function onConstructionComplete(id) {
    if (id === 'marketstall') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('marketstall'));
    } else if (id === 'tents') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('tents'));
    } else if (id === 'scoutspen') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('scoutspen'));
    } else if (id === 'toolshed') {
      window.OrbWeaver.Cards.reveal(window.OrbWeaver.Mechanics.get('toolshed'));
    }
    window.OrbWeaver.Cards.refreshOpenModal(ID);
  }

  const buildTrack = window.OrbWeaver.Upgrades.createChoiceTrack(CONSTRUCTION_ITEMS, onConstructionComplete);
  window.OrbWeaver.Upgrades.registerTrack(`${ID}:build`, buildTrack);

  const mechanic = {
    id: ID,
    section: 'Camp',
    cardThemeClass: 'tut-fade',
    buildTrackKey: 'build',
    cardName: () => (shown() ? (camp ? 'Camp' : 'Builders Bench') : ''),
    isBillable: () => buildTrack.isBuilding(),
    isBuildBarFaded: () => buildTrack.getQueuedItem() !== null && !buildTrack.isBuilding(),
    onOpen() { opened = true; },
    getStatText() {
      if (!shown()) return '';
      if (!opened) return 'Click to open';
      if (buildTrack.isBuilding()) {
        const item = buildTrack.activeItem();
        const secs = Math.ceil(buildTrack.getRemaining());
        return (paused || goldStarved) ? `Stopped ${item.name} – ${secs}s` : `Building ${item.name} – ${secs}s`;
      }
      const queued = buildTrack.getQueuedItem();
      if (queued) return `Queued ${queued.name} – waiting`;
      return '';
    },
    getUpgradeBarPct: () => 0,
    getBuildBarPct() {
      if (buildTrack.isBuilding()) return buildTrack.getProgressPct();
      if (buildTrack.getQueuedItem()) return buildTrack.getQueueFillPct();
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `Building ${window.OrbWeaver.Upgrades.formatRate(window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f))}/s`;
    },
    cheatCompleteAll() { buildTrack.completeAll(); },
    patchLiveTrack: () => buildTrack.patchModalRows(),
    renderModalHTML() {
      return `<div class="bench-modal">${buildTrack.renderModalRows(ID, 'build')}</div>`;
    },
    tick(goldAvailable, tickRate) {
      const held = window.OrbWeaver.Resources.get('wood');
      if (held > 0) lit = true;
      seen = Math.max(seen, Math.min(FADE_FULL, Math.floor(held)));
      fade();
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      // Auto-start queued item when both a worker is assigned and resources are met.
      const queued = buildTrack.getQueuedItem();
      if (queued && assigned > 0 && goldAvailable) {
        buildTrack.start(queued.id);
        if (buildTrack.isBuilding()) buildTrack.dequeue();
      }

      if (buildTrack.isBuilding()) {
        paused = assigned === 0;
        if (!paused && goldAvailable) buildTrack.advanceTimer(tickRate, assigned, m, p, f);
      } else {
        paused = false;
      }

      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };

  /* ---- Save/load ----
     The construction track saves itself, and replays each completed
     item's onComplete on load — that is what re-reveals Market,
     Tents, Trading Post and Tool Shed. `paused` and `goldStarved` are
     recomputed on the next tick, so neither is stored. */
  window.OrbWeaver.Save.register(ID,
    () => ({ o: opened ? 1 : 0, s: seen, l: lit ? 1 : 0, c: camp ? 1 : 0 }),
    (d) => { opened = !!d.o; seen = d.s || 0; lit = !!d.l || seen > 0; camp = !!d.c; fade(); });

  // The Research Bench's Camp page: rename, and Trading Post + Tool Shed join the list.
  function upgrade() {
    camp = true;
    ['scoutspen', 'toolshed'].forEach(buildTrack.unlock);
    window.OrbWeaver.Cards.refresh(mechanic);
  }
  window.OrbWeaver.BuildersBench = { upgrade };

  window.OrbWeaver.Mechanics.register(mechanic);
})();
