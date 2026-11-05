/* js/core/motion.js: a scene leaves nothing behind (copies, overlays, classes,
   inline styles, animations, camera listeners), is skipped where it must be,
   and is cancelled by a save load or by its window closing. element.animate and
   requestAnimationFrame are stubbed; layout and looks are checked in a browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
let checks = 0, failures = 0;
async function test(name, fn) {
  try { await fn(); checks++; console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + '\n' + e.stack); }
}
function boot({ animate = true } = {}) {
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' }).window;
  let ts = 0, live = 0;
  const anims = [], listeners = new Map();
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(ts += 50), 0);
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.IntersectionObserver = class { observe() {} unobserve() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  if (animate) w.Element.prototype.animate = function () {
    const a = { cancelled: false, cancel() { this.cancelled = true; } };
    a.finished = new Promise((r) => setTimeout(r, 5)); anims.push(a); return a;
  };
  const add = w.addEventListener.bind(w), rem = w.removeEventListener.bind(w);
  w.addEventListener = (t, f, o) => { if (['wheel', 'touchmove', 'keydown', 'pointerdown'].includes(t)) listeners.set(t, (listeners.get(t) || 0) + 1); add(t, f, o); };
  w.removeEventListener = (t, f, o) => { if (listeners.has(t)) listeners.set(t, listeners.get(t) - 1); rem(t, f, o); };
  scripts.forEach((src) => w.eval(fs.readFileSync(path.join(root, src), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver;
  OW.Loop.stop();
  const doc = w.document, M = OW.Motion;
  const cardA = OW.Mechanics.get('wood').els.wrap, cardB = OW.Mechanics.get('stone').els.wrap;
  const leftovers = () => doc.querySelectorAll('.mo-fly, .mo-fill, .mo-burst, .mo-hold, .mo-charge').length;
  const camListeners = () => [...listeners.values()].reduce((a, b) => a + b, 0);
  return { w, OW, doc, M, anims, cardA, cardB, leftovers, camListeners };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await test('Skipped without element.animate (and offline, replay, hidden tab): fn never runs, done runs', async () => {
    const { M } = boot({ animate: false });
    let ran = false, done = false;
    await M.scene(async () => { ran = true; }, () => { done = true; });
    assert.equal(ran, false); assert.equal(done, true);
  });

  await test('A finished scene leaves nothing behind; done() runs first with ownership already released', async () => {
    const T = boot();
    const kids0 = T.doc.getElementById('right-hand').children.length + T.doc.body.children.length, style0 = T.cardA.getAttribute('style');
    let seen = null;
    await T.M.scene(async (s) => {
      s.own(T.cardA); s.hold(T.cardB);
      assert.ok(T.M.owned(T.cardA) && T.M.owned(T.cardB));
      const g = s.ghost(T.cardA), t = s.token({ name: 'Torch', stat: 'Falling', cls: 'x' }, { x: 0, y: 0, w: 100 });
      s.follow(() => 0, .2);
      assert.ok(T.camListeners() > 0, 'camera listens for the player taking over');
      s.shake(T.cardA); s.collapse(T.cardA, 50); s.burst(T.cardA); s.cls(T.cardA, 'busy');
      await s.fill(T.cardA, 100);
      await s.fall(g, 40, { ms: 100, sway: 3 });
      s.show(T.cardB);
      await s.land(t, T.cardB);
      s.unfollow();
    }, () => { seen = { owned: T.M.owned(T.cardA), fly: T.leftovers() }; });
    assert.equal(seen.owned, false);
    assert.ok(seen.fly > 0, 'done runs before copies are removed, so a sync never sees a gap');
    assert.equal(T.leftovers(), 0);
    assert.ok(!T.cardA.classList.contains('busy'));
    assert.equal(T.cardA.getAttribute('style') || '', style0 || '');
    assert.equal(T.doc.getElementById('right-hand').children.length + T.doc.body.children.length, kids0);
    assert.ok(T.anims.length >= 5 && T.anims.every((a) => a.cancelled), T.anims.length + ' ' + T.anims.filter((a) => !a.cancelled).length);
    assert.equal(T.camListeners(), 0);
    assert.equal(T.M.running(), 0);
  });

  await test('Save load cancels a running scene at once; its later steps never run', async () => {
    const T = boot();
    let after = false, done = 0;
    const p = T.M.scene(async (s) => { s.hold(T.cardB); s.ghost(T.cardA); s.follow(T.cardA); await s.wait(60000); after = true; }, () => { done++; });
    await sleep(5);
    assert.equal(T.M.running(), 1);
    const d = JSON.parse(JSON.stringify(T.OW.Save.serialize())); d.savedAt = 0;
    T.OW.Save.deserialize(d);
    assert.equal(T.leftovers(), 0); assert.equal(T.M.owned(T.cardB), false); assert.equal(T.camListeners(), 0);
    await p;
    assert.equal(after, false); assert.equal(done, 1);
  });

  await test('A watched element leaving the page (window closed) ends the scene', async () => {
    const T = boot();
    const box = T.doc.body.appendChild(T.doc.createElement('div'));
    let after = false;
    const p = T.M.scene(async (s) => { s.watch(box); await s.wait(20); box.remove(); await s.tween(1000, () => {}); await s.wait(20); after = true; });
    await p;
    assert.equal(after, false); assert.equal(T.M.running(), 0);
  });

  await test('Lasting effects: fracture is idempotent; light fades and stops by itself', async () => {
    const T = boot();
    const label = T.doc.getElementById('thebelow-label');
    T.M.fracture(label, 2); const once = label.innerHTML; T.M.fracture(label, 2);
    assert.equal(label.innerHTML, once);
    assert.equal(label.querySelectorAll('.fr-l').length, 'The Below '.length);
    const voids = [...T.doc.querySelectorAll('.rt-void')];
    T.M.light(voids, 0, '1,2,3', 1);
    assert.ok(voids[0].style.getPropertyValue('--mo-lit') > 0);
    await sleep(2500); // ~140 frames at ×.955
    assert.equal(voids.filter((v) => v.style.getPropertyValue('--mo-lit')).length, 0);
  });

  console.log(`\n${checks} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
