/* ============================================================
   MECHANIC: TEMPLE RUINS TRADING POST
   Thin config for js/core/scoutstable.js — the same Trading Post as
   Camp's and Mountains', living at the top of the Temple Ruins section
   and drawing on its worker pool and resources (rt_ prefix). Trips to or
   from the ruins take 4× as long (RuinedTemple.travelScale).
   Shown once the Temple Ruins are discovered (js/mechanics/ruinedtemple.js).
   No initial Expedition (greyed tab), same as Mountains.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  OW.TempleScoutStable = OW.ScoutStable.create({
    id: 'rt_scoutstable',
    locationId: 'ruinedtemple',
    section: 'Temple Ruins',
    modalTheme: 'theme-temple',
    resourcePrefix: OW.RuinedTemple.prefix,
    workerPool: OW.RuinedTemple.workerPool,
    vehicleKinds: {
      mule:     { idBase: 'rt_resupplymule', cap: 200,  travel: 15,  label: 'Resupply Mule' },
      cartbull: { idBase: 'rt_cartbull',     cap: 1000, travel: 60,  label: 'Cart and Bull' }
    },
    hasInitialExpedition: false
  });
})();
