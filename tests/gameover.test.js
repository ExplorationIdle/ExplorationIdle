/* GAME OVER? (js/mechanics/gameover.js): the softlock escape card. Shows at 0 gold with
   wood + stone <= 200 and no Gold Panning; top of Camp; red pulse; hides when gold returns;
   reset needs two presses and calls Save.eraseAndReload; dismiss hides it and points to Settings. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

let STORE = null;
function newStore() { STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } }; }

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0; // no smoothing loop needed here
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => {
    try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const tick = (OW, s) => OW.Loop.runBulk(Math.round(s / 0.2), 0.2);

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}


newStore();
const { w, OW, errors } = boot();
const R = OW.Resources, card = OW.Mechanics.get('gameover'), wrap = card.els.wrap, doc = w.document;
const on = () => !!card.revealed && wrap.style.display !== 'none';
const press = (k) => doc.querySelector(`#card-modal-body [data-go="${k}"]`).click();
check('game boots with no script errors', errors.length === 0, errors.join('\n        '));
check('card is first in Camp', doc.getElementById('grid-camp').firstElementChild === wrap);
check('card pulses red', wrap.classList.contains('mo-pulse') && wrap.classList.contains('go-card'));
tick(OW, 1);
check('hidden at the start (gold 5000)', !on());
R.setRaw('gold', 0); R.setRaw('wood', 150); R.setRaw('stone', 50); tick(OW, 1);
check('shows at 0 gold with wood + stone = 200', on());
check('card face reads GAME OVER? Click Me', card.els.nameEl.textContent === 'GAME OVER? Click Me');
R.setRaw('stone', 51); tick(OW, 1);
check('hidden at wood + stone = 201', !on());
R.setRaw('stone', 0); tick(OW, 1);
check('shows again once back under', on());
R.setRaw('gold', 10); tick(OW, 0.2);
check('hides once gold returns', !on());
R.setRaw('gold', 0); tick(OW, 0.2);
OW.Cards.open(card);
check('modal warns about gold spending', /watch|eye on your gold spending/i.test(doc.getElementById('card-modal-body').textContent));
let erased = 0; OW.Save.eraseAndReload = () => erased++;
press('reset');
check('first reset press only asks to confirm', erased === 0 && /Really reset/.test(doc.querySelector('[data-go="reset"]').textContent));
press('reset');
check('second reset press erases via Save.eraseAndReload', erased === 1);
OW.Cards.open(card); press('reset');
check('reopening the modal disarms reset', erased === 1);
press('dismiss'); tick(OW, 1);
check('dismiss hides the card', !on() && !OW.Cards.isModalOpenFor('gameover'));
check('dismiss points to Settings', /reset the game anytime in the Settings menu/.test(doc.body.textContent));
newStore();
const b = boot();
b.OW.Cards.reveal(b.OW.Mechanics.get('goldpanning'));
b.OW.Resources.setRaw('gold', 0); b.OW.Resources.setRaw('wood', 0); tick(b.OW, 1);
check('never shows once Gold Panning is revealed', !b.OW.Mechanics.get('gameover').revealed);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
