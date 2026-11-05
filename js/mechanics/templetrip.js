/* Temple Ruins Expedition: one trip, offered on Camp's and the Mountains' Trading Post
   Expedition tabs once the Research Bench's Temple Ruins page is done (TradingPost.trips).
   It takes 1 idle worker from that location and no resources; one click sends it, and that
   location's Expedition Mule card shows the trip (TRIP s, the Temple Ruins' 4× travel).
   On arrival the worker joins the Temple Ruins and the ruins are revealed.
   Saved: phase (idle / traveling / delivered), where it left from, time left. */
(function () {
  'use strict';
  const OW = window.OrbWeaver, TRIP = 30 * 4;
  // Departure point → its mule card and worker pool.
  const FROM = { camp: { id: 'templemule', section: 'Camp', pool: () => OW.Workers },
    mountains: { id: 'mtn_templemule', section: 'Mountains', pool: () => OW.Mountains.workerPool } };
  let phase = 'idle', from = null, left = 0;
  const ready = () => phase === 'idle' && OW.ResearchBench.has('templeruins');

  function go(loc) {
    const f = FROM[loc];
    if (!ready() || !f || !f.pool().assign(f.id)) return;
    f.pool().sequester(f.id); // away until arrival, then a Temple Ruins worker
    phase = 'traveling'; from = loc; left = TRIP;
    OW.Cards.reveal(OW.Mechanics.get(f.id));
    OW.Cards.closeModal();
    OW.Footer.push('The expedition mule has departed for the Temple Ruins.');
  }
  function arrive() {
    OW.Cards.hide(OW.Mechanics.get(FROM[from].id));
    phase = 'delivered';
    OW.RuinedTemple.reveal(); OW.RuinedTemple.addWorkers(1);
    OW.Footer.push('Expedition discovered the Temple Ruins.');
  }

  const short = (loc) => !FROM[loc].pool().getIdleCount();
  const need = (loc) => `<span${short(loc) ? ' class="sp-short"' : ''}>${Math.min(1, FROM[loc].pool().getIdleCount())}/1</span>`;
  OW.TradingPost.trips.push({
    html: (loc) => (FROM[loc] && ready() ? `<div class="hs-card"><div class="hs-head"><span class="hs-title">Temple Ruins Expedition</span></div>
      <div class="hs-body"><div class="detail-card-desc">Send a worker South, where the Shard points.</div>
        <div class="ts-box sp-req-box"><div class="sp-req-row"><span>Workers</span><span data-tt-need>${need(loc)}</span></div></div>
        <button class="action-btn" data-tt-go="${loc}"${short(loc) ? ' disabled' : ''}>Send Expedition</button></div></div>` : ''),
    patch(loc) {
      const el = document.querySelector('#card-modal-body [data-tt-need]'), b = document.querySelector(`#card-modal-body [data-tt-go="${loc}"]`);
      if (el) el.innerHTML = need(loc);
      if (b) b.disabled = short(loc);
    }
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-tt-go]'); if (b && !b.disabled) go(b.dataset.ttGo); });

  // One mule card per departure point; only the one that left shows and counts down.
  Object.entries(FROM).forEach(([loc, f]) => {
    const mine = () => phase === 'traveling' && from === loc;
    const mule = {
      id: f.id, section: f.section, startHidden: true, isMule: true, modalTheme: 'theme-mule', upkeepExempt: true,
      workerPool: f.pool(),
      cardName: () => 'Expedition Mule',
      getUpgradeBarPct: () => 0,
      stepperReady: () => false,
      getBuildBarPct: () => (mine() ? ((TRIP - left) / TRIP) * 100 : 0),
      getStatText: () => (mine() ? `To the Temple Ruins… ${Math.ceil(left)}s` : ''),
      patchBuildStatus: () => (mine() ? `${Math.ceil(left)}s remaining` : null),
      renderModalHTML: () => `<div class="hs-card"><div class="hs-head"><span class="hs-title">Expedition Mule</span></div><div class="hs-body">
        <div class="detail-card-desc">On expedition to the Temple Ruins…</div>
        <div class="detail-progress-wrap"><div class="detail-progress-bar"></div></div>
        <div class="detail-status"><span>${Math.ceil(left)}s remaining</span></div></div></div>`,
      tick(goldAvailable, tickRate) {
        if (!mine()) return;
        left -= tickRate;
        if (left <= 0) arrive(); else OW.Cards.refresh(mule);
      }
    };
    OW.Mechanics.register(mule);
  });

  OW.Save.register('templetrip', () => ({ p: phase, f: from, l: left }), (d) => {
    phase = ['traveling', 'delivered'].includes(d && d.p) ? d.p : 'idle';
    from = FROM[d && d.f] ? d.f : null; left = Number.isFinite(d && d.l) ? d.l : 0;
    if (phase === 'traveling' && !from) phase = 'idle';
    Object.entries(FROM).forEach(([loc, f]) => (phase === 'traveling' && from === loc ? OW.Cards.reveal : OW.Cards.hide)(OW.Mechanics.get(f.id)));
  });
})();
