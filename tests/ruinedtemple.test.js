/* Temple Ruins + The Below: the travel path, its two claims, The Ceremony, what
   each step shows, save/load at every step, cargo routing (Shard included) and cheats. jsdom has no element.animate, so every
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
  const view = () => ['ruinedtemple', 'rt_orb', 'rt_freefall', 'rt_altar', 'blessed'].map((id) => +shown(id)).join('')
    + ['ruinedtemple-section', 'thebelow-section', 'left-hand-ruinedtemple-group'].map((id) => +($(id).style.display !== 'none')).join('');
  const openCard = (id) => { const t0 = Date.now(); while (Date.now() - t0 < 150); click(M(id).els.wrap.querySelector('.card')); }; // past the ghost-click guard
  const btn = (act) => doc.querySelector(`#card-modal-body [data-rt="${act}"]`);
  const pool = () => OW.RuinedTemple.workerPool;
  const step = (a) => M('ruinedtemple').els[a === 'add' ? 'cardStepperPlus' : 'cardStepperMinus'].dispatchEvent(new w.Event('pointerdown')); // card-face stepper
  // Arrive with 1 worker, walk it to the middle triangle and claim Crack in the Floor.
  function crackOpen() {
    click($('cheat-temple')); OW.RuinedTemple.addWorkers(1);
    openCard('ruinedtemple'); step('add');
    OW.Loop.runBulk(20, 0.2); // 1 worker, 1/s → the Crack (3) in 3 s
    click(btn('crack'));
  }
  function reload() { // a fresh page restoring this one's save
    const d = JSON.parse(JSON.stringify(OW.Save.serialize())); d.savedAt = 0;
    const B = boot(); B.OW.Save.deserialize(d); B.OW.Loop.runBulk(1, 0);
    return B;
  }
  return { w, OW, doc, M, $, click, shown, state, view, openCard, btn, pool, step, crackOpen, reload, errors };
}

test('Hidden until the Temple cheat; then a bottom section, rail group and cargo destination', () => {
  const T = boot();
  assert.equal(T.view(), '00000000');
  assert.ok(!T.OW.Locations.destinationsFor('camp').some((l) => l.id === 'ruinedtemple'));
  T.click(T.$('cheat-temple')); T.OW.Loop.runBulk(1, 0.2);
  assert.equal(T.view(), '10000101'); // Temple Ruins only (with its Trading Post); section + rail, no Below yet
  assert.equal(T.$('camp-section-label').style.display, '');
  assert.ok(T.OW.Locations.destinationsFor('camp').some((l) => l.id === 'ruinedtemple'));
  assert.ok(!T.OW.Locations.all().some((l) => l.id === 'thebelow'), 'The Below is a section, not a location');
  const kids = [...T.$('right-hand').children].filter((el) => el.id);
  assert.deepEqual(kids.slice(-4).map((el) => el.id), ['ruinedtemple-section', 'thebelow-section', 'templeplus-section', 'templeplus-below']); // Temple+ sits below
  assert.equal(T.$('left-hand').lastElementChild.id, 'left-hand-ruinedtemple-group');
  assert.deepEqual(T.errors, []);
});

test('Temple Ruins Trading Post: top of the section, shown with it, sends back to Camp and Mountains', () => {
  const T = boot(); T.OW.Mountains.reveal();
  assert.ok(!T.shown('rt_scoutstable'));
  T.click(T.$('cheat-temple')); T.OW.Loop.runBulk(1, 0.2);
  assert.ok(T.shown('rt_scoutstable'));
  const grid = T.$('grid-ruinedtemple'), first = [...grid.children].find((el) => el.style.display !== 'none');
  assert.equal(first, T.M('rt_scoutstable').els.wrap, 'first card in the section');
  assert.equal(T.OW.Locations.destinationsFor('ruinedtemple').map((l) => l.id).sort().join(), 'camp,mountains');
  assert.ok(T.OW.TempleScoutStable.vehicleIds.mule.every((id) => T.M(id).section === 'Temple Ruins'));
  const C = T.reload(); assert.ok(C.shown('rt_scoutstable'), 'shown after a reload');
  assert.deepEqual([T.errors, C.errors], [[], []]);
});

test('Trips to or from the Temple Ruins take 4× as long, either way; Camp ↔ Mountains unchanged', () => {
  const T = boot(); T.OW.Mountains.reveal(); T.click(T.$('cheat-temple'));
  T.OW.Workers.addWorkers(4); T.OW.RuinedTemple.addWorkers(2);
  const sel = (attrs, value) => { const e = T.doc.createElement('select'); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    const o = T.doc.createElement('option'); o.value = value; e.appendChild(o); T.doc.body.appendChild(e); e.value = value; e.dispatchEvent(new T.w.Event('change', { bubbles: true })); };
  function send(loc, kind, idx, dest) {
    const at = { 'data-sp-loc': loc, 'data-sp-kind': kind, 'data-sp-idx': String(idx) };
    sel({ ...at, 'data-sp-action': 'add-resource' }, '__workers__');
    sel({ ...at, 'data-sp-action': 'set-dest' }, dest);
    const b = T.doc.createElement('button'); Object.entries({ ...at, 'data-sp-action': 'dispatch' }).forEach(([k, v]) => b.setAttribute(k, v));
    T.doc.body.appendChild(b); T.click(b);
  }
  const trip = (id, kind, idx) => T.OW.Save.serialize().mechanics[id].runs[kind][idx].tr;
  send('camp', 'mule', 0, 'ruinedtemple'); send('camp', 'cartbull', 0, 'ruinedtemple'); send('camp', 'mule', 1, 'mountains');
  send('ruinedtemple', 'mule', 0, 'camp');
  T.OW.Loop.runBulk(15, 0.2);
  assert.equal([trip('scoutspen', 'mule', 0), trip('scoutspen', 'cartbull', 0), trip('scoutspen', 'mule', 1), trip('rt_scoutstable', 'mule', 0)].join(), '60,240,15,60');
  const C = T.reload(); assert.equal(C.OW.Save.serialize().mechanics.scoutspen.runs.mule[0].tr, 60, 'trip time saved');
  assert.deepEqual([T.errors, C.errors], [[], []]);
});

test('Cargo delivers workers and goods into the temple pool and rail', () => {
  const T = boot(); T.click(T.$('cheat-temple'));
  T.OW.RuinedTemple.addWorkers(3);
  const id = T.OW.RuinedTemple.ensureResource('wood', 'Wood'); T.OW.Resources.add(id, 5);
  assert.equal(T.pool().getTotal(), 3);
  assert.equal(id, 'rt_wood'); assert.equal(T.OW.Resources.get('rt_wood'), 5);
  assert.ok(T.$('left-hand-real-resources-ruinedtemple').textContent.includes('Wood'));
});

test('A Camp Shard ships to the Temple Ruins as a whole Shard', () => {
  const T = boot(); T.click(T.$('cheat-temple'));
  T.OW.Resources.add('shard', 1); T.OW.Workers.addWorkers(2);
  T.OW.Workers.assign('scoutspen');
  const at = { 'data-sp-loc': 'camp', 'data-sp-kind': 'mule', 'data-sp-idx': '0' };
  const sel = (attrs, value) => { const e = T.doc.createElement('select'); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    const o = T.doc.createElement('option'); o.value = value; e.appendChild(o); T.doc.body.appendChild(e); e.value = value; e.dispatchEvent(new T.w.Event('change', { bubbles: true })); };
  sel({ ...at, 'data-sp-action': 'add-resource' }, 'shard');
  sel({ ...at, 'data-sp-action': 'set-dest' }, 'ruinedtemple');
  const b = T.doc.createElement('button'); Object.entries({ ...at, 'data-sp-action': 'dispatch' }).forEach(([k, v]) => b.setAttribute(k, v));
  T.doc.body.appendChild(b); T.click(b);
  T.OW.Loop.runBulk(400, 0.2);
  assert.ok(T.OW.Resources.get('shard') < 1e-9);
  assert.equal(T.OW.Resources.get('rt_shard'), 1, 'exactly one Shard arrives');
  assert.ok(T.OW.Resources.isWhole('rt_shard'));
  assert.ok(T.$('left-hand-real-resources-ruinedtemple').textContent.includes('Shard1'));
  assert.deepEqual(T.errors, []);
});

test('Shard cheat: +1 Temple Ruins Shard per press, a whole number on the rail', () => {
  const T = boot(); T.click(T.$('cheat-temple'));
  T.click(T.$('cheat-rtshard')); T.click(T.$('cheat-rtshard'));
  assert.equal(T.$('cheat-rtshard').previousElementSibling.id, 'cheat-temple', 'sits right after Temple');
  assert.equal(T.OW.Resources.get('rt_shard'), 2);
  assert.ok(T.$('left-hand-real-resources-ruinedtemple').textContent.includes('Shard2'));
  assert.ok(T.OW.Footer.getHistory().some((e) => e.t === 'Cheat: +1 Temple Ruins Shard.'));
  assert.deepEqual(T.errors, []);
});

test('The path: 20 s for 1 worker, stops at the Crack (3 s, a third along) until claimed, billed only while walking, needs gold', () => {
  const T = boot(); T.click(T.$('cheat-temple')); T.OW.RuinedTemple.addWorkers(2);
  T.openCard('ruinedtemple');
  assert.equal(T.doc.querySelectorAll('#card-modal-body .rtp-tri').length, 2);
  assert.ok(T.btn('crack').disabled, 'Crack in the Floor greyed while travelling');
  T.step('add');
  assert.equal(T.pool().getAssigned('ruinedtemple'), 1);
  const gold = T.OW.Resources.get('gold');
  T.OW.Loop.runBulk(10, 0.2); // 2 s
  assert.ok(Math.abs(JSON.parse(T.state()).p - 2) < 1e-9);
  assert.equal(T.doc.querySelector('#card-modal-win .worker-desc').textContent, 'Exploring 1.00/s', 'rate on the modal header stepper');
  assert.ok(T.OW.Resources.get('gold') < gold, 'walkers are paid');
  assert.equal(T.M('ruinedtemple').getStatText(), 'Exploring 1.00/s');
  T.step('add'); T.OW.Loop.runBulk(5, 0.2); // 2 workers → 2/s for 1 s: capped at the Crack
  assert.equal(JSON.parse(T.state()).p, 3, 'stops at the Crack triangle');
  assert.ok(Math.abs(T.M('ruinedtemple').getUpgradeBarPct() - 100 / 3) < 1e-9, 'the Crack sits a third of the way along');
  assert.equal(T.doc.querySelector('#card-modal-body .rtp-tri').style.left.slice(0, 6), '33.333');
  assert.ok(!T.btn('crack').disabled && T.doc.querySelector('#card-modal-body .rtp-tri.reached'), 'button live, triangle jade');
  const held = T.OW.Resources.get('gold'); T.OW.Loop.runBulk(10, 0.2);
  assert.equal(T.OW.Resources.get('gold'), held, 'stopped walkers cost nothing');
  assert.equal(T.M('ruinedtemple').getStatText(), 'Something found');
  T.click(T.btn('crack'));
  assert.equal(T.OW.Cards.isModalOpenFor('ruinedtemple'), false, 'claiming Crack in the Floor closes the modal');
  T.OW.Resources.spend('gold', T.OW.Resources.get('gold'));
  T.OW.Loop.runBulk(10, 0.2);
  assert.equal(JSON.parse(T.state()).p, 3, 'no gold, no walking');
  assert.deepEqual(T.errors, []);
});

test('Full sequence with every scene skipped ends correct, and every step survives a reload', () => {
  const T = boot();
  const step = (expectView) => { assert.equal(T.view(), expectView); const B = T.reload(); assert.equal(B.state(), T.state()); assert.equal(B.view(), expectView); return B; };
  T.crackOpen();
  step('10100111'); // Temple Ruins + Crack in the Floor; The Below open
  assert.equal(T.M('rt_freefall').cardName(), 'Crack in the Floor');
  const torch = T.M('rt_freefall').els.wrap.querySelector('.rt-face-btn');
  assert.ok(!torch.classList.contains('mo-hold') && !T.M('rt_freefall').els.wrap.style.pointerEvents, 'scene skipped: Drop torch there at once');
  assert.equal(T.M('rt_freefall').getStatText(), 'No bottom in sight');
  assert.equal(T.M('rt_freefall').els.wrap.querySelector('.card-stepper-btn').closest('.card-steppers').style.display, 'none', 'no steppers');
  T.click(T.M('rt_freefall').els.wrap.querySelector('.rt-face-btn')); // face button, no modal
  step('10100111'); // no Altar
  assert.equal(T.M('rt_freefall').getStatText(), 'Torchlight far below');

  T.OW.Loop.runBulk(40, 0.2); // the walker resumes on its own: 3 → 11 of 20 (17 s leg)
  assert.ok(Math.abs(T.M('ruinedtemple').getUpgradeBarPct() - (100 / 3 + 8 / 17 * 200 / 3)) < 1e-9, 'second leg fills the other two thirds');
  T.OW.Loop.runBulk(50, 0.2);
  assert.equal(T.pool().getAssigned('ruinedtemple'), 0, 'walkers come back at the end');
  T.openCard('ruinedtemple');
  assert.ok(!T.btn('orb').disabled, 'Orb live');
  assert.ok(T.M('ruinedtemple').els.cardSteppersWrap.style.display !== 'none' && T.doc.querySelector('#card-modal-win .stepper-plus'), 'face and modal steppers stay');
  assert.ok(T.doc.querySelector('#card-modal-body .rtp-lab').textContent.includes('✓'));
  step('10100111');
  T.click(T.btn('orb'));
  assert.ok(T.M('rt_orb').els.wrap.compareDocumentPosition(T.M('rt_freefall').els.wrap) & 4, 'Orb above Crack in the Floor');
  assert.ok(T.M('ruinedtemple').els.wrap.compareDocumentPosition(T.M('rt_orb').els.wrap) & 4, 'Temple Ruins above Orb');
  assert.ok(T.M('rt_orb').els.wrap.classList.contains('rt-cracked'));
  const B = step('11100111');
  assert.ok(B.M('rt_orb').els.wrap.classList.contains('rt-cracked'), 'crack restored on load');

  // The Ceremony
  const req = () => [...T.doc.querySelectorAll('#card-modal-body [data-rt-req]')].map((e) => e.textContent).join(' ');
  assert.equal(T.doc.querySelector('#card-modal-body .hs-title').textContent, 'The Ceremony');
  assert.ok(T.doc.querySelector('#card-modal-body').textContent.includes('Gather a pilgrimage of workers to witness and one to set the Shard.Pilgrimage (idle workers)'));
  assert.equal(req(), '1/60 0/1 0/1');
  assert.ok(T.btn('begin').disabled);
  T.OW.RuinedTemple.addWorkers(60); T.OW.Loop.runBulk(1, 0.2);
  assert.equal(req(), '60/60 1/1 0/1');
  assert.ok(T.btn('begin').disabled, 'needs the Shard');
  T.OW.Resources.add(T.OW.RuinedTemple.ensureResource('shard', 'Shard'), 1); T.OW.Loop.runBulk(1, 0.2);
  assert.equal(req(), '60/60 1/1 1/1');
  assert.ok(!T.btn('begin').disabled);
  step('11100111');
  T.click(T.btn('begin'));
  assert.equal(T.OW.Cards.isModalOpenFor('ruinedtemple'), false);
  assert.equal(T.pool().getTotal(), 60, 'the bearer is gone for good; the pilgrims stay');
  assert.equal(T.OW.Resources.get('rt_shard'), 0);
  assert.ok(!T.M('rt_orb').els.wrap.classList.contains('rt-cracked'), 'the crack goes as the ceremony starts');
  const R = step('00001111'); // only The Shard Bearer, in The Below; the temple section stays
  assert.ok(R.shown('rt_scoutstable'), 'Trading Post stays to send the pilgrims home');
  assert.equal(R.M('blessed').getStatText(), '');
  assert.ok(!R.M('blessed').renderModalHTML().includes('TBD'));
  const label = R.$('thebelow-label');
  assert.ok(label.classList.contains('fr-on') && label.querySelectorAll('.fr-l').length === 'The Below '.length, 'broken heading saved for good');
  assert.ok(label.querySelector('.section-collapse-arrow'), 'collapse arrow kept');
  assert.equal(T.$('thebelow-label').querySelectorAll('.fr-seg').length, 3);
  const log = T.OW.Footer.getHistory().map((e) => e.t);
  ['The floor gives way. There is no bottom.', 'You find an orb on a plinth. It is cracked.', 'The Shard Bearer lands in The Below.'].forEach((l) => assert.ok(log.includes(l), l));
  assert.ok(!log.some((l) => /altar/i.test(l)), 'no Altar anywhere');
  assert.deepEqual([T.errors, R.errors], [[], []]);
});

test('Steps cannot be skipped: claims before their triangle, torch before the crack, ceremony short', () => {
  const T = boot(); T.click(T.$('cheat-temple')); T.OW.RuinedTemple.addWorkers(70);
  T.click(T.M('rt_freefall').els.wrap.querySelector('.rt-face-btn'));
  T.openCard('ruinedtemple');
  const fake = (act) => { const b = T.doc.createElement('button'); b.dataset.rt = act; T.doc.body.appendChild(b); T.click(b); };
  fake('crack'); fake('orb'); fake('begin');
  assert.deepEqual(JSON.parse(T.state()), { d: 1, p: 0, c: 0, b: 0, t: 0, k: 0, o: 0, r: 0 });
  T.step('add'); T.OW.Loop.runBulk(20, 0.2); fake('orb');
  assert.equal(JSON.parse(T.state()).b, 0, 'no Orb before the crack');
  fake('crack'); T.OW.Loop.runBulk(5, 0.2); fake('orb');
  assert.equal(JSON.parse(T.state()).b, 0, 'no Orb before the end');
  T.OW.Loop.runBulk(90, 0.2); fake('orb'); fake('begin');
  assert.equal(JSON.parse(T.state()).r, 0, 'no ceremony without a Shard');
  assert.equal(T.pool().getTotal(), 70);
  assert.deepEqual(T.errors, []);
});

test('ALL cheats cannot show later cards early; worker cheats never reach The Below', () => {
  const T = boot(); T.click(T.$('cheat-temple'));
  T.click(T.$('cheat-all')); T.click(T.$('cheat-all-v2')); T.click(T.$('cheat-workers'));
  T.OW.Loop.runBulk(1, 0.2);
  assert.equal(T.view().slice(0, 5), '10000');
  assert.ok(T.pool().getTotal() >= 50);
  assert.ok(!T.OW.Workers.getPools().thebelow);
});

test('Orb and Altar cannot be pinned; no temple card is ever a Strange Shard preview', () => {
  const T = boot();
  assert.ok(T.M('rt_orb').noPin && T.M('rt_altar').noPin);
  T.OW.StrangeShard.start();
  assert.ok(T.OW.Mechanics.all().filter((m) => m.id.startsWith('rt_') || m.id === 'ruinedtemple' || m.id === 'blessed').every((m) => !m._previewLock));
  assert.equal(T.$('ruinedtemple-section').style.display, 'none');
});

console.log(`\n${checks} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
