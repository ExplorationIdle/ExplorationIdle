/* ============================================================
   MECHANIC: CARAVAN (one shared caravan, three cards: Camp,
   Mountains, Sand Dunes). Owning spec: CARAVAN-HANDOFF.md (Stage 2).

   Cycle: road to its stop (card faded) → parked (trade) → road back
   → the Bazaar (pays the Settlement, rests) → loads from the shelf →
   road again. First departure the moment the Camp Trading Post card
   is revealed, arriving 2 min later. All trading and influence lives
   in the Trading Post's Caravan tab; the Caravan's own window is info
   only (plus Rush back at the Bazaar).

   Trading is barter at base value × MARKUP, cost rounded up. An
   order reserves its goods off the wagon at once; the Trading Post's
   workers then load the payment (one job in its shared rate, spent from
   the local stock as it goes, bar 0→100%) and unload the goods
   (whole units, bar 100→0%). Orders run one after another.
   Timer out: staffed with work left waits ("Leaving after");
   otherwise it leaves, cancels open orders with a refund of the
   payment for undelivered goods. Unsold
   cargo goes back on the Bazaar shelf. Every roll uses Math.random,
   which is the seeded Rng (js/core/rng.js).

   Influence tab (Stage 3): Leave now (free, parked), Rush back (3,500
   Gold Coins: trades and unloading finish instantly; departing, the road
   back, the Bazaar rest and the road out each take 2 s; closes the window), Request, Next stop and the upgrade ladder, bought
   in any order with Gold Bars from the stop where it is parked (like trades). Every leg is a flat 3 min;
   the Bazaar rest starts once unloading is done.
   Standing order trades on arrival, instantly, no labour.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, S = OW.Settlement, R = () => OW.Resources;

  const MARKUP = 1.3, FIRST = 120, OFFER = 3, UNLOAD_SHOW = 60, CRATE_UNITS = 1000;
  const ROAD = 180, PARK = 180, REST = 180, REST_FAST = 10;
  const RUSH = 3500, RUSH_S = 2, NEXT_COST = 3000, BARS = 'goldbars'; // paid from the stop where it is parked, like trades
  // [name, Gold Bars, effect, adds a wagon]. Any order; st.own[i] = owned.
  const LADDER = [['Second Wagon', 250, '+50% load', 1], ['Request Goods', 500, 'Pick a good for the next trip'],
    ['Fresh Camels', 1000, 'Rests 10 s at the Bazaar'], ['Third Wagon', 1750, '+50% load', 1],
    ['Next Stop', 2250, 'Choose where it goes next'], ['Standing Orders', 2750, 'Trades on arrival'],
    ['Fourth Wagon', 4000, '+50% load', 1], ['The Hidden Pass', 30000, 'Clears the Collapsed Path']];
  const REQUEST = 1, CAMELS = 2, NEXT = 4, STANDING = 5, PASS = 7, LEAVE = 3; // LADDER indexes; LEAVE = free Leave now timer (s)
  const STEP = { copperore: 100, copperhead: 10, tools3: 1, woodcrate: 1, stonecrate: 1 };

  const st = { phase: 'wait', t: 0, dest: 'camp', cargo: {}, orders: [], paid: {}, sel: {}, qty: {}, wagons: 1, ul: { p: {}, b: {}, l: 0 }, own: {}, req: '', next: 'camp', auto: {}, r: 0 }; // r = rushed this leg
  let off = null, wasReplaying = false, ver = 0, tab = 'trade';

  const PLACES = {
    camp: { id: 'caravan', tp: 'scoutspen', section: 'Camp', loc: () => OW.Locations.get('camp'), pool: OW.Workers },
    mtn: { id: 'mtn_caravan', tp: 'mtn_scoutstable', section: 'Mountains', loc: () => OW.Mountains, pool: OW.Mountains.workerPool },
    sd: { id: 'sd_caravan', section: 'Sand Dunes', loc: () => OW.SandDunes, pool: OW.SandDunes.workerPool }
  };
  const here = () => PLACES[st.dest];
  const payId = (r) => here().loc().prefix + r;
  const staffed = () => here().pool.getAssigned(here().tp) > 0; // the Trading Post's workers
  const loadOf = (g) => Math.floor(S.LOAD[g] * (1 + 0.5 * (st.wagons - 1)));
  const costOf = (g, n, pay) => Math.ceil(n * S.VALUE[g] * MARKUP / S.VALUE[pay] - 1e-9);
  const fmt = (n) => Math.floor(n + 1e-9).toLocaleString();
  const clock = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const changed = () => { ver++; };
  const footer = (m) => OW.Footer.push(m);

  /* ---- cycle ---- */
  // Unloading at the Bazaar: payment into the Bazaar's pile, unsold cargo onto the shelf, spread over UNLOAD_SHOW.
  function unload(dt) {
    const u = st.ul, k = u.l > 0 ? Math.min(dt, u.l) / u.l : 1;
    Object.keys(u.p).forEach((r) => { const n = u.p[r] * k; S.deposit(r, n); u.p[r] -= n; });
    Object.keys(u.b).forEach((g) => { const n = u.b[g] * k; S.restock(g, n); u.b[g] -= n; });
    u.l = Math.max(0, u.l - dt);
    if (!u.l) { u.p = {}; u.b = {}; }
  }
  function depart(t) {
    unload(Infinity);
    const stocked = S.GOODS.filter((g) => S._st.shelf[g] >= 1);
    for (let i = stocked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [stocked[i], stocked[j]] = [stocked[j], stocked[i]]; }
    if (st.req && stocked.includes(st.req)) stocked.unshift(...stocked.splice(stocked.indexOf(st.req), 1));
    st.cargo = {}; st.req = ''; st.dest = st.next; st.next = 'camp';
    stocked.slice(0, OFFER).forEach((g) => {
      const n = S.take(g, loadOf(g));
      st.cargo[g] = n; st.qty[g] = Math.min(st.qty[g] || STEP[g], n) || 1;
      S.addLog(`Caravan bought ${fmt(n)} ${S.NAME[g]}.`);
    });
    st.phase = 'road'; st.t = t || (st.r ? RUSH_S : ROAD); changed();
  }
  function arrive() {
    st.phase = 'parked'; st.t = PARK; st.r = 0; changed();
    if (off) off.trips++;
    footer(`Caravan arrived at ${here().loc().label}.`);
    if (has(STANDING)) autoTrade();
  }
  function leave() {
    st.orders.forEach((o) => {
      const refund = o.loaded * (o.qty - o.done) / o.qty;
      if (refund > 0) R().add(payId(o.pay), refund);
      st.paid[o.pay] = (st.paid[o.pay] || 0) + o.loaded - refund;
      st.cargo[o.g] += o.qty - o.done;
      footer(`Canceled ${S.NAME[o.g]} trade. Refunded.`);
    });
    st.orders = [];
    st.phase = 'back'; st.t = st.r ? RUSH_S : ROAD; changed();
    footer('Caravan left for the Bazaar.');
  }
  function home() {
    const pos = (o) => Object.keys(o).reduce((a, k) => { if (o[k] > 0) a[k] = o[k]; return a; }, {});
    st.ul = { p: pos(st.paid), b: pos(st.cargo), l: UNLOAD_SHOW };
    Object.keys(st.ul.p).forEach((r) => S.addLog(`Caravan unloaded ${fmt(st.ul.p[r])} ${S.NAME[r]} at the Bazaar.`));
    Object.keys(st.ul.b).forEach((g) => S.addLog(`Caravan returned ${fmt(st.ul.b[g])} ${S.NAME[g]} to the shelf.`));
    S.addLog(`Caravan arrived from ${here().loc().label}.`);
    S.flushSales();
    st.paid = {}; st.cargo = {};
    if (st.r) unload(Infinity);
    st.phase = 'bazaar'; st.t = st.r ? RUSH_S : has(CAMELS) ? REST_FAST : REST; changed(); // rushed: rests RUSH_S, and the road out stays rushed
    footer('Caravan arrived at the Bazaar.');
  }

  /* ---- trading ---- */
  function trade(g) {
    const qty = Math.min(st.qty[g] || 0, st.cargo[g] || 0), pay = st.sel[g] || S.INPUTS[0];
    if (st.phase !== 'parked' || qty < 1) return false;
    const cost = costOf(g, qty, pay);
    if (R().available(payId(pay)) < cost) return false;
    st.cargo[g] -= qty;
    st.orders.push({ g, qty, pay, cost, loaded: 0, done: 0, u: 0 });
    changed();
    return true;
  }
  function autoTrade() {
    Object.keys(st.cargo).forEach((g) => {
      const pay = st.sel[g] || S.INPUTS[0], have = R().available(payId(pay));
      let n = st.auto[g] ? Math.min(st.cargo[g], Math.floor(have * S.VALUE[pay] / (S.VALUE[g] * MARKUP) + 1e-9)) : 0;
      while (n > 0 && costOf(g, n, pay) > have) n--;
      if (n < 1) return;
      const cost = costOf(g, n, pay);
      R().spend(payId(pay), cost); grant(g, n);
      st.cargo[g] -= n; st.paid[pay] = (st.paid[pay] || 0) + cost;
      footer(`Standing order traded ${fmt(cost)} ${S.NAME[pay]} for ${fmt(n)} ${S.NAME[g]}.`);
      if (off) { const a = off.auto[pay + '>' + g] = off.auto[pay + '>' + g] || [0, 0]; a[0] += cost; a[1] += n; }
    });
  }
  function grant(g, n) {
    const L = here().loc();
    if (g === 'woodcrate' || g === 'stonecrate') {
      const parent = L.prefix + (g === 'woodcrate' ? 'wood' : 'stone');
      R().add(R().ensureCrate(parent), n * CRATE_UNITS);
      return;
    }
    const id = L.ensureResource ? L.ensureResource(g, S.NAME[g]) : g;
    R().add(id, n);
    if (R().isHidden(id)) R().reveal(id);
  }
  // Trading Post job: its share of the loading rate goes to the first order.
  const KEY = { camp: 'camp', mountains: 'mtn' }; // Trading Post location -> Caravan key
  const jobActive = (loc) => { const o = parkedAt(KEY[loc]) && st.orders[0]; return !!o && (o.loaded >= o.cost - 1e-9 || R().available(payId(o.pay)) > 0); };
  function work(loc, budget) {
    if (!jobActive(loc)) return;
    while (budget > 1e-9 && st.orders.length) {
      const o = st.orders[0];
      if (o.loaded < o.cost - 1e-9) {
        const got = R().spend(payId(o.pay), Math.min(budget, o.cost - o.loaded));
        o.loaded += got; budget -= got;
        if (!got) return; // ran out of payment: stalls until stock returns or it leaves
        if (o.loaded >= o.cost - 1e-9) o.loaded = o.cost;
        continue;
      }
      const use = Math.min(budget, o.qty - o.done - o.u);
      o.u += use; budget -= use;
      const n = Math.floor(o.u + 1e-9);
      if (n > 0) { grant(o.g, n); o.done += n; o.u = Math.max(0, o.u - n); }
      if (o.done >= o.qty) { st.paid[o.pay] = (st.paid[o.pay] || 0) + o.cost; st.orders.shift(); changed(); }
    }
  }
  function step(dt) {
    if (!(dt > 0)) return;
    if (st.phase === 'wait') { const ss = OW.Mechanics.get('scoutspen'); if (ss && ss.revealed) depart(FIRST); return; }
    if (st.phase === 'bazaar' && st.ul.l > 0) { const u = Math.min(dt, st.ul.l); unload(dt); dt -= u; if (dt <= 0) return; } // rest starts after unloading
    st.t -= dt;
    if (st.t > 0) return;
    if (st.phase === 'road') arrive();
    else if (st.phase === 'parked') { if (st.orders.length && staffed() && !st.r) st.t = 0; else leave(); }
    else if (st.phase === 'back') home();
    else if (st.phase === 'bazaar') depart();
  }

  /* ---- influence ---- */
  // Free: parked at Camp or Mountains, the departure timer drops to LEAVE seconds.
  function leaveNow() {
    if (st.phase !== 'parked' || st.t <= LEAVE) return false;
    st.t = LEAVE; changed(); return true;
  }
  // Rush back: trades in progress (parked) or unloading (Bazaar) finish now; every step until it parks again takes RUSH_S.
  const rushOff = () => !(st.phase === 'parked' || st.phase === 'bazaar') || st.r || R().available('gold') < RUSH;
  function rush() {
    if (rushOff()) return false;
    R().spend('gold', RUSH);
    if (st.phase === 'bazaar') unload(Infinity);
    else st.orders = st.orders.filter((o) => {
      o.loaded += R().spend(payId(o.pay), o.cost - o.loaded);
      if (o.loaded < o.cost - 1e-9) return true; // short of payment: refunded on leaving
      grant(o.g, o.qty - o.done); st.paid[o.pay] = (st.paid[o.pay] || 0) + o.cost; return false;
    });
    st.t = Math.min(st.t, RUSH_S); st.r = 1; changed();
    footer('Caravan is rushing back.');
    return true;
  }
  const away = () => st.phase !== 'parked'; // Request, Next stop and upgrades: only while parked at a Trading Post
  function request(g) {
    if (away() || !has(REQUEST) || (g && !S.GOODS.includes(g))) return false;
    st.req = g; changed(); return true;
  }
  function setNext(k) {
    if (away() || !has(NEXT) || k === st.next || (k !== 'camp' && k !== 'mtn')) return false;
    if (k === 'mtn') { if (!OW.Mountains.isDiscovered() || R().available('gold') < NEXT_COST) return false; R().spend('gold', NEXT_COST); }
    else R().add('gold', NEXT_COST); // back to Camp refunds the Mountains fee
    st.next = k; changed(); return true;
  }
  const has = (i) => !!st.own[i];
  const owned = () => LADDER.filter((u, i) => has(i)).length;
  const canBuy = (i) => LADDER[i] && !has(i) && !away() && R().available(payId(BARS)) >= LADDER[i][1];
  function buy(i = LADDER.findIndex((u, k) => !has(k))) {
    const u = LADDER[i];
    if (!canBuy(i)) return false;
    R().spend(payId(BARS), u[1]); st.own[i] = 1;
    if (u[3]) S.setWagons(++st.wagons);
    if (i === PASS && !OW.CollapsedPath.isCleared()) OW.CollapsedPath.finish();
    footer(`Bought ${u[0]} for the Caravan.`); changed();
    return true;
  }

  /* ---- cards ---- */
  const parkedAt = (key) => st.phase === 'parked' && st.dest === key;
  function visibleAt(key) {
    if (key === 'sd') return OW.SandDunes.isDiscovered() && (st.phase === 'back' || st.phase === 'bazaar');
    return st.dest === key && (st.phase === 'road' || st.phase === 'parked');
  }
  const restElapsed = () => st.phase === 'bazaar' && st.ul.l > 0;
  function orderText(o, waiting) {
    const tail = waiting ? 'Leaving after' : clock(st.t);
    return o.loaded < o.cost
      ? `Loading ${fmt(o.loaded)} / ${fmt(o.cost)} ${S.NAME[o.pay]} · ${tail}`
      : `Unloading ${fmt(o.done)} / ${fmt(o.qty)}${waiting ? '' : ' ' + S.NAME[o.g]} · ${tail}`;
  }
  function statText(key) {
    if (key === 'sd') return st.phase === 'back' ? `Arriving in ${clock(st.t)}` : restElapsed() ? 'Unloading at the Bazaar' : `Resting ${clock(st.t)}`;
    if (st.phase === 'road') return `Arriving in ${clock(st.t)}`;
    const o = st.orders[0];
    return o ? orderText(o, st.t <= 0) : `Departs in ${clock(st.t)}`;
  }
  function barPct(key) {
    if (key === 'sd') return restElapsed() ? st.ul.l / UNLOAD_SHOW * 100 : 0;
    const o = parkedAt(key) && st.orders[0];
    if (!o) return 0;
    return o.loaded < o.cost ? o.loaded / o.cost * 100 : (o.qty - o.done - o.u) / o.qty * 100;
  }

  /* ---- modal ---- */
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  const hs = (title, right, body, sub) => `<div class="hs-card"><div class="hs-head"><span class="hs-title ms-item-title${sub ? ' cv-titled' : ''}">${title}${sub ? `<span class="cv-sub cv-plain">${sub}</span>` : ''}</span><span class="upgrade-costtime">${right}</span></div><div class="hs-body">${body}</div></div>`;
  const row = (label, key, val) => `<div class="cv-r"><span>${label}</span><b data-cv="${key}">${val}</b></div>`;
  const timerLabel = () => (st.phase === 'road' || st.phase === 'back' ? 'Arriving in' : st.phase === 'parked' ? 'Departs in' : restElapsed() ? 'Unloading' : 'Leaves in');
  function cargoText() {
    const o = st.orders[0];
    if (!o) return 'Nothing ordered';
    return o.loaded < o.cost ? `Loading payment ${fmt(o.loaded)} / ${fmt(o.cost)} ${S.NAME[o.pay]}` : `Unloading ${fmt(o.done)} / ${fmt(o.qty)} ${S.NAME[o.g]}`;
  }
  // What the non-parked modal lists: on the way back, the payment and unsold cargo; at the Bazaar, what's left to unload.
  const board = () => (st.phase === 'bazaar' ? st.ul : { p: st.paid, b: st.cargo });
  const queueText = () => st.orders.slice(1).map((o) => `${fmt(o.qty)} ${S.NAME[o.g]}`).join(', ') || '—';
  const tradeOff = (g) => { const qty = Math.min(st.qty[g] || 0, st.cargo[g] || 0), pay = st.sel[g] || S.INPUTS[0];
    return qty < 1 || R().available(payId(pay)) < costOf(g, qty, pay); };
  const costText = (g) => `Costs ${fmt(costOf(g, Math.max(1, Math.min(st.qty[g] || 1, st.cargo[g] || 1)), st.sel[g] || S.INPUTS[0]))} ${S.NAME[st.sel[g] || S.INPUTS[0]]}`;
  const capOf = (g) => st.cargo[g] || 0;
  const curOf = (g) => Math.min(st.qty[g] || 0, capOf(g));
  const stepper = (g, v) => `<div class="card-steppers visible ms-stepper"><button class="card-stepper-btn" data-cv-step="${g}" data-cv-dir="-1" ${curOf(g) <= 1 ? 'disabled' : ''}>−</button><span class="card-stepper-val" data-cv="qty-${g}">${v}</span><button class="card-stepper-btn" data-cv-step="${g}" data-cv-dir="1" ${curOf(g) >= capOf(g) ? 'disabled' : ''}>+</button></div>`;
  const offs = () => ({ rush: rushOff(), mtn: away() || (st.next !== 'mtn' && R().available('gold') < NEXT_COST), camp: away() });
  function values() {
    const v = { timer: restElapsed() ? clock(st.ul.l) : st.t > 0 ? clock(st.t) : 'Leaving after', eta: clock(st.t), crew: `${fmt(here().pool.getAssigned(here().tp || ''))} assigned`, coins: fmt(R().get('gold')), bars: fmt(R().available(payId(BARS))), cargo: cargoText(), queue: queueText() };
    const B = board();
    Object.keys(B.p).forEach((r) => { v['bp-' + r] = fmt(B.p[r]); });
    Object.keys(B.b).forEach((g) => { v['bb-' + g] = fmt(B.b[g]); });
    Object.keys(st.cargo).forEach((g) => { v['ob-' + g] = `${fmt(st.cargo[g])} on board`; v['qty-' + g] = fmt(Math.min(st.qty[g] || 0, st.cargo[g])); v['cost-' + g] = costText(g); });
    return v;
  }
  function payOptions(g) {
    const cur = st.sel[g] || S.INPUTS[0];
    return S.INPUTS.map((r) => `<option value="${r}"${r === cur ? ' selected' : ''}>${S.NAME[r]} (${S.VALUE[r]}) · ${fmt(R().available(payId(r)))}</option>`).join('');
  }
  function goodHTML(g, v) {
    const auto = has(STANDING) ? `<span class="ms-auto-inline"><span class="ms-auto-label">Standing order</span><span class="toggle-switch sell-auto${st.auto[g] ? ' on' : ''}" data-cv-auto="${g}"></span></span>` : '';
    return hs(S.NAME[g], auto, `
      <div class="ms-row-body"><div class="ms-ctl ms-com-ctl"><span class="ms-ctl-label">Quantity</span>
        ${stepper(g, v['qty-' + g])}</div>
        <span class="cv-stock" data-cv="ob-${g}">${v['ob-' + g]}</span></div>
      <div class="cv-row"><span class="ms-ctl-label">Pay with</span><select class="sp-select" data-cv-pay="${g}">${payOptions(g)}</select><span class="cv-pay" data-cv="cost-${g}">${v['cost-' + g]}</span>
        <div class="ms-right cv-push"><button class="action-btn ms-sell" data-cv-trade="${g}" ${tradeOff(g) ? 'disabled' : ''}>Trade</button></div></div>`);
  }
  const btn = (attr, label, off) => `<div class="ms-right cv-push"><button class="action-btn ms-sell" ${attr} ${off ? 'disabled' : ''}>${label}</button></div>`;
  const rushHTML = (o) => hs('Rush back', '', `<div class="cv-row"><span class="cv-pay">Costs ${fmt(RUSH)} Gold Coins</span>${btn('data-cv-rush', 'Rush back', o.rush)}</div>`, `Rush the Caravan. It will arrive in ${RUSH_S * (st.phase === 'bazaar' ? 2 : 4)} seconds`);
  function influenceHTML(v) {
    const o = offs();
    let h = hs('Leave now', '', `<div class="cv-row"><span class="cv-pay">Free</span>${btn('data-cv-leave', 'Leave now', st.t <= LEAVE)}</div>`, `Caravan departs in ${LEAVE} seconds`);
    h += rushHTML(o);
    if (has(REQUEST)) h += hs('Request', '', `<div class="cv-row"><span class="ms-ctl-label">Next trip brings</span><select class="sp-select" data-cv-req><option value="">Any</option>${S.GOODS.map((g) => `<option value="${g}"${st.req === g ? ' selected' : ''}>${S.NAME[g]} · ${fmt(S._st.shelf[g])} on the shelf</option>`).join('')}</select></div>`);
    if (has(NEXT)) {
      const place = (k, label, cost, off) => `<div class="cv-row"><span>${label}</span><span class="cv-pay">${cost}</span>${btn(`data-cv-next="${k}"`, st.next === k ? 'Chosen' : 'Go', st.next === k || off)}</div>`;
      h += hs('Next stop', '', place('camp', 'Camp', 'Free', o.camp) + (OW.Mountains.isDiscovered() ? place('mtn', 'Mountains', `${fmt(NEXT_COST)} Gold Coins`, o.mtn) : ''));
    }
    return h + hs('Influence Caravan with Gold Bars', '', LADDER.map((u, i) => `<div class="cv-row cv-up"><span class="cv-up-name">${u[0]}<span class="cv-up-eff">${u[2]}</span></span>`
      + (has(i) ? '<span class="cv-pay">Owned</span>' : `<span class="cv-pay">${fmt(u[1])} Gold Bars</span>${btn(`data-cv-buy="${i}"`, 'Buy', !canBuy(i)).replace('ms-right cv-push', 'ms-right')}`) + '</div>').join(''));
  }
  const strip = (v, full) => `<div class="ms-header"><span>${timerLabel()} <b data-cv="timer">${v.timer}</b></span>${full ? `<span>Gold Coins <b data-cv="coins">${v.coins}</b></span><span>Gold Bars <b data-cv="bars">${v.bars}</b></span>` : ''}</div>`;
  const wrap = (top, body) => `<div class="marketstall-modal">${top}<div class="sp-tab-body ms-body">${body}</div></div>`;
  // The Caravan's own window: what's on board and the timer; Rush back at the Bazaar.
  function renderFor(key) {
    const v = values(), B = board(), rows = Object.keys(B.b).map((g) => row(S.NAME[g], 'bb-' + g, v['bb-' + g]))
      .concat(Object.keys(B.p).map((r) => row(`${S.NAME[r]} · traded`, 'bp-' + r, v['bp-' + r])));
    const go = PLACES[key].tp ? '<button class="action-btn cv-go" data-cv-go>Go to Trade Post</button>' : '';
    return wrap(strip(v), hs('On board', go, `<div class="cv-cargo">${rows.length ? rows.join('') : row('Nothing', '', '')}</div>`)
      + (key === 'sd' && st.phase === 'bazaar' ? rushHTML(offs()) : ''));
  }
  // The Trading Post's Caravan tab: trade and influence while parked here.
  function tabFor(key) {
    const v = values();
    if (st.phase === 'road' && st.dest === key) return wrap(strip(v, 1), `<div class="sp-tab-greyed">Caravan arrives in <span data-cv="eta">${v.eta}</span>.</div>`);
    if (!parkedAt(key)) return '<div class="sp-tab-greyed">Caravan is elsewhere.</div>';
    const goods = Object.keys(st.cargo);
    const tabs = `<div class="sp-tabs cv-subtabs">${[['trade', 'Trade'], ['influence', 'Influence']].map(([k, l]) => `<button class="sp-tab${tab === k ? ' active' : ''}" data-cv-tab="${k}">${l}</button>`).join('')}</div>`;
    const note = `<div class="cv-note">Trading Post workers load the payment and unload the goods · <span data-cv="crew">${v.crew}</span></div>`;
    const body = tab === 'influence' ? influenceHTML(v) : hs('Cargo', '', `<div class="cv-cargo">${row('Now', 'cargo', v.cargo)}<div class="detail-progress-wrap"><div class="detail-progress-bar" data-track="cv-bar" style="width:${barPct(key)}%"></div></div>${row('Then', 'queue', v.queue)}</div>`)
      + (goods.length ? goods.map((g) => goodHTML(g, v)).join('') : '<div class="sp-tab-greyed">The Bazaar had nothing to send this trip.</div>');
    return wrap(strip(v, 1) + note + tabs, body);
  }
  function patchFor(m) {
    if (m._ver !== ver) { m._ver = ver; OW.Cards.refreshOpenModal(m.id); return; }
    const v = values();
    Object.keys(v).forEach((k) => { const el = q(`[data-cv="${k}"]`); if (el && el.textContent !== v[k]) el.textContent = v[k]; });
    const b = q('[data-track="cv-bar"]'); if (b) b.style.width = barPct(m.key) + '%';
    Object.keys(st.cargo).forEach((g) => { const el = q(`[data-cv-trade="${g}"]`); if (el) el.disabled = tradeOff(g); });
    const o = offs(), dis = (sel, d) => { const el = q(sel); if (el) el.disabled = d; };
    dis('[data-cv-rush]', o.rush); LADDER.forEach((u, i) => dis(`[data-cv-buy="${i}"]`, !canBuy(i))); dis('[data-cv-leave]', st.t <= LEAVE); dis('[data-cv-next="mtn"]', o.mtn || st.next === 'mtn');
  }
  function bind(m) {
    const body = document.getElementById('card-modal-body');
    m._ver = ver;
    body.querySelectorAll('[data-cv-trade]').forEach((el) => el.addEventListener('click', () => { if (trade(el.getAttribute('data-cv-trade'))) OW.Cards.refreshOpenModal(m.id); }));
    const on = (sel, ev, fn) => body.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, () => { if (fn(el) !== false) OW.Cards.refreshOpenModal(m.id); }));
    on('[data-cv-tab]', 'click', (el) => { tab = el.getAttribute('data-cv-tab'); });
    on('[data-cv-rush]', 'click', () => { if (rush()) OW.Cards.closeModal(); return false; });
    on('[data-cv-go]', 'click', () => { OW.TradingPost.nextTab = 'caravan'; OW.Cards.open(OW.Mechanics.get(PLACES[m.key].tp)); return false; });
    on('[data-cv-buy]', 'click', (el) => buy(+el.getAttribute('data-cv-buy')));
    on('[data-cv-leave]', 'click', () => { if (leaveNow()) OW.Cards.closeModal(); return false; });
    on('[data-cv-next]', 'click', (el) => setNext(el.getAttribute('data-cv-next')));
    on('[data-cv-req]', 'change', (el) => request(el.value));
    on('[data-cv-auto]', 'click', (el) => { const g = el.getAttribute('data-cv-auto'); st.auto[g] = !st.auto[g]; el.classList.toggle('on', st.auto[g]); return false; });
    body.querySelectorAll('[data-cv-pay]').forEach((el) => el.addEventListener('change', () => { st.sel[el.getAttribute('data-cv-pay')] = el.value; patchFor(m); }));
    body.querySelectorAll('[data-cv-step]').forEach((el) => OW.Cards.addHoldBehavior(el, () => {
      const g = el.getAttribute('data-cv-step'), dir = +el.getAttribute('data-cv-dir'), cap = capOf(g), cur = curOf(g);
      st.qty[g] = Math.max(1, Math.min(cap, dir > 0 ? (cur < STEP[g] ? STEP[g] : cur + STEP[g]) : cur - STEP[g]));
      const qty = curOf(g);
      body.querySelector(`[data-cv-step="${g}"][data-cv-dir="-1"]`).disabled = qty <= 1;
      body.querySelector(`[data-cv-step="${g}"][data-cv-dir="1"]`).disabled = qty >= cap;
      patchFor(m);
    }));
  }

  const cards = Object.keys(PLACES).map((key) => {
    const P = PLACES[key];
    const m = {
      id: P.id, key, section: P.section, startHidden: true,
      cardThemeClass: 'cv-sand', modalTheme: 'theme-sanddunes', modalWide: true, workerPool: P.pool,
      stepperReady: () => false, // staffed by the Trading Post
      cardName: () => 'Caravan',
      getStatText: () => statText(key),
      getUpgradeBarPct: () => 0,
      getBuildBarPct: () => barPct(key),
      hideBuildBar: () => barPct(key) <= 0,
      isMuted: () => (key === 'sd' ? st.phase === 'back' : st.phase === 'road'),
      canAssign: () => false,
      renderModalHTML: () => renderFor(key),
      patchLiveTrack: () => patchFor(m),
      afterRender: () => bind(m),
      tick(goldAvailable, dt) {
        if (key === 'camp') sim(dt);
        const want = visibleAt(key);
        if (want !== !!m.revealed) (want ? OW.Cards.reveal : OW.Cards.hide)(m);
        OW.Cards.refresh(m);
      }
    };
    if (key === 'sd') S.gate(m, 'Caravan');
    OW.Mechanics.register(m);
    return m;
  });
  const tpView = {}; // per Trading Post location: the window handle bind/patchFor redraw
  const viewOf = (loc) => (tpView[loc] = tpView[loc] || { id: PLACES[KEY[loc]].tp, key: KEY[loc] });
  OW.TradingPost.tabs.push({ id: 'caravan', label: 'Caravan', html: (loc) => tabFor(KEY[loc]), bind: (loc) => bind(viewOf(loc)), patch: (loc) => patchFor(viewOf(loc)) });
  OW.TradingPost.jobs.push({ active: jobActive, work });
  function sim(dt) {
    const rep = OW.Offline.isReplaying();
    if (rep && !wasReplaying) off = { trips: 0, auto: {} };
    wasReplaying = rep;
    step(dt);
  }

  OW.Offline.setSummaryLine(() => {
    const o = off; off = null;
    if (!o || !o.trips) return '';
    const a = Object.keys(o.auto).map((k) => { const [p, g] = k.split('>'); return `${fmt(o.auto[k][0])} ${S.NAME[p]} for ${fmt(o.auto[k][1])} ${S.NAME[g]}`; });
    return `Caravan made ${o.trips} trip${o.trips === 1 ? '' : 's'}.${a.length ? ' Standing orders traded ' + a.join(', ') + '.' : ''}`;
  });

  OW.Save.register('caravan', () => ({ p: st.phase, t: st.t, d: st.dest, c: st.cargo, o: st.orders, y: st.paid, s: st.sel, q: st.qty, w: st.wagons, ul: st.ul, ow: st.own, k: st.req, n: st.next, a: st.auto, r: st.r }), (d) => {
    if (!d) return;
    st.phase = d.p || 'wait'; st.t = d.t || 0; st.dest = PLACES[d.d] ? d.d : 'camp';
    st.cargo = d.c || {}; st.orders = d.o || []; st.paid = d.y || {}; st.sel = d.s || {}; st.qty = d.q || {};
    Object.keys(st.sel).forEach((g) => { if (!S.INPUTS.includes(st.sel[g])) delete st.sel[g]; }); // older saves: Luxury left the pay list
    st.wagons = d.w || 1; st.ul = d.ul || { p: {}, b: {}, l: 0 };
    st.own = d.ow || LADDER.reduce((o, u, i) => { if (i < (d.u || 0)) o[i] = 1; return o; }, {}); // older saves: first u owned
    st.req = d.k || ''; st.next = d.n === 'mtn' ? 'mtn' : 'camp'; st.auto = d.a || {}; st.r = d.r || 0;
    S.setWagons(st.wagons); changed();
  });

  OW.Caravan = {
    _st: st, cards, trade, step, costOf, MARKUP, LADDER, rush, RUSH, request, setNext, buy, leaveNow, owned,
    _influence: () => influenceHTML(values()),
    unloading: () => st.phase === 'bazaar' && st.ul.l > 0,
    cheatGo() { if (st.phase === 'wait') return depart(3); if (st.phase === 'bazaar') unload(Infinity); st.t = 3; changed(); },
    cheatArrive() { if (st.phase === 'parked') return; if (st.phase !== 'road') depart(); arrive(); }
  };
})();
