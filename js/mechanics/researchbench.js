/* Camp's Research Bench: research Pages on a desk.
   Hidden (no slot) until the first Dig Site roll, then fades in: 0% up to
   100% at FADE_FULL digs (Dig Site saves the lifetime count). No clicks,
   steppers or face text until full.

   A Page has four hidden rows (Category, Title, Descriptor, Effect), each with
   its own stepper. Every worker on a row spends 1 Research Paper a second (game
   time, paid gold like other Camp workers) toward that row's cost; a finished
   row shows its text and its workers move down to the page's next unfinished row
   (Effect wraps to Category); with none left they idle on the bench, unpaid,
   until the next "+". Card face: how many pages have workers, or Stopped; its bar is the
   page closest to done. Text types in letter by letter as papers go in. The
   page's total sits top left; "Complete page" is greyed until all four rows are
   done, then files it under Completed (newest first; each opens read-only), closes
   the modal, applies its effect and pans the camera to the card it touched (if
   built), which may flash its colour (or a resource's left-hand row) and open.
   Pages land in PAGES order, a page with `after` only once that page (or every
   page in an `after` list) is completed; Study pages (after 'study') land at random instead. `cost`
   scales its rows from NEED. The Study page renames this card (saved).
   Shuffle (Study only): every unlocked desk page goes back to the pile for
   ceil(20 × 1.66^shuffles) papers; freed slots refill at random on the next
   ticks (a riffle shows it). Pages just sent back are not drawn until the next
   shuffle, unless nothing else is left. Their workers idle on the bench; their
   progress is kept. From Study on, the Set aside list shows every page waiting off
   the desk; each opens read-only with the text paid so far.
   Trading Post and Mountains pages gate Camp's Trading Post tabs (ResearchBench.has).
   The desk holds up to DESK pages, fanned in one of LAYOUTS (a page with its
   own `lone` spot uses that instead while it is alone); each time a page
   lands a different layout is rolled (seeded Math.random, on a tick). Card /
   header "+" fills the first unfinished row; "−" takes from the last.
   Saved: desk order, rows with progress (papers, workers), completed pages, layout,
   study, locks, set-aside pages, shuffle count. */
(function () {
  'use strict';
  const OW = window.OrbWeaver, R = OW.Resources, pool = OW.Workers;
  const ID = 'researchbench', FADE_FULL = 15, DESK = 3, PAPERS = 'researchpapers';
  const LABELS = ['Category', 'Title', 'Descriptor', 'Effect'], NEED = [10, 50, 20, 100];
  // Page data: text per row; card: the card the camera pans to. Optional: effect (what "Complete page"
  // does), after (lands once that page, or every page in the list, is completed), tab (the card opens on that
  // Trading Post tab), cost (× NEED, rounded up), lone (its
  // own spot when alone), flash (the card flashes its colour after the pan), res (that resource's left-hand
  // row glows instead), show (then its modal opens).
  const PAGES = [
    { id: 'shard', text: ['Research', 'Strange Shard', 'Research Strange Shard and reveal its secrets', "A glimpse of the Shard's destination"],
      effect: () => OW.ShardCard.add(), card: 'shardcard', flash: true, lone: { r: 1.5, x: 0, y: 0, z: 1 } },
    { id: 'camp', after: 'shard', cost: .5, text: ['Upgrade', 'Camp', 'Additional building options become available using both wood and stone', 'Upgrades Builders Bench to Camp'],
      effect: () => OW.BuildersBench.upgrade(), card: 'buildersbench', flash: true, show: true },
    { id: 'stock', after: 'shard', cost: .25, text: ['Unlock', 'Stock Market', 'Speculate on goods in the Stock Market', 'Unlocks Stock Market in the Market Stall'],
      effect: () => OW.MarketStall.unlockStock(), card: 'marketstall', flash: true, show: true },
    { id: 'tradepost', after: ['camp', 'stock'], cost: .5, text: ['Unlock', 'Trading Post', 'Transfer Workers and resources between locations', 'Unlocks Resupply tab in Trading Post'],
      card: 'scoutspen', flash: true, show: true, tab: 'resupply' },
    { id: 'mountains', after: ['camp', 'stock'], cost: .25, text: ['Location', 'Mountains', 'Discover the Mountain Passage', 'Adds Mountains Expedition to Trading Post'],
      card: 'scoutspen', flash: true, show: true, tab: 'expedition' },
    { id: 'study', after: ['camp', 'stock'], text: ['Upgrade', 'Study', 'Additional research options become available', 'Upgrades Research Bench to Study'],
      effect: () => { study = true; }, card: ID, flash: true, show: true },
    // Study pages
    { id: 'woodcap', after: 'study', cost: .5, text: ['Cap Increase', 'Wood', 'Find more storage space for Wood', 'Increases cap to 6000'],
      effect: () => R.setCap('wood', 6000), card: 'wood', res: 'wood' },
    { id: 'stonecap', after: 'study', cost: 1.25, text: ['Cap Increase', 'Stone', 'Find more storage space for Stone', 'Increases cap to 3000'],
      effect: () => R.setCap('stone', 3000), card: 'stone', res: 'stone' },
    { id: 'huts', after: 'study', cost: 2.25, text: ['Upgrade', 'Tents', 'Build Huts for your workers', 'Upgrades Tents to Huts. Requires tools and stone'],
      effect: () => tools('tents'), card: 'tents', flash: true, show: true },
    { id: 'axes', after: 'study', cost: 2, text: ['Unlock', 'Wood Pile', 'Teach workers to use axes to chop wood', 'Tier 2 tools can be used in Wood Pile'],
      effect: () => tools('wood'), card: 'wood', flash: true, show: true },
    { id: 'pickaxes', after: 'study', cost: 1.5, text: ['Unlock', 'Stone Pit', 'Teach workers to use Pickaxes to chisel stone', 'Tier 2 tools can be used in Stone Pit'],
      effect: () => tools('stone'), card: 'stone', flash: true, show: true },
    { id: 'templeruins', after: 'study', cost: 4, text: ['Location', 'Temple Ruins', 'The Shard vibrates when pointed South', 'Reveals the Temple Ruins'],
      card: 'scoutspen', flash: true, show: true, tab: 'expedition' } // its Expedition: js/mechanics/templetrip.js
  ];
  const tools = (id) => { const m = OW.Mechanics.get(id); m.tools.unlock(); OW.Cards.refresh(m); };
  // Fan layouts, one entry per desk slot: tilt (deg), x/y nudge (px), stacking order.
  const LAYOUTS = [
    [{ r: -2.2, x: 0, y: 0, z: 1 }, { r: .8, x: 0, y: 6, z: 2 }, { r: 2.4, x: 0, y: 2, z: 3 }],      // Rising
    [{ r: -3.5, x: 10, y: 14, z: 1 }, { r: 0, x: 0, y: -4, z: 3 }, { r: 3.5, x: -10, y: 14, z: 2 }], // Tent
    [{ r: 3, x: 6, y: 18, z: 2 }, { r: -4, x: 0, y: -2, z: 3 }, { r: 1.5, x: -4, y: 30, z: 1 }],     // Scatter
    [{ r: -1.5, x: 34, y: 4, z: 3 }, { r: 1, x: 12, y: 0, z: 2 }, { r: 2.5, x: -10, y: 8, z: 1 }]    // Reverse
  ];
  const byId = (id) => PAGES.find((p) => p.id === id);
  const desk$ = () => document.querySelector('#card-modal-body .pg-desk');
  // Redraws from ticks wait while a riffle owns the desk (its end redraws anyway).
  const redraw = () => { const b = desk$(); if (!b || !OW.Motion.owned(b)) OW.Cards.refreshOpenModal(ID); };
  let desk = [], done = [], rows = {}, layout = 0, study = false, locks = [], aside = [], shuffles = 0;
  let front = null, viewing = null; // view only: page brought forward, completed page open

  const seen = () => Math.min(FADE_FULL, OW.DigSite.digs()), shown = () => seen() >= FADE_FULL;
  // .tut-fade (style.css) holds a fresh game's card at 0 before the first tick.
  const fade = () => {
    const w = mechanic.els && mechanic.els.wrap;
    if (!w) return;
    if (!!seen() !== mechanic.revealed) (seen() ? OW.Cards.reveal : OW.Cards.hide)(mechanic); // no slot before the first dig
    w.style.opacity = seen() / FADE_FULL; w.style.pointerEvents = shown() ? 'auto' : 'none';
  };

  // Row slots in desk order, top to bottom: '<page>:<row>'.
  const slots = () => desk.flatMap((id) => NEED.map((n, k) => `${id}:${k}`));
  const row = (key) => rows[key] || (rows[key] = { have: 0, w: 0 });
  const needOf = (id) => NEED.map((n) => Math.ceil(n * (byId(id).cost || 1))), total = (id) => needOf(id).reduce((a, n) => a + n, 0);
  const need = (key) => needOf(key.split(':')[0])[+key.split(':')[1]];
  const open = (key) => row(key).have < need(key);
  const full = (id) => NEED.every((n, k) => !open(`${id}:${k}`));
  const used = () => slots().reduce((a, key) => a + row(key).w, 0);
  const ready = () => desk.filter(full).length;
  const paid = (id) => NEED.reduce((a, n, k) => a + row(`${id}:${k}`).have, 0);

  function clampWorkers() {
    let budget = pool.getAssigned(ID);
    slots().forEach((key) => { const r = row(key); r.w = Math.min(r.w, budget); budget -= r.w; });
  }
  function subAssign(key) {
    if (!shown() || !slots().includes(key) || !open(key)) return;
    if (pool.getAssigned(ID) - used() <= 0 && !pool.assign(ID)) return;
    row(key).w++;
    OW.Cards.refresh(mechanic);
  }
  function subUnassign(key) {
    if (!rows[key] || rows[key].w <= 0) return;
    rows[key].w--;
    pool.unassign(ID); // returns the worker to idle (fires the card refresh)
  }
  pool.onChange(clampWorkers);

  // Pages that could land: not on the desk or completed, their `after` done.
  const pile = () => PAGES.filter((p) => !desk.includes(p.id) && !done.includes(p.id) && [].concat(p.after || []).every((a) => done.includes(a)));
  // A free slot takes the next fixed page, else a random Study page (set-aside ones only if nothing else), and rolls a new layout.
  function land() {
    const free = pile(), fixed = free.find((p) => p.after !== 'study'), fresh = free.filter((p) => !aside.includes(p.id)), from = fresh.length ? fresh : free;
    if (desk.length >= DESK || !from.length) return;
    desk.push((fixed || from[Math.floor(Math.random() * from.length)]).id);
    let n; do n = Math.floor(Math.random() * LAYOUTS.length); while (n === layout);
    layout = n;
    redraw();
  }

  const cost = () => Math.ceil(20 * Math.pow(1.66, shuffles)), loose = () => desk.filter((id) => !locks.includes(id));
  const canShuffle = () => study && loose().length > 0 && R.available(PAPERS) >= cost() && pile().length > 0;
  function shuffle() {
    if (!canShuffle()) return;
    R.spend(PAPERS, cost()); shuffles++;
    aside = loose();
    aside.forEach((id) => NEED.forEach((n, k) => { row(`${id}:${k}`).w = 0; })); // workers stay on the bench, idle
    desk = desk.filter((id) => locks.includes(id));
    OW.Cards.refresh(mechanic);
    const b = desk$(), redo = () => { OW.Cards.refreshOpenModal(ID); return desk$(); };
    if (b) OW.Motion.scene((s) => s.riffle(b, ':scope > .pg-slot', (el) => aside.includes(el.dataset.pgSlot), redo), redo); // view only
    else redo();
  }
  function lock(id) {
    if (!study || !desk.includes(id)) return;
    locks = locks.includes(id) ? locks.filter((x) => x !== id) : locks.concat(id);
    OW.Cards.refreshOpenModal(ID);
  }

  function complete(id) {
    if (!desk.includes(id) || !full(id)) return;
    desk = desk.filter((d) => d !== id); locks = locks.filter((d) => d !== id);
    done.push(id);
    OW.Footer.push(`Page complete: ${byId(id).text[1]}.`);
    OW.Cards.closeModal();
    const p = byId(id);
    if (p.effect) p.effect();
    OW.Cards.refresh(mechanic);
    const m = OW.Mechanics.get(p.card), band = p.res && document.querySelector(`.res-band[data-res="${p.res}"]`);
    if (m.revealed) OW.Motion.scene(async (s) => { await s.panTo(m.els.wrap, 900); if (p.flash) await s.flash(m.els.wrap); if (band) await s.glow(band); },
      () => { if (p.show) { OW.TradingPost.nextTab = p.tab; OW.Cards.open(m); } }); // view only
  }

  // ---- modal ----
  const stepper = (key) => `<div class="card-steppers visible">
      <button class="card-stepper-btn" data-pg-minus="${key}">−</button>
      <span class="card-stepper-val" data-pg-val="${key}">0</span>
      <button class="card-stepper-btn" data-pg-plus="${key}">+</button></div>`;
  // live: on the desk; else completed, or set aside (ro: progress so far, read only).
  const pageHTML = (p, live, ro = !live && !done.includes(p.id)) => `<div class="pg-page" data-pg-page="${p.id}">
      <div class="pg-page-title"><span data-pg-total="${live ? p.id : ''}">${live ? '' : `${ro ? Math.floor(paid(p.id)) : total(p.id)}/${total(p.id)}`}</span>${live && study
        ? `<button class="card-lock-btn pg-lock${locks.includes(p.id) ? ' locked' : ''}" data-pg-lock="${p.id}" title="${locks.includes(p.id) ? 'Locked: kept on shuffle' : 'Lock to keep on shuffle'}">${locks.includes(p.id) ? '🔒' : '🔓'}</button>` : ''}</div>
      ${LABELS.map((L, k) => { const key = `${p.id}:${k}`, fin = (!live && !ro) || !open(key), f = ro && !fin && row(key).have / need(key); return `<div class="pg-row" data-k="${k}">
        <div class="pg-step">${fin ? '<div class="pg-check">✓</div>' : live ? stepper(key) : ''}</div>
        <div class="pg-main"><div class="pg-head"><span>${L}</span><span class="wf-tag" data-pg-amt="${live ? key : ''}">${ro && !fin ? `${Math.floor(row(key).have)}/${need(key)}` : ''}</span></div>
          <div class="pg-text${ro && !fin && !Math.floor(p.text[k].length * f) ? ' hid' : ''}" data-pg-text="${live ? key : ''}">${fin ? p.text[k] : ro ? reveal(p.text[k], f) : ''}</div></div></div>`; }).join('')}
      ${live ? `<button class="action-btn pg-complete" data-pg-complete="${p.id}"${full(p.id) ? '' : ' disabled'}>Complete page</button>` : ro ? '<div class="pg-stamp pg-aside-stamp">Set aside</div>' : '<div class="pg-stamp">✓ Completed</div>'}
    </div>`;
  const away = () => (study ? pile().map((p) => p.id) : []); // Set aside: pages waiting off the desk
  const viewer = () => viewing && (done.includes(viewing) || away().includes(viewing))
    ? `<div class="pg-view" data-pg-view><div class="pg-slot">${pageHTML(byId(viewing), false)}</div><button class="card-stepper-btn pg-view-close" data-pg-close>✕</button></div>` : '';

  // Clipped reveal: the paid share of letters types in, the rest stay dots.
  const reveal = (s, p) => { const n = Math.floor(s.length * p); return !n ? '? ? ?' : s.slice(0, n) + (n < s.length ? `<span class="pg-dots">${s.slice(n).replace(/\S/g, '·')}</span>` : ''); };
  function typed(el, s, p) { el.classList.toggle('hid', !Math.floor(s.length * p)); el.innerHTML = reveal(s, p); }
  // Each slot sits where the layout says; the page brought forward rises above the rest.
  function place(body) {
    const box = body.querySelector('.pg-desk');
    if (!box) return;
    const slots = box.querySelectorAll(':scope > .pg-slot'), solo = slots.length === 1 && byId(slots[0].dataset.pgSlot).lone;
    const L = solo ? [solo] : LAYOUTS[layout];
    slots.forEach((el, i) => {
      const c = L[i];
      el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.r}deg)`;
      el.style.zIndex = el.dataset.pgSlot === front ? 5 : c.z;
      el.classList.toggle('front', el.dataset.pgSlot === front);
    });
    const ys = L.slice(0, Math.max(1, box.children.length)).map((c) => c.y);
    box.style.paddingTop = 10 + Math.max(0, -Math.min(...ys)) + 'px';
    box.style.paddingBottom = 14 + Math.max(...ys) + 'px';
  }

  const mechanic = {
    id: ID, section: 'Camp', cardThemeClass: 'tut-fade', startHidden: true, modalWide: true,
    cardName: () => (shown() ? (study ? 'Study' : 'Research Bench') : ''),
    // Card-face / header "+" adds to the first unfinished row (lastSub is never set).
    subSlots: () => slots().filter(open), subAdd: subAssign,
    stepperReady: () => shown(),
    canAssign: () => shown() && slots().some(open),
    getUpgradeBarPct: () => 0,
    hideUpgradeBar: () => true,
    getBuildBarPct: () => Math.max(0, ...desk.map((id) => paid(id) / total(id))) * 100, // bottom bar: the page closest to done
    hideBuildBar: () => !shown() || !desk.length,
    getBillableCount: () => R.get('gold') > 0 ? used() : 0,
    getStatText() {
      if (!shown()) return '';
      const u = used(), n = ready(), on = desk.filter((id) => NEED.some((x, k) => row(`${id}:${k}`).w)).length;
      if (n) return `${n} page${n > 1 ? 's' : ''} ready`;
      if (!pool.getAssigned(ID)) return '';
      if (!u || R.get('gold') <= 0) return 'Stopped'; // idle on the bench, or no gold
      if (R.available(PAPERS) <= 0) return 'No papers';
      return `Researching – ${on} paper${on > 1 ? 's' : ''}`;
    },
    getSubtitleHtml: () => '<div class="tool-pips-row"><span class="tool-pips-label">1 Research Paper per worker per second</span></div>',
    renderModalHTML() {
      const stat = (label, key) => `<div class="gp-resbar-stat"><span class="gp-resbar-label">${label}</span><span class="gp-resbar-amt" data-pg-${key}></span></div>`;
      const list = done.length
        ? `<div class="pg-done-list">${done.slice().reverse().map((id) => `<div class="pg-done-item" data-pg-open="${id}"><span class="hs-title">${byId(id).text[1]}</span><span class="pg-eff">${byId(id).text[3]}</span></div>`).join('')}</div>`
        : '<div class="pg-none">None yet</div>';
      const set = away().length ? `<div class="modal-subsection-label divider-top">Set aside (${away().length})</div><div class="pg-done-list">${away().map((id) =>
        `<div class="pg-done-item pg-aside-item" data-pg-open="${id}"><span class="hs-title">${reveal(byId(id).text[1], row(`${id}:1`).have / need(`${id}:1`))}</span><span class="pg-eff">${Math.floor(paid(id))}/${total(id)}</span></div>`).join('')}</div>` : '';
      return `<div class="bench-modal pg-modal">
        <div class="gp-resbar"><div class="gp-resbar-item"><div class="pg-stats">${stat('Research Papers', 'papers')}${stat('Using', 'rate')}</div>${study
          ? `<button class="action-btn pg-shuffle-btn" data-pg-shuffle>Shuffle – ${cost()} papers</button>` : ''}</div></div>
        <div class="pg-area"><div>
          <div class="pg-desk">${desk.map((id) => `<div class="pg-slot" data-pg-slot="${id}">${pageHTML(byId(id), true)}</div>`).join('') || '<div class="pg-none">No pages on the desk</div>'}</div>
          ${set}<div class="modal-subsection-label divider-top">Completed (${done.length})</div>
          ${list}</div>${viewer()}
        </div></div>`;
    },
    afterRender() {
      const body = document.getElementById('card-modal-body');
      ['plus', 'minus'].forEach((action) => body.querySelectorAll(`[data-pg-${action}]`).forEach((button) => {
        const run = () => (action === 'plus' ? subAssign : subUnassign)(button.getAttribute('data-pg-' + action));
        OW.Cards.addHoldBehavior(button, run);
        // Pointer input is handled by hold-to-repeat; keyboard clicks have no detail.
        button.addEventListener('click', (e) => { if (!e.detail && !button.disabled) run(); });
      }));
      body.querySelectorAll('[data-pg-complete]').forEach((b) => b.addEventListener('click', () => complete(b.dataset.pgComplete)));
      body.querySelectorAll('[data-pg-lock]').forEach((b) => b.addEventListener('click', () => lock(b.dataset.pgLock)));
      const sh = body.querySelector('[data-pg-shuffle]');
      if (sh) sh.addEventListener('click', shuffle);
      // View only (never saved): bring a page forward, open / close a completed or set-aside page.
      body.querySelectorAll('[data-pg-slot]').forEach((el) => el.addEventListener('click', () => { if (front !== el.dataset.pgSlot) { front = el.dataset.pgSlot; place(body); } }));
      body.querySelectorAll('[data-pg-open]').forEach((el) => el.addEventListener('click', () => { viewing = el.dataset.pgOpen; OW.Cards.refreshOpenModal(ID); }));
      const view = body.querySelector('[data-pg-view]');
      if (view) view.addEventListener('click', (e) => { if (e.target === view || e.target.closest('[data-pg-close]')) { viewing = null; OW.Cards.refreshOpenModal(ID); } });
      place(body);
      mechanic.patchLiveTrack();
    },
    patchLiveTrack() {
      const body = document.getElementById('card-modal-body');
      const q = (s) => body.querySelector(s), u = used(), idle = pool.getIdleCount();
      const text = (s, v) => { const el = q(s); if (el) el.textContent = v; };
      text('[data-pg-papers]', Math.floor(R.get(PAPERS)));
      text('[data-pg-rate]', `${u}/s`);
      const sh = q('[data-pg-shuffle]');
      if (sh) sh.disabled = !canShuffle();
      const starved = R.available(PAPERS) <= 0 || R.get('gold') <= 0;
      desk.forEach((id) => {
        text(`[data-pg-total="${id}"]`, full(id) ? 'Ready' : `${Math.floor(paid(id))}/${total(id)}`);
        const done1 = q(`[data-pg-complete="${id}"]`);
        if (done1) done1.disabled = !full(id);
        needOf(id).forEach((n, k) => {
          const key = `${id}:${k}`, r = row(key);
          if (!open(key)) return;
          text(`[data-pg-val="${key}"]`, r.w);
          const minus = q(`[data-pg-minus="${key}"]`), plus = q(`[data-pg-plus="${key}"]`);
          if (minus) minus.disabled = r.w <= 0;
          if (plus) plus.disabled = pool.getAssigned(ID) - u <= 0 && idle <= 0;
          const amt = q(`[data-pg-amt="${key}"]`);
          if (amt) amt.innerHTML = r.w && starved ? `<span class="pg-no">${R.get('gold') <= 0 ? 'Stopped' : 'No papers'}</span>` : `${Math.floor(r.have)}/${n}`;
          const t = q(`[data-pg-text="${key}"]`);
          if (t) typed(t, byId(id).text[k], r.have / n);
        });
      });
    },
    tick(goldAvailable, tickRate) {
      fade();
      if (shown() && tickRate > 0) {
        land();
        if (goldAvailable) slots().forEach((key) => {
          const r = row(key);
          if (!r.w || !open(key)) return;
          r.have += R.spend(PAPERS, Math.min(r.w * tickRate, need(key) - r.have));
          if (r.have < need(key) - 1e-9) return;
          r.have = need(key);
          // Its workers move down to the next unfinished row of the same page (Effect wraps to Category);
          // none left: they stay on the bench, idle and unpaid, for the next "+".
          const [id, k] = key.split(':'), next = [1, 2, 3].map((d) => `${id}:${(+k + d) % NEED.length}`).find(open);
          if (next) row(next).w += r.w;
          r.w = 0;
          redraw();
        });
      }
      OW.Cards.refresh(mechanic);
    }
  };

  OW.Save.register(ID,
    () => ({ desk: desk.slice(), done: done.slice(), layout, study, locks: locks.slice(), aside: aside.slice(), shuffles,
      rows: Object.fromEntries(Object.keys(rows).filter((key) => slots().includes(key) || (rows[key].have > 0 && !done.includes(key.split(':')[0])))
        .map((key) => [key, [rows[key].have, rows[key].w]])) }),
    (d) => {
      const ok = (id) => !!byId(id);
      const num = (v) => Number.isFinite(v) && v > 0 ? v : 0;
      done = (Array.isArray(d && d.done) ? d.done : []).filter(ok);
      desk = (Array.isArray(d && d.desk) ? d.desk : []).filter((id) => ok(id) && !done.includes(id)).slice(0, DESK);
      layout = Number.isInteger(d && d.layout) && LAYOUTS[d.layout] ? d.layout : 0;
      study = !!(d && d.study);
      const list = (k) => (Array.isArray(d && d[k]) ? d[k] : []);
      locks = list('locks').filter((id) => desk.includes(id));
      aside = list('aside').filter((id) => ok(id) && !done.includes(id));
      shuffles = Number.isInteger(d && d.shuffles) && d.shuffles > 0 ? d.shuffles : 0;
      rows = {};
      // Rows on the desk, plus any page with progress kept in the pile (no workers there).
      new Set([...Object.keys((d && d.rows) || {}), ...slots()]).forEach((key) => {
        const [id, k] = key.split(':');
        if (!ok(id) || done.includes(id) || !/^[0-3]$/.test(k)) return;
        const v = (d && d.rows && d.rows[key]) || [];
        rows[key] = { have: Math.min(need(key), num(v[0])), w: desk.includes(id) && num(v[0]) < need(key) ? Math.floor(num(v[1])) : 0 };
      });
      clampWorkers();
      front = viewing = null;
      fade(); // Dig Site's script, and so its saved dig count, loads first
    });
  OW.Mechanics.register(mechanic);
  // Res cheat: every page not yet done completes in PAGES order, effects applied, no animation.
  function cheatAll() {
    PAGES.filter((p) => !done.includes(p.id)).forEach((p) => { done.push(p.id); if (p.effect) p.effect(); });
    desk = []; locks = []; aside = []; rows = {};
    OW.Cards.refresh(mechanic); OW.Cards.refreshOpenModal(ID);
  }
  OW.ResearchBench = { name: () => (study ? 'Study' : 'Research Bench'), has: (id) => done.includes(id), cheatAll };
})();
