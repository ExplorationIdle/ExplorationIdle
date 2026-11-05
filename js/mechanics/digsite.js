/* Camp's Dig Site: one shared roll and a wood-fed research bonus.
   Balance stays here; cards, workers, cycles and saves use the shared engine.
   Holds its slot from the start but fades in with loose stone held: 0% up to
   100% at FADE_FULL (never drops back; seen is saved). No clicks and a blank
   face (name and status) until full.
   Excavation: every dig removes 1 of EXCAVATION; at 0 it becomes the Ancient tunnel, a
   Mountains-style travel path (tunnel workers, TUNNEL_TIME), then a TBD stub. */
(function () {
  'use strict';
  const OW = window.OrbWeaver, R = OW.Resources, pool = OW.Workers;
  const ID = 'digsite', ROLL_TIME = 5, WOOD_CAP = 50, FILL_RATE = 1, BURN_RATE = 2, EXCAVATION = 10000, TUNNEL_TIME = 600;
  const HOUR_BUCKETS = 60; // Last hour: one-minute buckets of game time (Gold Panning's pattern)
  const workers = { dig: 0, brazier: 0, tunnel: 0 }, cycle = OW.Cycles.create(ROLL_TIME);
  let introDone = false, wood = 0, burning = false, loadedWood = false, excavation = EXCAVATION, tunnel = 0;
  const travelling = () => excavation <= 0 && tunnel < TUNNEL_TIME;
  let buckets = [], bucketClock = 0, lastReward = null, seen = 0, digs = 0; // digs: lifetime rolls (fades Research Bench in) // seen: most whole stone held, 0–FADE_FULL
  const hourTotal = (type) => buckets.reduce((n, b) => n + b[type], 0);
  const fmt = OW.Upgrades.formatRate;
  const FADE_FULL = 10, shown = () => seen >= FADE_FULL; // tutorial fade-in: stone for 100%
  // .tut-fade (style.css) holds a fresh game's card at 0 before the first tick.
  const fade = () => { const w = mechanic.els && mechanic.els.wrap; if (w) { w.style.opacity = seen / FADE_FULL; w.style.pointerEvents = shown() ? 'auto' : 'none'; } };
  const rate = (slot) => workers[slot] > 0 ? OW.Upgrades.workerRate(workers[slot], 1, 1, 0) : 0;
  const used = () => workers.dig + workers.brazier + workers.tunnel;
  const free = () => pool.getAssigned(ID) - used();
  const researchChance = () => Math.min(100, workers.dig + (burning ? wood : 0));
  const canStoke = () => introDone && R.get('gold') > 0 && workers.brazier > 0 && wood < WOOD_CAP && R.available('wood') > 0;
  const rewardText = (type) => type === 'stone' ? '1 Stone' : type === 'research' ? '1 Research Paper' : '—';

  // Game time, not the wall clock, so offline catch-up and replays spread rolls across the hour.
  function clockHour(tickRate) {
    bucketClock += tickRate;
    while (bucketClock >= 60) {
      bucketClock -= 60;
      buckets.push({ stone: 0, research: 0 });
      if (buckets.length > HOUR_BUCKETS) buckets.shift();
    }
  }
  function rollReward() {
    digs++;
    const type = Math.random() * 100 < 100 - researchChance() ? 'stone' : 'research';
    const id = type === 'stone' ? 'stone' : 'researchpapers';
    if (type === 'research') R.reveal(id);
    R.add(id, 1);
    if (!buckets.length) buckets.push({ stone: 0, research: 0 });
    buckets[buckets.length - 1][type]++;
    lastReward = type;
    if (excavation > 0 && --excavation <= 0) OW.Cards.refreshOpenModal(ID);
  }

  // Expected per second for /min and /hr (js/core/rates.js): rolls × the research chance averaged over a
  // whole Brazier heat-and-burn cycle, so it doesn't swing as the wood burns. Stone gets the rest.
  function expected(id) {
    if (id !== 'stone' && id !== 'researchpapers') return undefined;
    if (!introDone || !workers.dig) return 0;
    const fill = workers.brazier > 0 && R.available('wood') > 0 ? rate('brazier') * FILL_RATE : 0;
    const chance = (w) => Math.min(100, workers.dig + w) / 100;
    let p = chance(fill >= BURN_RATE ? WOOD_CAP : 0);                    // no crew or no wood: no bonus; fast crew: always full
    if (fill > 0 && fill < BURN_RATE) {                                   // heat 0→cap at fill, then burn cap→0 at BURN_RATE − fill
      const heat = WOOD_CAP / fill, burn = WOOD_CAP / (BURN_RATE - fill);
      let avg = 0; for (let i = 0; i < 50; i++) avg += chance((i + 0.5) / 50 * WOOD_CAP) / 50;
      p = (p * heat + avg * burn) / (heat + burn);
    }
    return rate('dig') / ROLL_TIME * (id === 'stone' ? 1 - p : p);
  }

  function clampWorkers() {
    let budget = pool.getAssigned(ID);
    // Tunnel and Brazier keep theirs first, so card / header "−" trims Dig.
    ['tunnel', 'brazier', 'dig'].forEach((slot) => { workers[slot] = Math.min(workers[slot], budget); budget -= workers[slot]; });
  }
  function subAssign(slot) {
    if (!introDone || !(slot in workers) || (slot === 'tunnel' && !travelling())) return;
    if (free() <= 0 && !pool.assign(ID)) return;
    workers[slot]++;
    mechanic.lastSub = slot;
    OW.Cards.refresh(mechanic);
  }
  function subUnassign(slot) {
    if (!(slot in workers) || workers[slot] <= 0) return;
    workers[slot]--;
    pool.unassign(ID); // a modal − returns the worker to idle (fires the card refresh)
  }
  pool.onChange(clampWorkers);

  function completeIntro() {
    if (introDone || !mechanic.revealed) return;
    introDone = true;
    OW.Cards.closeModal();
    OW.Cards.refresh(mechanic);
    OW.StrangeShard.start(mechanic.els.wrap);
  }
  function rateText(slot) {
    if (!workers[slot]) return '';
    if (R.get('gold') <= 0 || (slot === 'brazier' && !canStoke())) return 'Stopped';
    if (slot === 'tunnel') return `Exploring ${fmt(rate(slot))}/s`;
    return `${slot === 'dig' ? 'Digging' : burning ? 'Stoking' : 'Adding wood'} ${fmt(rate(slot) * (slot === 'dig' ? 1 / ROLL_TIME : FILL_RATE))}/s`;
  }
  function detail(slot, title) {
    const isWood = slot === 'brazier';
    return `<div class="hs-card">
      <div class="hs-head"><div class="ds-head-left"><div class="card-steppers visible">
          <button class="card-stepper-btn" data-ds-minus="${slot}" aria-label="Remove ${title} worker">–</button>
          <span class="card-stepper-val" data-ds-count="${slot}">${workers[slot]}</span>
          <button class="card-stepper-btn" data-ds-plus="${slot}" aria-label="Add ${title} worker">+</button>
        </div><span class="hs-title">${title}</span></div>${isWood ? '<span class="ds-wood-info"><span data-ds-state></span><span class="sm-wood-active" data-ds-wood></span></span>' : ''}</div>
      <div class="hs-body">${isWood ? '' : `
        <div class="wf-line">Last dig <span class="wf-tag" data-ds-last></span></div>
        <div class="wf-line">Last hour <span class="wf-tag" data-ds-hour></span></div>`}
        <div class="detail-progress-wrap"><div class="detail-progress-bar${isWood ? ' sm-molten-bar ds-brazier-bar' : ''}" data-extra-track="ds-${slot}"></div></div>
        <span class="ds-rate" data-ds-rate="${slot}"></span>
      </div>
    </div>`;
  }

  function excavationSection() {
    const bar = (key) => `<div class="detail-progress-wrap"><div class="detail-progress-bar" data-extra-track="ds-${key}"></div></div>`;
    if (excavation > 0) return `<div class="hs-card"><div class="hs-head"><span class="hs-title">Excavation</span>
      <span class="ds-wood-info"><span class="sm-wood-active" data-ds-exc></span></span></div><div class="hs-body">${bar('excavation')}</div></div>`;
    if (travelling()) return `<div class="bare-section"><div class="bare-row"><span class="bare-label">Ancient tunnel</span></div>
      <div class="detail-card-desc">Travel deeper underground.</div>${bar('tunnel')}
      <div class="card-steppers visible" style="margin-top:4px"><button class="card-stepper-btn" data-ds-minus="tunnel" aria-label="Remove Ancient tunnel worker">−</button>
        <span class="card-stepper-val" data-ds-count="tunnel">${workers.tunnel}</span>
        <button class="card-stepper-btn" data-ds-plus="tunnel" aria-label="Add Ancient tunnel worker">+</button><span class="worker-desc" data-ds-rate="tunnel"></span></div></div>`;
    return '<div class="bare-section"><div class="bare-row"><span class="bare-label">Deep in the Ancient tunnel</span></div><div class="detail-card-desc">TBD</div></div>';
  }

  const mechanic = {
    id: ID, section: 'Camp', cardThemeClass: 'ds-card tut-fade',
    cardName: () => (shown() ? 'Dig Site' : ''),
    rateExpect: expected,
    // Card-face / header "+" (js/core/cards.js) always adds to Dig.
    subSlots: () => (introDone ? ['dig'] : []), subAdd: subAssign,
    stepperReady: () => introDone,
    canAssign: () => introDone,
    upgradeBarTiered: true, // Camp's --tier gold, same as the modal bars
    getUpgradeBarPct: () => excavation > 0 ? excavation / EXCAVATION * 100 : tunnel / TUNNEL_TIME * 100,
    hideUpgradeBar: () => !introDone || !(excavation > 0 || travelling()),
    getBuildBarPct: () => wood / WOOD_CAP * 100,
    hideBuildBar: () => !introDone,
    isBuildBarFaded: () => !burning,
    // Modal bars have their own smoothing targets; the face mirrors Brazier wood.
    upgradeTrackKey: 'ds-none', buildTrackKey: 'ds-none',
    getExtraBars: () => introDone ? [{ id: 'ds-excavation', pct: excavation / EXCAVATION * 100 }, { id: 'ds-tunnel', pct: tunnel / TUNNEL_TIME * 100 }, { id: 'ds-dig', pct: cycle.getPct() }, { id: 'ds-brazier', pct: wood / WOOD_CAP * 100 }] : [],
    getStatText() {
      if (!shown()) return '';
      if (!introDone) return 'Strange Shard';
      if (!pool.getAssigned(ID)) return '';
      if (R.get('gold') <= 0) return 'Stopped';
      if (workers.tunnel && !workers.dig && !workers.brazier) return rateText('tunnel');
      if (!used() || wood <= 0) return 'Dark'; // workers on, brazier empty
      if (workers.dig) return burning ? `Research ${Number(researchChance().toFixed(1))}%` : 'Dark'; // no dig speed on the face
      return burning ? 'Burning' : canStoke() ? 'Adding wood' : 'Stopped';
    },
    getBillableCount: () => introDone && R.get('gold') > 0 ? workers.dig + workers.tunnel + (loadedWood ? workers.brazier : 0) : 0,
    renderModalHTML() {
      if (!introDone) return '<button class="action-btn" data-ds-intro>Show your future</button>';
      const stat = (label, key) => `<div class="gp-resbar-stat"><span class="gp-resbar-label">${label}</span><span class="gp-resbar-amt" data-ds-${key}></span></div>`;
      return `<div class="bench-modal ds-modal">
        <div class="gp-resbar"><div class="gp-resbar-item">${stat('Research Papers', 'papers')}${stat('Research chance', 'chance')}</div></div>
        ${excavationSection()}<div class="bench-modal-divider"></div>${detail('dig', 'Dig')}<div class="bench-modal-divider"></div>${detail('brazier', 'Brazier')}
      </div>`;
    },
    afterRender() {
      const body = document.getElementById('card-modal-body');
      const intro = body.querySelector('[data-ds-intro]');
      if (intro) intro.addEventListener('click', completeIntro);
      ['plus', 'minus'].forEach((action) => body.querySelectorAll(`[data-ds-${action}]`).forEach((button) => {
        const run = () => (action === 'plus' ? subAssign : subUnassign)(button.getAttribute('data-ds-' + action));
        OW.Cards.addHoldBehavior(button, run);
        // Pointer input is handled by hold-to-repeat; keyboard clicks have no detail.
        button.addEventListener('click', (e) => { if (!e.detail && !button.disabled) run(); });
      }));
      mechanic.patchLiveTrack();
    },
    patchLiveTrack() {
      if (!introDone) return;
      const body = document.getElementById('card-modal-body');
      const text = (key, value) => { const el = body.querySelector(`[data-ds-${key}]`); if (el) el.textContent = value; };
      text('papers', Math.floor(R.get('researchpapers')));
      text('chance', `${Number(researchChance().toFixed(1))}%`);
      text('last', rewardText(lastReward));
      text('hour', `${hourTotal('research')} Research Papers · ${hourTotal('stone')} Stone`);
      text('state', burning ? `Burning ${BURN_RATE}/s` : 'Heating');
      text('exc', `${excavation.toLocaleString('en-US')}/${EXCAVATION.toLocaleString('en-US')}`);
      text('wood', `${Number(wood.toFixed(1))}/${WOOD_CAP} Wood`);
      const bar = body.querySelector('[data-extra-track="ds-brazier"]');
      if (bar) bar.classList.toggle('ds-burning', burning);
      Object.keys(workers).forEach((slot) => {
        const count = body.querySelector(`[data-ds-count="${slot}"]`);
        if (count) count.textContent = workers[slot];
        const line = body.querySelector(`[data-ds-rate="${slot}"]`);
        if (line) line.textContent = rateText(slot);
        const minus = body.querySelector(`[data-ds-minus="${slot}"]`);
        if (minus) minus.disabled = workers[slot] <= 0;
        const plus = body.querySelector(`[data-ds-plus="${slot}"]`);
        if (plus) plus.disabled = free() <= 0 && pool.getIdleCount() <= 0;
      });
    },
    tick(goldAvailable, tickRate) {
      if (mechanic.els) mechanic.els.upgradeBar.classList.toggle('tiered', excavation > 0); // gold while excavating, default green while travelling
      seen = Math.max(seen, Math.min(FADE_FULL, Math.floor(R.get('stone'))));
      fade();
      loadedWood = false;
      if (introDone && tickRate > 0) {
        // Burn, then fill: a full Brazier reads 50/50 (+50%) on the tick it fills, and a fast crew holds it there.
        if (burning) {
          wood = Math.max(0, wood - BURN_RATE * tickRate);
          if (wood < 1e-9) { wood = 0; burning = false; }
        }
        if (goldAvailable && workers.brazier > 0) {
          // Request only what fits; shared spend already handles loose wood + crates.
          const gained = R.spend('wood', Math.min(WOOD_CAP - wood, rate('brazier') * FILL_RATE * tickRate));
          wood = Math.min(WOOD_CAP, wood + gained);
          if (WOOD_CAP - wood < 1e-9) wood = WOOD_CAP; // no 49.999… stall
          loadedWood = gained > 0;
        }
        if (wood >= WOOD_CAP) burning = true;
        if (goldAvailable && workers.dig > 0) {
          const rolls = cycle.advance(rate('dig'), tickRate);
          for (let i = 0; i < rolls; i++) rollReward();
        }
        if (goldAvailable && travelling() && workers.tunnel > 0 && (tunnel += rate('tunnel') * tickRate) >= TUNNEL_TIME) {
          tunnel = TUNNEL_TIME;
          while (workers.tunnel) subUnassign('tunnel');
          OW.Footer.push("You've travelled deep into the Ancient tunnel.");
          OW.Cards.refreshOpenModal(ID);
        }
        clockHour(tickRate);
      }
      OW.Cards.refresh(mechanic);
    }
  };

  OW.Save.register(ID,
    () => ({ introDone, seen, digs, workers: { ...workers }, progress: cycle.serialize(), wood, burning, lastReward, hour: buckets.map((b) => [b.stone, b.research]), hourClock: bucketClock, excavation, tunnel }),
    (d) => {
      const number = (v) => Number.isFinite(v) && v > 0 ? v : 0;
      introDone = !!d.introDone; seen = Math.min(FADE_FULL, Math.floor(number(d.seen))); digs = Math.floor(number(d.digs)); fade();
      Object.keys(workers).forEach((slot) => { workers[slot] = introDone ? Math.floor(number(d.workers && d.workers[slot])) : 0; });
      clampWorkers();
      cycle.deserialize(number(d.progress) % ROLL_TIME);
      wood = Math.min(WOOD_CAP, number(d.wood));
      burning = !!d.burning && wood > 0;
      loadedWood = false;
      buckets = (Array.isArray(d.hour) ? d.hour : []).slice(-HOUR_BUCKETS).map((b) => ({ stone: number(b && b[0]), research: number(b && b[1]) }));
      bucketClock = number(d.hourClock) % 60;
      excavation = Number.isFinite(d.excavation) ? Math.max(0, Math.min(EXCAVATION, d.excavation)) : EXCAVATION;
      tunnel = Math.min(TUNNEL_TIME, number(d.tunnel));
      lastReward = d.lastReward === 'stone' || d.lastReward === 'research' ? d.lastReward : null;
    });
  OW.Mechanics.register(mechanic);
  // Cheat (Dig button): skip n excavation; hitting 0 opens the tunnel like play does.
  function cheatDig(n) { if (excavation <= 0) return; excavation = Math.max(0, excavation - n); OW.Cards.refreshOpenModal(ID); OW.Cards.refresh(mechanic); }
  OW.DigSite = { subAssign, subUnassign, completeIntro, researchChance, cheatDig, digs: () => digs };
})();
