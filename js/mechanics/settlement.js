/* ============================================================
   MECHANIC: SETTLEMENT + BAZAAR (Sand Dunes, two cards, one module)
   Owning spec: CARAVAN-HANDOFF.md (Stage 1). Runs from game start;
   both cards reveal (polled) once Sand Dunes is discovered.

   SETTLEMENT — a stockpile the player can't staff. Buildings draw
   their inputs continuously while they work (uses × speed). Shared
   inputs are rationed equally by demand (a building that needs less
   leaves the rest to the others). A building short of inputs runs at
   the fed fraction, plus TRICKLE (25%) for the rest, for free. Goods
   made by the free trickle are tracked on the shelf (st.free) and earn
   no Wealth when sold. While Wheat Bundle or Gold Bars are stocked every
   building runs at full speed even without its inputs (counts as fed),
   and each adds BOOST on top; each burns BOOST_USE[r] per second.
   Upgrades are automatic: every WEALTH_STEP of Wealth levels the marked
   building (random among the lowest; Crate Yard is one level for both
   crate lines) by LEVEL_SPEED of base speed.
   The Caravan unloads into the Bazaar's stockpile (st.bz). The
   Settlement buys from it in lumps, instantly: when its own stock drops
   below LOW_H hours of full-speed use it buys about LUMP_H hours' worth
   (varied ±VARY), or what the Bazaar has.
   No purchases while the Caravan is unloading, so each is one lump.

   BAZAAR — a shelf per good. Anything above one wagon load sells
   elsewhere: excess *= SELL_RATE ** (dt/60), which is step-size
   independent. Sales of fed (not trickle) goods add their base value to Wealth and are logged in
   batches. The log keeps LOG_MAX entries stamped with a saved
   game-time counter (never the wall clock).
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;

  const TRICKLE = 0.25, LEVEL_SPEED = 0.25, BOOST = 0.25, BOOST_USE = { wheatbundle: 1 / 75, goldbars: 1 / 15 };
  // Inputs that apply to every building: each stocked one gives full speed + BOOST and burns BOOST_USE[r] per second (Wheat Bundle 1 every 75 s, Gold Bars 1 every 15 s).
  const BOOSTS = ['wheatbundle', 'goldbars'];
  const WEALTH_STEP = 100000, SELL_RATE = 0.98, LOG_MAX = 20, LOG_EVERY = 3600, START_CRATES = 10, REPLAY_CHUNK = 10, LOW_H = 1 / 6, LUMP_H = 1, VARY = 0.2;
  const VALUE = { wood: 3, stone: 4, tools2: 8, tools3: 110, copperore: 6, copperhead: 40, goldbars: 25, wheatbundle: 25, luxury: 200, woodcrate: 3000, stonecrate: 4000 };
  const NAME = { wood: 'Wood', stone: 'Stone', tools2: 'Tools II', tools3: 'Tools III', copperore: 'Copper Ore', copperhead: 'Copper Tool Head',
    goldbars: 'Gold Bars', wheatbundle: 'Wheat Bundle', luxury: 'Luxury', woodcrate: 'Wood Crate', stonecrate: 'Stone Crate' };
  const INPUTS = ['wood', 'stone', 'tools2', 'goldbars', 'wheatbundle']; // what the Settlement buys (Caravan pay list)
  const GOODS = ['copperore', 'copperhead', 'tools3', 'woodcrate', 'stonecrate'];
  const LOAD = { copperore: 1000, copperhead: 100, tools3: 20, woodcrate: 2, stonecrate: 2 };
  // secs = seconds per item at 100%; uses = stockpile per item; shelf = Bazaar goods per item.
  const BUILDINGS = [
    { key: 'mine', name: 'Mine', secs: 6, out: 'copperore', uses: { tools2: 0.1 }, shelf: {}, label: 'Tools II → Copper Ore' },
    { key: 'smelter', name: 'Smelter', secs: 70, out: 'copperhead', uses: { wood: 5 }, shelf: { copperore: 1 }, label: 'Copper Ore + Wood → Copper Tool Head' },
    { key: 'toolshed', name: 'Tool Shed', secs: 360, out: 'tools3', uses: { wood: 20, stone: 20 }, shelf: { copperhead: 1 }, label: 'Copper Tool Head + Wood + Stone → Tools III' },
    { key: 'wcrate', yard: 1, secs: 600, out: 'woodcrate', uses: { wood: 1200 }, shelf: {} },
    { key: 'scrate', yard: 1, secs: 600, out: 'stonecrate', uses: { stone: 1200 }, shelf: {} }
  ];
  // Upgradable: one level per entry; the Crate Yard level drives both crate lines.
  const LEVELLED = BUILDINGS.filter((b) => !b.yard).concat({ key: 'yard', name: 'Crate Yard' });

  // Bazaar starts with one wagon load of every good (crates: START_CRATES), so the first Caravan has goods to sell.
  const START = Object.assign({}, LOAD, { woodcrate: START_CRATES, stonecrate: START_CRATES });
  const zero = (keys) => keys.reduce((o, k) => { o[k] = 0; return o; }, {});
  const st = {
    stock: zero(INPUTS), bz: zero(INPUTS), prog: zero(BUILDINGS.map((b) => b.key)), fp: zero(BUILDINGS.map((b) => b.key)),
    lvl: { mine: 1, smelter: 1, toolshed: 1, yard: 1 }, mark: '', shelf: Object.assign({}, START),
    free: Object.assign({}, START), // starting stock earns no Wealth either
    pend: zero(GOODS), wealth: 0, log: [], clock: 0, flushAt: 0, wagons: 1, acc: 0, buys: 0
  };

  /* ---- economy ---- (hot path: runs every replay step, so no per-call allocation) */
  BUILDINGS.forEach((b) => { b.res = Object.keys(b.uses); b.goods = Object.keys(b.shelf); b.f = 0; });
  const CONS = {}, SCONS = {};
  BUILDINGS.forEach((b) => { b.res.forEach((r) => { (CONS[r] = CONS[r] || []).push(b); }); b.goods.forEach((g) => { (SCONS[g] = SCONS[g] || []).push(b); }); });
  // Equal shares by demand with spillover; each building keeps the lowest fed fraction over its inputs.
  function ration(supply, cons, per, key, dt) {
    let left = Math.max(0, supply), open = cons.length, moved = true;
    for (const b of cons) { b.d = b.f > 0 ? per[b.key][key] * b.rate * dt : 0; b.got = -1; }
    while (moved && open) {
      moved = false;
      const share = left / open;
      for (const b of cons) if (b.got < 0 && b.d <= share + 1e-12) { b.got = b.d; left -= b.d; open--; moved = true; }
    }
    for (const b of cons) { if (b.got < 0) b.got = left / open; if (b.d > 0) b.f = Math.min(b.f, b.got / b.d); }
  }
  const USES = {}, SHELF = {};
  BUILDINGS.forEach((b) => { USES[b.key] = b.uses; SHELF[b.key] = b.shelf; });
  // Shelf use keeps the trickle-made share (st.free) proportional.
  function useShelf(g, n) {
    if (n <= 0) return;
    st.free[g] = st.shelf[g] > n ? st.free[g] * (st.shelf[g] - n) / st.shelf[g] : 0;
    st.shelf[g] = Math.max(0, st.shelf[g] - n);
  }
  function blocked(b) {
    for (const r of b.res) if (st.stock[r] <= 1e-9) return true;
    for (const g of b.goods) if (st.shelf[g] <= 1e-9) return true;
    return false;
  }
  const missing = (b) => b.res.filter((r) => st.stock[r] <= 1e-9).concat(b.goods.filter((g) => st.shelf[g] <= 1e-9));
  const levelMult = (b) => 1 + LEVEL_SPEED * (st.lvl[b.yard ? 'yard' : b.key] - 1);
  // Wheat Bundle or Gold Bars in stock run every building at full speed, inputs or not (and add BOOST each on top).
  const boosted = () => BOOSTS.some((r) => st.stock[r] > 0);
  const boostMult = () => 1 + BOOSTS.reduce((n, r) => n + (st.stock[r] > 0 ? BOOST : 0), 0);
  function produce(dt, mult) {
    const full = boosted();
    for (const b of BUILDINGS) { b.rate = mult * levelMult(b) / b.secs; b.f = blocked(b) ? 0 : 1; } // a blocked building leaves its share to the others
    for (const r in CONS) ration(st.stock[r], CONS[r], USES, r, dt);
    for (const g in SCONS) ration(st.shelf[g], SCONS[g], SHELF, g, dt);
    for (const b of BUILDINGS) {
      const made = b.rate * dt, free = full ? 0 : made * (1 - b.f) * TRICKLE;
      for (const r of b.res) st.stock[r] = Math.max(0, st.stock[r] - b.f * b.uses[r] * made);
      for (const g of b.goods) useShelf(g, b.f * b.shelf[g] * made);
      st.prog[b.key] += full ? made : made * b.f + free; st.fp[b.key] += free;
      const n = Math.floor(st.prog[b.key] + 1e-9);
      if (n < 1) continue;
      const share = Math.min(1, st.fp[b.key] / st.prog[b.key]);
      st.shelf[b.out] += n; st.free[b.out] += n * share;
      st.prog[b.key] = Math.max(0, st.prog[b.key] - n); st.fp[b.key] = st.prog[b.key] * share;
    }
  }
  const floorOf = (g) => LOAD[g] * (1 + 0.5 * (st.wagons - 1));
  function sellOff(dt) {
    const keep = Math.pow(SELL_RATE, dt / 60);
    for (const g of GOODS) {
      const excess = st.shelf[g] - floorOf(g);
      if (excess <= 0) continue;
      const sold = excess - excess * keep, freeSold = st.free[g] * sold / st.shelf[g];
      useShelf(g, sold); st.pend[g] += sold; st.wealth += Math.max(0, sold - freeSold) * VALUE[g];
    }
  }
  function addLog(msg) {
    st.log.unshift({ t: st.clock, m: msg });
    if (st.log.length > LOG_MAX) st.log.length = LOG_MAX;
  }
  function flushSales() {
    st.flushAt = st.clock;
    GOODS.forEach((g) => {
      const n = Math.floor(st.pend[g]);
      if (n < 1) return;
      st.pend[g] -= n;
      addLog(`Bazaar sold ${fmt(n)} ${NAME[g]} elsewhere.`);
    });
  }
  // Full-speed use per hour at current levels (boost goods burn BOOST_USE).
  const perHour = (r) => (CONS[r] ? CONS[r].reduce((n, b) => n + b.uses[r] * levelMult(b) / b.secs, 0) : BOOST_USE[r] || 0) * 3600;
  // Deterministic ±VARY wobble from a saved counter, so live and batched replay agree.
  const wobble = () => { const x = Math.sin(++st.buys * 12.9898) * 43758.5453; return 1 - VARY + 2 * VARY * (x - Math.floor(x)); };
  function buy(r) {
    if (st.bz[r] < 1 || (OW.Caravan && OW.Caravan.unloading())) return; // waits for the Caravan to finish unloading
    const hr = perHour(r);
    if (st.stock[r] >= hr * LOW_H) return;
    const n = Math.min(st.bz[r], Math.round(hr * LUMP_H * wobble()));
    st.bz[r] -= n; st.stock[r] += n;
    addLog(`Settlement bought ${fmt(n)} ${NAME[r]}.`);
  }
  function step(dt) {
    if (!(dt > 0)) return;
    st.clock += dt;
    const mult = boostMult();
    for (const r of BOOSTS) if (st.stock[r] > 0) st.stock[r] = Math.max(0, st.stock[r] - BOOST_USE[r] * dt);
    for (const r of INPUTS) buy(r);
    produce(dt, mult);
    sellOff(dt);
    while (st.wealth >= WEALTH_STEP) { st.wealth -= WEALTH_STEP; upgrade(); }
    if (st.clock - st.flushAt >= LOG_EVERY) flushSales();
  }

  // Every WEALTH_STEP of Wealth upgrades the marked building; the next mark is a random lowest-level one.
  function pick() {
    const low = Math.min(...LEVELLED.map((b) => st.lvl[b.key])), ties = LEVELLED.filter((b) => st.lvl[b.key] === low);
    st.mark = ties[Math.floor(Math.random() * ties.length)].key;
    return st.mark;
  }
  const marked = () => LEVELLED.find((b) => b.key === (st.mark || pick()));
  function upgrade() {
    const b = marked();
    st.lvl[b.key]++;
    addLog(`Settlement upgraded the ${b.name} to level ${roman(st.lvl[b.key])}.`);
    pick();
  }

  /* ---- rendering ---- */
  const fmt = (n) => Math.floor(n + 1e-9).toLocaleString();
  function roman(n) {
    let s = '';
    [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].forEach(([v, c]) => { while (n >= v) { s += c; n -= v; } });
    return s;
  }
  const dur = (s) => (s < 120 ? `${+s.toFixed(1)}s` : `${+(s / 60).toFixed(1)} min`);
  function ago(s) {
    const m = Math.floor(s / 60), h = Math.floor(m / 60);
    return m < 1 ? 'just now' : h < 1 ? `${m}m ago` : h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
  }
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  const hs = (title, right, body, sub) => `<div class="hs-card"><div class="hs-head"><span class="hs-title ms-item-title${sub ? ' cv-titled' : ''}">${title}${sub ? `<span class="cv-sub">${sub}</span>` : ''}</span><span class="upgrade-costtime">${right}</span></div><div class="hs-body">${body}</div></div>`;
  const row = (label, key, val) => `<div class="cv-r"><span>${label}</span><b data-sv="${key}">${val}</b></div>`;
  const bar = (key, pct) => `<div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="sv-${key}" style="width:${pct}%"></div></div>`;
  const pct = (b) => Math.min(100, st.prog[b.key] * 100);
  const status = (b) => { const m = missing(b), sp = Math.round((b.f + (1 - b.f) * TRICKLE) * 100); return sp >= 100 || boosted() ? 'Full speed' : `${sp}%${m.length ? ' · needs ' + m.map((r) => NAME[r]).join(', ') : ''}`; };
  const wealthHead = () => `${fmt(st.wealth % WEALTH_STEP)} / ${WEALTH_STEP.toLocaleString()}`;
  const SUB = `Marked for upgrade. Will produce ${LEVEL_SPEED * 100}% faster`;
  const DEST = { wood: 'Smelter, Tool Shed, Crates', stone: 'Tool Shed, Crates', tools2: 'Mine', goldbars: 'all', wheatbundle: 'all' };
  // Every live number, keyed by its data-sv attribute; render and patch share it.
  function values() {
    const v = { wealth: wealthHead() };
    Object.keys(DEST).forEach((r) => { v['in-' + r] = fmt(st.stock[r]); });
    BUILDINGS.forEach((b) => { v['st-' + b.key] = status(b); });
    INPUTS.forEach((r) => { v['sb-' + r] = fmt(st.bz[r]); });
    GOODS.forEach((g) => { v['cb-' + g] = fmt(st.shelf[g]); });
    return v;
  }

  let shown = '';
  const sig = () => st.mark + JSON.stringify(st.lvl); // a level or mark change redraws the modal
  const lvlCard = (b, body) => hs(`${b.name} · Level ${roman(st.lvl[b.key])}`, '', body, b.key === st.mark ? SUB : '');
  function settlementHTML() {
    const v = values(), yard = BUILDINGS.filter((b) => b.yard);
    marked(); shown = sig();
    return `<div class="marketstall-modal"><div class="sp-tab-body ms-body">
      ${hs('Wealth', '<span class="cv-stock">Sells excess goods for wealth</span>', bar('wealth', (st.wealth % WEALTH_STEP) / 1000) + row(`Settlement will upgrade ${marked().name} next`, 'wealth', v.wealth))}
      ${hs('Stockpile', '', `<div class="cv-cargo">${Object.keys(DEST).map((r) => row(`${NAME[r]} → ${DEST[r]}`, 'in-' + r, v['in-' + r])).join('')}</div>`)}
      ${BUILDINGS.filter((b) => !b.yard).map((b) => lvlCard(b, `<div class="cv-cargo">
          ${row('Uses', '', b.label)}${row('Output', '', `1 every ${dur(b.secs / levelMult(b))} → Bazaar`)}${row('Status', 'st-' + b.key, v['st-' + b.key])}${bar(b.key, pct(b))}</div>`)).join('')}
      ${lvlCard(LEVELLED[3], `<div class="cv-cargo">${row('Uses', '', '1,200 Wood or Stone → Crate')}${row('Output', '', `1 of each every ${dur(yard[0].secs / levelMult(yard[0]))} → Bazaar`)}
          ${yard.map((b) => row(NAME[b.out], 'st-' + b.key, v['st-' + b.key]) + bar(b.key, pct(b))).join('')}</div>`)}
      </div></div>`;
  }
  const logHTML = () => (st.log.length ? st.log.map((e) => `<div class="cv-r"><span>${ago(st.clock - e.t)}</span><b>${e.m}</b></div>`).join('')
    : '<div class="cv-r"><span>No trades yet.</span></div>');
  function bazaarHTML() {
    const v = values();
    return `<div class="marketstall-modal"><div class="sp-tab-body ms-body">
      <div class="cv-eq">${hs('Settlement stall', '', `<div class="cv-cargo">${GOODS.map((g) => row(NAME[g], 'cb-' + g, v['cb-' + g])).join('')}</div>`)}
      ${hs('Caravan stall', '', `<div class="cv-cargo">${INPUTS.map((r) => row(NAME[r], 'sb-' + r, v['sb-' + r])).join('')}</div>`)}</div>
      ${hs('Trade log', '', `<div class="cv-cargo" data-sv-log>${logHTML()}</div>`)}</div></div>`;
  }
  function patch() {
    const v = values();
    Object.keys(v).forEach((k) => { const el = q(`[data-sv="${k}"]`); if (el && el.textContent !== v[k]) el.textContent = v[k]; });
    BUILDINGS.forEach((b) => { const el = q(`[data-track="sv-${b.key}"]`); if (el) el.style.width = pct(b) + '%'; });
    const w = q('[data-track="sv-wealth"]'); if (w) w.style.width = (st.wealth % WEALTH_STEP) / 1000 + '%';
    if (q('[data-sv="in-wood"]') && shown !== sig()) OW.Cards.refreshOpenModal('settlement');
    const lg = q('[data-sv-log]'); if (lg) { const h = logHTML(); if (lg.innerHTML !== h) lg.innerHTML = h; }
  }

  const pool = OW.SandDunes.workerPool;
  // Peering over the top shows the Sand Dunes cards; their modals stay shut until a worker is down there.
  const sdLocked = () => !pool.getTotal();
  function gate(m, title) {
    const r = m.renderModalHTML, p = m.patchLiveTrack, a = m.afterRender;
    m.renderModalHTML = () => ((m._lk = sdLocked()) ? `<div class="hs-card"><div class="hs-head"><span class="hs-title">${title}</span></div><div class="hs-body">
      <div class="detail-card-desc">Nobody has made it down yet. Send a worker to Sand Dunes to use the ${title}.</div></div></div>` : r());
    m.patchLiveTrack = () => { if (sdLocked() !== m._lk) OW.Cards.refreshOpenModal(m.id); else if (!m._lk && p) p(); };
    m.afterRender = () => { if (!m._lk && a) a(); };
  }
  const base = { section: 'Sand Dunes', startHidden: true, modalTheme: 'theme-sanddunes', modalWide: true, workerPool: pool,
    stepperReady: () => false, getUpgradeBarPct: () => 0, patchLiveTrack: patch };
  const bazaar = Object.assign({}, base, {
    id: 'bazaar', cardName: () => 'Bazaar',
    getStatText: () => (st.log.length ? st.log[0].m : ''),
    renderModalHTML: bazaarHTML,
    tick() { OW.Cards.refresh(bazaar); }
  });
  const settlement = Object.assign({}, base, {
    id: 'settlement', cardName: () => 'Settlement',
    getStatText: () => LEVELLED.map((b) => `${b.name} ${roman(st.lvl[b.key])}`).join(' · '),
    getUpgradeBarPct: () => (st.wealth % WEALTH_STEP) / 1000, upgradeBarTiered: true,
    renderModalHTML: settlementHTML,
    // Offline replay batches into REPLAY_CHUNK steps (production and sell-off are exact per step size).
    tick(goldAvailable, dt) {
      st.acc += dt;
      if (!OW.Offline.isReplaying() || st.acc >= REPLAY_CHUNK) { step(st.acc); st.acc = 0; }
      if (!settlement.revealed && OW.SandDunes.isDiscovered()) { OW.Cards.reveal(settlement); OW.Cards.reveal(bazaar); }
      OW.Cards.refresh(settlement);
    }
  });

  gate(settlement, 'Settlement'); gate(bazaar, 'Bazaar');

  OW.Save.register('settlement', () => ({ s: st.stock, z: st.bz, p: st.prog, e: st.free, q: st.fp, l: st.lvl, k: st.mark, h: st.shelf, n: st.pend, w: st.wealth, g: st.log, c: st.clock, t: st.flushAt, a: st.acc, u: st.buys }),
    (d) => {
      if (!d) return;
      [['s', 'stock'], ['z', 'bz'], ['p', 'prog'], ['e', 'free'], ['q', 'fp'], ['l', 'lvl'], ['h', 'shelf'], ['n', 'pend']].forEach(([k, f]) => Object.assign(st[f], d[k] || {}));
      if (!d.e) GOODS.forEach((g) => { st.free[g] = 0; }); // older saves: shelf counts as fed
      Object.keys(d.b || {}).forEach((k) => { st.stock[k.split('.')[1]] += d.b[k]; }); // older saves: per-building buckets go back to the stockpile
      st.wealth = d.w || 0; st.log = (d.g || []).slice(0, LOG_MAX); st.clock = d.c || 0; st.flushAt = d.t || 0; st.acc = d.a || 0; st.buys = d.u || 0; st.mark = d.k || '';
    });

  OW.Mechanics.register(settlement);
  OW.Mechanics.register(bazaar);
  // Stage 2/3 seams: deposit (Caravan payment), take (Caravan cargo), setWagons.
  OW.Settlement = {
    VALUE, NAME, INPUTS, GOODS, LOAD, perHour, _st: st, _b: BUILDINGS, step, sellOff, flushSales, addLog, upgrade, pick, floorOf, ago,
    gate, sdLocked,
    deposit: (r, n) => { st.bz[r] += n; },
    restock: (g, n) => { st.shelf[g] += n; },
    take: (g, n) => { const t = Math.min(n, Math.floor(st.shelf[g] + 1e-9)); useShelf(g, t); return t; },
    setWagons: (n) => { st.wagons = n; }
  };
})();
