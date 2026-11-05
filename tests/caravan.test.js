/* Caravan (js/mechanics/caravan.js). Boots the real game headless, same
   harness as settlement.test.js. Covers: card order in all three grids,
   waiting for the Trading Post, first arrival 2 min later, seeded rolls,
   3 random goods loaded from the shelf, barter cost (+30%, rounded up),
   unavailable pay blocked, staffed-but-idle unbilled, payment loaded at
   1 unit/s per worker then goods unloaded in whole units (crates into
   the crate row), "Leaving after" while staffed, unstaffed departure
   cancels with refund and frees workers, payment reaching the
   Settlement and unsold cargo returning to the shelf, Sand Dunes card,
   paused tick, save mid-order, the Crv cheat, Commodities gone, and the
   offline summary line pinned second. Stage 3: Rush back, Request, Next
   stop, the upgrade ladder in order, Standing Orders (live, Mountains,
   offline line), The Hidden Pass, save. */
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
function boot(raf) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = raf || (() => 0);
  Object.defineProperty(w, 'performance', { value: { now: () => Date.now() }, configurable: true, writable: true });
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (t) => ({ width: (t || '').length * 6 }) });
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => { try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver;
  return { w, OW, C: OW.Caravan, st: OW.Caravan._st, S: OW.Settlement, R: OW.Resources, M: (id) => OW.Mechanics.get(id), errors };
}
const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);
const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}
const lastMsg = (OW) => OW.Footer.getHistory()[0].t;
const msgs = (OW) => OW.Footer.getHistory().map((h) => h.t);
const start = (A, seed) => { A.OW.Rng.setSeed(seed); A.OW.Cards.reveal(A.M('scoutspen')); tick(A.OW, 0.2); };

(async () => {
// ─── boot + card order ───────────────────────────────────────────────
newStore();
const A = boot();
check('boots with no script errors', A.errors.length === 0, A.errors.join('\n        '));
const cv = A.M('caravan'), mcv = A.M('mtn_caravan'), scv = A.M('sd_caravan');
check('three Caravan cards, all hidden at start', [cv, mcv, scv].every((m) => m && !m.revealed));
check('Camp: Caravan is the last card', cv.els.wrap.parentNode.lastElementChild === cv.els.wrap);
check('Mountains: Caravan sits just above Collapsed Path', mcv.els.wrap.nextElementSibling === A.M('collapsedpath').els.wrap);
check('Sand Dunes: Caravan follows the Bazaar', A.M('bazaar').els.wrap.nextElementSibling === scv.els.wrap);
check('always Sand Dunes colours', [cv, mcv, scv].every((m) => m.els.wrap.classList.contains('cv-sand') && m.modalTheme === 'theme-sanddunes'));

// ─── waits for the Trading Post, arrives 2 min after ─────────────────
tick(A.OW, 300);
check('no Caravan before the Trading Post card is revealed', A.st.phase === 'wait' && !cv.revealed);
const shelfBefore = Object.assign({}, A.S._st.shelf);
start(A, 4242);
const goods = Object.keys(A.st.cargo);
check('leaves the Bazaar once the Trading Post is revealed', A.st.phase === 'road' && A.st.t > 119 && A.st.t <= 120);
check('loads up to 3 goods that had stock, capped at one wagon load', goods.length >= 1 && goods.length <= 3 &&
  goods.every((g) => shelfBefore[g] >= 1 && A.st.cargo[g] === Math.min(Math.floor(shelfBefore[g]), A.S.LOAD[g])), JSON.stringify(A.st.cargo));
check('on the road: Camp card shows faded with a countdown', cv.revealed && cv.els.wrap.classList.contains('card-pending') && /^Arriving in (2:00|1:5\d)$/.test(cv.getStatText()), cv.getStatText());
tick(A.OW, 120);
check('arrives at Camp after 2 min', A.st.phase === 'parked' && lastMsg(A.OW) === 'Caravan arrived at Camp.', lastMsg(A.OW));
check('parked: not faded, shows Departs in', !cv.els.wrap.classList.contains('card-pending') && /^Departs in \d+:\d\d$/.test(cv.getStatText()) && A.st.t === 180, A.st.t);

// ─── seeded rolls ────────────────────────────────────────────────────
newStore();
const A2 = boot();
tick(A2.OW, 300); start(A2, 4242); tick(A2.OW, 120);
check('same seed, same cargo and parked timer', JSON.stringify(A2.st.cargo) === JSON.stringify(A.st.cargo) && A2.st.t === A.st.t);

// ─── trading ─────────────────────────────────────────────────────────
A.st.t = 1000; // room for the long crate order
A.st.cargo = { copperhead: 10, woodcrate: 2 }; A.st.qty = { copperhead: 2, woodcrate: 1 };
A.st.sel.copperhead = 'wood';
check('cost = base × 1.3 ÷ pay value, rounded up (2 heads = 35 Wood)', A.C.costOf('copperhead', 2, 'wood') === 35);
check('Trade blocked without enough Wood', !A.C.trade('copperhead') && A.st.orders.length === 0);
A.st.sel.copperhead = 'goldbars';
check('Trade blocked when the pay good does not exist here (Gold Bars at Camp)', !A.C.trade('copperhead'));
A.st.sel.copperhead = 'wood';
A.R.add('wood', 200);
const pool = A.OW.Workers;
const tp = A.M('scoutspen');
for (let i = 0; i < 5; i++) pool.assign('scoutspen'); // the Trading Post's workers do the Caravan's loading
check('Caravan card has no worker stepper', cv.stepperReady() === false && !cv.canAssign());
check('Trading Post idle with nothing ordered', !tp.isBillable());
check('Trade places an order and takes the goods off the wagon', A.C.trade('copperhead') && A.st.cargo.copperhead === 8 && A.st.orders[0].cost === 35);
check('the open order makes the Trading Post work (billed)', tp.isBillable());
const wood0 = A.R.get('wood');
tick(A.OW, 4);
check('5 workers load 20 Wood of payment in 4 s, bar 0→100%', Math.abs(A.st.orders[0].loaded - 20) < 1e-6 && Math.abs(wood0 - A.R.get('wood') - 20) < 1e-6 && Math.abs(cv.getBuildBarPct() - 20 / 35 * 100) < 1e-6);
const dummy = { active: () => true, work: () => {} }; A.OW.TradingPost.jobs.push(dummy);
const l0 = A.st.orders[0].loaded; tick(A.OW, 2);
check('rate shared evenly: a second active Trading Post job halves the Caravan share', Math.abs(A.st.orders[0].loaded - l0 - 5) < 1e-6, A.st.orders[0].loaded - l0);
A.OW.TradingPost.jobs.pop();
check('face: Loading 25 / 35 Wood · timer', /^Loading 25 \/ 35 Wood · \d+:\d\d$/.test(cv.getStatText()), cv.getStatText());
tick(A.OW, 3.4);
const heads = A.R.get('copperhead');
check('then unloads whole goods; both heads delivered and revealed', heads === 2 && !A.R.isHidden('copperhead') && A.st.orders.length === 0, heads);
check('a finished order books its payment for the Settlement', A.st.paid.wood === 35);
A.st.sel.woodcrate = 'wood'; A.R.add('wood', 2000); A.R.add(A.R.ensureCrate('wood'), 5000);
check('crate order costs 1,300 Wood', A.C.costOf('woodcrate', 1, 'wood') === 1300 && A.C.trade('woodcrate'));
const crate0 = A.R.get('woodcrate');
tick(A.OW, 262);
check('a crate unloads as 1 item into the Wood crate row (+1,000)', A.st.orders.length === 0 && Math.round(A.R.get('woodcrate') - crate0) === 1000, A.R.get('woodcrate') - crate0);

// ─── departure: staffed waits, unstaffed leaves and refunds ──────────
A.st.qty.copperhead = 8; A.R.add('wood', 1000);
A.C.trade('copperhead');
tick(A.OW, 2);
A.st.t = 0.1; tick(A.OW, 1);
check('timer out while staffed with work left: waits', A.st.phase === 'parked' && / · Leaving after$/.test(cv.getStatText()), cv.getStatText());
const loaded = A.st.orders[0].loaded, woodBefore = A.R.get('wood');
while (pool.unassign('scoutspen'));
tick(A.OW, 0.2);
check('unstaffed: leaves', A.st.phase === 'back' && msgs(A.OW).slice(0, 2).join('|') === 'Caravan left for the Bazaar.|Canceled Copper Tool Head trade. Refunded.', msgs(A.OW).slice(0, 2).join('|'));
check('refunds the loaded payment and puts the goods back on board', Math.abs(A.R.get('wood') - woodBefore - loaded) < 1e-6 && A.st.cargo.copperhead === 8);
check('Camp card hides while it is away', !cv.revealed);

// ─── home to the Bazaar ──────────────────────────────────────────────
A.OW.SandDunes.reveal();
tick(A.OW, 0.2);
check('Sand Dunes card shows (faded) while heading home', scv.revealed && scv.els.wrap.classList.contains('card-pending'));
check('heading home: one On board card lists unsold cargo and the traded goods', (cv.renderModalHTML().match(/hs-card/g) || []).length === 1 && /On board[\s\S]*Copper Tool Head[\s\S]*>8<[\s\S]*Wood · traded[\s\S]*1,335/.test(cv.renderModalHTML()));
let dep = 0; const realDep = A.S.deposit; A.S.deposit = (r, n) => { if (r === 'wood') dep += n; realDep(r, n); };
const shelfHeads = A.S._st.shelf.copperhead;
A.st.t = 0.1; tick(A.OW, 0.2);
check('arrives at the Bazaar', A.st.phase === 'bazaar' && lastMsg(A.OW) === 'Caravan arrived at the Bazaar.');
check('Sand Dunes face: Unloading at the Bazaar', scv.getStatText() === 'Unloading at the Bazaar' && !scv.els.wrap.classList.contains('card-pending'));
tick(A.OW, 30);
check('rest waits for the unload: timer still 3:00, strip says Unloading', A.st.t === 180 && /Unloading <b data-cv="timer">0:30/.test(scv.renderModalHTML() + (A.OW.SandDunes.addWorkers(1), scv.renderModalHTML())), A.st.t);
check('unloads gradually: half the payment in the Bazaar after 30 s', Math.abs(dep - 1335 / 2) < 5 && Math.abs(A.st.ul.p.wood - 1335 / 2) < 5 && Math.abs(scv.getBuildBarPct() - 50) < 1, dep);
tick(A.OW, 31);
check('payment all reaches the Bazaar pile (35 + 1,300 Wood)', Math.abs(dep - 1335) < 1e-6 && !Object.keys(A.st.ul.p).length, dep);
check('unsold cargo returns to the shelf and is logged', !Object.keys(A.st.ul.b).length && A.S._st.log.some((e) => e.m === 'Caravan returned 8 Copper Tool Head to the shelf.'));
check('unload is logged', A.S._st.log.some((e) => e.m === 'Caravan unloaded 1,335 Wood at the Bazaar.'));
check('Settlement waited for the unload, then bought Wood in one lump', A.S._st.log.filter((e) => /^Settlement bought [\d,]+ Wood\.$/.test(e.m)).length === 1, JSON.stringify(A.S._st.log.slice(0, 6)));
check('…then Resting M:SS', /^Resting \d+:\d\d$/.test(scv.getStatText()) && Math.abs(A.st.t - 179) < 1e-6, A.st.t);
check('…then Leaves in, with Rush back; no Trade Post button (no Trading Post there)', ['Leaves in <b data-cv="timer">', 'data-cv-rush'].every((t) => scv.renderModalHTML().includes(t)) && !scv.renderModalHTML().includes('data-cv-go'));
A.st.t = 0.1; tick(A.OW, 0.2);
check('rests, reloads and heads back to Camp; Sand Dunes card disappears', A.st.phase === 'road' && cv.revealed && !scv.revealed && A.st.t === 180);

// ─── paused tick, save mid-order, cheat ──────────────────────────────
const snap = JSON.stringify(A.st);
A.C.step(0); A.OW.Loop.runBulk(1, 0);
check('paused zero-length tick changes nothing', JSON.stringify(A.st) === snap);
A.OW.Caravan.cheatArrive();
check('Crv cheat: arrives now', A.st.phase === 'parked' && cv.revealed);
const g0 = Object.keys(A.st.cargo).find((g) => A.st.cargo[g] > 0);
A.st.sel[g0] = 'wood'; A.st.qty[g0] = 1; A.R.add('wood', 1000); A.R.add(A.R.ensureCrate('wood'), 6000);
A.C.trade(g0);
const blob = JSON.parse(JSON.stringify(A.OW.Save.serialize()));
newStore();
STORE.setItem('orbweaver.save.v1', A.OW.Save.encode(blob));
const B = boot();
check('second boot has no script errors', B.errors.length === 0, B.errors.join('\n        '));
check('phase, cargo and open order survive a save', B.st.phase === 'parked' && B.st.orders.length === 1 && B.st.orders[0].g === g0 && JSON.stringify(B.st.cargo) === JSON.stringify(A.st.cargo));

// ─── modal ───────────────────────────────────────────────────────────
tick(B.OW, 0.2);
B.M('caravan').els.wrap.querySelector('.card').dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const body = B.w.document.getElementById('card-modal-body');
check('Caravan window is info only: timer, Go to Trade Post, On board',
  ['Departs in', 'Go to Trade Post', 'On board'].every((t) => body.innerHTML.includes(t)) && !/data-cv-(trade|tab|rush)|Gold Coins|Trade with and influence/.test(body.innerHTML));
body.querySelector('[data-cv-go]').click();
check('Go to Trade Post opens the Camp Trading Post on its Caravan tab',
  B.OW.Cards.isModalOpenFor('scoutspen') && body.querySelector('.sp-tab.active').dataset.spTab === 'caravan' && body.querySelector('[data-cv-tab]'));
B.OW.Cards.closeModal(); B.OW.Cards.open(B.M('scoutspen'));
check('a normal open still lands on Resupply', body.querySelector('.sp-tab.active').dataset.spTab === 'resupply');
B.OW.Cards.closeModal();
const openTP = (X) => { X.OW.Cards.closeModal(); const t0 = Date.now(); while (Date.now() - t0 < 150); // modal reopen debounce
  X.M('scoutspen').els.wrap.firstElementChild.dispatchEvent(new X.w.Event('click', { bubbles: true }));
  X.w.document.querySelector('#card-modal-body [data-sp-tab="caravan"]').click(); return X.w.document.getElementById('card-modal-body'); };
check('Trading Post tabs: Resupply | Caravan | Expedition', (() => { const b = openTP(B); return [...b.querySelectorAll('[data-sp-tab]')].map((e) => e.textContent).join('|') === 'Resupply|Caravan|Expedition'; })());
check('Caravan tab (parked): strip, worker note and a trade row per good',
  ['Departs in', 'Gold Coins', 'Gold Bars', 'Cargo', 'Trading Post workers load the payment and unload the goods'].every((t) => body.innerHTML.includes(t)) && body.querySelectorAll('[data-cv-trade]').length === Object.keys(B.st.cargo).length);
check('pay list always has all five goods, no Luxury', body.querySelector('[data-cv-pay]').options.length === 5 && /Gold Bars \(25\) · 0/.test(body.innerHTML) && !/Luxury/.test(body.innerHTML));
check('no Commodities tab left on the Market Stall', !B.M('marketstall').renderModalHTML().includes('Commodities'));

// ─── Stage 3: Influence tab + upgrade ladder ─────────────────────────
newStore();
const I = boot();
tick(I.OW, 1); start(I, 99);
const icv = I.M('caravan'), I_ = I.st;
check('ladder: no Gold Bars, no upgrade', !I.C.buy() && I.C.owned() === 0);
check('Request locked until Request Goods', !I.C.request('tools3'));
I.R.add('gold', 2500);
const gr = I.R.get('gold');
const campBars = (T) => T.OW.Locations.all().find((l) => !l.prefix).ensureResource('goldbars', 'Gold Bars'); // Influence pays from the stop where it is parked
campBars(I); I.R.add('goldbars', 50000);
check('traveling: upgrades and Rush back refused', !I.C.buy() && !I.C.rush() && /data-cv-rush disabled/.test(I.OW.Caravan._influence()));
const tpTab = (loc) => I.OW.TradingPost.tabs[0].html(loc);
check('heading here: Caravan tab reads "Caravan arrives in M:SS."', /Caravan arrives in <span data-cv="eta">\d+:\d\d<\/span>\./.test(tpTab('camp')) && !/data-cv-tab/.test(tpTab('camp')));
I.C.cheatGo(); tick(I.OW, 3.2);
const bars0 = I.R.get('goldbars');
check('Second Wagon: 250 Gold Bars, +50% load', I.C.buy() && I.C.owned() === 1 && I_.wagons === 2 && bars0 - I.R.get('goldbars') === 250 &&
  I.S.floorOf('copperore') === 1500 && lastMsg(I.OW) === 'Bought Second Wagon for the Caravan.', lastMsg(I.OW));
check('Caravan arrives', I_.phase === 'parked');
const ib = openTP(I);
check('modal has Trade and Influence tabs', ib.querySelectorAll('[data-cv-tab]').length === 2 && ib.innerHTML.includes('Cargo'));
check('no Standing order toggle before Standing Orders', !ib.querySelector('[data-cv-auto]'));
ib.querySelector('[data-cv-tab="influence"]').click();
check('Influence: Leave now, Rush back, upgrades in any order under "Influence Caravan with Gold Bars"',
  ['Influence Caravan with Gold Bars<', 'Owned', 'Leave now<span class="cv-sub cv-plain">Caravan departs in 3 seconds', '>Free<', 'Rush back<span class="cv-sub cv-plain">Rush the Caravan. It will arrive in 8 seconds', 'Costs 3,500 Gold Coins', '500 Gold Bars', 'cv-up-eff">Rests 10 s at the Bazaar'].every((t) => ib.innerHTML.includes(t)) && !/Upgrades|after Request Goods|cv-lock|Hurry|Influence the/.test(ib.innerHTML) && ib.querySelectorAll('[data-cv-buy]').length === 7);
ib.querySelector('[data-cv-buy]').click();
check('Buy button buys Request Goods; Request card appears', I.C.owned() === 2 && !!ib.querySelector('[data-cv-req]'));
['copperore', 'copperhead', 'tools3', 'woodcrate', 'stonecrate'].forEach((g) => { I.S._st.shelf[g] = I.S.LOAD[g] * 3; });
check('Request picks a good', I.C.request('stonecrate') && I_.req === 'stonecrate');
I.C.buy();
check('Fresh Camels owned', I.C.owned() === 3);
I_.t = 0.1; tick(I.OW, 0.2); I_.t = 0.1; tick(I.OW, 0.2);
check('Fresh Camels: rests 10 s', I_.phase === 'bazaar' && I_.t === 10, I_.t);
check('away from a Trading Post: Request and upgrades refused; Camp tab reads "Caravan is elsewhere."', !I.C.request('tools3') && !I.C.buy() && tpTab('camp') === '<div class="sp-tab-greyed">Caravan is elsewhere.</div>');
I.R.add('gold', 10000);
const g0i = I.R.get('gold');
I.OW.SandDunes.workerPool.addWorkers(1); I.OW.Cards.open(I.M('sd_caravan')); // a worker down there opens its window
const rb = I.w.document.querySelector('#card-modal-body [data-cv-rush]');
check('…its window offers Rush back, arriving in 4 seconds', rb && I.w.document.getElementById('card-modal-body').innerHTML.includes('It will arrive in 4 seconds'));
rb.click();
check('Rush back at the Bazaar: 3,500 Gold Coins, unloading done, rests 2 s, window closes', I_.t === 2 && I_.ul.l === 0 && g0i - I.R.get('gold') === 3500 && !I.C.rush() && !I.OW.Cards.isModalOpenFor('sd_caravan'));
tick(I.OW, 2.2);
check('…2 s on the road', I_.phase === 'road' && I_.t <= 2 && I_.t > 1);
check('requested good is on the next trip; request clears', I_.phase === 'road' && I_.cargo.stonecrate > 0 && I_.req === '');
I_.t = 0.1; tick(I.OW, 0.2);
I.C.buy(); I.C.buy();
check('Third Wagon + Next Stop owned', I.C.owned() === 5 && I_.wagons === 3);
check('Next stop: Mountains needs discovery', !I.C.setNext('mtn'));
I.OW.Mountains.reveal();
I.R.add('gold', 5000); // Rush back spent most of the capped purse
const g1 = I.R.get('gold');
check('Mountains costs 3,000 Gold Coins; Camp refunds it', I.C.setNext('mtn') && g1 - I.R.get('gold') === 3000 && I.C.setNext('camp') && I.R.get('gold') === g1);
I.C.setNext('mtn'); I.C.buy();
check('Standing Orders owned', I.C.owned() === 6);
I_.t = 0.1; tick(I.OW, 0.2); I_.t = 0.1; tick(I.OW, 0.2); I.C.cheatGo(); tick(I.OW, 3.2);
check('next stop is Mountains; then defaults to Camp', I_.phase === 'road' && I_.dest === 'mtn' && I_.next === 'camp' && I.M('mtn_caravan').revealed && !icv.revealed);
const ga = Object.keys(I_.cargo).find((g) => I_.cargo[g] > 0), had = I_.cargo[ga];
I_.auto[ga] = true; I_.sel[ga] = 'wood';
I.R.add(I.R.ensureCrate('mtn_wood'), 1e6);
const mw = I.R.available('mtn_wood');
I_.t = 0.1; tick(I.OW, 0.2);
check('Standing Orders: arrival at Mountains auto-trades instantly from Mountains stock', I_.phase === 'parked' && I_.cargo[ga] === 0 && I_.orders.length === 0 &&
  Math.abs(mw - I.R.available('mtn_wood') - I.C.costOf(ga, had, 'wood')) < 1e-6 && msgs(I.OW).includes(`Standing order traded ${I.C.costOf(ga, had, 'wood').toLocaleString()} Wood for ${had.toLocaleString()} ${I.S.NAME[ga]}.`), msgs(I.OW).slice(0, 3).join('|'));
const blobI = JSON.parse(JSON.stringify(I.OW.Save.serialize()));
newStore(); STORE.setItem('orbweaver.save.v1', I.OW.Save.encode(blobI));
const J = boot();
check('ladder, request, next stop and Standing order survive a save', J.C.owned() === 6 && J.st.wagons === 3 && J.st.next === 'camp' && J.st.auto[ga] === true && J.S.floorOf('copperore') === 2000);
const cb = I.R.get('goldbars');
check('parked at the Mountains: Camp Gold Bars do not pay', !I.C.buy() && I.R.get('goldbars') === cb);
I.OW.Mountains.ensureResource('goldbars', 'Gold Bars'); I.R.add('mtn_goldbars', 50000);
I.C.buy();
check('Fourth Wagon', I.C.owned() === 7 && I_.wagons === 4);
I.R.spend('mtn_goldbars', I.R.get('mtn_goldbars'));
check('The Hidden Pass needs 30,000 Gold Bars', !I.C.buy() && I.C.owned() === 7);
I.R.add('mtn_goldbars', 30000);
check('The Hidden Pass clears the Collapsed Path and reveals Sand Dunes', !I.OW.CollapsedPath.isCleared() && I.C.buy() && I.OW.CollapsedPath.isCleared() && I.OW.SandDunes.isDiscovered() && I.C.owned() === 8);
check('ladder ends', !I.C.buy());
newStore();
const L = boot();
tick(L.OW, 1); start(L, 5); L.C.cheatGo(); tick(L.OW, 3.2);
campBars(L); L.R.add('goldbars', 10000);
check('any order: Fourth Wagon first, then Second Wagon; each adds a wagon', L.C.buy(6) && L.st.wagons === 2 && L.C.buy(0) && L.st.wagons === 3 && L.C.owned() === 2 && !L.C.buy(6));
check('Standing Orders bought without the rows above it', L.C.buy(5) && L.C.owned() === 3);
const lb = openTP(L);
lb.querySelector('[data-cv-tab="influence"]').click();
const lg = L.R.get('gold');
lb.querySelector('[data-cv-leave]').click();
check('Leave now: free, departure timer to 3 s, Trading Post window closes', L.st.t === 3 && !L.OW.Cards.isModalOpenFor('scoutspen') && L.R.get('gold') === lg);
tick(L.OW, 3.2);
check('…and it leaves', L.st.phase === 'back');
I_.t = 0.1; tick(I.OW, 0.2); // leaves Mountains
check('heading back: request and next stop refused', I_.phase === 'back' && !I.C.request('tools3') && !I.C.setNext('mtn'));
I.C.cheatGo();
check('Crv go: timer to 3 s', I_.t === 3);
tick(I.OW, 3.2);
check('…and it arrives at the Bazaar', I_.phase === 'bazaar');
I.C.cheatGo(); tick(I.OW, 3.2);
check('Crv go at the Bazaar: leaves in 3 s, finishing the unload first', I_.phase === 'road' && !Object.keys(I_.ul.p).length);

// ─── offline summary line pinned second ──────────────────────────────
newStore();
const O = boot((f) => setTimeout(f, 0));
tick(O.OW, 1); start(O, 77);
await new Promise((res) => O.OW.Offline.apply(5 * 3600, res));
const lis = [...O.w.document.querySelectorAll('.offline-events li')].map((l) => l.textContent);
check('welcome back: "Caravan made N trips." pinned second', /^Caravan made \d+ trips?\.$/.test(lis[1] || ''), JSON.stringify(lis.slice(0, 3)));
newStore();
const O2 = boot((f) => setTimeout(f, 0));
tick(O2.OW, 1); start(O2, 77);
[0, 1, 2, 3, 4, 5].forEach((i) => { O2.st.own[i] = 1; }); O2.S._st.shelf.copperore = 5000;
O2.S.GOODS.forEach((g) => { O2.st.auto[g] = true; O2.st.sel[g] = 'wood'; });
O2.R.add('wood', 1e6);
await new Promise((res) => O2.OW.Offline.apply(5 * 3600, res));
const lis2 = [...O2.w.document.querySelectorAll('.offline-events li')].map((l) => l.textContent);
check('welcome back counts standing orders', /^Caravan made \d+ trips?\. Standing orders traded [\d,]+ Wood for [\d,]+ .+\.$/.test(lis2[1] || ''), JSON.stringify(lis2.slice(0, 2)));

// ─── Rush back from Camp: orders finish now; depart, road back, rest and road out each 2 s; instant unload ──
newStore();
const Q = boot();
tick(Q.OW, 1); start(Q, 31); Q.C.cheatGo(); tick(Q.OW, 3.2);
const qg = Object.keys(Q.st.cargo).find((g) => Q.st.cargo[g] > 0);
Q.st.sel[qg] = 'wood'; Q.st.qty[qg] = 1; Q.R.add(Q.R.ensureCrate('wood'), 1e5); Q.R.add('gold', 5000);
check('parked with an open order, nobody loading', Q.st.phase === 'parked' && Q.C.trade(qg) && Q.st.orders.length === 1);
const qgold = Q.R.get('gold');
const qb = openTP(Q); qb.querySelector('[data-cv-tab="influence"]').click(); qb.querySelector('[data-cv-rush]').click();
check('Rush back at Camp: order finishes instantly, departs in 2 s, Trading Post window closes', !Q.OW.Cards.isModalOpenFor('scoutspen') && !Q.st.orders.length && Q.st.paid.wood > 0 && Q.st.t === 2 && qgold - Q.R.get('gold') === 3500 && lastMsg(Q.OW) === 'Caravan is rushing back.', lastMsg(Q.OW));
check('…only once per leg', !Q.C.rush());
tick(Q.OW, 2.2);
check('…2 s on the road back', Q.st.phase === 'back' && Q.st.t <= 2 && Q.st.t > 1);
tick(Q.OW, 2.2);
check('…unloads instantly at the Bazaar, then rests 2 s', Q.st.phase === 'bazaar' && Q.st.ul.l === 0 && !Object.keys(Q.st.ul.p).length && Q.st.t > 1.5 && Q.st.t <= 2, Q.st.t);
tick(Q.OW, 2.2);
check('…then 2 s on the road out', Q.st.phase === 'road' && Q.st.t <= 2 && Q.st.t > 1.5, Q.st.t);
tick(Q.OW, 2.2);
check('…parks again, no longer rushed', Q.st.phase === 'parked' && Q.st.r === 0, Q.st.phase);
const qsnap = JSON.parse(JSON.stringify(Q.OW.Save.serialize())).mechanics;
check('Rush flag is saved', 'r' in (qsnap.caravan || {}) || JSON.stringify(Q.OW.Save.serialize()).includes('"r":0'));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
})();
