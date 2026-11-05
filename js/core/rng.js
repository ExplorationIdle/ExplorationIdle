/* ============================================================
   CORE: SEEDED RANDOMNESS
   Replaces Math.random for every player, always (recording on or off),
   so the same seed + the same inputs give the same dice. sfc32 output,
   reseeded from hash(seed, tick) at the start of every loop tick
   (js/core/loop.js step), so a stray roll only shifts its own tick.

   Installed once at load; a later assignment to Math.random (tests)
   still wins. Any invalid output restores the browser's own random
   for the rest of the page load (Rng.fallback says why).

   Seed: new every page load (crypto, else native random) unless the
   cheat header's Seed box fixed one (key orbweaver.rng.v1). The seed is
   never saved. Applying a fixed seed marks the save as cheated.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver = window.OrbWeaver || {};
  const KEY = 'orbweaver.rng.v1', native = Math.random;
  const mix = (h) => { // murmur3 finalizer
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const toSeed = (v) => /^\d+$/.test(v) ? Number(v) >>> 0 : [...v].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  let a = 0, b = 0, c = 0, d = 0;
  function sfc32() {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11)) + t | 0;
    return (t >>> 0) / 4294967296;
  }
  function reseed() {
    a = mix(Rng.seed ^ 0x9e3779b9); b = mix((Rng.ticks + 0x6d2b79f5) ^ a); c = mix(a ^ b ^ 0x1b873593); d = 1;
    for (let i = 0; i < 12; i++) sfc32();
  }
  function random() {
    if (Rng.fallback) return native();
    const r = Rng.gen();
    if (r >= 0 && r < 1) { Rng.draws++; return r; }
    Rng.fallback = 'invalid output';
    return native();
  }

  let fixed = null;
  try { const v = localStorage.getItem(KEY); if (v !== null) fixed = toSeed(v); } catch (e) {}
  let seed = fixed;
  if (seed === null) {
    try { seed = crypto.getRandomValues(new Uint32Array(1))[0]; } catch (e) { seed = Math.floor(native() * 4294967296); }
  }

  const Rng = OW.Rng = {
    seed, ticks: 0, draws: 0, fixed, native, gen: sfc32, fallback: null,
    tick() { Rng.ticks++; if (!Rng.fallback) reseed(); },
    setSeed(s, ticks = 0) { Rng.seed = s >>> 0; Rng.ticks = ticks; reseed(); },
    getState: () => [Rng.seed, Rng.ticks, Rng.draws, a, b, c, d],
    setState(s) { [Rng.seed, Rng.ticks, Rng.draws, a, b, c, d] = s; }
  };
  reseed();
  Math.random = random;
  // Settings shows the seed once boot is settled (replay.js has set a recorded one by then).
  document.addEventListener('DOMContentLoaded', () => { const s = document.getElementById('build-seed'); if (s) s.textContent = Rng.seed; });

  // Cheat header Seed box: fixed seed = identical luck every reload. Blank = random.
  const box = document.getElementById('cheat-seed'), apply = document.getElementById('cheat-seed-apply');
  if (box && apply) {
    if (fixed !== null) box.value = fixed;
    apply.addEventListener('click', () => {
      const v = box.value.trim();
      try {
        if (v) { localStorage.setItem(KEY, String(toSeed(v))); OW.Save.markCheated(); OW.Save.saveToStorage(); }
        else localStorage.removeItem(KEY);
      } catch (e) {}
      location.reload();
    });
  }
})();
