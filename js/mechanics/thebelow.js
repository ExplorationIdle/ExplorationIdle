/* ============================================================
   MECHANIC: THE BELOW (bottom section, near-black theme)
   A section only — not a location: no workers, no rail group, no cargo.
   Holds the shaft (SHAFT lightless boxes, plain DOM that js/core/motion.js
   light() glows as things fall past) and The Shard Bearer's card, which
   js/mechanics/ruinedtemple.js reveals once the fall has happened and
   whose heading it breaks for good. Content after landing: TBD.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const SHAFT = 26;

  const card = {
    id: 'blessed', section: 'The Below', modalTheme: 'theme-below', startHidden: true,
    stepperReady: () => false,
    cardName: () => 'The Shard Bearer',
    getStatText: () => '',
    getUpgradeBarPct: () => 0, hideUpgradeBar: () => true,
    renderModalHTML: () => '<div class="hs-card"><div class="hs-head"><span class="hs-title">The Shard Bearer</span></div></div>',
    tick() { OW.Cards.refresh(card); }
  };
  OW.Mechanics.register(card);

  function build(shaft, grid) {
    for (let i = 0; i < SHAFT; i++) shaft.appendChild(document.createElement('div')).className = 'rt-void mo-glow';
    grid.appendChild(OW.Cards.build(card));
  }

  OW.TheBelow = { card, build, voids: () => [...document.querySelectorAll('#thebelow-shaft .rt-void')] };
})();
