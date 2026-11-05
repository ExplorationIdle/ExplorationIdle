/* Camp's Strange Shard card: added by the Research Bench's first page.
   Its modal shows "Show your future": the modal closes and Temple+ plays
   (js/mechanics/templeplus.js) — the jade reveal, then the player presses
   Drop torch, then the dissolve — and the modal reopens with "Take the Shard",
   which closes it, adds 1 Shard (its left-hand row glows) and removes the card for good.
   Steps are saved at the click (0 none, 1 added, 2 vision started, 3 taken);
   "Take the Shard" shows once Temple+ reports its torch dropped, so an
   offline/replay run (scenes skipped) lands in the same place.
   The Shard's rail band, expanded, shows only Near and Far (Rates.expand):
   Near replays the first glimpse (js/core/strangeshard.js) for cards not yet
   revealed; Far replays Temple+. Each is ignored while its own vision is
   still under way (glimpse counting down; Temple+ waiting for the torch). */
(function () {
  'use strict';
  const OW = window.OrbWeaver, ID = 'shardcard';
  let step = 0;

  const sync = () => { if (mechanic.els && mechanic.revealed !== (step === 1 || step === 2)) (mechanic.revealed ? OW.Cards.hide : OW.Cards.reveal)(mechanic); };
  const seenFuture = () => step === 2 && OW.TemplePlus.used();

  function add() { if (step) return; step = 1; sync(); }
  function future() {
    if (step !== 1 && !(step === 2 && !OW.TemplePlus.used())) return;
    if (step === 1) { step = 2; OW.Footer.push('The Shard shows you something far below.'); }
    OW.Cards.closeModal();
    // UI only: reopen this modal once the torch scene ends (the step above is already saved).
    OW.TemplePlus.vision(() => { if (step === 2 && mechanic.revealed) OW.Cards.open(mechanic); });
  }
  function take() {
    if (!seenFuture()) return;
    step = 3;
    OW.Cards.closeModal();
    OW.Resources.add('shard', 1);
    OW.Footer.push('You take the Shard.');
    sync();
    const band = document.querySelector('.res-band[data-res="shard"]');
    if (band) OW.Motion.scene((s) => s.glow(band)); // view only: its left-hand row glows
  }

  function near(band) {
    if (OW.StrangeShard.active()) return;
    if (!OW.StrangeShard.start(band)) OW.Footer.push('The Shard shows nothing new.');
  }
  const far = () => { if (!OW.TemplePlus.waiting()) OW.TemplePlus.vision(); };
  OW.Rates.expand('shard', (el) => {
    el.innerHTML = '<div class="sc-sight"><button class="action-btn" data-sc-near>Near</button><button class="action-btn" data-sc-far>Far</button></div>';
    el.querySelector('[data-sc-near]').addEventListener('click', () => near(el.closest('.res-band')));
    el.querySelector('[data-sc-far]').addEventListener('click', far);
  });

  const mechanic = {
    id: ID, section: 'Camp', startHidden: true, noPin: true,
    cardName: () => 'Strange Shard',
    getStatText: () => (seenFuture() ? 'Ready to take' : step === 2 ? 'Showing your future' : ''),
    stepperReady: () => false,
    getUpgradeBarPct: () => 0,
    hideUpgradeBar: () => true,
    renderModalHTML: () => seenFuture()
      ? '<button class="action-btn" data-sc-take>Take the Shard</button>'
      : '<button class="action-btn" data-sc-future>Show your future</button>',
    afterRender() {
      const body = document.getElementById('card-modal-body');
      const f = body.querySelector('[data-sc-future]'), t = body.querySelector('[data-sc-take]');
      if (f) f.addEventListener('click', future);
      if (t) t.addEventListener('click', take);
    },
    tick() { sync(); OW.Cards.refresh(mechanic); }
  };

  OW.Save.register(ID, () => ({ step }), (d) => { step = [0, 1, 2, 3].includes(d.step) ? d.step : 0; sync(); });
  OW.Mechanics.register(mechanic);
  OW.ShardCard = { add, step: () => step };
})();
