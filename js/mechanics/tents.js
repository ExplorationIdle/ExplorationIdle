/* ============================================================
   MECHANIC: TENTS (Camp) — formerly Campsite
   Not a resource — no left-hand row. One worker pool drives the Tent
   Track (bottom bar):
     - Starts automatically the moment ≥1 worker is assigned — no
       button, same instinct as Wood/Stone's auto-production.
     - Full tent cost is paid up front when a tent starts (no partial
       collection, mirrors Construction's up-front rule).
     - Can't afford the next tent → status 'stopped' (Wood/Stone-style);
       stopped workers here are exempt from gold upkeep via the generic
       mechanic.isBillable() hook.
     - Once started, the timer counts down at a 1s/s base pace plus the
       shared base rate per assigned worker (assigned may drop to 0
       mid-build without canceling it — same as every other timer in
       this codebase). The label shows real time left: work left ÷ the
       current worker rate, so it jumps as workers come and go.
     - Every completed tent: cost ×1.15, time ×1.05, +1 idle worker to
       the global pool.

   A bespoke pattern: single-resource, auto-repeating, escalating, and
   needs zero player interaction.

   Huts (a Study page unlocks the tool picker, js/core/toolUse.js):
   with Tier II picked the card is named Huts, each one also costs the
   same amount of Stone, and building it uses 1 Tools II per worker per
   second (none in stock: Stopped, unpaid). Huts keep their own count and
   cost curve, starting from the base like the first tent. Switching tier cancels the build in
   progress and refunds it. No self-upgrade ladder. The top bar is a reserved-but-unused stub
   (getUpgradeBarPct: () => 0), same convention as every other card
   that doesn't use it.

   Stats block: a vertically-stacked section, patched every tick via
   patchLiveTrack() (same "patch, don't rebuild" rule as everything
   else with live modal content). Worker Locations groups by
   mechanic.section (Camp, Mountains, Sand Dunes) and reads each
   mechanic's own worker pool (falling back to Camp's), same
   convention as js/core/cards.js's pool() helper — a mechanic outside
   Camp has its own separate pool, not a copy of Camp's.
   ============================================================ */
(function () {
  'use strict';
  window.OrbWeaver = window.OrbWeaver || {};

  const ID = 'tents';
  const TENT_RESOURCE = 'wood';
  const TENT_BASE_COST = 0.01;
  const TENT_COST_GROWTH = 1.66;
  const TENT_BASE_TIME = 3;
  const TENT_TIME_GROWTH = 1.33;

  // Worker contribution formula (see js/core/upgrades.js workerRate()).
  // Local to this card — a future tool changes only these three.
  let m = 1, p = 1, f = 0;

  let tentsBuilt = 0, hutsBuilt = 0;
  let status = 'idle'; // idle | stopped | producing
  let timeRemaining = null;
  let currentTentTime = null; // total build time for the tent currently in progress
  let goldStarved = false;

  const hut = () => tools.tier() === 2, tc = window.OrbWeaver.ToolUse.createConsumer();
  let noTools = false; // last tick: a hut had no Tools II
  const built = () => (hut() ? hutsBuilt : tentsBuilt); // the picked tier's own curve
  const verb = () => (hut() ? 'Stacking' : 'Pitching');
  const rate = () => window.OrbWeaver.Upgrades.workerRate(window.OrbWeaver.Workers.getAssigned(ID), m, p, f);
  function tentCost() { return TENT_BASE_COST * Math.pow(TENT_COST_GROWTH, built()); }
  function tentTime() { return TENT_BASE_TIME * Math.pow(TENT_TIME_GROWTH, built()); }

  /* The only place a cost/time pair is formatted — card face (all three
     states) and the modal's Next cost row all read from here, so the
     four strings can't drift apart. Time steps up a unit as it grows:
     seconds, then m+s past 2 minutes, then h+m past 1 hour (seconds
     are meaningless at that scale). Both thresholds are strict, so
     exactly 120s and exactly 3600s still read in the smaller unit.
     The total is rounded BEFORE it is split, otherwise the two halves
     can round opposite ways and print "2m 60s". */
  function costLine(sec) {
    const t = Math.round(sec > 3600 ? sec / 60 : sec);
    const time = sec > 3600 ? `${Math.floor(t / 60)}h ${t % 60}m`
      : sec > 120 ? `${Math.floor(t / 60)}m ${t % 60}s`
        : `${sec.toFixed(1)}s`;
    return `${tentCost().toFixed(2)} wood, ${hut() ? `${tentCost().toFixed(2)} stone, ` : ''}${time}`;
  }
  // Time only — used while actively Pitching, where the wood is already spent.
  function timeLine(sec) {
    const t = Math.round(sec > 3600 ? sec / 60 : sec);
    return sec > 3600 ? `${Math.floor(t / 60)}h ${t % 60}m`
      : sec > 120 ? `${Math.floor(t / 60)}m ${t % 60}s`
        : `${sec.toFixed(1)}s`;
  }

  function tryStartTent() {
    const cost = tentCost(), R = window.OrbWeaver.Resources;
    if (R.available(TENT_RESOURCE) >= cost && (!hut() || R.available('stone') >= cost)) {
      R.spend(TENT_RESOURCE, cost);
      if (hut()) R.spend('stone', cost);
      currentTentTime = tentTime();
      timeRemaining = currentTentTime;
      status = 'producing';
    } else {
      status = 'stopped';
    }
  }

  function completeTent() {
    if (hut()) hutsBuilt++; else tentsBuilt++;
    timeRemaining = null;
    currentTentTime = null;
    status = 'idle';
    window.OrbWeaver.Workers.addWorkers(1);
    window.OrbWeaver.Footer.push(`${hut() ? 'Hut' : 'Tent'} built. +1 idle worker.`);
  }
  // Unassigned mid-build, or the tier switched: the build stops and its cost comes back.
  function refund() {
    if (status !== 'producing') return;
    window.OrbWeaver.Resources.add(TENT_RESOURCE, tentCost());
    if (hut()) window.OrbWeaver.Resources.add('stone', tentCost());
    status = 'idle'; timeRemaining = null; currentTentTime = null;
  }

  function statsData() {
    const pools = Object.values(window.OrbWeaver.Workers.getPools());
    const population = pools.reduce((sum, pl) => sum + pl.getTotal(), 0);
    const idle = pools.reduce((sum, pl) => sum + pl.getIdleCount(), 0);
    const assignedParts = [];
    const locationTotals = {};
    window.OrbWeaver.Mechanics.all().forEach((mech) => {
      const a = (mech.workerPool || window.OrbWeaver.Workers).getAssigned(mech.id);
      if (a <= 0) return;
      assignedParts.push(`${a} ${mech.cardName()}`);
      const sec = mech.section || 'Camp';
      locationTotals[sec] = (locationTotals[sec] || 0) + a;
    });
    return {
      tents: String(tentsBuilt),
      huts: String(hutsBuilt),
      population: String(population),
      idle: String(idle),
      assigned: assignedParts.length ? assignedParts.join(', ') : 'None',
      locations: Object.entries(locationTotals).map(([s, n]) => `${s}: ${n}`).join(', ') || 'Camp: 0',
      nextTent: costLine(tentTime())
    };
  }

  function renderStatsBlock() {
    const s = statsData();
    const row = (label, key) => `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-val" data-stat="${key}">${s[key]}</span></div>`;
    return `<div class="stats-block">` +
      row('Tents built', 'tents') +
      (tools.unlocked() ? row('Huts built', 'huts') : '') +
      row('Total population', 'population') +
      row('Idle workers', 'idle') +
      row('Workers assigned', 'assigned') +
      row('Worker locations', 'locations') +
      row('Next cost', 'nextTent') +
    `</div>`;
  }

  function patchStatsBlock() {
    const s = statsData();
    Object.keys(s).forEach((key) => {
      const el = document.querySelector(`#card-modal-body [data-stat="${key}"]`);
      if (el) el.textContent = s[key];
    });
  }

  const mechanic = {
    id: ID,
    startHidden: true,
    section: 'Camp',
    toolTier: 2, // face pill, shown by the picker only while Tier II is picked
    cardName: () => (hut() ? 'Huts' : 'Tents'),
    isBillable: () => status !== 'stopped' && !(status === 'producing' && noTools),
    getStatText() {
      if (status === 'producing') return goldStarved || noTools ? `Stopped` : `${verb()} – ${timeLine(Math.max(0, timeRemaining) / (rate() || 1))} remaining`;
      if (status === 'stopped') return `Stopped – ${costLine(tentTime())}`;
      if (goldStarved && window.OrbWeaver.Workers.getAssigned(ID) > 0) return 'Stopped';
      return `Next – ${costLine(tentTime())}`;
    },
    getUpgradeBarPct: () => 0,
    isBuildBarFaded: () => status === 'stopped',
    getBuildBarPct() {
      if (status === 'producing' && timeRemaining != null && currentTentTime)
        return Math.min(100, ((currentTentTime - timeRemaining) / currentTentTime) * 100);
      if (status === 'stopped') {
        const have = Math.min(window.OrbWeaver.Resources.available(TENT_RESOURCE), hut() ? window.OrbWeaver.Resources.available('stone') : Infinity);
        return Math.min(100, (have / tentCost()) * 100);
      }
      return 0;
    },
    getWorkerDesc: () => {
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);
      return assigned === 0 ? '' : `${verb()} ${window.OrbWeaver.Upgrades.formatRate(rate())}/s`;
    },
    patchLiveTrack: () => patchStatsBlock(),
    getSubtitleHtml: () => tools.header(),
    renderModalHTML() {
      return `<div class="tents-modal"><div class="modal-subsection-label">Each ${hut() ? 'hut' : 'tent'} costs 66% more</div>${renderStatsBlock()}</div>`;
    },
    tick(goldAvailable, tickRate) {
      goldStarved = !goldAvailable;
      const assigned = window.OrbWeaver.Workers.getAssigned(ID);

      if (status === 'producing' && assigned === 0) refund();
      else if (status !== 'producing' && assigned > 0 && goldAvailable) tryStartTent();
      else if (status !== 'producing' && assigned === 0) status = 'idle';

      noTools = status === 'producing' && goldAvailable && hut() && tc.tick('', 2, assigned, tickRate).starved;
      if (status === 'producing' && goldAvailable && !noTools) {
        timeRemaining -= window.OrbWeaver.Upgrades.workerRate(assigned, m, p, f) * tickRate;
        if (timeRemaining <= 0) completeTent();
      }

      tools.sync();
      window.OrbWeaver.Cards.refresh(mechanic);
    }
  };
  // Refund runs before the tier flips, so a hut gives back its stone.
  const tools = mechanic.tools = window.OrbWeaver.ToolUse.createPicker(mechanic, refund);

  /* ---- Save/load ----
     tentsBuilt is the seed: the next tent's cost and time are always
     recomputed from it, so rebalancing the growth curve later reaches
     existing saves. The in-progress tent's timer is preserved as-is. */
  window.OrbWeaver.Save.register(ID,
    () => ({ n: tentsBuilt, h: hutsBuilt, st: status, t: timeRemaining, ct: currentTentTime, tl: tools.serialize(), tc: tc.serialize() }),
    (d) => {
      tools.deserialize(d.tl); tc.deserialize(d.tc || 0);
      tentsBuilt = d.n || 0; hutsBuilt = d.h || 0;
      status = d.st || 'idle';
      timeRemaining = d.t != null ? d.t : null;
      currentTentTime = d.ct != null ? d.ct : null;
    });

  window.OrbWeaver.Mechanics.register(mechanic);
})();
