/* ============================================================
   MECHANIC: RUINED TEMPLE (bottom section, jade theme) + its cinematics
   Revealed by the Temple Ruins Expedition (or the Temple cheat). Own worker
   pool, filled by Trading Post cargo (a normal Locations destination once
   discovered); its own Trading Post (js/mechanics/templescoutstable.js) shows with it.

   The Temple Ruins card's own workers (face and modal steppers) walk one travel
   path (TIME s at 1 worker, faster with more; Mountains' worker rate) with two
   triangles: the Crack one (MID s in, drawn a third of the way along) stops
   the walk until "Crack in the Floor" is claimed (the modal closes, the floor
   breaks, Crack in the Floor and The Below open); the end one returns the
   walkers and offers "Orb" (the Orb card, cracked). With both claimed the
   path becomes The Ceremony: 60 idle pilgrims, 1 idle Shard bearer and 1
   Temple Ruins Shard (shipped from Camp). Begin Ceremony spends the Shard,
   takes the bearer out of the pool for good (The Shard Bearer) and leaves the
   pilgrims as ordinary workers; the orb breaks and The Shard Bearer falls into
   The Below, its heading broken for good.

   Saved: discovered, path progress, crack claimed, orb claimed, torches,
   risen. Altar, kneel and the level-up are kept but unused (no way in).

   Every step changes on a click or tick first; js/core/motion.js scenes
   only animate it, so a skipped (offline, replay) or cancelled scene
   changes nothing. sync() re-derives what is shown from the steps on every
   tick, load and scene end; it never hides what a scene owns, but a held
   card is put in place (still invisible) so the scene can aim at it.
   Names and texts are placeholders (TBD).
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const ID = 'ruinedtemple', PREFIX = 'rt_';
  const TIME = 20, MID = 3, AT = 100 / 3; // path length and the Crack in worker-seconds; the Crack triangle's spot on the bar (%)
  const PILGRIMS = 60;
  const TORCH = '232,184,74', PALE = '244,241,234';
  const MILESTONES = [[1, 'HP', (l) => 20 + l * 20], [3, 'Hunger', () => 'Sated'], [5, 'Mood', () => 'Unshaken'], [7, 'Favorite meal', () => 'Ash Bread'], [10, 'Trait', () => 'Orb-touched']];
  const SWAP = [{ opacity: 0, filter: 'blur(4px)', letterSpacing: '3px' }, { opacity: 1, filter: 'none', letterSpacing: 'normal' }];
  const ROW_IN = [{ opacity: 0, transform: 'translateX(-14px)', background: 'rgba(124,196,176,.35)' }, { opacity: 1, transform: 'none' }];
  // The Orb card's crack (shown while .rt-cracked).
  const CRACK_SVG = '<svg class="rt-crack-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + [['58,0 55,20 60,33 52,50 56,62 49,100', 'rgba(0,0,0,.7)', 1.2, ''],
    ['58,0 55,20 60,33 52,50 56,62 49,100', 'rgba(124,196,176,.35)', .6, ' transform="translate(.8,0)"'], ['60,33 66,40 68,50', 'rgba(0,0,0,.55)', .9, '']]
    .map(([pt, c, w, t]) => `<polyline points="${pt}" fill="none" stroke="${c}" stroke-width="${w}" vector-effect="non-scaling-stroke"${t}/>`).join('') + '</svg>';
  const VOID_IN = [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 1, transform: 'none' }];
  const pool = OW.Workers.createPool(0, ID);
  const $ = (id) => document.getElementById(id);
  let mount = null, discovered = false, prog = 0, cracked = false, orbed = false, torches = 0, kneel = false, touched = false, risen = false;
  let firstFalling = false; // display only: the first torch is still in the air
  const walkers = () => pool.getAssigned(ID);
  const end = () => (cracked ? TIME : MID);           // where the walk stops right now
  const claimable = () => (!cracked ? prog >= MID : !orbed && prog >= TIME);
  const walking = () => walkers() > 0 && prog < end();
  const rate = () => OW.Upgrades.workerRate(walkers(), 1, 1, 0);
  const rateText = () => (walking() ? `Exploring ${OW.Upgrades.formatRate(rate())}/s` : '');
  const shard = () => OW.Resources.get(PREFIX + 'shard');
  const ready = () => pool.getIdleCount() >= PILGRIMS + 1 && shard() >= 1 - 1e-9;
  const say = (...lines) => lines.forEach((l) => OW.Footer.push(l));
  const closeIf = (m) => { if (OW.Cards.isModalOpenFor(m.id)) OW.Cards.closeModal(); };
  const hs = (title, side, body) => `<div class="hs-card"><div class="hs-head"><span class="hs-title">${title}</span><span class="upgrade-costtime">${side}</span></div><div class="hs-body">${body}</div></div>`;
  const desc = (t) => `<span class="upgrade-desc">${t}</span>`;

  function card(id, o) {
    const m = Object.assign({ id, section: 'Temple Ruins', modalTheme: 'theme-temple', workerPool: pool, startHidden: true,
      stepperReady: () => false, getStatText: () => '', getUpgradeBarPct: () => 0, hideUpgradeBar: () => true,
      tick() { OW.Cards.refresh(m); } }, o);
    OW.Mechanics.register(m);
    return m;
  }

  /* ---- Cards ---- */
  const q = (sel) => document.querySelector('#card-modal-body ' + sel);
  // The bar runs in two legs so the Crack triangle sits at AT% though it is reached at MID s.
  const pct = () => (prog <= MID ? prog / MID * AT : AT + (prog - MID) / (TIME - MID) * (100 - AT));
  const tri = (at, lab, got) => { const r = prog >= at ? ' reached' : '', e = at === TIME ? ' end' : '', x = at === TIME ? 100 : AT;
    return `<span class="rtp-tri${r}${e}" style="left:${x}%"></span><span class="rtp-lab${r}${e}" style="left:${x}%">${lab}${got ? ' ✓' : ''}</span>`; };
  const pathHTML = () => `<div class="bare-section">
      <div class="bare-row"><span class="bare-label">Explore the sanctum</span></div>
      <div class="detail-card-desc">Pillars lean against each other. Something is waiting further in.</div>
      <div class="rtp-track">${tri(MID, 'Crack', cracked)}${tri(TIME, 'Orb', orbed)}
        <div class="detail-progress-wrap"><div class="detail-progress-bar" data-extra-track="rtp"></div></div></div>
      <div class="rt-row rtp-foot"><button class="action-btn" data-rt="${cracked ? 'orb' : 'crack'}"${claimable() ? '' : ' disabled'}>${cracked ? 'Orb' : 'Crack in the Floor'}</button></div>
    </div>`;
  const short = (have, need) => `<span${have < need ? ' class="sp-short"' : ''}>${Math.max(0, Math.min(need, have))}/${need}</span>`;
  const reqHTML = () => { const idle = pool.getIdleCount(); return [short(idle, PILGRIMS), short(idle - PILGRIMS, 1), short(Math.floor(shard() + 1e-9), 1)]; };
  const ceremonyHTML = () => { const r = reqHTML();
    return hs('The Ceremony', '', desc('Gather a pilgrimage of workers to witness and one to set the Shard.') +
      `<div class="ts-box sp-req-box">${['Pilgrimage (idle workers)', 'Shard bearer (idle worker)', 'Shard'].map((k, i) =>
        `<div class="sp-req-row"><span>${k}</span><span data-rt-req="${i}">${r[i]}</span></div>`).join('')}</div>
      <button class="action-btn rtp-begin" data-rt="begin"${ready() ? '' : ' disabled'}>Begin Ceremony</button>`); };

  const temple = card(ID, {
    cardName: () => 'Temple Ruins',
    getStatText: () => (orbed ? 'Awaiting the ceremony' : walking() ? rateText() : claimable() ? 'Something found' : walkers() ? 'Stopped' : ''),
    stepperReady: () => true, getWorkerDesc: rateText,
    getUpgradeBarPct: pct, hideUpgradeBar: () => orbed,
    getExtraBars: () => (orbed ? [] : [{ id: 'rtp', pct: pct() }]),
    isBillable: walking,
    renderModalHTML: () => (orbed ? ceremonyHTML() : pathHTML()),
    patchLiveTrack() {
      reqHTML().forEach((h, i) => { const e = q(`[data-rt-req="${i}"]`); if (e && e.innerHTML !== h) e.innerHTML = h; });
      const b = q('[data-rt="begin"]'); if (b) b.disabled = !ready();
    },
    tick(goldAvailable, tickRate) {
      if (discovered && walking() && goldAvailable && tickRate) {
        const was = claimable();
        prog = Math.min(end(), prog + rate() * tickRate);
        if (end() - prog < 1e-9) prog = end(); // no 9.999… stall short of a triangle
        if (prog >= TIME) while (pool.unassign(ID)); // the walkers come back at the end
        if (!was && claimable()) { say(cracked ? 'At the far end of the sanctum: an orb.' : 'A little way in, the floor is split.'); OW.Cards.refreshOpenModal(ID); }
      }
      sync();
      OW.Cards.refresh(temple);
    }
  });

  const levelHTML = () => `<div class="lv"><div class="lv-top"><span class="lv-name"><span class="lv-new">The Shard Bearer</span></span><span class="lv-num"><small>LEVEL</small><span>10</span></span></div>
    <div class="detail-progress-wrap"><div class="detail-progress-bar lv-bar" data-track="rt-lv" style="width:100%"></div></div>
    <div class="lv-stats">${MILESTONES.map(([, k, v]) => `<div class="lv-row"><span><span class="tag">NEW</span><span class="k">${k}</span></span><span class="v">${v(10)}</span></div>`).join('')}</div>
    </div>`;

  const orb = card('rt_orb', {
    noPin: true,
    cardName: () => 'Orb',
    getStatText: () => (risen ? 'Waking' : 'Cracked'),
    renderModalHTML: () => touched ? levelHTML() : hs('Orb', 'Cracked', desc('A smooth sphere pulsing a faint light. A thin crack runs through the Orb.'))
  });

  // Unused (kept): nothing reveals the Altar any more.
  const altar = card('rt_altar', {
    noPin: true,
    cardName: () => risen ? 'The Shard Bearer' : 'Altar',
    getStatText: () => risen ? 'Standing' : kneel ? 'Kneeling' : 'Empty',
    renderModalHTML() {
      if (kneel) return hs('TBD', 'Kneeling', desc('TBD kneels at the altar, facing the orb.'));
      const idle = pool.getIdleCount() > 0;
      return `<div class="rt-pick"><span class="rt-note">Choose who kneels here. They will not come back the same.</span>${[0, 1, 2].map(() =>
        hs('TBD', 'Worker', desc('TBD.') + `<button class="action-btn" data-rt="pick"${idle ? '' : ' disabled'}>Choose</button>`)).join('')}${idle ? '' : '<span class="rt-note">Needs an idle worker in the Temple Ruins</span>'}</div>`;
    }
  });

  const freefall = card('rt_freefall', {
    modalTheme: 'theme-below', cardThemeClass: 'rt-freefall',
    cardName: () => 'Crack in the Floor',
    getStatText: () => torches && !firstFalling ? 'Torchlight far below' : 'No bottom in sight',
    renderModalHTML: () => hs('The fall', `${torches} torch${torches === 1 ? '' : 'es'} dropped`,
      desc(torches ? 'A long drop. Torches land far below and burn for a while.' : 'You cannot see the bottom.') +
      '<button class="action-btn rt-end" data-rt="drop">Drop torch</button>')
  });

  /* ---- State → page (every tick, load and scene end) ---- */
  function vis(m, want) {
    if (!m.els || !!m.revealed === want || (!want && OW.Motion.owned(m.els.wrap))) return;
    if (want) OW.Cards.reveal(m); else OW.Cards.hide(m);
  }
  // Like vis(): never hides what a scene owns, but puts a held section in place (still invisible) so the scene can fade it in.
  function disp(el, want) { const v = want ? '' : 'none'; if (el && !(!want && OW.Motion.owned(el)) && el.style.display !== v) el.style.display = v; }
  function sync() {
    disp($('ruinedtemple-section'), discovered);
    disp($('left-hand-ruinedtemple-group'), discovered);
    if (discovered) disp($('camp-section-label'), true);
    disp($('thebelow-section'), cracked);
    vis(OW.Mechanics.get('rt_scoutstable'), discovered);
    vis(temple, discovered && !risen);
    vis(orb, orbed && !risen);
    vis(altar, false);
    vis(freefall, cracked && !risen);
    vis(OW.TheBelow.card, risen);
    if (!orb.els) return;
    if (!OW.Motion.owned(orb.els.wrap)) orb.els.wrap.classList.toggle('rt-cracked', orbed && !risen); // the ceremony scene mends it first
    orb.els.wrap.classList.toggle('mo-pulse', kneel && !touched);
    [orb, altar].forEach((m) => m.els.statEl.classList.toggle('rt-jade', kneel));
    const label = $('thebelow-label');
    if (risen && !OW.Motion.owned(label)) OW.Motion.fracture(label, 2);
  }

  /* ---- Steps and their scenes ---- */
  // Claim the middle triangle: the modal closes and the floor breaks open.
  function claimCrack() {
    if (cracked || prog < MID) return;
    cracked = true;
    say('The floor gives way. There is no bottom.', 'Below the temple: The Below.');
    OW.Cards.closeModal();
    OW.Motion.scene(async (s) => {
      const ff = s.hold(freefall.els.wrap), below = s.hold($('thebelow-section')), torch = s.hold(ff.querySelector('.rt-face-btn'));
      sync();
      await s.shake(temple.els.wrap, 5, 420);
      s.style(ff, 'pointer-events', 'none'); // Drop torch (face or window) waits for the last black box
      s.show(ff);
      s.show(below, { ms: 400, dy: 0 });
      const vs = OW.TheBelow.voids(); // one by one, about a second in all
      await Promise.all(vs.map((v, i) => s.anim(v, VOID_IN, { duration: 300, delay: 100 + i * 600 / vs.length, easing: 'ease-out', fill: 'backwards' })));
      await s.show(torch, { ms: 300, dy: 0 });
    }, sync);
  }
  // Claim the end triangle: the Orb card, cracked; the modal turns to The Ceremony.
  function claimOrb() {
    if (!cracked || orbed || prog < TIME) return;
    orbed = true;
    say('You find an orb on a plinth. It is cracked.');
    sync();
    OW.Cards.refreshOpenModal(ID);
  }

  function dropTorch() {
    if (!cracked || risen) return;
    const first = ++torches === 1;
    say(first ? 'You drop a torch into the fall.' : 'Another torch falls.');
    if (first) say('The torch lands far below. It is still burning.');
    closeIf(freefall);
    OW.Motion.scene(async (s) => {
      const ff = freefall.els.wrap, p = s.pos(ff);
      if (first) firstFalling = true;
      sync();
      OW.Cards.refresh(freefall);
      const t = s.token({ name: 'Torch', stat: 'Falling', cls: 'rt-torch' }, { x: p.x, y: p.y + p.h + 4, w: p.w });
      s.follow(() => t.y + 25, .14);
      await s.fall(t, s.pos($('grid-thebelow')).y - 6, { ms: 2600, sway: 3, onStep: (cy) => s.light(OW.TheBelow.voids(), cy, TORCH, 1) });
      t.el.querySelector('.card-stat').textContent = 'Burning';
      s.shake(t.el, 3, 260);
      if (first) { firstFalling = false; OW.Cards.refresh(freefall); }
      await s.wait(900);
      s.unfollow();
      await s.anim(t.el, [{ opacity: 1 }, { opacity: .3 }, { opacity: .8 }, { opacity: 0 }], { duration: 900 });
      t.el.remove();
      await s.panTo(risen ? $('grid-thebelow') : ff, 900);
    }, () => { firstFalling = false; sync(); OW.Cards.refresh(freefall); });
  }

  function choose() {
    if (kneel || !pool.getIdleCount()) return;
    pool.assign('rt_altar'); pool.sequester('rt_altar'); // the worker leaves the temple for good
    kneel = true;
    say('TBD kneels at the altar.');
    closeIf(altar);
    sync(); OW.Cards.refresh(altar); OW.Cards.refresh(orb);
  }

  function touch() {
    if (!kneel || touched) return;
    touched = true;
    say('TBD touches the orb.', 'TBD is now The Shard Bearer.');
    sync();
    if (!OW.Cards.isModalOpenFor(orb.id)) return;
    OW.Cards.refreshOpenModal(orb.id);
    const body = $('card-modal-body'), q = (sel) => body.querySelector(sel);
    OW.Motion.scene(async (s) => {
      s.watch(q('.lv')); // closing the window ends the level-up; reopening shows it finished
      const name = q('.lv-name'), num = q('.lv-num span'), bar = q('.lv-bar'), rows = [...body.querySelectorAll('.lv-row')];
      rows.forEach((r) => s.hold(r));
      name.textContent = 'TBD'; num.textContent = 0; bar.style.width = '0%';
      await s.wait(500);
      for (let l = 1; l <= 10; l++) {
        await s.tween(Math.max(220, 620 - l * 45), (k) => { bar.style.width = k * 100 + '%'; });
        num.textContent = l;
        num.parentNode.classList.remove('bump'); void num.offsetWidth; num.parentNode.classList.add('bump');
        rows[0].querySelector('.v').textContent = 20 + l * 20;
        const i = MILESTONES.findIndex(([at]) => at === l);
        if (i >= 0) { s.show(rows[i], { ms: 450, frames: ROW_IN }); await s.wait(380); }
      }
      await s.wait(500);
      name.innerHTML = '<s>TBD</s>';
      await s.wait(650);
      name.innerHTML = '<span class="lv-new">The Shard Bearer</span>';
      s.anim(name.firstChild, SWAP, { duration: 700, easing: 'ease' });
    });
  }

  // The Ceremony: the bearer leaves for good, the pilgrims stay.
  function begin() {
    if (!orbed || risen || !ready()) return;
    OW.Resources.spend(PREFIX + 'shard', 1);
    pool.assign('blessed'); pool.sequester('blessed');
    risen = true;
    say('The Shard is set into the orb.', 'The orb breaks.', 'The Shard Bearer lands in The Below.');
    OW.Cards.closeModal();
    OW.Motion.scene(async (s) => {
      const w = (m) => m.els.wrap, label = s.own($('thebelow-label')), blessed = s.hold(w(OW.TheBelow.card));
      [temple, freefall, orb].forEach((m) => s.own(w(m)));
      sync();
      await s.panTo(label, 600);
      // The Shard mends the crack: its lines fill white, then fade.
      const svg = w(orb).querySelector('.rt-crack-svg');
      s.cls(w(orb), 'rt-cracked');
      await Promise.all([...svg.children].map((l) => s.anim(l, [{ stroke: l.getAttribute('stroke') }, { stroke: '#fff', strokeWidth: 2 }], { duration: 900, easing: 'ease-in', fill: 'forwards' })));
      await s.anim(svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 250, fill: 'forwards' });
      await s.fill(w(orb), 2800);
      await s.wait(450);
      for (let i = 0; i < 3; i++) {
        s.fracture(label, i); s.shake(label, 2 + i * 2, 300);
        await s.shake(w(orb), 4 + i * 4, 300 + i * 60);
        if (i < 2) await s.wait(320);
      }
      const p = s.pos(w(orb));
      s.burst(w(orb));
      s.anim(w(orb), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.12)' }], { duration: 260, fill: 'forwards' });
      await s.wait(120);
      const f = s.token({ name: 'The Shard Bearer', stat: 'Falling', cls: 'rt-blessed' }, p);
      s.collapse(w(orb), 300);
      await s.wait(10); // 0.13 s into the flash: Temple Ruins and Crack in the Floor go with the orb
      await Promise.all([s.collapse(w(temple), 300), s.collapse(w(freefall), 300)]);
      s.follow(() => f.y + 25, .2);
      await s.fall(f, s.pos(blessed).y, { ms: 3400, sway: 4, onStep: (cy) => s.light(OW.TheBelow.voids(), cy, PALE, .9) });
      s.unfollow();
      await s.land(f, blessed, { bounce: 10 });
      s.shake(blessed, 6, 360);
      await s.panTo($('grid-thebelow'), 900);
    }, sync);
  }

  // Modal buttons (and pinned Free Fall panels): one delegated listener.
  const ACTIONS = { drop: dropTorch, crack: claimCrack, orb: claimOrb, begin, pick: choose, touch };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rt]');
    if (b && !b.disabled && ACTIONS[b.dataset.rt]) ACTIONS[b.dataset.rt]();
  });

  function build(railMount, grid) {
    mount = railMount;
    pool.init(railMount);
    [temple, orb, freefall, altar].forEach((m) => grid.appendChild(OW.Cards.build(m)));
    orb.els.wrap.querySelector('.card').insertAdjacentHTML('beforeend', CRACK_SVG);
    const btn = freefall.els.wrap.querySelector('.card').appendChild(document.createElement('button'));
    btn.className = 'action-btn rt-face-btn'; btn.textContent = 'Drop torch';
    btn.addEventListener('click', (e) => { e.stopPropagation(); dropTorch(); });
  }

  function ensureResource(baseId, name) {
    const id = PREFIX + baseId;
    OW.Resources.ensure(id, { name, mount, current: 0, hidden: false });
    return id;
  }
  function reveal() { if (!discovered) { discovered = true; sync(); } }

  // Workers save with the pool (js/core/workers.js).
  OW.Save.register(ID, () => ({ d: +discovered, p: prog, c: +cracked, b: +orbed, t: torches, k: +kneel, o: +touched, r: +risen }), (d) => {
    discovered = !!d.d; prog = d.p || 0; cracked = !!d.c; orbed = !!d.b; torches = d.t || 0; kneel = !!d.k; touched = !!d.o; risen = !!d.r;
    firstFalling = false;
    sync();
  });

  OW.RuinedTemple = {
    id: ID, label: 'Temple Ruins', prefix: PREFIX, workerPool: pool, travelScale: 4, // trips to or from here take 4× as long
    isDiscovered: () => discovered, isRisen: () => risen, addWorkers: (n) => pool.addWorkers(n), ensureResource, reveal, build
  };
  OW.Locations.register(OW.RuinedTemple);
})();
