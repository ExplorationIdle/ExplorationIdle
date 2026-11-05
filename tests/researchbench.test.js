/* Research Bench (pages on a desk) + the Strange Shard card: rows, papers, workers, gold,
   Complete page, the Completed viewer, save/load, and the Shard flow through Temple+.
   jsdom has no element.animate, so every Motion scene is skipped (the offline/replay path). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
let checks = 0, failures = 0;
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m); // values cross the jsdom realm
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
  const tap = (el) => { el.dispatchEvent(new w.Event('pointerdown')); el.dispatchEvent(new w.Event('pointerup')); }; // hold-to-repeat steppers
  const R = OW.Resources, pool = OW.Workers, rb = M('researchbench'), sc = M('shardcard');
  const body = () => $('card-modal-body');
  const q = (s) => body().querySelector(s);
  const wait = () => { const t0 = Date.now(); while (Date.now() - t0 < 150); }; // past the ghost-click guard
  const openCard = (id) => { wait(); click(M(id).els.wrap.querySelector('.card')); };
  const rows = () => OW.Save.serialize().mechanics.researchbench.rows;
  // Bench usable: Dig Site's 15 lifetime digs, plus gold, papers and idle workers.
  function ready() {
    OW.DigSite.completeIntro(); OW.StrangeShard.clear(); OW.Workers.addWorkers(10);
    R.add('gold', 1e6); OW.DigSite.subAssign('dig');
    while (OW.DigSite.digs() < 15) OW.Loop.runBulk(1, 0.2);
    pool.unassign('digsite'); OW.Loop.runBulk(1, 0.2);
    R.add('researchpapers', 1000);
  }
  function reload() {
    const d = JSON.parse(JSON.stringify(OW.Save.serialize())); d.savedAt = 0;
    const B = boot(); B.OW.Save.deserialize(d); B.OW.Loop.runBulk(1, 0);
    return B;
  }
  return { w, OW, doc, M, $, click, tap, R, pool, rb, sc, q, openCard, rows, ready, reload, errors };
}

test('Page I lands on the desk once the bench is full; face + fills the first unfinished row', () => {
  const T = boot(); T.ready();
  same(T.OW.Save.serialize().mechanics.researchbench.desk, ['shard']);
  T.tap(T.rb.els.cardStepperPlus); T.tap(T.rb.els.cardStepperPlus);
  T.tap(T.rb.els.cardStepperMinus); T.tap(T.rb.els.cardStepperPlus);
  same(T.rows()['shard:0'], [0, 2]);
  T.openCard('researchbench');
  T.click(T.q('[data-pg-plus="shard:3"]'));
  T.tap(T.rb.els.cardStepperMinus); // face − takes from the last row with workers
  same([T.rows()['shard:0'][1], T.rows()['shard:3'][1]], [2, 0]);
  assert.ok(T.$('card-modal-win').classList.contains('modal-wide'));
  assert.equal(T.doc.querySelectorAll('#card-modal-body .pg-slot').length, 1);
  assert.equal(T.q('.pg-slot').style.transform, 'translate(0px, 0px) rotate(1.5deg)', 'Page I alone: its own spot');
  assert.equal(T.q('[data-pg-text="shard:0"]').textContent, '? ? ?');
});

test('1 paper per worker per second, paid; a finished row reveals and its workers move down', () => {
  const T = boot(); T.ready();
  const p0 = T.R.get('researchpapers'), idle0 = T.pool.getIdleCount();
  T.openCard('researchbench');
  T.click(T.q('[data-pg-plus="shard:1"]')); T.click(T.q('[data-pg-plus="shard:1"]'));
  T.OW.Loop.runBulk(5, 0.2); // 1 s × 2 workers
  assert.ok(Math.abs(p0 - T.R.get('researchpapers') - 2) < 1e-9);
  assert.ok(Math.abs(T.rows()['shard:1'][0] - 2) < 1e-9);
  assert.equal(T.q('[data-pg-amt="shard:1"]').textContent, '2/50');
  assert.equal(T.rb.getStatText(), 'Researching – 1 paper', 'counts pages, not workers');
  T.click(T.q('[data-pg-plus="shard:0"]')); // Category: 10 papers
  T.OW.Loop.runBulk(60, 0.2);
  same(T.rows()['shard:0'], [10, 0]);
  assert.equal(T.rows()['shard:1'][1], 3, 'Category worker moved down to Title');
  assert.equal(T.pool.getIdleCount(), idle0 - 3, 'still on the bench');
  assert.equal(T.rb.getStatText(), 'Researching – 1 paper');
  assert.equal(T.q('[data-k="0"] .pg-text').textContent, 'Research');
  assert.ok(T.q('[data-k="0"] .pg-check'));
  T.R.spend('gold', T.R.get('gold'));
  const r = T.rows()['shard:1'], t = r[0]; T.OW.Loop.runBulk(5, 0.2);
  assert.ok(r[1] > 0 && T.rows()['shard:1'][0] === t, 'no gold, no research');
  assert.equal(T.rb.getStatText(), 'Stopped');
});

test('Effect finishing wraps its workers to the top', () => {
  const T = boot(); T.ready(); T.openCard('researchbench');
  T.click(T.q('[data-pg-plus="shard:1"]'));
  for (let i = 0; i < 3; i++) T.click(T.q('[data-pg-plus="shard:3"]'));
  T.OW.Loop.runBulk(170, 0.2); // 34 s: Effect (100 at 3/s) done, Title (50 at 1/s) not
  same([T.rows()['shard:3'], T.rows()['shard:0'][1], T.rows()['shard:1'][1]], [[100, 0], 3, 1]);
});

test('Camp and Stock Market land after Page I; Trading Post, Mountains and Study after both: Camp upgrades Builders Bench, Study renames the bench', () => {
  const T = boot(); T.ready(); T.R.add('wood', 10); T.openCard('researchbench');
  const finish = (id) => { for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) T.click(T.q(`[data-pg-plus="${id}:${k}"]`)); T.OW.Loop.runBulk(400, 0.2); };
  T.OW.Loop.runBulk(5, 0.2);
  same(T.OW.Save.serialize().mechanics.researchbench.desk, ['shard'], 'Pages 2 and 3 wait for Page I');
  finish('shard'); T.click(T.q('[data-pg-complete="shard"]'));
  T.OW.Loop.runBulk(3, 0.2);
  same(T.OW.Save.serialize().mechanics.researchbench.desk, ['camp', 'stock']);
  T.openCard('researchbench');
  same([T.q('[data-pg-amt="camp:0"]').textContent, T.q('[data-pg-total="camp"]').textContent, T.q('[data-pg-total="stock"]').textContent], ['0/5', '0/90', '0/46']);
  same([0, 1, 2, 3].map((k) => T.q(`[data-pg-amt="stock:${k}"]`).textContent), ['0/3', '0/13', '0/5', '0/25'], 'quarter cost, rounded up');
  T.click(T.q('[data-pg-plus="camp:0"]')); T.click(T.q('[data-pg-plus="camp:0"]')); T.click(T.q('[data-pg-plus="stock:0"]'));
  assert.equal(T.rb.getStatText(), 'Researching – 2 papers');
  T.click(T.q('[data-pg-minus="stock:0"]'));
  const bb = T.M('buildersbench'), track = T.OW.Upgrades.getTrack('buildersbench:build');
  const listed = () => track.serialize().s;
  same([listed().scoutspen[0], listed().toolshed[0], listed().tents[0], listed().marketstall[0], 'academy' in listed()], [0, 0, 1, 1, false]);
  finish('camp');
  T.click(T.q('[data-pg-complete="camp"]'));
  assert.equal(T.OW.Cards.isModalOpenFor('researchbench'), false);
  assert.equal(bb.cardName(), 'Camp');
  same([listed().scoutspen[0], listed().toolshed[0]], [1, 1], 'Trading Post and Tool Shed join the list');
  T.OW.Loop.runBulk(3, 0.2);
  same(T.OW.Save.serialize().mechanics.researchbench.desk, ['stock'], 'section 3 waits for Stock Market too');
  T.openCard('researchbench'); finish('stock'); T.click(T.q('[data-pg-complete="stock"]'));
  T.OW.Loop.runBulk(3, 0.2);
  same(T.OW.Save.serialize().mechanics.researchbench.desk, ['tradepost', 'mountains', 'study']);
  T.openCard('researchbench');
  same(['tradepost', 'mountains', 'study'].map((id) => T.q(`[data-pg-total="${id}"]`).textContent), ['0/90', '0/46', '0/180']);
  finish('study'); T.click(T.q('[data-pg-complete="study"]'));
  assert.equal(T.rb.cardName(), 'Study');
  T.openCard('researchbench'); assert.equal(T.$('card-modal-title').textContent, 'Study');
  same(T.OW.Save.serialize().mechanics.researchbench.done, ['shard', 'camp', 'stock', 'study']);
  same([...T.doc.querySelectorAll('#card-modal-body .pg-done-item:not(.pg-aside-item) .hs-title')].map((e) => e.textContent), ['Study', 'Stock Market', 'Camp', 'Strange Shard'], 'newest first');
  assert.equal(T.doc.querySelectorAll('#card-modal-body .pg-aside-item').length, 6, 'from Study on, Set aside lists every page waiting off the desk');
  const C = T.reload();
  same([C.rb.cardName(), C.M('buildersbench').cardName(), C.OW.Upgrades.getTrack('buildersbench:build').serialize().s.toolshed[0]], ['Study', 'Camp', 1]);
  same(T.errors, []);
});

test('Stock Market page: the tab opens locked until Complete, which opens Market Stall on it', () => {
  const T = boot(); T.ready(); T.OW.Cards.reveal(T.M('marketstall'));
  const finish = (id) => { for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) T.click(T.q(`[data-pg-plus="${id}:${k}"]`)); T.OW.Loop.runBulk(400, 0.2); };
  T.openCard('marketstall'); T.click(T.q('[data-ms-tab="stock"]'));
  assert.equal(T.q('.sp-tab-body').textContent.trim(), 'Unlock Stock Market at the Research Bench.');
  assert.equal(T.q('[data-ms-view]'), null);
  T.click(T.q('[data-ms-tab="selling"]')); T.OW.Cards.closeModal();
  T.openCard('researchbench'); finish('shard'); T.click(T.q('[data-pg-complete="shard"]'));
  T.OW.Loop.runBulk(2, 0.2); T.openCard('researchbench'); finish('stock');
  T.click(T.q('[data-pg-complete="stock"]'));
  assert.ok(T.OW.Cards.isModalOpenFor('marketstall'), 'Market Stall opens');
  assert.ok(T.q('.sp-tab[data-ms-tab="stock"]').classList.contains('active'));
  assert.ok(T.q('[data-ms-view]'), 'Stock Market unlocked');
  const C = T.reload(); C.openCard('marketstall');
  assert.ok(C.q('[data-ms-view]'), 'unlock saved');
  same(T.errors, []);
});

// A fresh game with these Study pages fully researched on the desk (every pre-Study page done).
function primed(ids, rows) {
  const T = boot(); T.ready();
  const d = JSON.parse(JSON.stringify(T.OW.Save.serialize())); d.savedAt = 0;
  d.mechanics.researchbench = { desk: ids, done: ['shard', 'camp', 'stock', 'tradepost', 'mountains', 'study'], layout: 0, study: true,
    rows: rows || Object.fromEntries(ids.flatMap((id) => [0, 1, 2, 3].map((k) => [`${id}:${k}`, [1e4, 0]]))) };
  const B = boot(); B.OW.Save.deserialize(d); B.OW.Loop.runBulk(1, 0);
  return B;
}

test('Study pages land at random after Study; Camp and Study open their modals; caps; Temple Ruins', () => {
  const T = boot(); T.ready(); T.R.add('researchpapers', 5000); T.R.add('wood', 10); T.openCard('researchbench');
  const finish = (id) => { for (let k = 0; k < 4; k++) for (let i = 0; i < 3; i++) T.click(T.q(`[data-pg-plus="${id}:${k}"]`)); T.OW.Loop.runBulk(400, 0.2); };
  finish('shard'); T.click(T.q('[data-pg-complete="shard"]')); T.OW.Loop.runBulk(3, 0.2);
  T.openCard('researchbench'); finish('camp'); T.click(T.q('[data-pg-complete="camp"]'));
  assert.ok(T.OW.Cards.isModalOpenFor('buildersbench'), 'Camp opens after the flash');
  T.OW.Cards.closeModal(); T.openCard('researchbench'); finish('stock'); T.click(T.q('[data-pg-complete="stock"]'));
  T.OW.Cards.closeModal(); T.OW.Loop.runBulk(3, 0.2); T.openCard('researchbench'); finish('study'); T.click(T.q('[data-pg-complete="study"]'));
  assert.ok(T.OW.Cards.isModalOpenFor('researchbench'), 'Study opens after the flash');
  assert.equal(T.$('card-modal-title').textContent, 'Study');
  T.OW.Loop.runBulk(3, 0.2);
  const STUDY = ['woodcap', 'stonecap', 'huts', 'axes', 'pickaxes', 'templeruins'], dk = T.OW.Save.serialize().mechanics.researchbench.desk;
  assert.equal(dk.slice(0, 2).join(), 'tradepost,mountains'); assert.ok(dk.slice(2).every((id) => STUDY.includes(id)), 'a Study page joins');
  T.OW.Cards.refreshOpenModal('researchbench');
  const E = primed(['woodcap', 'stonecap'], {}); E.openCard('researchbench');
  same(['woodcap', 'stonecap'].map((id) => E.q(`[data-pg-total="${id}"]`).textContent), ['0/90', '0/226']);
  const P = primed(['woodcap', 'stonecap', 'templeruins']);
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="woodcap"]'));
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="stonecap"]'));
  same([P.R.getCap('wood'), P.R.getCap('stone')], [6000, 3000]);
  assert.equal(P.M('ruinedtemple').revealed, false);
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="templeruins"]'));
  assert.equal(P.M('ruinedtemple').revealed, false, 'the page offers an Expedition instead');
  const C = P.reload();
  same([C.R.getCap('wood'), C.R.getCap('stone'), C.M('ruinedtemple').revealed], [6000, 3000, false]);
  same([T.errors, P.errors], [[], []]);
});

test("Trading Post and Mountains pages unlock Camp's Trading Post tabs, then open it on that tab", () => {
  const T = boot(); T.ready();
  const d = JSON.parse(JSON.stringify(T.OW.Save.serialize())); d.savedAt = 0;
  d.mechanics.researchbench = { desk: ['tradepost', 'mountains'], done: ['shard', 'camp', 'stock'], layout: 0,
    rows: Object.fromEntries(['tradepost', 'mountains'].flatMap((id) => [0, 1, 2, 3].map((k) => [`${id}:${k}`, [1e4, 0]]))) };
  const P = boot(); P.OW.Save.deserialize(d); P.OW.Loop.runBulk(1, 0);
  P.OW.Cards.reveal(P.M('scoutspen'));
  const tab = () => P.q('.sp-tab.active').dataset.spTab;
  P.openCard('scoutspen');
  same([tab(), P.q('.sp-no-dest').textContent, !!P.q('.sp-locked[inert]')], ['resupply', 'Visit the Research Bench to unlock Resupply.', true]);
  P.click(P.q('[data-sp-tab="expedition"]')); assert.equal(P.q('.sp-tab-greyed').textContent, 'Visit the Research Bench to unlock Expeditions.');
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="mountains"]'));
  assert.ok(P.OW.Cards.isModalOpenFor('scoutspen') && tab() === 'expedition' && P.q('[data-sp-action="prepare-mule"]'), 'Mountains opens the Expedition tab, unlocked');
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="tradepost"]'));
  assert.ok(P.OW.Cards.isModalOpenFor('scoutspen') && tab() === 'resupply' && P.q('.sp-no-dest').textContent === 'No discovered destinations. Use Expedition tab', 'Trading Post opens Resupply, unlocked');
  same(P.reload().OW.Save.serialize().mechanics.researchbench.done, ['shard', 'camp', 'stock', 'mountains', 'tradepost']);
  same(P.errors, []);
});

test('Temple Ruins page: an Expedition on Camp and Mountains Trading Posts, 1 worker, no resources, 120 s; the worker joins the Temple Ruins', () => {
  const P = primed(['templeruins']), { OW, M } = P, tab = () => P.q('.sp-tab.active').dataset.spTab;
  OW.Cards.reveal(M('scoutspen'));
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="templeruins"]'));
  assert.ok(OW.Cards.isModalOpenFor('scoutspen') && tab() === 'expedition', 'pans, flashes, opens on Expedition');
  assert.ok(P.q('[data-sp-action="prepare-mule"]') && P.q('[data-tt-go="camp"]'), 'beside the Mountains Expedition');
  OW.Cards.closeModal(); OW.Cards.open(M('mtn_scoutstable')); P.click(P.q('[data-sp-tab="expedition"]'));
  const go = () => P.q('[data-tt-go="mountains"]');
  assert.ok(go() && go().disabled && P.q('[data-tt-need] .sp-short').textContent === '0/1', 'Mountains: needs 1 idle worker');
  OW.Mountains.addWorkers(1); M('mtn_scoutstable').patchLiveTrack();
  assert.ok(!go().disabled && P.q('[data-tt-need]').textContent === '1/1');
  OW.Cards.closeModal(); OW.Cards.open(M('scoutspen')); P.click(P.q('[data-sp-tab="expedition"]'));
  const camp = OW.Workers.getTotal(), wood = P.R.get('wood'), rt = OW.RuinedTemple.workerPool.getTotal();
  P.click(P.q('[data-tt-go="camp"]'));
  assert.ok(!OW.Cards.isModalOpenFor('scoutspen') && M('templemule').revealed && !M('mtn_templemule').revealed, 'Camp mule leaves at once');
  same([OW.Workers.getTotal(), P.R.get('wood')], [camp - 1, wood], '1 worker, no resources');
  OW.Cards.open(M('mtn_scoutstable')); P.click(P.q('[data-sp-tab="expedition"]'));
  assert.equal(P.q('.sp-tab-greyed').textContent, 'Visit the Study for more Expeditions.', 'one trip, gone from both posts');
  OW.Cards.closeModal(); OW.Loop.runBulk(300, 0.2);
  assert.ok(/^To the Temple Ruins… 60s$/.test(M('templemule').getStatText()), M('templemule').getStatText());
  const C = P.reload();
  assert.ok(C.M('templemule').revealed && !C.M('ruinedtemple').revealed, 'mid-trip reload');
  C.OW.Loop.runBulk(305, 0.2);
  same([C.M('ruinedtemple').revealed, C.M('templemule').revealed, C.OW.RuinedTemple.workerPool.getTotal(), C.OW.Workers.getTotal()], [true, false, rt + 1, camp - 1]);
  same(C.reload().OW.Save.serialize().mechanics.templetrip.p, 'delivered');
  same([P.errors, C.errors], [[], []]);
});

test('Tool tiers: Wood Pile ×4 per work on Tools II, falls back to I without; Tents become Huts', () => {
  const P = primed(['huts', 'axes', 'pickaxes']), { R, M, OW } = P, wood = M('wood'), pill = (m) => m.els.wrap.querySelector('.card-tier-pill');
  OW.Cards.reveal(M('tents'));
  assert.equal(pill(wood).style.display, 'none', 'no face pill before the page');
  assert.equal(wood.getSubtitleHtml(), '');
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="axes"]'));
  assert.equal(pill(wood).style.display, '', 'Tier II picked on unlock');
  P.openCard('wood'); assert.ok(P.$('card-modal-header-sub').querySelector('[data-tu-tier="wood:1"].off'));
  R.setRaw('wood', 0); R.add('tools2', 10); OW.Workers.assign('wood');
  OW.Loop.runBulk(5, 0.2);
  const w3 = R.get('wood');
  assert.ok(Math.abs(R.get('tools2') - 9) < 1e-9, '1 Tools II per worker per second');
  R.setRaw('tools2', 0); OW.Loop.runBulk(1, 0.2);
  assert.equal(wood.tools.tier(), 1, 'out of Tools II: back to Tier I');
  assert.equal(pill(wood).style.display, 'none');
  R.setRaw('wood', 0); OW.Loop.runBulk(5, 0.2);
  assert.ok(Math.abs(w3 / R.get('wood') - 4) < 1e-6, 'Tier II gives 4× per work');
  // Balance: a Tier II chain (card worker + Tool Shed workers feeding it) beats the same workers on Tier I,
  // pricing the tool's wood and stone at Tier I gathering time.
  const n = OW.Workers.getAssigned('wood'), r1 = R.get('wood') / n, r2 = w3 / n; // per worker per second (runBulk(5, 0.2) = 1s)
  OW.Workers.unassign('wood');
  R.setRaw('stone', 0); OW.Workers.assign('stone'); const ns = OW.Workers.getAssigned('stone');
  OW.Loop.runBulk(5, 0.2); const rs = R.get('stone') / ns; OW.Workers.unassign('stone');
  const t2 = M('toolshed')._debug.RECIPES.tools2, amt = (id) => t2.inputs.find((i) => i.id === id).amt;
  assert.ok((r2 / r1 - amt('wood') / r1 - amt('stone') / rs) / (1 + t2.cycleTime) > 1, 'Tier II chain beats the same workers on Tier I');
  // Tents → Huts (5 tents built first: huts keep their own count and start at the base cost)
  const sv = JSON.parse(JSON.stringify(OW.Save.serialize())); sv.savedAt = 0; sv.mechanics.tents = { n: 5 }; OW.Save.deserialize(sv); OW.Loop.runBulk(1, 0);
  const tents = M('tents'), statRows = () => [...P.doc.querySelectorAll('#card-modal-body .stat-label')].map((e) => e.textContent);
  P.openCard('tents'); assert.ok(!statRows().includes('Huts built'), 'no Huts row before the unlock'); OW.Cards.closeModal();
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="huts"]'));
  assert.equal(tents.cardName(), 'Huts'); assert.ok(OW.Cards.isModalOpenFor('tents'), 'Huts opens after the flash'); OW.Cards.closeModal();
  R.add('wood', 100); R.add('stone', 100); R.add('tools2', 100);
  const w0 = R.get('wood'), s0 = R.get('stone');
  OW.Workers.assign('tents'); OW.Loop.runBulk(1, 0.2);
  assert.ok(Math.abs((w0 - R.get('wood')) - (s0 - R.get('stone'))) < 1e-9 && R.get('stone') < s0, 'a hut costs the same stone as wood');
  assert.ok(Math.abs(w0 - R.get('wood') - 0.01) < 1e-9, 'the first hut costs the base, not the 6th tent');
  assert.ok(/^Stacking – .* remaining$/.test(tents.getStatText()) && tents.getWorkerDesc().startsWith('Stacking '), 'huts use the verb Stacking');
  P.openCard('tents'); const tier = (n) => P.click(P.$('card-modal-header-sub').querySelector(`[data-tu-tier="tents:${n}"]`)); tier(1);
  same([tents.cardName(), Math.abs(R.get('stone') - s0) < 1e-9], ['Tents', true], 'switching cancels and refunds');
  tier(2);
  R.setRaw('tools2', 0); OW.Loop.runBulk(2, 0.2);
  same([tents.getStatText(), tents.isBillable()], ['Stopped', false], 'no Tools II: Stopped, unpaid');
  R.add('tools2', 100);
  OW.Loop.runBulk(400, 0.2);
  const ts = OW.Save.serialize().mechanics.tents;
  assert.ok(ts.n === 5 && ts.h > 0 && OW.Footer.getHistory().some((e) => e.t === 'Hut built. +1 idle worker.'), 'huts count on their own');
  P.openCard('tents'); same([statRows().slice(0, 2), P.q('[data-stat="tents"]').textContent, P.q('[data-stat="huts"]').textContent], [['Tents built', 'Huts built'], '5', String(ts.h)]);
  P.openCard('researchbench'); P.click(P.q('[data-pg-complete="pickaxes"]'));
  assert.equal(OW.Footer.getHistory()[0].t, 'Page complete: Stone Pit.');
  const C = P.reload();
  assert.equal(C.OW.Save.serialize().mechanics.tents.h, ts.h, 'huts count saved');
  same([C.M('tents').cardName(), C.M('wood').tools.tier(), C.M('stone').tools.tier(), C.M('stone').els.wrap.querySelector('.card-tier-pill').style.display], ['Huts', 1, 2, '']);
  same(P.errors, []);
});

test('Text types in by share paid; no papers stops a row', () => {
  const T = boot(); T.ready(); T.R.spend('researchpapers', T.R.get('researchpapers')); T.R.add('researchpapers', 25);
  T.openCard('researchbench'); T.click(T.q('[data-pg-plus="shard:1"]'));
  T.OW.Loop.runBulk(200, 0.2);
  assert.equal(T.rows()['shard:1'][0], 25);
  assert.equal(T.q('[data-pg-text="shard:1"]').textContent, 'Strang· ·····'); // half of "Strange Shard"
  assert.equal(T.q('[data-pg-amt="shard:1"]').textContent, 'No papers');
  assert.equal(T.rb.getStatText(), 'No papers');
});

test('Complete page: Completed list + viewer, Strange Shard card, layout rolled, save/load at every step', () => {
  const T = boot(); T.ready();
  const s0 = T.OW.Save.serialize().mechanics.researchbench;
  T.openCard('researchbench');
  assert.ok(T.q('[data-pg-complete="shard"]').disabled, 'Complete page greyed while researching');
  assert.equal(T.q('.pg-page-title').textContent.trim(), '0/180', 'total top left, no page name');
  assert.equal(T.rb.getBuildBarPct(), 0);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 2; i++) T.click(T.q(`[data-pg-plus="shard:${k}"]`));
  const B = T.reload(); assert.equal(JSON.stringify(B.rows()), JSON.stringify(T.rows()), "mid-research reload");
  T.OW.Loop.runBulk(300, 0.2);
  assert.equal(T.rb.getStatText(), '1 page ready');
  assert.equal(T.q('[data-pg-total="shard"]').textContent, 'Ready');
  assert.equal(T.rb.els.buildBar.style.display, '', 'bottom bar shows the page closest to done');
  assert.equal(T.rb.els.upgradeBar.style.display, 'none', 'top bar unused');
  assert.equal(T.rb.getBuildBarPct(), 100);
  const idle = T.pool.getIdleCount();
  same(Object.values(T.rows()).map((r) => r[1]), [0, 0, 0, 0]);
  T.click(T.q('[data-pg-complete="shard"]'));
  assert.equal(T.OW.Cards.isModalOpenFor('researchbench'), false, 'Complete closes the modal');
  assert.equal(T.pool.getIdleCount(), idle, 'workers stay on the bench');
  assert.equal(T.rb.getStatText(), 'Stopped');
  assert.equal(T.rb.getBillableCount(), 0, 'idle bench workers are unpaid');
  assert.equal(T.rb.els.buildBar.style.display, 'none', 'no page, no bar');
  const s1 = T.OW.Save.serialize().mechanics.researchbench;
  same(s1.done, ['shard']); same(s1.desk, []);
  assert.ok(T.OW.Footer.getHistory().some((e) => e.t === 'Page complete: Strange Shard.'));
  assert.ok(T.sc.revealed, 'Strange Shard card added');
  assert.equal(T.sc.els.wrap.previousElementSibling, T.rb.els.wrap, 'right after Research Bench');
  T.openCard('researchbench');
  assert.equal(T.q('.pg-done-item .hs-title').textContent, 'Strange Shard');
  T.click(T.q('[data-pg-open="shard"]'));
  assert.ok(T.q('.pg-view .pg-stamp'));
  assert.equal(T.q('.pg-view .pg-page-title').textContent.trim(), '180/180');
  assert.equal(T.doc.querySelectorAll('#card-modal-body .pg-view .pg-text')[3].textContent, "A glimpse of the Shard's destination");
  T.click(T.q('[data-pg-close]')); assert.equal(T.q('.pg-view'), null);
  const C = T.reload();
  same(C.OW.Save.serialize().mechanics.researchbench.done, ['shard']);
  assert.ok(C.sc.revealed);
  assert.ok(s0.layout >= 0 && s0.layout < 4);
  same(T.errors, []);
});

test('Strange Shard: Show your future → Temple+ → Drop torch → modal reopens → Take the Shard', () => {
  const T = boot(); T.ready();
  T.OW.ShardCard.add(); T.OW.Loop.runBulk(1, 0.2);
  assert.ok(T.sc.revealed && T.sc.noPin);
  T.openCard('shardcard');
  T.click(T.q('[data-sc-future]'));
  assert.equal(T.OW.Cards.isModalOpenFor('shardcard'), false, 'modal closed');
  assert.equal(T.$('templeplus-section').style.display, '', 'Temple+ shown');
  const R1 = T.reload(); // vision started, torch not dropped: Temple+ waits, Take not offered
  assert.equal(R1.$('templeplus-section').style.display, '');
  R1.openCard('shardcard'); assert.ok(R1.q('[data-sc-future]'));
  T.click(T.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.equal(T.OW.Cards.isModalOpenFor('shardcard'), true, 'modal reopened after the torch scene');
  assert.equal(T.$('templeplus-section').style.display, 'none', 'Temple+ gone');
  assert.ok(T.q('[data-sc-take]'));
  const R2 = T.reload(); R2.openCard('shardcard'); assert.ok(R2.q('[data-sc-take]'), 'Take survives a reload');
  T.click(T.q('[data-sc-take]'));
  assert.equal(T.OW.Cards.isModalOpenFor('shardcard'), false);
  assert.equal(T.R.get('shard'), 1);
  assert.ok(T.$('left-hand-real-resources').textContent.includes('Shard'));
  assert.equal(T.sc.els.wrap.style.display, 'none', 'card gone');
  assert.ok(T.OW.Footer.getHistory().some((e) => e.t === 'You take the Shard.'));
  const R3 = T.reload(); assert.equal(R3.sc.els.wrap.style.display, 'none'); assert.equal(R3.R.get('shard'), 1);
  same(T.errors, []);
});

test('The Temple+ cheat first does not block the Shard vision', () => {
  const T = boot(); T.ready();
  T.click(T.$('cheat-templeplus')); T.click(T.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.equal(T.OW.TemplePlus.used(), true);
  T.OW.ShardCard.add(); T.OW.Loop.runBulk(1, 0.2);
  T.openCard('shardcard'); T.click(T.q('[data-sc-future]'));
  assert.equal(T.$('templeplus-section').style.display, '');
  T.click(T.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.ok(T.q('[data-sc-take]'));
});

test('Bench classes never touch the rail breakdown; the Shard band is jade with only Near and Far', () => {
  const T = boot(); T.ready();
  T.openCard('researchbench');
  assert.equal(T.doc.querySelectorAll('#card-modal-body [class*="rb-"]').length, 0, 'bench uses pg-');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.ok(!css.split('RESEARCH BENCH: PAGES')[1].includes('.rb-'), 'no rb- in the bench CSS');
  assert.ok(/\.res-band\[data-res\$="shard"\] \.res-name[^}]*--temple-text/.test(css));
  T.R.add('shard', 1);
  const band = T.doc.querySelector('#left-hand .res-band[data-res="shard"]');
  T.click(band.querySelector('.res-name'));
  const bd = () => band.querySelector('.res-breakdown');
  same([...bd().querySelectorAll('button')].map((b) => b.textContent), ['Near', 'Far']);
  T.OW.Loop.runBulk(3, 0.2); T.OW.Rates.render();
  assert.ok(bd().querySelector('[data-sc-near]') && !bd().querySelector('.rb-row, .rb-state'), 'not repainted by the tick');
  T.click(bd().querySelector('[data-sc-near]'));
  assert.ok(band.classList.contains('open'), 'a button press keeps the band open');
  T.click(band.querySelector('.res-name')); assert.equal(bd(), null);
  const gold = T.doc.querySelector('#left-hand .res-band[data-res="gold"]');
  T.click(gold.querySelector('.res-name')); assert.ok(gold.querySelector('.res-breakdown .rb-state'), 'other bands keep their breakdown');
});

test('Near replays the glimpse for unrevealed cards only; Far replays Temple+; each ignored while its vision runs', () => {
  const T = boot(); T.ready(); T.R.add('shard', 1);
  const band = T.doc.querySelector('#left-hand .res-band[data-res="shard"]');
  T.click(band.querySelector('.res-name'));
  const press = (k) => T.click(band.querySelector(`[data-sc-${k}]`));
  const hidden = T.OW.Mechanics.all().filter((m) => m.els && ['marketstall', 'scoutspen'].includes(m.id) && !m.revealed);
  assert.ok(hidden.length, 'some cards still unrevealed');
  press('near');
  assert.ok(T.OW.StrangeShard.active());
  assert.ok(hidden.every((m) => m._previewLock), 'unrevealed cards glimpsed');
  assert.ok(!T.M('wood')._previewLock, 'revealed cards stay out');
  const left = () => T.M(hidden[0].id).getUpgradeBarPct();
  T.OW.Loop.runBulk(10, 0.2); const p = left();
  press('near'); assert.equal(left(), p, 'second Near ignored while the glimpse counts down');
  T.OW.Loop.runBulk(200, 0.2); assert.equal(T.OW.StrangeShard.active(), false);
  press('near'); assert.ok(T.OW.StrangeShard.active(), 'Near works again once it ends');
  T.OW.StrangeShard.clear();
  T.OW.Mechanics.all().forEach((m) => { if (m.els && !m.revealed && m.id !== 'shardcard') T.OW.Cards.reveal(m); });
  press('near');
  assert.equal(T.OW.StrangeShard.active(), false);
  assert.equal(T.OW.Footer.getHistory()[0].t, 'The Shard shows nothing new.');
  press('far');
  assert.equal(T.$('templeplus-section').style.display, '');
  assert.ok(T.OW.TemplePlus.waiting());
  const n = T.OW.Footer.getHistory().length;
  press('far'); assert.ok(T.OW.TemplePlus.waiting()); assert.equal(T.OW.Footer.getHistory().length, n);
  T.click(T.M('tp_crack').els.wrap.querySelector('.tp-face-btn'));
  assert.equal(T.$('templeplus-section').style.display, 'none');
  press('far'); assert.equal(T.$('templeplus-section').style.display, '', 'Far works again after the torch');
  same(T.errors, []);
});

test('Shuffle: locks keep pages, cost grows, sent pages set aside with progress kept, then rejoin; saved', () => {
  // Partial progress on huts, with 2 workers on it.
  const P = primed(['woodcap', 'stonecap', 'huts'], { 'huts:0': [23, 0], 'huts:1': [60, 2] }), { OW, R } = P, rb = () => OW.Save.serialize().mechanics.researchbench;
  OW.Workers.assign('researchbench'); OW.Workers.assign('researchbench');
  const papers = () => R.available('researchpapers');
  P.openCard('researchbench');
  const btn = () => P.q('[data-pg-shuffle]');
  assert.equal(btn().textContent, 'Shuffle – 20 papers');
  P.click(P.q('[data-pg-lock="woodcap"]'));
  assert.ok(P.q('[data-pg-lock="woodcap"]').classList.contains('locked')); assert.equal(P.q('[data-pg-lock="woodcap"]').textContent, '🔒');
  const before = papers(); P.click(btn());
  same([rb().desk, rb().aside, rb().shuffles, Math.round(before - papers())], [['woodcap'], ['stonecap', 'huts'], 1, 20]);
  same([rb().rows['huts:1'], rb().rows['huts:0']], [[60, 0], [23, 0]], 'progress kept, workers off the page');
  assert.equal(OW.Workers.getAssigned('researchbench'), 2, 'workers stay on the bench');
  assert.equal(P.rb.getBillableCount(), 0, 'idle, unpaid');
  same([...P.doc.querySelectorAll('.pg-slot')].map((e) => e.dataset.pgSlot), ['woodcap'], 'desk redrawn');
  same([...P.doc.querySelectorAll('.pg-aside-item')].map((e) => e.querySelector('.pg-eff').textContent), ['0/226', '83/406', '0/360', '0/270', '0/720'], 'every waiting page, PAGES order');
  same([...P.doc.querySelectorAll('.pg-aside-item .hs-title')].map((e) => e.textContent).slice(0, 2), ['? ? ?', 'Te···'], 'title typed so far');
  P.click(P.q('[data-pg-open="huts"]')); // opens read only, progress so far
  const v = (s) => [...P.doc.querySelectorAll(`#card-modal-body .pg-view ${s}`)];
  same([v('.pg-page-title')[0].textContent.trim(), v('.pg-check').length, v('.wf-tag').map((e) => e.textContent), v('.pg-text').map((e) => e.textContent),
    v('.card-stepper-btn:not(.pg-view-close)').length + v('[data-pg-complete]').length + v('[data-pg-lock]').length, v('.pg-stamp')[0].textContent],
    ['83/406', 1, ['', '60/113', '0/45', '0/225'], ['Upgrade', 'Te···', '? ? ?', '? ? ?'], 0, 'Set aside']);
  P.click(P.q('[data-pg-close]')); assert.equal(P.q('.pg-view'), null);
  OW.Loop.runBulk(3, 0.2);
  const dk = rb().desk; assert.equal(dk.length, 3);
  assert.ok(dk.slice(1).every((id) => ['axes', 'pickaxes', 'templeruins'].includes(id)), 'set-aside pages not drawn');
  P.openCard('researchbench'); assert.equal(btn().textContent, 'Shuffle – 34 papers');
  const C = P.reload(), cb = C.OW.Save.serialize().mechanics.researchbench;
  same([cb.desk, cb.aside, cb.shuffles, cb.locks, cb.rows['huts:1']], [dk, ['stonecap', 'huts'], 1, ['woodcap'], [60, 0]], 'saved');
  // Lock everything: greyed. Unlock: no papers: greyed.
  C.openCard('researchbench'); dk.slice(1).forEach((id) => C.click(C.q(`[data-pg-lock="${id}"]`)));
  C.OW.Loop.runBulk(1, 0.2); assert.equal(C.q('[data-pg-shuffle]').disabled, true, 'all locked');
  C.click(C.q('[data-pg-lock="woodcap"]')); C.OW.Loop.runBulk(1, 0.2); assert.equal(C.q('[data-pg-shuffle]').disabled, false);
  C.R.spend('researchpapers', C.R.available('researchpapers') - 10); C.OW.Loop.runBulk(1, 0.2);
  assert.equal(C.q('[data-pg-shuffle]').disabled, true, 'papers short');
  // Second shuffle: stonecap/huts rejoin, woodcap is the one kept out.
  C.R.add('researchpapers', 1000); C.click(C.q('[data-pg-shuffle]'));
  same(C.OW.Save.serialize().mechanics.researchbench.aside, ['woodcap']);
  C.OW.Loop.runBulk(1, 0.2);
  assert.notEqual(C.OW.Save.serialize().mechanics.researchbench.desk.slice(-1)[0], 'woodcap', 'the newly sent page is kept out');
  C.openCard('researchbench');
  const listed = [...C.doc.querySelectorAll('.pg-aside-item')].map((e) => e.dataset.pgOpen), dk2 = C.OW.Save.serialize().mechanics.researchbench.desk;
  assert.ok(listed.includes('woodcap') && listed.every((id) => !dk2.includes(id)), 'the list is every page off the desk');
  same([P.errors, C.errors], [[], []]);
});

test('No dead end: only set-aside pages left, a free slot takes one; no Shuffle before Study', () => {
  const T = boot(); T.ready(); T.openCard('researchbench'); assert.equal(T.q('[data-pg-shuffle]'), null, 'no Shuffle before Study');
  T.OW.Cards.closeModal();
  const P = primed(['woodcap', 'stonecap', 'huts']), { OW } = P, rb = () => OW.Save.serialize().mechanics.researchbench;
  const d = JSON.parse(JSON.stringify(OW.Save.serialize())); d.savedAt = 0;
  d.mechanics.researchbench.done.push('axes', 'pickaxes', 'templeruins'); OW.Save.deserialize(d); OW.Loop.runBulk(1, 0);
  P.openCard('researchbench'); assert.equal(P.q('[data-pg-shuffle]').disabled, true, 'nothing else to draw');
  d.mechanics.researchbench.done = ['shard', 'camp', 'stock', 'tradepost', 'mountains', 'study', 'axes', 'pickaxes']; OW.Save.deserialize(d); OW.Loop.runBulk(1, 0);
  P.openCard('researchbench'); P.click(P.q('[data-pg-shuffle]')); OW.Loop.runBulk(3, 0.2);
  const dk = rb().desk; assert.ok(dk.length === 3 && dk.includes('templeruins') && dk.every((id) => ['woodcap', 'stonecap', 'huts', 'templeruins'].includes(id)), 'templeruins, then set-aside pages');
  same(P.errors, []);
});

test('Res cheat completes every page in order, effects applied, once', () => {
  const T = boot(); T.ready(); const { OW, R, M } = T, rb = () => OW.Save.serialize().mechanics.researchbench;
  T.click(T.$('cheat-res')); OW.Loop.runBulk(2, 0.2);
  same(rb().done, ['shard', 'camp', 'stock', 'tradepost', 'mountains', 'study', 'woodcap', 'stonecap', 'huts', 'axes', 'pickaxes', 'templeruins']);
  same([rb().desk, rb().aside, rb().locks], [[], [], []], 'desk cleared, nothing lands');
  assert.equal(OW.ResearchBench.name(), 'Study');
  same([R.getCap('wood'), R.getCap('stone')], [6000, 3000]);
  assert.equal(OW.Save.serialize().mechanics.buildersbench.c, 1, 'Builders Bench is Camp');
  assert.ok(['tents', 'wood', 'stone'].every((id) => M(id).tools.unlocked()), 'Tier II tool choice unlocked');
  assert.ok(T.sc.revealed, 'Strange Shard card added');
  const once = JSON.stringify(OW.Save.serialize().mechanics); T.click(T.$('cheat-res'));
  assert.equal(JSON.stringify(OW.Save.serialize().mechanics), once, 'second press changes nothing');
  same(T.reload().OW.Save.serialize().mechanics.researchbench.done.length, 12, 'survives a reload');
  same(T.errors, []);
});

console.log(`\n${checks} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
