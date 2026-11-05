/* Settlement + Bazaar (js/mechanics/settlement.js). Boots the real game
   headless, same harness as marketstall.test.js. Covers: 25% trickle on
   an empty stockpile, full speed with inputs, continuous draw rationed by
   demand (blocked buildings leave their share), lump purchases from the
   Bazaar stockpile (threshold, varied size, short stock), automatic
   Wealth upgrades (lowest level, random tie, Crate Yard), trickle goods earning no Wealth,
   the Sand Dunes worker gate, crate start stock and rate, shelf floor and sell-off giving
   the same result at 0.2 s, 1 s and one 24 h step, Wealth → upgrade
   discount, batched sale logging, log cap and relative time across a
   save, paused zero-length tick, Wheat/Gold Bars speed-up, reveal once
   Sand Dunes is discovered, and both modals through real clicks. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() {
  STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
}
function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  Object.defineProperty(w, 'performance', { value: { now: () => Date.now() }, configurable: true, writable: true });
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (t) => ({ width: (t || '').length * 6 }) });
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => { try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, S: w.OrbWeaver.Settlement, st: w.OrbWeaver.Settlement._st, errors };
}
const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);
const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ─── boot, hidden, runs before discovery ─────────────────────────────
newStore();
let A = boot();
check('boots with no script errors', A.errors.length === 0, A.errors.join('\n        '));
const sm = A.OW.Mechanics.get('settlement'), bz = A.OW.Mechanics.get('bazaar');
check('both cards start hidden', !sm.revealed && !bz.revealed && sm.els.wrap.style.display === 'none');
check('Sand Dunes grid order: Settlement then Bazaar after Sand Dunes',
  [...A.w.document.getElementById('grid-sanddunes').children].indexOf(sm.els.wrap) === 2 && sm.els.wrap.nextSibling === bz.els.wrap);
check('Bazaar starts with a wagon load of every good (crates 10)', A.st.shelf.woodcrate === 10 && A.st.shelf.stonecrate === 10 && A.st.shelf.copperore === 1000 && A.st.shelf.copperhead === 100 && A.st.shelf.tools3 === 20 && A.st.free.copperore === 1000);
Object.assign(A.st.shelf, { copperore: 0, copperhead: 0 });

// ─── 25% trickle on an empty stockpile ───────────────────────────────
tick(A.OW, 600);
check('empty stockpile: Mine trickles at 25% (≈25 ore in 10 min)', near(A.st.shelf.copperore, 25, 1), A.st.shelf.copperore);
check('empty stockpile: Smelter trickles at 25% without taking ore (≈2 heads)', Math.floor(A.st.shelf.copperhead) === 2, A.st.shelf.copperhead);
check('runs before discovery (cards still hidden)', !sm.revealed);

// ─── paused zero-length tick ─────────────────────────────────────────
const snap = JSON.stringify(A.st);
A.S.step(0); A.OW.Loop.runBulk(1, 0);
check('paused zero-length tick changes nothing', JSON.stringify(A.st) === snap);

// ─── reveal once Sand Dunes is discovered ────────────────────────────
A.OW.SandDunes.reveal(); tick(A.OW, 0.2);
check('reveal polls Sand Dunes discovery', sm.revealed && bz.revealed && sm.els.wrap.style.display === '' && bz.els.wrap.style.display === '');
check('Settlement face lists levels', sm.getStatText() === 'Mine I · Smelter I · Tool Shed I · Crate Yard I', sm.getStatText());

// ─── full speed with inputs; mapping + spillover ─────────────────────
newStore();
let B = boot();
B.st.shelf.copperore = 0; B.st.stock.tools2 = 100;
tick(B.OW, 61);
check('Tools II feeds the Mine at full speed (10 ore / 60 s)', near(B.st.shelf.copperore, 10, 0.05), B.st.shelf.copperore);
check('Mine draws 1 Tools II per 10 ore as it works', near(B.st.stock.tools2, 100 - (B.st.shelf.copperore + B.st.prog.mine) / 10, 0.01), B.st.stock.tools2);
newStore();
B = boot();
const hrW = B.S.perHour('wood');
check('Wood use per hour at level I (≈7,657)', near(hrW, 3600 * (5 / 70 + 20 / 360 + 2), 1e-6), hrW);
B.st.stock.wood = hrW / 6 + 10; B.S.deposit('wood', 30000);
B.S.step(0.2);
check('stock above 10 min of use: Settlement does not buy', B.st.bz.wood === 30000 && !B.st.log.length);
B.st.stock.wood = 100; B.S.step(0.2);
const lump1 = 30000 - B.st.bz.wood;
check('below 10 min: buys a lump of about an hour, instantly, and logs it', lump1 >= hrW * 0.8 - 1 && lump1 <= hrW * 1.2 + 1 && Number.isInteger(lump1) && B.st.stock.wood > lump1 &&
  B.st.log[0].m === `Settlement bought ${lump1.toLocaleString()} Wood.`, lump1);
const lumps = [];
for (let i = 0; i < 4; i++) { B.st.stock.wood = 0; const b0 = B.st.bz.wood; B.S.step(0.01); lumps.push(b0 - B.st.bz.wood); }
check('lump sizes vary', new Set(lumps.concat(lump1)).size >= 4, JSON.stringify(lumps));
B.st.bz.wood = 300; B.st.stock.wood = 0; B.S.step(0.01);
check('Bazaar short: buys what it has', B.st.bz.wood === 0 && near(B.st.stock.wood, 300, 0.1));
check('Luxury is no longer something the Settlement buys', !B.S.INPUTS.includes('luxury'));
B.st.bz.wood = 0; B.st.stock.wood = 1000; B.st.shelf.copperore = 0; B.st.shelf.copperhead = 0;
B.S.step(60);
check('Smelter and Tool Shed lack ore/heads: their Wood share goes to the crate yard (120 / min)', near(B.st.stock.wood, 880, 0.5), B.st.stock.wood);
Object.assign(B.st.shelf, { copperore: 50, copperhead: 5 }); B.st.stock.stone = 1000; B.st.stock.wood = 1;
B.S.step(1);
const bf = (k) => B.S._b.find((b) => b.key === k).f;
check('scarce Wood: equal shares by demand, small needs filled, the rest to the crate yard', bf('smelter') === 1 && bf('toolshed') === 1 && near(bf('wcrate'), (1 - 5 / 70 - 20 / 360) / 2, 1e-6) && B.st.stock.wood < 1e-9,
  JSON.stringify([bf('smelter'), bf('toolshed'), bf('wcrate'), B.st.stock.wood]));
check('Wood never reaches the Mine or Stone Crates', !('wood' in B.S._b.find((b) => b.key === 'mine').uses) && !('wood' in B.S._b.find((b) => b.key === 'scrate').uses));

// ─── crate rate ──────────────────────────────────────────────────────
B.st.stock.stone = 10000; B.st.shelf.copperhead = 0;
tick(B.OW, 600);
check('Stone Crates draw 1,200 Stone per 10 min', near(B.st.stock.stone, 8800, 1), B.st.stock.stone);

// ─── shelf floor + sell-off step-size independence ───────────────────
function sellRun(stepS) {
  Object.assign(B.st.shelf, { copperore: 5000, copperhead: 100, tools3: 50, woodcrate: 10, stonecrate: 1 });
  Object.keys(B.st.free).forEach((g) => { B.st.free[g] = 0; });
  B.st.wealth = 0;
  for (let t = 0; t < 86400 - 1e-6; t += stepS) B.S.sellOff(stepS);
  return [B.st.shelf.copperore, B.st.shelf.tools3, B.st.shelf.woodcrate, B.st.wealth];
}
const r02 = sellRun(0.2), r1 = sellRun(1), r24 = sellRun(86400);
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1e-6 * Math.max(1, Math.abs(v)));
check('sell-off identical at 0.2 s, 1 s and one 24 h step', same(r02, r1) && same(r1, r24), JSON.stringify([r02, r1, r24]));
check('shelf never drops below one wagon load', r24[0] >= 1000 && r24[1] >= 20 && r24[2] >= 2 && near(r24[0], 1000, 0.01));
check('at-floor goods do not sell', B.st.shelf.copperhead === 100 && B.st.shelf.stonecrate === 1);
check('sales add base value to Wealth', near(r24[3], 4000 * 6 + 30 * 110 + 8 * 3000, 1), r24[3]);
B.S.setWagons(2);
check('each wagon raises the floor by 50%', B.S.floorOf('copperore') === 1500 && B.S.floorOf('tools3') === 30);
B.S.setWagons(1);

// ─── trickle goods earn no Wealth ────────────────────────────────────
newStore();
let C = boot();
tick(C.OW, 3601);
check('nothing supplied: goods still sell, but Wealth stays 0', C.st.wealth < 1e-6 && C.st.log.some((e) => /^Bazaar sold/.test(e.m)), C.st.wealth);
newStore();
const W = boot();
W.st.stock.tools2 = 1000; W.st.shelf.copperore = 1000;
tick(W.OW, 1800);
check('fed goods sold above the floor earn Wealth (6 per Copper Ore)', W.st.wealth > 0 && W.st.wealth <= (W.st.pend.copperore + 300) * 6, W.st.wealth);

// ─── batched logging ─────────────────────────────────────────────────
const sold = C.st.log.find((e) => /^Bazaar sold \d+ Wood Crate elsewhere\.$/.test(e.m));
check('sales log once per batch, whole units, with a period', !!sold && C.st.log.filter((e) => /Wood Crate/.test(e.m)).length === 1, JSON.stringify(C.st.log));
check('Bazaar face shows the newest log line', C.OW.Mechanics.get('bazaar').getStatText() === C.st.log[0].m);

// ─── Wealth → automatic upgrades ─────────────────────────────────────
C.st.wealth = 0; C.st.mark = ''; Object.assign(C.st.lvl, { mine: 2, smelter: 1, toolshed: 2, yard: 1 });
const marks = new Set();
for (let i = 0; i < 40; i++) { C.st.mark = ''; marks.add(C.S.pick()); }
check('marks a random building among the lowest level', marks.size === 2 && marks.has('smelter') && marks.has('yard'), JSON.stringify([...marks]));
C.st.mark = 'yard'; C.st.wealth = 99990; C.S._st.prog.wcrate = 0;
const lv = JSON.stringify(C.st.lvl);
C.S.step(0.01);
check('below 100,000: no upgrade', JSON.stringify(C.st.lvl) === lv);
C.st.wealth = 100000.5; C.S.step(0.01);
check('100,000 Wealth upgrades the marked building and resets the bar', C.st.lvl.yard === 2 && C.st.wealth < 1 && C.st.log[0].m === 'Settlement upgraded the Crate Yard to level II.' && C.st.mark === 'smelter', JSON.stringify([C.st.lvl, C.st.mark]));
check('each level adds 25% of base speed; the Crate Yard drives both crate lines', C.S.perHour('stone') === 3600 * (20 / 360 * 1.25 + 1200 / 600 * 1.25));
C.st.wealth = 0;

// ─── speed-up ────────────────────────────────────────────────────────
newStore();
let D = boot();
Object.assign(D.st.stock, { tools2: 100, wheatbundle: 10, goldbars: 10 }); D.st.shelf.copperore = 0;
tick(D.OW, 60.4);
check('Wheat Bundle + Gold Bars give +50% (15 ore / 60 s)', near(D.st.shelf.copperore, 15, 0.05), D.st.shelf.copperore);
check('Gold Bars burn 1 every 15 s, Wheat Bundle 1 every 75 s', near(D.st.stock.wheatbundle, 9.2, 0.05) && near(D.st.stock.goldbars, 6, 0.05), D.st.stock.wheatbundle);
check('lump sizing follows the burn: 240 / h Gold Bars, 48 / h Wheat Bundle', D.S.perHour('goldbars') === 240 && Math.round(D.S.perHour('wheatbundle')) === 48);
newStore();
const G = boot();
G.st.shelf.copperore = 0; G.st.free.copperore = 0; G.st.stock.goldbars = 10;
tick(G.OW, 60);
const gm = G.S._b.find((b) => b.key === 'mine');
check('Gold Bars alone: Mine runs at full speed ×1.25 with no Tools II (12.5 ore / 60 s)', near(G.st.shelf.copperore + G.st.prog.mine, 12.5, 0.05), G.st.shelf.copperore + G.st.prog.mine);
check('…counts as fed (no free share), status says Full speed', G.st.free.copperore < 1e-9 && G.st.fp.mine < 1e-9);
G.OW.SandDunes.reveal(); G.OW.SandDunes.addWorkers(1); tick(G.OW, 0.2);
check('…and the label drops the 25%', /data-sv="st-mine">Full speed</.test(G.OW.Mechanics.get('settlement').renderModalHTML()));
G.st.stock.goldbars = 0; G.st.stock.wheatbundle = 0.5;
tick(G.OW, 60);
check('Wheat Bundle does the same; once burnt out the 25% returns', G.st.stock.wheatbundle === 0 && /data-sv="st-mine">25%/.test(G.OW.Mechanics.get('settlement').renderModalHTML()));

// ─── offline replay batches into 10 s steps with the same result ─────
const runFeed = (replaying) => { newStore(); const X = boot(); X.OW.Offline.isReplaying = () => replaying;
  X.S.deposit('wood', 9000); X.S.deposit('stone', 9000); X.S.deposit('tools2', 500); X.S.deposit('wheatbundle', 30);
  X.OW.Loop.runBulk(7200, 1); return X.st; };
const live = runFeed(false), batched = runFeed(true);
check('offline replay batching matches live stepping (2 h, fed)', GOODS_SAME(live, batched), JSON.stringify([live.shelf, batched.shelf]));
function GOODS_SAME(a, b) { return ['copperore', 'copperhead', 'tools3', 'woodcrate', 'stonecrate'].every((g) => Math.abs(a.shelf[g] - b.shelf[g]) <= Math.max(2, 0.005 * a.shelf[g])) && Math.abs(a.wealth - b.wealth) <= 0.01 * Math.max(1, a.wealth) + 150; }

// ─── log cap + relative time across a save ───────────────────────────
for (let i = 0; i < 25; i++) D.S.addLog(`Entry ${i}.`);
check('log keeps 20 entries, newest first', D.st.log.length === 20 && D.st.log[0].m === 'Entry 24.');
tick(D.OW, 750);
const agoBefore = D.S.ago(D.st.clock - D.st.log[0].t);
const blob = JSON.parse(JSON.stringify(D.OW.Save.serialize()));
newStore();
STORE.setItem('orbweaver.save.v1', D.OW.Save.encode(blob));
const E = boot();
check('second boot has no script errors', E.errors.length === 0, E.errors.join('\n        '));
check('log and its relative time survive a save', E.st.log.length === 20 && E.S.ago(E.st.clock - E.st.log[0].t) === agoBefore && agoBefore === '12m ago', agoBefore);
check('shelf, stockpile and levels survive a save',
  near(E.st.shelf.copperore, D.st.shelf.copperore, 1e-9) && near(E.st.stock.tools2, D.st.stock.tools2, 1e-9) && E.st.lvl.mine === 1);

// ─── modals through real clicks ──────────────────────────────────────
E.OW.SandDunes.reveal(); tick(E.OW, 0.2);
const doc = E.w.document, open = (m) => m.els.wrap.querySelector('.card').dispatchEvent(new E.w.MouseEvent('click', { bubbles: true }));
const body = () => doc.getElementById('card-modal-body').innerHTML;
open(E.OW.Mechanics.get('settlement'));
check('no worker in Sand Dunes: modal opens with a note only', body().includes('Nobody has made it down yet. Send a worker to Sand Dunes to use the Settlement.') && !body().includes('Stockpile'));
E.OW.SandDunes.addWorkers(1); tick(E.OW, 0.2);
check('a worker arrives: the open modal redraws in full', body().includes('Stockpile'));
E.OW.Cards.refreshOpenModal('settlement');
const mk = E.st.mark, mkName = { mine: 'Mine', smelter: 'Smelter', toolshed: 'Tool Shed', yard: 'Crate Yard' }[mk];
check('Settlement modal: no strip or Upgrade buttons; Wealth subtitle and next-upgrade line; Crate Yard has a level',
  ['Sells excess goods for wealth', `Settlement will upgrade ${mkName} next`, 'Stockpile', 'Mine · Level I', 'Crate Yard · Level I'].every((t) => body().includes(t)) && !/Luxury|Speed <b|data-sv-up|Progress/.test(body()), body().slice(0, 300));
check('marked building carries the subtitle', (body().match(/Marked for upgrade\. Will produce 25% faster/g) || []).length === 1 && new RegExp(`${mkName} · Level I<span class="cv-sub">Marked`).test(body()));
E.st.wealth = 100000; tick(E.OW, 0.2);
check('an upgrade redraws the open modal with the new level and a new mark', body().includes(`${mkName} · Level II`) && E.st.log.some((e) => e.m === `Settlement upgraded the ${mkName} to level II.`));
open(E.OW.Mechanics.get('bazaar'));
check('Bazaar modal: Settlement stall (left), Caravan stall (right), trade log', /Settlement stall[\s\S]*Copper Tool Head[\s\S]*Caravan stall[\s\S]*Wood[\s\S]*Trade log/.test(body()) && !/Settlement buys|Caravan buys|goods</.test(body()));
E.st.bz.wood = 500; E.st.stock.wood = 5000; tick(E.OW, 0.2);
const sbw = doc.querySelector('#card-modal-body [data-sv="sb-wood"]').textContent;
check('Bazaar shows its own stockpile, not the Settlement stockpile', sbw === '500', sbw);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
