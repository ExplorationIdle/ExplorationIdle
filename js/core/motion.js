/* ============================================================
   CORE: MOTION — reusable card animation kit. Display only: nothing
   here reads or writes game state, so a skipped or cancelled scene
   never changes the game.

   Contract for a mechanic:
   1. Change state first (click or tick), then call Motion.scene(fn, done).
   2. Inside fn, before applying the new state: s.own(el) for anything that
      should stay as it was while it animates out, s.hold(el) for anything
      arriving (kept invisible until s.show / s.land). Then sync the DOM to
      the new state; a sync must skip Motion.owned(el) elements.
   3. Everything a scene adds (copies, overlays, classes, inline styles,
      animations, the camera) is removed when it ends; done() runs first,
      so the mechanic's sync gets the final word.
   Real cards only receive temporary animations, classes and overlays;
   anything that moves is a copy in #right-hand (its last children, so
   recorder paths of real elements never shift).

   Skipped (fn never runs, done() runs at once) during offline catch-up,
   replays, hidden tabs and browsers without element.animate. Save load
   cancels every scene. Times come from requestAnimationFrame stamps,
   never the wall clock.

   Parts: Camera (follow/panTo/unfollow; any wheel, touch, key or pointer
   press hands it to the player for the rest of that scene) · Scenes · Movers (ghost/token/fall/land) ·
   Effects (shake, show, collapse, dissolve, fill, burst, flash, glow, riffle, light, fracture).
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const RH = () => document.getElementById('right-hand');
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ease = { io: (x) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, out: (x) => 1 - Math.pow(1 - x, 3), in2: (x) => x * x };
  const ABORT = { abort: true };
  const owners = new Map(); // element -> count of scenes owning it
  const scenes = new Set();

  const skip = () => document.hidden || !!OW.Replay || !document.body.animate || !!(OW.Offline && OW.Offline.isReplaying());

  // Layout position inside #right-hand's scroll content, in its own (unzoomed) px.
  function pos(el) {
    let x = 0, y = 0, e = el;
    const rh = RH();
    while (e && e !== rh) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  /* ---- Camera: one owner; the newest request wins ---- */
  const INPUTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];
  let cam = null, seizes = 0;
  // The player scrolled, tapped or pressed a key: the camera is theirs, and a
  // scene that was steering it never takes it back (s.follow / s.panTo no-op).
  function seize() { if (cam) seizes++; setCam(null); }
  function setCam(c) {
    if (cam && cam.res) cam.res();
    if (!cam && c) INPUTS.forEach((t) => window.addEventListener(t, seize, { capture: true, passive: true }));
    if (cam && !c) INPUTS.forEach((t) => window.removeEventListener(t, seize, { capture: true }));
    cam = c;
    if (c) requestAnimationFrame((ts) => camStep(c, ts));
  }
  function camStep(c, ts) {
    if (cam !== c) return;
    const rh = RH(), center = (y) => y - rh.clientHeight / 2;
    if (c.pan) {
      if (c.t0 == null) { c.t0 = ts; c.from = rh.scrollTop; }
      const k = cl((ts - c.t0) / c.ms);
      rh.scrollTop = c.from + (center(c.y()) - c.from) * ease.io(k);
      if (k >= 1) return setCam(null);
    } else rh.scrollTop += (center(c.y()) - rh.scrollTop) * c.stiff;
    requestAnimationFrame((t) => camStep(c, t));
  }
  const yOf = (t) => typeof t === 'function' ? t : () => { const p = pos(t); return p.y + p.h / 2; };
  function follow(target, stiff = 0.16) { setCam({ y: yOf(target), stiff }); return cam; }
  function panTo(el, ms = 700) { return new Promise((res) => setCam({ y: yOf(el), pan: true, ms, res })); }
  function unfollow() { setCam(null); }

  /* ---- Light: glows that fade by themselves (CSS reads --mo-lit / --mo-rgb) ---- */
  const lit = new Map();
  function light(els, cy, rgb, power = 1) {
    const start = !lit.size;
    els.forEach((v) => {
      const p = pos(v), l = Math.max(lit.get(v) || 0, power * cl(1 - Math.abs(p.y + p.h / 2 - cy) / 150));
      if (l <= .002) return;
      lit.set(v, l); v.style.setProperty('--mo-rgb', rgb); v.style.setProperty('--mo-lit', l.toFixed(3));
    });
    if (start && lit.size) requestAnimationFrame(fade);
  }
  function fade() {
    lit.forEach((l, v) => {
      l *= .955;
      if (l > .002) { lit.set(v, l); v.style.setProperty('--mo-lit', l.toFixed(3)); }
      else { lit.delete(v); v.style.removeProperty('--mo-lit'); v.style.removeProperty('--mo-rgb'); }
    });
    if (lit.size) requestAnimationFrame(fade);
  }

  /* ---- Fracture: a lasting effect. Idempotent, so a mechanic re-applies it from state. ---- */
  function fracture(el, stage) {
    if (el._fr && el._fr.stage === stage) return;
    if (!el._fr) {
      const t = el.firstChild, letters = [...t.textContent.trimStart()].map((ch) => {
        const s = document.createElement('span'); s.className = 'fr-l'; s.textContent = ch === ' ' ? ' ' : ch; return s;
      });
      t.replaceWith(...letters);
      el.classList.add('fr-on');
      const segs = [[0, .31], [.335, .64], [.665, 1]].map(([a, b]) => {
        const d = document.createElement('div'); d.className = 'fr-seg';
        d.style.left = a * 100 + '%'; d.style.width = (b - a) * 100 + '%'; el.appendChild(d); return d;
      });
      el._fr = { letters, segs };
    }
    const k = [.7, 1.6, 2.8][stage], s = stage + 1;
    el._fr.stage = stage;
    el._fr.letters.forEach((l, i) => {
      l.style.transform = `translate(${((i * 37) % 7 - 3) * k * .5}px, ${((i * 53) % 5 - 2) * k * .6}px) rotate(${((i * 29) % 9 - 4) * k}deg)`;
      l.style.opacity = stage === 2 && i % 3 === 1 ? .5 : '';
    });
    el._fr.segs.forEach((d, j) => { d.style.transform = `translateY(${j === 1 ? s * 1.5 : 0}px) rotate(${(j - 1) * s * .8}deg)`; });
  }

  /* ---- Scenes ---- */
  function scene(fn, done) {
    if (skip()) { if (done) done(); return Promise.resolve(); }
    const s = makeScene();
    s._done = done;
    scenes.add(s);
    return Promise.resolve().then(() => fn(s))
      .then(() => Promise.all(s.anims.map((a) => a.finished.catch(() => {}))))
      .catch((e) => { if (e !== ABORT) console.error('[Orb Weaver] Motion scene:', e); })
      .finally(() => s.end(done));
  }

  function makeScene() {
    let kill;
    const dead = new Promise((_, rej) => { kill = () => rej(ABORT); });
    dead.catch(() => {});
    const own = new Set(), nodes = [], classes = [], styles = [], anims = [];
    let watched = null, over = false, camera = null;
    const seized0 = seizes, taken = () => seizes > seized0;
    const check = () => { if (over || (watched && !watched.isConnected)) throw ABORT; };
    const race = (p) => Promise.race([p, dead]).then((v) => { check(); return v; });
    const s = {
      anims, ease, pos,
      abort() { over = true; kill(); },
      watch(el) { watched = el; },
      own(el) { if (el && !own.has(el)) { own.add(el); owners.set(el, (owners.get(el) || 0) + 1); } return el; },
      hold(el) { s.own(el); s.cls(el, 'mo-hold'); return el; },
      cls(el, c) { if (el && !el.classList.contains(c)) { el.classList.add(c); classes.push([el, c]); } return el; },
      style(el, prop, val) { styles.push([el, prop, el.style.getPropertyValue(prop)]); el.style.setProperty(prop, val); },
      add(node) { nodes.push(node); return node; },
      wait: (ms) => race(new Promise((r) => setTimeout(r, ms))),
      tween: (ms, fn) => race(new Promise((res) => {
        let t0 = null;
        const f = (ts) => {
          if (over) return res();
          if (t0 == null) t0 = ts;
          const k = cl((ts - t0) / ms); fn(k);
          k < 1 ? requestAnimationFrame(f) : res();
        };
        requestAnimationFrame(f);
      })),
      anim(el, frames, opts) { const a = el.animate(frames, opts); anims.push(a); return race(a.finished); },
      follow(target, stiff) { if (!taken()) camera = follow(target, stiff); },
      unfollow() { if (cam === camera) unfollow(); },
      panTo(el, ms) { if (taken()) return race(Promise.resolve()); const p = panTo(el, ms); camera = cam; return race(p); },
      light,
      fracture,

      /* Effects */
      shake(el, amp = 6, ms = 380) {
        const k = [];
        for (let i = 0; i <= 10; i++) { const a = amp * (1 - i / 10); k.push({ transform: `translate(${i % 2 ? -a : a}px, ${(i % 3 - 1) * a * .35}px) rotate(${(i % 2 ? -1 : 1) * a * .12}deg)` }); }
        return s.anim(el, k, { duration: ms, easing: 'linear' });
      },
      // Release a held element with a fade-up (dy 0: fade only).
      show(el, { delay = 0, ms = 420, dy = 10, frames } = {}) {
        el.classList.remove('mo-hold');
        return s.anim(el, frames || [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }], { duration: ms, delay, easing: 'ease-out', fill: 'backwards' });
      },
      // Shrink an owned element out of the flow; it stays collapsed until the scene ends.
      collapse(el, ms = 450) {
        const cs = getComputedStyle(el), gap = parseFloat(getComputedStyle(el.parentNode).rowGap) || 0;
        s.style(el, 'overflow', 'hidden');
        return s.anim(el, [{ height: el.offsetHeight + 'px', opacity: cs.opacity, marginTop: cs.marginTop }, { height: '0px', opacity: 0, marginTop: -gap + 'px' }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
      },
      // The "Show your future" exit: greys and dims, then shrinks out of the flow.
      // rgb ("r,g,b") fades it toward that color instead of grey (a themed exit).
      async dissolve(el, delay = 0, rgb) {
        await s.anim(el, rgb ? [{ opacity: 1 }, { opacity: .35, backgroundColor: `rgba(${rgb},.18)`, boxShadow: `inset 0 0 18px rgba(${rgb},.35)` }]
          : [{ opacity: 1, filter: 'none' }, { opacity: .35, filter: 'grayscale(1)' }], { duration: 350, delay, fill: 'forwards' });
        await s.collapse(el, 450);
      },
      // A colored overlay sweeps across el left to right while it glows (--mo-k).
      fill(el, ms, rgb = '244,241,234') {
        const o = s.add(document.createElement('div'));
        o.className = 'mo-fill'; o.style.background = `rgb(${rgb})`; el.appendChild(o);
        s.cls(el, 'mo-charge'); s.style(el, '--mo-rgb', rgb); s.style(el, '--mo-k', 0);
        return s.tween(ms, (k) => { o.style.width = k * 100 + '%'; el.style.setProperty('--mo-k', k); });
      },
      // One white flash centered on el (screen space, so it sits above everything).
      burst(el, size = 520) {
        const r = el.getBoundingClientRect(), z = parseFloat(getComputedStyle(RH()).zoom) || 1, d = size * z;
        const b = s.add(document.createElement('div'));
        b.className = 'mo-burst';
        Object.assign(b.style, { width: d + 'px', height: d + 'px', left: r.left + r.width / 2 - d / 2 + 'px', top: r.top + r.height / 2 - d / 2 + 'px' });
        document.body.appendChild(b);
        return s.anim(b, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(.8)', offset: .25 }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 750, easing: 'ease-out' });
      },

      // A glow in el's own --tier colour pulses once over it (an upgrade landed there).
      flash(el, ms = 1100) {
        const o = s.add(document.createElement('div'));
        o.className = 'mo-flash'; el.appendChild(o);
        return s.anim(o, [{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
      },

      // el's own background and edge glow once in its --tier colour (a soft row highlight; text stays readable).
      glow(el, ms = 1400) {
        const cs = getComputedStyle(el), c = cs.getPropertyValue('--tier').trim() || '#a08858', bg = cs.backgroundColor;
        return s.anim(el, [{ backgroundColor: bg, boxShadow: 'inset 0 0 0 0 transparent' },
          { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, boxShadow: `inset 0 0 12px 1px ${c}`, offset: .25 },
          { backgroundColor: bg, boxShadow: 'inset 0 0 0 0 transparent' }], { duration: ms, easing: 'ease-out' });
      },

      // The cards (sel) in box squeeze to its centre, gone(el) ones fading out; mid() redraws and returns
      // the new box, whose cards fan back out from that centre to their places.
      // Moves with the translate/scale properties, so a layout that pins transform (phone column) still slides.
      async riffle(box, sel, gone, mid, ms = 320) {
        const off = (b, el) => { const c = b.getBoundingClientRect(), r = el.getBoundingClientRect(), k = c.width / b.offsetWidth || 1;
          return `${(c.left + c.width / 2 - r.left - r.width / 2) / k}px ${(c.top + c.height / 2 - r.top - r.height / 2) / k}px`; };
        s.own(box);
        await Promise.all([...box.querySelectorAll(sel)].map((el) => s.anim(el, [{ translate: '0 0', scale: 1, opacity: 1 },
          { translate: off(box, el), scale: .96, opacity: gone(el) ? 0 : 1 }], { duration: ms, easing: 'ease-in', fill: 'forwards' })));
        const nb = mid();
        if (!nb) return;
        s.own(nb);
        await Promise.all([...nb.querySelectorAll(sel)].map((el) => s.anim(el, [{ translate: off(nb, el), scale: .96 },
          { translate: '0 0', scale: 1 }], { duration: ms * 1.3, easing: 'ease-out' })));
      },

      /* Movers: copies only, positioned absolutely in #right-hand */
      fly(el, at) {
        s.add(el); el.classList.remove('mo-hold'); el.classList.add('mo-fly'); el.setAttribute('inert', '');
        Object.assign(el.style, { left: at.x + 'px', top: at.y + 'px', width: at.w + 'px' });
        RH().appendChild(el);
        return { el, x: at.x, y: at.y };
      },
      ghost: (el) => s.fly(el.cloneNode(true), pos(el)),
      // A temporary card in the game's own markup (a torch, a stone...).
      token({ name = '', stat = '', cls = '' }, at) {
        const w = document.createElement('div');
        w.className = 'card-wrap ' + cls;
        w.innerHTML = '<div class="card"><div class="card-body"><div class="card-name"></div><div class="card-stat"></div></div></div>';
        w.querySelector('.card-name').textContent = name; w.querySelector('.card-stat').textContent = stat;
        return s.fly(w, at);
      },
      // Gravity drop with a damped side sway; onStep(centerY) lets the world react.
      fall(f, toY, { ms = 3000, sway = 0, onStep } = {}) {
        const y0 = f.y;
        return s.tween(ms, (k) => {
          f.y = y0 + (toY - y0) * ease.in2(k);
          f.el.style.top = f.y + 'px';
          f.el.style.transform = sway ? `translateX(${Math.sin(k * 9) * sway * (1 - k)}px) rotate(${Math.sin(k * 7) * sway * .15}deg)` : '';
          if (onStep) onStep(f.y + f.el.offsetHeight / 2);
        });
      },
      // Settle a flying copy onto a held slot with a bounce, then reveal the real card there.
      async land(f, slot, { bounce = 8 } = {}) {
        const to = pos(slot), dx = f.x - to.x, dy = f.y - to.y;
        Object.assign(f.el.style, { left: to.x + 'px', top: to.y + 'px', transform: '' });
        await s.anim(f.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translateY(${bounce}px)`, offset: .7 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
        slot.classList.remove('mo-hold'); f.el.remove();
      },

      end(done) {
        if (s.ended) return;
        s.ended = over = true; scenes.delete(s);
        own.forEach((el) => { const n = owners.get(el) - 1; n ? owners.set(el, n) : owners.delete(el); });
        try { if (done) done(); } catch (e) { console.error('[Orb Weaver] Motion done:', e); }
        anims.forEach((a) => a.cancel());
        nodes.forEach((n) => n.remove());
        classes.forEach(([el, c]) => el.classList.remove(c));
        styles.reverse().forEach(([el, p, v]) => (v ? el.style.setProperty(p, v) : el.style.removeProperty(p)));
        if (camera && cam === camera) unfollow();
      }
    };
    return s;
  }

  // Abort every running scene (save load / import). Their done() still runs.
  function cancel() { scenes.forEach((s) => { s.abort(); s.end(s._done); }); lit.forEach((l, v) => { v.style.removeProperty('--mo-lit'); }); lit.clear(); }

  OW.Save.register('motion', null, () => cancel());
  OW.Motion = { scene, cancel, pos, ease, follow, panTo, unfollow, light, fracture, skip,
    owned: (el) => owners.has(el), running: () => scenes.size };
})();
