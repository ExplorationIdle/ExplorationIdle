/* Temple+: the cheat-only stage — shown but locked, one torch, then gone for good. jsdom has no element.animate, so every
   Motion scene is skipped here — exactly the offline/replay path, where the game
   must still end up correct. Visuals are checked in a real browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
let checks = 0, failures = 0;
function test(name, fn) {
  try { fn(); checks++; console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + '\n' + e.stack); }
}
function boot() {
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' }).window;
  const errors = [];
  w.requestAnimationFrame = () => 1;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.IntersectionObserver = class { observe() {} unobserve() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  w.console.error = (...args) => errors.push(args.join(' '));
  scripts.forEach((src) => w.eval(fs.readFileSync(path.join(root, src), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver, doc = w.document, M = (id) => OW.Mechanics.get(id);
  OW.Loop.stop();
  const $ = (id) => doc.getElementById(id);
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const shown = (id) => M(id).revealed && M(id).els.wrap.style.display !== 'none';
  const state = () => JSON.stringify(OW.Save.serialize().mechanics.ruinedtemple);
  const view = () => ['ruinedtemple', 'rt_orb', 'rt_freefall', 'blessed'].map((id) => +shown(id)).join('')
    + ['ruinedtemple-section', 'thebelow-section', 'left-hand-ruinedtemple-group'].map((id) => +($(id).style.display !== 'none')).join('');
  const openCard = (id) => { const t0 = Date.now(); while (Date.now() - t0 < 150); click(M(id).els.wrap.querySelector('.card')); }; // past the ghost-click guard
  const btn = (act) => doc.querySelector(`#card-modal-body [data-rt="${act}"]`);
  const pool = () => OW.RuinedTemple.workerPool;
  function crackOpen() {
    click($('cheat-temple')); OW.RuinedTemple.addWorkers(6);
    for (let i = 0; i < 6; i++) pool().assign('rt_crack');
    OW.Loop.runBulk(30, 0.2); // 6 workers × 3.2 %/s → 100% in ~5.2 s
  }
  function reload() { // a fresh page restoring this one's save
    const d = JSON.parse(JSON.stringify(OW.Save.serialize())); d.savedAt = 0;
    const B = boot(); B.OW.Save.deserialize(d); B.OW.Loop.runBulk(1, 0);
    return B;
  }
  return { w, OW, doc, M, $, click, shown, state, view, openCard, btn, pool, crackOpen, reload, errors };
}

test('Hidden until Temple+; everything locked except the face Drop torch button', () => {
  const T = boot(), sec = () => [T.$('templeplus-section'), T.$('templeplus-below')].map((e) => e.style.display).join('|');
  assert.equal(sec(), 'none|none');
  T.click(T.$('cheat-templeplus'));
  assert.equal(sec(), '|');
  assert.deepEqual(['tp_temple', 'tp_orb', 'tp_crack'].map((id) => T.M(id).cardName()), ['Temple Ruins', 'Orb', 'Crack in the floor']);
  assert.equal(T.M('tp_crack').getStatText(), '');
  assert.equal(T.M('tp_orb').getStatText(), 'Cracked');
  assert.ok(T.M('tp_orb').els.wrap.classList.contains('rt-cracked') && T.M('tp_orb').els.wrap.querySelector('.card .rt-crack-svg'), 'the Orb is cracked, like the real one');
  ['tp_temple', 'tp_orb'].forEach((id) => assert.ok(T.M(id).els.wrap.hasAttribute('inert'), id));
  const crack = T.M('tp_crack').els.wrap, btn = crack.querySelector('.tp-face-btn');
  assert.ok(crack.querySelector('.card').hasAttribute('inert') && !crack.hasAttribute('inert') && btn && !btn.closest('[inert]'));
  assert.equal(T.$('templeplus-shaft').children.length, 26);
  assert.equal(T.doc.querySelectorAll('#templeplus-section .mo-hold, #templeplus-below .mo-hold').length, 0, 'a skipped reveal leaves everything shown and the button live');
  assert.ok(!T.OW.Locations.all().some((l) => l.id.startsWith('templeplus')) && !T.OW.Workers.getPools().templeplus);
  const kids = [...T.$('right-hand').children].filter((el) => el.id);
  assert.deepEqual(kids.slice(-2).map((el) => el.id), ['templeplus-section', 'templeplus-below']);
  assert.deepEqual(T.errors, []);
});

test('One torch per showing; the cheat shows Temple+ again, after a reload too', () => {
  const T = boot();
  T.click(T.$('cheat-templeplus'));
  T.click(T.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.equal(T.$('templeplus-section').style.display, 'none'); // the scene is skipped here (no element.animate)
  assert.equal(T.$('templeplus-below').style.display, 'none');
  assert.equal(T.OW.Footer.getHistory()[0].t, 'You drop a torch into the fall.');
  const B = T.reload();
  assert.equal(B.$('templeplus-section').style.display, 'none');
  assert.equal(JSON.stringify(B.OW.Save.serialize().mechanics.templeplus), JSON.stringify({ s: 1, u: 1 }));
  B.click(B.$('cheat-templeplus'));
  assert.equal(B.$('templeplus-section').style.display, '');
  assert.equal(B.OW.Footer.getHistory()[0].t, 'Cheat: Temple+ shown.');
  assert.equal(JSON.stringify(B.OW.Save.serialize().mechanics.templeplus), JSON.stringify({ s: 1, u: 0 }));
  B.click(B.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.equal(B.$('templeplus-section').style.display, 'none');
});

test('Shown but unused survives a reload; the original Temple is untouched', () => {
  const T = boot(); T.click(T.$('cheat-templeplus'));
  const B = T.reload();
  assert.equal(B.$('templeplus-section').style.display, '');
  assert.equal(B.$('ruinedtemple-section').style.display, 'none');
  assert.equal(B.OW.RuinedTemple.isDiscovered(), false);
});

console.log(`\n${checks} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
