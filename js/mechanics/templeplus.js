/* ============================================================
   MECHANIC: TEMPLE+ (stage for the Strange Shard's "Show your future")
   A display-only copy of the Temple Ruins at the very bottom: no
   workers, no rail, not a location. On reveal a jade light travels down
   it top to bottom, the camera trailing, each piece fading up as the light
   passes (the "Show your future" look); then the camera returns to
   Crack in the floor (RETURN) and Drop torch becomes pressable.
   Temple Ruins and Orb (cracked, like the real one) show but can't be clicked; Crack in the floor (the old Free Fall) has
   one live control, its face Drop torch button, which works once per showing.
   The torch falls through The Below exactly like js/mechanics/
   ruinedtemple.js; as the camera pans back up, every card, black box and
   heading dissolves, fading toward the ruins' jade rather than grey. Saved: shown, used.
   vision(after) is the only way in (Strange Shard card, the Shard band's Far, the cheat): it
   plays Temple+ again after any earlier torch, and calls after() (view only) when the torch
   scene ends; if Temple+ is already waiting it just pans the camera to it. waiting(): shown,
   torch not yet dropped.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const TORCH = '232,184,74', LIGHT = '124,196,176', SHAFT = 26;
  const RETURN = true; // false: the camera stays at the bottom after the reveal
  const $ = (id) => document.getElementById(id);
  let shown = false, used = false, after = null;
  // The Orb's crack, the same drawing as the real Orb's (js/mechanics/ruinedtemple.js).
  const CRACK_SVG = '<svg class="rt-crack-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + [['58,0 55,20 60,33 52,50 56,62 49,100', 'rgba(0,0,0,.7)', 1.2, ''],
    ['58,0 55,20 60,33 52,50 56,62 49,100', 'rgba(124,196,176,.35)', .6, ' transform="translate(.8,0)"'], ['60,33 66,40 68,50', 'rgba(0,0,0,.55)', .9, '']]
    .map(([pt, c, w, t]) => `<polyline points="${pt}" fill="none" stroke="${c}" stroke-width="${w}" vector-effect="non-scaling-stroke"${t}/>`).join('') + '</svg>';

  const cards = [['tp_temple', 'Temple Ruins', 'Collapsed sanctum'], ['tp_orb', 'Orb', 'Cracked'], ['tp_crack', 'Crack in the floor', '']]
    .map(([id, name, stat]) => {
      const m = { id, section: 'Temple Ruins', cardThemeClass: { tp_crack: 'rt-freefall', tp_orb: 'rt-cracked' }[id] || '', stepperReady: () => false,
        cardName: () => name, getStatText: () => stat, getUpgradeBarPct: () => 0, hideUpgradeBar: () => true,
        renderModalHTML: () => '', tick() { OW.Cards.refresh(m); } };
      OW.Mechanics.register(m);
      return m;
    });
  const crack = cards[2];
  const sections = () => [$('templeplus-section'), $('templeplus-below')];
  const voids = () => [...document.querySelectorAll('#templeplus-shaft .rt-void')];

  function sync() {
    const v = shown && !used ? '' : 'none';
    sections().forEach((el) => { if (!OW.Motion.owned(el) && el.style.display !== v) el.style.display = v; });
  }

  function drop() {
    if (!shown || used) return;
    used = true;
    OW.Footer.push('You drop a torch into the fall.');
    OW.Motion.scene(async (s) => {
      sections().forEach((el) => s.own(el));
      s.hold(btn);
      sync();
      const ff = crack.els.wrap, p = s.pos(ff);
      const t = s.token({ name: 'Torch', stat: 'Falling', cls: 'rt-torch' }, { x: p.x, y: p.y + p.h + 4, w: p.w });
      s.follow(() => t.y + 25, .14);
      await s.fall(t, s.pos($('grid-templeplus-landing')).y - 6, { ms: 2600, sway: 3, onStep: (cy) => s.light(voids(), cy, TORCH, 1) });
      t.el.querySelector('.card-stat').textContent = 'Burning';
      s.shake(t.el, 3, 260);
      await s.wait(900);
      s.unfollow();
      await s.anim(t.el, [{ opacity: 1 }, { opacity: .3 }, { opacity: .8 }, { opacity: 0 }], { duration: 900 });
      t.el.remove();
      // The camera climbs back while the whole glimpse dissolves, lowest first.
      const pan = s.panTo(ff, 900);
      const parts = sections().flatMap((sec) => [...sec.querySelectorAll('.section-label, .card-wrap, .rt-void')]).reverse();
      await Promise.all([pan, ...parts.map((el, i) => s.dissolve(el, Math.min(i * 25, 600), LIGHT))]);
    }, () => { sync(); const f = after; after = null; if (f) f(); });
  }

  let btn = null;
  function build(grid, shaft) {
    cards.forEach((m) => { grid.appendChild(OW.Cards.build(m)); m.els.wrap.setAttribute('inert', ''); });
    cards[1].els.wrap.querySelector('.card').insertAdjacentHTML('beforeend', CRACK_SVG);
    // The face button sits on the wrap, outside the inert card, so it is the one live control.
    crack.els.wrap.removeAttribute('inert');
    crack.els.wrap.querySelector('.card').setAttribute('inert', '');
    btn = crack.els.wrap.appendChild(document.createElement('button'));
    btn.className = 'action-btn tp-face-btn'; btn.textContent = 'Drop torch';
    btn.addEventListener('click', drop);
    for (let i = 0; i < SHAFT; i++) shaft.appendChild(document.createElement('div')).className = 'rt-void mo-glow';
  }

  function reveal() {
    OW.Motion.scene(async (s) => {
      const items = sections().flatMap((sec) => [...sec.querySelectorAll('.section-label, .card-wrap, .rt-void')]).map((el) => ({ el: s.hold(el) }));
      s.hold(btn);
      items.forEach(({ el }) => { if (!el.classList.contains('section-label')) s.cls(el, 'mo-glow'); });
      sync();
      items.forEach((it) => { const p = s.pos(it.el); it.y = p.y + p.h / 2; });
      const y0 = items[0].y, y1 = items[items.length - 1].y, lit = items.map((it) => it.el).filter((el) => el.classList.contains('mo-glow'));
      let y = y0;
      s.follow(() => y, .14);
      await s.tween(Math.max(2500, Math.min(5000, 1200 + (y1 - y0) * 1.2)), (k) => {
        y = y0 + (y1 - y0) * s.ease.io(k);
        s.light(lit, y, LIGHT, 1);
        items.forEach((it) => { if (!it.shown && it.y <= y + 30) { it.shown = true; s.show(it.el); } });
      });
      await s.wait(500);
      s.unfollow();
      if (RETURN) await s.panTo(crack.els.wrap, 900);
      s.show(btn, { ms: 300, dy: 0 });
    }, sync);
  }

  function vision(cb) {
    if (cb) after = cb;
    if (shown && !used) { OW.Motion.scene((s) => s.panTo(crack.els.wrap, 900)); return; }
    shown = true; used = false;
    reveal();
  }

  OW.Save.register('templeplus', () => ({ s: +shown, u: +used }), (d) => { shown = !!d.s; used = !!d.u; sync(); });
  OW.TemplePlus = { build, drop, vision, used: () => used, waiting: () => shown && !used };
})();
