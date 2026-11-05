/* Real-game integration: production, billing, saves, temporary previews and DOM controls.
   Run with Node + jsdom, like the other suites. No game or browser storage is written. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const windows = [];
let checks = 0, failures = 0;
function test(name, fn) {
  try { fn(); checks++; console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + '\n' + e.stack); }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function boot() {
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' }).window;
  windows.push(w);
  let now = 2000000000000, frames = [];
  const errors = [];
  w.Date.now = () => now;
  w.performance.now = () => 1000;
  w.requestAnimationFrame = (fn) => { frames.push(fn); return 1; };
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.IntersectionObserver = class { observe() {} unobserve() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  w.console.error = (...args) => errors.push(args.join(' '));
  scripts.forEach((src) => w.eval(fs.readFileSync(path.join(root, src), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver, m = OW.Mechanics.get('digsite');
  OW.Loop.stop();
  assert.deepEqual(errors, []);
  const state = () => OW.Save.serialize().mechanics.digsite;
  const rolls = () => state().hour.reduce((n, b) => n + b[0] + b[1], 0);
  function load(values) {
    const d = JSON.parse(JSON.stringify(OW.Save.serialize()));
    d.mechanics.digsite = { ...d.mechanics.digsite, ...values };
    d.savedAt = 0;
    OW.Save.deserialize(d);
  }
  function unlock() { // fade fully in (10 stone), then leave the original 1 loose Stone
    OW.Resources.add('stone', 10);
    m.tick(true, 0);
    OW.Resources.spend('stone', 9);
    OW.DigSite.completeIntro();
    OW.StrangeShard.clear();
  }
  return { w, OW, m, state, rolls, load, unlock, errors,
    clock: (ms) => { now += ms; },
    animate: (ms) => { const pending = frames; frames = []; pending.forEach((fn) => fn(ms)); } };
}

test('Dig Site sits below Stone Pit, with only the intro button and no face bars', () => {
  const { w, OW, m } = boot();
  assert.equal(m.revealed, true); // fades in with stone (tests/tutorial-start.test.js)
  assert.equal(m.els.wrap.previousElementSibling, OW.Mechanics.get('stone').els.wrap);
  assert.equal(m.els.upgradeBar.style.display, 'none');
  assert.equal(m.els.buildBar.style.display, 'none');
  assert.equal(m.els.cardSteppersWrap.style.display, 'none'); // no reserved space before the intro: text sits left
  m.els.wrap.querySelector('.card').click();
  assert.equal(w.document.querySelector('#card-modal-body').textContent.trim(), 'Show your future');
  assert.equal(w.document.querySelector('#card-modal-header-left').childElementCount, 0);
  w.document.querySelector('[data-ds-intro]').click();
  assert.equal(OW.Cards.isModalOpenFor('digsite'), false);
  assert.equal(OW.Save.serialize().mechanics.digsite.introDone, true);
  assert.equal(m.els.cardSteppersWrap.style.visibility, '');
});

test('Parked workers show Dark; Brazier face bar mirrors heat and survives save/load', () => {
  const { w, OW, m, state, load, unlock, animate } = boot(); unlock();
  assert.equal(m.getStatText(), '');
  OW.Workers.assign('digsite');
  assert.equal(m.els.statEl.textContent, 'Dark');
  assert.equal(m.getBillableCount(), 0);
  OW.DigSite.subAssign('brazier'); OW.Resources.setRaw('wood', 100);
  m.tick(true, 1);
  assert.equal(m.getStatText(), 'Adding wood');
  load({ wood: 25, burning: false });
  animate(1000); animate(1400);
  near(parseFloat(m.els.buildBar.style.width), 50);
  assert.equal(m.els.buildBar.classList.contains('bar-collecting'), true);
  assert.equal(m.els.upgradeBar.style.display, ''); // Excavation drains the top bar
  OW.Workers.addWorkers(1); m.els.cardStepperPlus.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  m.els.cardStepperPlus.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(state().workers.dig, 1); assert.equal(state().workers.brazier, 1); // face + always adds to Dig, even after a Brazier add
  m.tick(true, 0);
  assert.equal(m.getStatText(), 'Dark'); // digging, brazier still adding wood
  load({ wood: 40, burning: true });
  assert.equal(m.getStatText(), 'Research 41%'); // 1 digger + 40 wood
  OW.DigSite.subUnassign('dig');
  animate(2000); animate(2400);
  near(parseFloat(m.els.buildBar.style.width), 80);
  assert.equal(m.els.buildBar.classList.contains('bar-collecting'), false);
  OW.DigSite.subUnassign('brazier'); // a modal − returns the worker to idle
  assert.equal(OW.Workers.getAssigned('digsite'), 0);
  assert.equal(m.getStatText(), '');
});

test('One shared roll respects workers, global modifiers, overflow and whole rewards', () => {
  const { w, OW, m, state, rolls, unlock } = boot(); unlock();
  w.Math.random = () => 0;
  OW.DigSite.subAssign('dig');
  for (let i = 0; i < 25; i++) m.tick(true, 0.2);
  assert.equal(rolls(), 1);
  assert.equal(OW.Resources.get('stone'), 2);
  OW.Upgrades.setGlobalMods({ m: 1, p: 0, f: 0 });
  m.tick(true, 2.5);
  assert.equal(rolls(), 2);
  OW.Upgrades.setGlobalMods({ m: 0, p: 0, f: 0 });
  for (let i = 0; i < 4; i++) OW.DigSite.subAssign('dig');
  m.tick(true, 3.4);
  assert.equal(rolls(), 5);
  near(state().progress, 2);
  w.Math.random = () => 0.999;
  m.tick(true, 0.6);
  assert.equal(OW.Resources.get('researchpapers'), 1);
  assert.equal(OW.Resources.isHidden('researchpapers'), false);
});

test('Heating gives no bonus or burn; capacity-limited filling loses no wood', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  for (let i = 0; i < 5; i++) OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 100);
  load({ wood: 40, burning: false });
  near(OW.DigSite.researchChance(), 0);
  m.tick(true, 1);
  near(state().wood, 45);
  assert.equal(state().burning, false);
  near(OW.DigSite.researchChance(), 0);
  load({ wood: 49 });
  const before = OW.Resources.get('wood');
  m.tick(true, 1);
  near(OW.Resources.get('wood'), before - 1);
  near(state().wood, 50); // fills to a true 50/50; burning starts next tick
  assert.equal(state().burning, true);
  near(OW.DigSite.researchChance(), 50);
});

test('Brazier draws loose Wood before Camp crates, never Mountains wood', () => {
  const { OW, m, state, unlock } = boot(); unlock();
  OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 0.5);
  OW.Resources.setRaw('woodcrate', 10);
  OW.Resources.setRaw('mtn_wood', 100);
  m.tick(true, 2);
  near(state().wood, 2);
  near(OW.Resources.get('wood'), 0);
  near(OW.Resources.get('woodcrate'), 8.5);
  near(OW.Resources.get('mtn_wood'), 100);
});

test('Sufficient stoking holds Burning; understaffing drains to empty and reheats', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  OW.DigSite.subAssign('brazier'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 1000);
  load({ wood: 50, burning: true });
  for (let i = 0; i < 50; i++) m.tick(true, 0.2);
  near(state().wood, 50); assert.equal(state().burning, true); // burn then refill: holds 50/50
  OW.DigSite.subUnassign('brazier');
  let n = 0; while (state().burning && n < 300) { m.tick(true, 0.2); n++; }
  assert.ok(n >= 249 && n <= 250, n); // 50 wood at net −1/s
  near(state().wood, 0.2); assert.equal(state().burning, false); // emptied, and reheating began that tick
  m.tick(true, 1);
  near(state().wood, 1.2); near(OW.DigSite.researchChance(), 0);
});

test('Odds combine raw Dig workers with Burning wood, after this tick burns and fills', () => {
  const { w, OW, m, state, load, unlock } = boot(); unlock();
  OW.Workers.addWorkers(100);
  for (let i = 0; i < 50; i++) OW.DigSite.subAssign('dig');
  OW.DigSite.subAssign('brazier'); OW.Resources.setRaw('wood', 100);
  load({ wood: 50, burning: true }); near(OW.DigSite.researchChance(), 100);
  w.Math.random = () => 0.001; // falls in the 0.2% Stone chance AFTER burning and refilling
  m.tick(true, 0.2);
  near(OW.DigSite.researchChance(), 99.8);
  assert.equal(state().lastReward, 'stone');
  for (let i = 0; i < 51; i++) OW.DigSite.subAssign('dig');
  load({ wood: 0, burning: false }); near(OW.DigSite.researchChance(), 100);
  m.tick(true, 0.2); assert.equal(state().lastReward, 'research');
});

test('Gold starvation freezes Dig/fill, but fire still burns; zero-length ticks change nothing', () => {
  const { OW, m, state, load, unlock } = boot(); unlock();
  OW.DigSite.subAssign('dig'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 100);
  load({ progress: 2, wood: 4, burning: true });
  const before = JSON.stringify(state()); m.tick(true, 0);
  assert.equal(JSON.stringify(state()), before);
  OW.Resources.setRaw('gold', 0); m.tick(false, 1);
  near(state().wood, 2); near(state().progress, 2);
  near(OW.Resources.get('wood'), 100); assert.equal(m.getStatText(), 'Stopped');
  m.tick(false, 1); assert.equal(state().burning, false);
  OW.Resources.setRaw('gold', 100); m.tick(true, 1);
  near(state().wood, 1); near(state().progress, 3);
});

test('Billing charges working slots only; wood-starved workers stay assigned for free', () => {
  const { OW, m, unlock } = boot(); unlock();
  OW.Workers.assign('digsite'); OW.Workers.assign('digsite'); OW.Workers.assign('digsite');
  OW.DigSite.subAssign('dig'); OW.DigSite.subAssign('brazier');
  OW.Resources.setRaw('wood', 0); OW.Resources.setRaw('gold', 100);
  OW.Loop.runBulk(1, 1);
  near(OW.Resources.get('gold'), 99);
  assert.equal(OW.Save.serialize().mechanics.digsite.workers.brazier, 1);
  OW.Resources.setRaw('wood', 10); OW.Loop.runBulk(1, 1);
  near(OW.Resources.get('gold'), 97);
  OW.Workers.recallAll();
  assert.equal(m.getBillableCount(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(OW.Save.serialize().mechanics.digsite.workers)), { dig: 0, brazier: 0, tunnel: 0 });
});

test('Card / header "−" trims Dig first; Brazier only once Dig is empty', () => {
  const { OW, unlock } = boot(); unlock(); OW.Workers.addWorkers(10);
  [0, 1, 2].forEach(() => OW.DigSite.subAssign('dig')); [0, 1].forEach(() => OW.DigSite.subAssign('brazier'));
  const w = () => { const x = OW.Save.serialize().mechanics.digsite.workers; return [x.dig, x.brazier]; };
  assert.deepEqual(w(), [3, 2]);
  OW.Workers.unassign('digsite'); assert.deepEqual(w(), [2, 2]);
  OW.Workers.unassign('digsite'); OW.Workers.unassign('digsite'); assert.deepEqual(w(), [0, 2]);
  OW.Workers.unassign('digsite'); assert.deepEqual(w(), [0, 1]);
});

test('Modal has two live bars, amber heating/burning classes, minimal rates and functioning steppers', () => {
  const { w, OW, m, load, unlock, animate } = boot(); unlock();
  w.performance.now = () => 2000; // past the intro-close ghost-click guard
  m.els.wrap.querySelector('.card').click();
  const body = w.document.querySelector('#card-modal-body');
  assert.equal(body.querySelectorAll('[data-extra-track]').length, 3); // Excavation, Dig, Brazier
  body.querySelector('[data-ds-plus="dig"]').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  body.querySelector('[data-ds-plus="dig"]').dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(body.querySelector('[data-ds-count="dig"]').textContent, '1');
  assert.equal(body.querySelector('[data-ds-rate="dig"]').textContent, 'Digging .20/s');
  OW.Resources.setRaw('wood', 100); OW.DigSite.subAssign('brazier');
  load({ wood: 25, burning: false, progress: 2.5 }); m.patchLiveTrack(); animate(3000); animate(4000);
  near(parseFloat(body.querySelector('[data-extra-track="ds-dig"]').style.width), 50);
  near(parseFloat(body.querySelector('[data-extra-track="ds-brazier"]').style.width), 50);
  assert.equal(body.querySelector('[data-ds-chance]').textContent, '1%');
  assert.equal(body.querySelector('.ds-brazier-bar').classList.contains('ds-burning'), false);
  load({ burning: true }); m.patchLiveTrack();
  assert.equal(body.querySelector('.ds-brazier-bar').classList.contains('ds-burning'), true);
  assert.equal(body.querySelector('[data-ds-chance]').textContent, '26%');
});

test('Last hour rolls off in game-time minute buckets, offline coarse steps included', () => {
  const { w, OW, state, rolls, load, unlock } = boot(); unlock();
  load({ lastReward: 'research', hour: [[1, 0], [0, 1]], hourClock: 30 });
  assert.equal(rolls(), 2);
  OW.DigSite.subAssign('dig'); w.Math.random = () => 0.999;
  OW.Loop.runBulk(50, 1); // same coarse step that offline replay uses
  assert.equal(rolls(), 12);
  assert.equal(state().hour.length, 3);
  near(state().hourClock, 20);
  OW.DigSite.subUnassign('dig');
  OW.Loop.runBulk(3600, 1);
  assert.equal(rolls(), 0);
  assert.ok(state().hour.length <= 60);
  assert.equal(state().lastReward, 'research', 'last reward outlives the hour window');
});

test('Dig state survives a save with worker counts, progress, wood, fire and the last-hour buckets', () => {
  const A = boot(); A.unlock(); A.OW.DigSite.subAssign('dig'); A.OW.DigSite.subAssign('brazier');
  A.load({ wood: 12, burning: true, progress: 2.2, hour: [[2, 1]], hourClock: 12, lastReward: 'research' });
  const saved = JSON.parse(JSON.stringify(A.OW.Save.serialize())); saved.savedAt = 0;
  const B = boot(); B.OW.Save.deserialize(saved);
  assert.equal(JSON.stringify(B.state()), JSON.stringify(A.state()));
  A.w.Math.random = B.w.Math.random = () => 0.9;
  A.OW.Loop.runBulk(10, 0.2); B.OW.Loop.runBulk(10, 0.2);
  assert.equal(JSON.stringify(B.state()), JSON.stringify(A.state()));
  assert.equal(B.m.revealed, true);
});

test('Strange Shard shows only the frozen list of hidden cards, without saving preview unlocks', () => {
  const { OW } = boot(); OW.StrangeShard.start();
  const cards = OW.Mechanics.all();
  assert.equal(JSON.stringify(cards.filter((m) => m._previewLock).map((m) => m.id).sort()), JSON.stringify(['collapsedpath', 'goldmine', 'goldpanning', 'marketstall', 'mountains',
    'mtn_scoutstable', 'quarry', 'researchbench', 'scoutspen', 'sdpulley', 'smeltershack', 'wheatfieldcard']));
  assert.ok(cards.some((m) => m._previewLock));
  cards.filter((m) => m.isMule || m.id === 'mpftest' || (m.revealed && m.id !== 'researchbench')).forEach((m) => assert.ok(!m._previewLock, m.id));
  const saved = OW.Save.serialize();
  cards.filter((m) => m._previewLock && m.id !== 'researchbench').forEach((m) => {
    assert.equal(m.revealed, false); assert.equal(saved.cards[m.id].r, 0);
  });
  assert.equal(OW.Mountains.isDiscovered(), false);
  assert.equal(OW.SandDunes.isDiscovered(), false);
});

test('Preview locks worker buttons and modal clicks, and the original smoothing loop reads overrides', () => {
  const { w, OW, animate } = boot();
  const m = OW.Mechanics.get('marketstall'), original = m.getUpgradeBarPct;
  OW.StrangeShard.start();
  m.els.cardStepperPlus.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  m.els.wrap.querySelector('.card').click();
  assert.equal(OW.Workers.getAssigned('marketstall'), 0);
  assert.equal(OW.Cards.isModalOpenFor('marketstall'), false);
  animate(1000); animate(1400);
  near(parseFloat(m.els.upgradeBar.style.width), 100);
  OW.Mechanics.get('strangeshard').tick(false, 5);
  animate(2000); animate(2400);
  assert.ok(parseFloat(m.els.upgradeBar.style.width) < 100);
  OW.StrangeShard.clear();
  assert.equal(m.getUpgradeBarPct, original);
  assert.equal(m.els.wrap.hasAttribute('inert'), false);
});

test('Document order sets 20-to-10 second lifetimes and each location restores independently', () => {
  const { w, OW } = boot(); OW.StrangeShard.start();
  assert.equal(w.document.querySelector('#camp-section-label').style.display, 'none'); // a glimpse never shows the Camp heading
  const ordered = Array.from(w.document.querySelectorAll('.card-wrap')).map((el) => OW.Mechanics.all().find((m) => m.els && m.els.wrap === el)).filter((m) => m && m._previewLock);
  const ticker = OW.Mechanics.get('strangeshard'); ticker.tick(false, 5);
  ordered.forEach((m, i) => {
    const duration = 20 - 10 * i / (ordered.length - 1);
    near(m.getUpgradeBarPct(), (duration - 5) / duration * 100);
  });
  // Sand Dunes (last location) restores once its FIRST card in document
  // order — the longest-lived of its cards — runs out.
  const sdEnd = 20 - 10 * ordered.findIndex((m) => m.section === 'Sand Dunes') / (ordered.length - 1);
  ticker.tick(false, sdEnd - 5);
  assert.equal(w.document.querySelector('#sanddunes-section').style.display, 'none');
  assert.equal(w.document.querySelector('#mountains-section').style.display, '');
  ticker.tick(false, 20 - 10 * ordered.findIndex((m) => m.section === 'Mountains') / (ordered.length - 1) - sdEnd); // Mountains' first card runs out
  assert.equal(w.document.querySelector('#mountains-section').style.display, 'none');
  assert.ok(ordered[0]._previewLock, 'Camp still counting down');
  ticker.tick(false, 4);
  assert.ok(ordered.every((m) => !m._previewLock));
  assert.equal(w.document.querySelector('#camp-section-label').style.display, 'none'); // Camp label hidden until another location appears
});

test('Real card unlock and location discovery during a preview permanently win', () => {
  const { w, OW } = boot(); OW.StrangeShard.start();
  const card = OW.Mechanics.get('marketstall'); OW.Cards.reveal(card);
  OW.Mountains.reveal();
  OW.Mechanics.get('strangeshard').tick(true, 20);
  assert.equal(card.revealed, true); assert.equal(card.els.wrap.style.display, '');
  assert.equal(card._previewLock, undefined);
  assert.equal(OW.Mountains.isDiscovered(), true);
  assert.equal(w.document.querySelector('#mountains-section').style.display, '');
  assert.equal(w.document.querySelector('#camp-section-label').style.display, '');
  assert.equal(w.document.querySelector('#sanddunes-section').style.display, 'none');
});

test('Research Bench is shown in full and named during a glimpse, then leaves no slot before the first dig', () => {
  const { w, OW } = boot();
  const rb = OW.Mechanics.get('researchbench'), wrap = rb.els.wrap;
  rb.tick(true, 0);
  const opacity = wrap.style.opacity, saved = JSON.stringify(OW.Save.serialize().mechanics);
  OW.StrangeShard.start();
  assert.ok(rb._previewLock && wrap.classList.contains('ss-show') && wrap.hasAttribute('inert'));
  OW.Cards.refresh(rb); rb.tick(true, 0);
  assert.equal(rb.els.nameEl.textContent, 'Research Bench');
  OW.Mechanics.get('strangeshard').tick(true, 20);
  assert.ok(!rb._previewLock && !wrap.classList.contains('ss-show') && !wrap.hasAttribute('inert'));
  rb.tick(true, 0);
  assert.equal(wrap.style.opacity, opacity);
  assert.equal(rb.els.nameEl.textContent, '');
  assert.equal(wrap.style.display, 'none', 'no slot before the first dig');
  assert.equal(rb.revealed, false);
  assert.equal(JSON.stringify(OW.Save.serialize().mechanics), saved);
});

test('Each card leaves at its own countdown, leaving no gap; vehicle gaps and real unlocks are untouched', () => {
  const { w, OW } = boot();
  const grid = w.document.querySelector('#grid-camp'); grid.style.display = 'none';
  OW.StrangeShard.start(); assert.equal(grid.style.display, '');
  const vehicle = OW.Mechanics.all().find((m) => m.isMule && m.gapOnHide);
  vehicle.els.wrap.style.visibility = 'hidden'; vehicle.els.wrap.style.display = '';
  const shown = Array.from(w.document.querySelectorAll('.card-wrap')).map((el) => OW.Mechanics.all().find((m) => m.els && m.els.wrap === el)).filter((m) => m && m._previewLock), ticker = OW.Mechanics.get('strangeshard');
  ticker.tick(true, 19);
  shown.forEach((m, i) => {
    const up = 20 - 10 * i / (shown.length - 1) > 19; // each card's own lifetime, 20 s down to 10 s
    assert.equal(m.els.wrap.style.display, up ? '' : 'none', m.id);
    assert.equal(m.els.wrap.style.visibility, '');
    assert.equal(m.els.wrap.hasAttribute('inert'), up);
  });
  assert.ok(shown.some((m) => m.els.wrap.style.display === '') && shown.some((m) => m.els.wrap.style.display === 'none'));
  ticker.tick(true, 1);
  assert.ok(shown.every((m) => m.els.wrap.style.display === 'none' && m.gapOnHide === undefined && !m._previewLock));
  assert.equal(vehicle.els.wrap.style.visibility, 'hidden');
  assert.equal(vehicle.els.wrap.style.display, '');
  assert.equal(grid.style.display, 'none');
  OW.StrangeShard.start();
  const saved = JSON.parse(JSON.stringify(OW.Save.serialize())); saved.savedAt = 0;
  OW.Save.deserialize(saved);
  assert.equal(OW.Mechanics.all().some((m) => m._previewLock), false);
  assert.ok(shown.every((m) => m.els.wrap.style.display === 'none'));
});

test('Reload ends preview, preserves completed intro; old saves start Dig Site cleanly', () => {
  const A = boot(); A.OW.Resources.add('stone', 1); A.m.tick(true, 0); A.OW.DigSite.completeIntro();
  const saved = JSON.parse(JSON.stringify(A.OW.Save.serialize())); saved.savedAt = 0;
  const B = boot(); B.OW.Save.deserialize(saved);
  assert.equal(B.state().introDone, true);
  assert.ok(B.OW.Mechanics.all().every((m) => !m._previewLock));
  assert.equal(B.OW.Mountains.isDiscovered(), false);
  delete saved.mechanics.digsite; delete saved.cards.digsite;
  const C = boot(); C.OW.Save.deserialize(saved);
  assert.equal(C.state().introDone, false); assert.equal(C.m.revealed, true);
});

test('Excavation drains per dig, opens the Ancient tunnel, travels 600 and leaves the TBD stub', () => {
  const { w, OW, m, state, load, unlock, animate } = boot(); unlock();
  OW.Resources.add('gold', 1000); OW.Workers.addWorkers(2);
  w.performance.now = () => 2000;
  m.els.wrap.querySelector('.card').click();
  const body = () => w.document.querySelector('#card-modal-body');
  assert.equal(body().querySelector('[data-ds-exc]').textContent, '10,000/10,000');
  assert.equal(body().querySelector('[data-ds-plus="tunnel"]'), null);
  OW.DigSite.subAssign('tunnel'); assert.equal(state().workers.tunnel, 0); // no tunnel yet
  OW.DigSite.subAssign('dig'); m.tick(true, 10); // 2 digs
  assert.equal(state().excavation, 9998);
  animate(1000); animate(1400);
  near(parseFloat(m.els.upgradeBar.style.width), 99.98);
  assert.ok(m.els.upgradeBar.classList.contains('tiered'));
  w.document.querySelector('#cheat-dig').click();
  assert.equal(state().excavation, 8);
  m.tick(true, 40); // 8 digs empty it
  assert.equal(state().excavation, 0);
  assert.match(body().textContent, /Ancient tunnel\s+Travel deeper underground\./);
  m.tick(true, 0); assert.equal(m.els.upgradeBar.classList.contains('tiered'), false); // green while travelling
  body().querySelector('[data-ds-plus="tunnel"]').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  body().querySelector('[data-ds-plus="tunnel"]').dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  OW.DigSite.subUnassign('dig');
  assert.equal(state().workers.tunnel, 1);
  assert.equal(body().querySelector('[data-ds-rate="tunnel"]').textContent, 'Exploring 1.00/s');
  assert.equal(m.getStatText(), 'Exploring 1.00/s');
  assert.equal(m.getBillableCount(), 1);
  m.tick(true, 300);
  assert.equal(state().tunnel, 300);
  const saved = JSON.parse(JSON.stringify(OW.Save.serialize())); saved.savedAt = 0;
  const B = boot(); B.OW.Save.deserialize(saved);
  assert.equal(B.state().excavation, 0); assert.equal(B.state().tunnel, 300);
  m.tick(true, 300);
  assert.equal(state().workers.tunnel, 0);
  assert.equal(OW.Workers.getAssigned('digsite'), 0);
  assert.match(body().textContent, /Deep in the Ancient tunnel\s*TBD/);
  assert.equal(body().querySelector('[data-ds-plus="tunnel"]'), null);
  animate(5000); assert.equal(m.els.upgradeBar.style.display, 'none');
  assert.ok(w.document.querySelector('#footer-log, body').textContent.includes("You've travelled deep into the Ancient tunnel."));
});

windows.forEach((w) => w.close());
console.log(`\n${checks} passed, ${failures} failed.`);
process.exitCode = failures ? 1 : 0;
