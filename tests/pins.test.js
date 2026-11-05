/* Side pins (js/core/pins.js). Boots the real game headless and covers:
   default off (5 pin max on, Centered on), on with no pins acting off, the
   first pin opening the column and moving Centered to Free, a fully
   clickable panel (steppers, hold-to-repeat, Market Stall tabs) running
   inside the host swap with the real modal's ids restored after, live
   patching, equal panel widths, the handoff to and from the real modal,
   the 5-pin cap and its message, 5 pin max off/on (top 5 kept), cargo
   cards unpinnable, a hidden card unpinning, the narrow-window hide, the
   last unpin restoring Centered, Centered turning on Force bottom, the mobile
   bottom strip, and both switches remembered in display prefs.
   Last, every non-cargo card (new cards included automatically) is pinned:
   its panel must match its real modal, and every panel button is clicked.
   A failure here usually means the card keeps a modal element in a
   variable, searches outside #card-modal-body, or edits its modal late.
   jsdom has no matchMedia or layout, so the desktop check is stubbed. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPTS = HTML.match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);
const STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;
Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
const raf = [], roCbs = []; // frames are queued, run only by the ResizeObserver check
w.requestAnimationFrame = (f) => (raf.push(f), 0);
w.ResizeObserver = class { constructor(cb) { roCbs.push(cb); } observe() {} disconnect() {} };
w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 6 }) });
let isDesktop = true; // flipped to false later for the mobile bottom strip
w.matchMedia = () => ({ matches: isDesktop });
w.innerWidth = 1600;
const errors = [];
w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
SCRIPTS.forEach((src) => {
  try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); }
});
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
const OW = w.OrbWeaver, doc = w.document, $ = (id) => doc.getElementById(id);
OW.Loop.stop();

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const ptr = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const step = (n = 1) => { for (let i = 0; i < n; i++) OW.Mechanics.all().forEach((m) => m.tick(true, 0.2)); };
// Waits out cards.js's 130ms ghost-click guard, as a real second click would.
const open = async (id) => { await sleep(150); const m = OW.Mechanics.get(id); OW.Cards.reveal(m); click(m.els.wrap.querySelector('.card')); return m; };
const close = () => click($('card-modal-close'));
const panels = () => [...doc.querySelectorAll('#pin-dock .pin-host')];
const idsHome = () => ['card-modal-scrim', 'card-modal-win', 'card-modal-body', 'card-modal-title', 'card-modal-header-left', 'card-modal-header-sub']
  .every((id) => $(id) && $(id).closest('#pin-dock') === null);

(async () => {
  const lay = { get value() { return String(OW.DisplayPrefs.get('layout')); } }, prefs = () => JSON.parse(STORE._d['orbweaver.display.v1'] || '{}');
  check('game boots with no script errors', errors.length === 0, errors.join('\n        '));
  check('new game: Side pins off, 5 pin max on, Centered layout on, no pin icon', !OW.Pins.isOn() && !$('pins-toggle').classList.contains('on') && $('pins-max-toggle').classList.contains('on') && $('layout-toggle').classList.contains('on') && !doc.body.classList.contains('pins-on') && lay.value === '1');
  click($('pins-toggle'));
  check('switching Side pins on shows the pin icon and is remembered', OW.Pins.isOn() && doc.body.classList.contains('pins-on') && prefs().pins === 1);
  check('on with no pins acts off: no column, layout untouched (Centered)', OW.Pins.pins.length === 0 && !doc.body.classList.contains('pins-side') && lay.value === '1' && doc.body.classList.contains('layout-centered'));
  check('Settings has a Side pins section (pin icon, subtitle) holding both switches', [...doc.querySelectorAll('.settings-section-label')].some((l) => l.firstChild.textContent.trim() === 'Side pins' && l.querySelector('svg') && l.querySelector('.settings-sub').textContent === 'Pin your favorite buildings to the side' && l.nextElementSibling.contains($('pins-toggle'))));

  // First pin: column opens, Centered moves to Free.
  const wood = await open('wood');
  click(doc.body); // pin-button sync runs on document click
  check('pin button shown for a real card', !$('card-modal-pin').hidden);
  click($('card-modal-pin'));
  check('pinning closes the real modal', !OW.Cards.isModalOpenFor('wood') && !$('card-modal-scrim').classList.contains('open'));
  check('first pin opens the side column and moves Centered to Free', doc.body.classList.contains('pins-side') && lay.value === '0' && !doc.body.classList.contains('layout-centered'));
  $('main-wrap').getBoundingClientRect = () => ({ top: 77 });
  raf.length = 0; roCbs.forEach((cb) => cb([]));
  const sync = doc.getElementById('pin-dock').style.getPropertyValue('--pins-top');
  raf.splice(0).forEach((f) => f());
  check('a resize moves the pin column one frame later, not inside the observer (no loop error)', sync !== '77px' && $('pin-dock').style.getPropertyValue('--pins-top') === '77px');
  check('side column starts under the header', $('pin-dock').style.getPropertyValue('--pins-top') !== '');
  let p = panels()[0];
  check('one panel in the column with the card title', panels().length === 1 && p.querySelector('.modal-title').textContent === 'Wood Pile');
  check('panel carries its own worker steppers', !!p.querySelector('.modal-header-left .card-steppers .stepper-plus'));
  check('real modal ids are home after pinning', idsHome());

  // Clickable panel stepper (inside the swap), then ids restored.
  const plus = () => panels()[0].querySelector('.stepper-plus');
  ptr(plus(), 'pointerdown');
  check('panel + assigns a worker', OW.Workers.getAssigned('wood') === 1, OW.Workers.getAssigned('wood'));
  check('during a pointer hold the panel holds the modal ids', $('card-modal-body').closest('#pin-dock') !== null);
  await sleep(800); // hold-to-repeat kicks in after 600ms
  ptr(w, 'pointerup');
  await sleep(10);
  check('hold-to-repeat works in a panel', OW.Workers.getAssigned('wood') > 1, OW.Workers.getAssigned('wood'));
  check('real modal ids restored after release', idsHome());
  check('panel stepper value shows the live count', panels()[0].querySelector('.card-stepper-val').textContent === String(OW.Workers.getAssigned('wood')));

  step(2);
  check('panel live-patches on ticks (worker desc)', /Chops/.test(panels()[0].querySelector('.worker-desc').textContent));
  check('ids stay home through ticks', idsHome());

  // Market Stall: afterRender-wired tab buttons work in a panel; wide card widens every panel.
  await open('marketstall'); click(doc.body); click($('card-modal-pin'));
  const ms = () => panels()[1];
  const tabs = ms().querySelectorAll('[data-ms-tab]');
  const before = ms().querySelector('.modal-body').innerHTML;
  click(tabs[tabs.length - 1]);
  await sleep(5);
  check('Market Stall tab click inside a panel re-renders that panel', ms().querySelector('.modal-body').innerHTML !== before);
  check('real modal stays closed and empty', !$('card-modal-scrim').classList.contains('open') && $('card-modal-body').innerHTML === '');
  // Shared .modal-win.modal-wide sets a fixed 820px; a stronger panel rule must make wide panels fill (and shrink with) the column.
  // jsdom ignores selector strength, so this guards the rule itself; real-browser widths were measured when it was added.
  check('wide panels fill the column instead of a fixed 820px (style.css rule present)', /\.modal-win\.pin-win\.modal-wide\s*\{\s*width:\s*100%/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));
  check('a wide pinned card widens every panel (has-wide)', ms().querySelector('.pin-win').classList.contains('modal-wide') && $('pin-dock').classList.contains('has-wide'));

  // Handoff: opening a pinned card opens the real modal; closing rebuilds the panel.
  await open('wood');
  check('handoff: pinned card opens the real modal normally', OW.Cards.isModalOpenFor('wood') && $('card-modal-title').textContent === 'Wood Pile');
  click(doc.body);
  check('handoff: real modal pin button reads pinned', $('card-modal-pin').classList.contains('on'));
  close();
  step(1);
  check('handoff: panel rebuilt with its steppers after close', wood.els.modalSteppers && panels()[0].contains(wood.els.modalSteppers));

  // Regression: focus leaving a panel while the real modal closes must not leave a stale "open" card.
  await open('stone');
  panels()[0].querySelector('.stepper-plus').dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
  close();
  await sleep(5);
  check('focus leaving a panel during a real-modal close leaves nothing open', !OW.Mechanics.all().some((m) => OW.Cards.isModalOpenFor(m.id)));

  await open('resupplymule1'); click(doc.body);
  check('cargo card: pin button hidden', $('card-modal-pin').hidden);
  close();

  // Cap at 5.
  for (const id of ['stone', 'tents', 'toolshed']) { await open(id); click(doc.body); click($('card-modal-pin')); }
  check('five pins allowed', panels().length === 5, panels().length);
  await open('scoutspen'); click(doc.body);
  const footerBefore = OW.Footer.getHistory().length;
  click($('card-modal-pin'));
  check('6th pin refused', panels().length === 5 && OW.Cards.isModalOpenFor('scoutspen'));
  const popText = () => [...doc.querySelectorAll('.pin-pop.sp-req-msg')].map((d) => d.textContent).join('|');
  check('6th pin pops "Pin limit reached" (not logged) and shakes', popText() === 'Pin limit reached' && OW.Footer.getHistory().length === footerBefore && $('card-modal-pin').classList.contains('shake'));
  check('pop-up removes itself when its fade ends', (doc.querySelector('.pin-pop').dispatchEvent(new w.Event('animationend')), !doc.querySelector('.pin-pop')));
  $('card-modal-pin').dispatchEvent(new w.Event('animationend'));
  check('shake class clears when its animation ends (no replay later)', !$('card-modal-pin').classList.contains('shake'));
  close();

  // 5 pin max off: no cap + warning; back on keeps the top 5.
  const logBefore = OW.Footer.getHistory().length;
  click($('pins-max-toggle'));
  check('5 pin max off pops the warning (not logged) and is remembered', popText() === 'Could slow down game on low end systems' && OW.Footer.getHistory().length === logBefore && prefs().pinMax === 0);
  for (const id of ['scoutspen', 'quarry']) { await open(id); click(doc.body); click($('card-modal-pin')); }
  check('max off: 7 pins allowed', panels().length === 7, panels().length);
  click($('pins-max-toggle'));
  check('max back on keeps the top 5, removes the rest', OW.Pins.pins.map((x) => x.m.id).join() === 'wood,marketstall,stone,tents,toolshed' && panels().length === 5 && prefs().pinMax === 1);

  // Unpin from a panel's own pin button.
  click(panels()[4].querySelector('.pin-btn'));
  check('panel pin button unpins', panels().length === 4 && !OW.Pins.pins.some((x) => x.m.id === 'toolshed'));
  check('unpinned card drops its panel steppers', OW.Mechanics.get('toolshed').els.modalSteppers === null);

  OW.Cards.hide(OW.Mechanics.get('tents'));
  step(1);
  check('hidden card unpins itself', !OW.Pins.pins.some((x) => x.m.id === 'tents'));

  // Narrow window hides the column, keeps pins; widening rebuilds.
  w.innerWidth = 800; w.dispatchEvent(new w.Event('resize'));
  check('narrow: column hidden, pins kept', doc.body.classList.contains('pins-hidden') && !doc.body.classList.contains('pins-side') && OW.Pins.pins.length === 3);
  w.innerWidth = 1600; w.dispatchEvent(new w.Event('resize'));
  check('wide again: column shown', !doc.body.classList.contains('pins-hidden') && doc.body.classList.contains('pins-side'));

  // Last unpin closes the column and restores Centered.
  while (panels().length) click(panels()[0].querySelector('.pin-btn'));
  check('last unpin: no column, layout back to Centered, setting still on', !doc.body.classList.contains('pins-side') && lay.value === '1' && doc.body.classList.contains('layout-centered') && OW.Pins.isOn());

  // Centered over a desktop side column turns on Force bottom; the pins stay.
  await open('wood'); click(doc.body); click($('card-modal-pin'));
  click($('layout-toggle'));
  check('Centered moves pins to the bottom strip via Force bottom', OW.Pins.pins.length === 1 && panels().length === 1 && doc.body.classList.contains('pins-bottom') && !doc.body.classList.contains('pins-side') && $('pins-bottom-toggle').classList.contains('on') && !$('pins-right-toggle').classList.contains('on') && prefs().pinPos === 2 && lay.value === '1');
  click($('layout-toggle'));
  check('Centered off later leaves Force bottom on', lay.value === '0' && $('pins-bottom-toggle').classList.contains('on') && doc.body.classList.contains('pins-bottom') && OW.Pins.pins.length === 1);
  click($('layout-toggle')); click($('pins-bottom-toggle'));
  while (panels().length) click(panels()[0].querySelector('.pin-btn'));
  check('ids home, real modal untouched', idsHome());

  // Mobile: pins go in a bottom strip; layout untouched.
  isDesktop = false; w.dispatchEvent(new w.Event('resize'));
  await open('wood'); click(doc.body); click($('card-modal-pin'));
  check('mobile: pin goes to the bottom strip, layout untouched', doc.body.classList.contains('pins-bottom') && !doc.body.classList.contains('pins-side') && lay.value === '1');
  click($('pins-right-toggle'));
  check('mobile + Force right: game left, pins right (split), remembered', doc.body.classList.contains('pins-side') && doc.body.classList.contains('pins-split') && !doc.body.classList.contains('pins-bottom') && lay.value === '1' && prefs().pinPos === 1);
  isDesktop = true; w.dispatchEvent(new w.Event('resize'));
  check('desktop + Force right: plain side column, Centered gives way', doc.body.classList.contains('pins-side') && !doc.body.classList.contains('pins-split') && lay.value === '0');
  click($('pins-bottom-toggle'));
  check('Force bottom turns Force right off, docks at the bottom on desktop, Centered back', $('pins-bottom-toggle').classList.contains('on') && !$('pins-right-toggle').classList.contains('on') && doc.body.classList.contains('pins-bottom') && !doc.body.classList.contains('pins-side') && lay.value === '1' && prefs().pinPos === 2);
  click($('layout-toggle')); click($('layout-toggle'));
  check('Force bottom: Centered/Free switchable without unpinning', OW.Pins.pins.length === 1 && lay.value === '1' && doc.body.classList.contains('pins-bottom'));
  click($('pins-bottom-toggle'));
  check('both off: back to automatic (desktop = side column)', prefs().pinPos === 0 && doc.body.classList.contains('pins-side') && !doc.body.classList.contains('pins-bottom'));

  // Off: clears pins and the icon, remembered.
  click($('pins-toggle'));
  check('off clears every pin, hides the icon, is remembered', !OW.Pins.isOn() && OW.Pins.pins.length === 0 && panels().length === 0 && !doc.body.classList.contains('pins-on') && prefs().pins === 0);
  check('off: no layout classes left', !['pins-side', 'pins-split', 'pins-bottom', 'pins-hidden'].some((c) => doc.body.classList.contains(c)));
  step(3);

  // Every card (future ones included): its panel matches its real modal, and every panel button runs cleanly.
  click($('pins-toggle'));
  check('on again is remembered', OW.Pins.isOn() && prefs().pins === 1);
  const norm = (s) => s.replace(/ style="[^"]*"/g, '').replace(/\s+/g, ' ');
  const look = (h) => norm(h.querySelector('.modal-body').innerHTML + '|' + h.querySelector('.modal-title').textContent + '|' + h.querySelector('.modal-header-sub').innerHTML) + h.querySelectorAll('.modal-header-left .stepper-plus').length;
  // Fade Bench / Dig Site / Research Bench fully in (they can't open before): 10 wood, 10 stone, 15 digs.
  OW.Resources.add('wood', 10); OW.Resources.add('stone', 10); step(1);
  OW.DigSite.completeIntro(); OW.StrangeShard.clear(); OW.Workers.addWorkers(1); OW.DigSite.subAssign('dig');
  for (let i = 0; i < 5000 && OW.DigSite.digs() < 15; i++) step(1);
  OW.DigSite.subUnassign('dig'); step(1);
  const cards = OW.Mechanics.all().filter((m) => !m.isMule && !m.noPin && m.els && m.els.wrap), bad = [];
  for (const m of cards) {
    await open(m.id); click(doc.body);
    const real = look($('card-modal-win')); click($('card-modal-pin'));
    const host = () => panels().find((h) => OW.Pins.pins.some((x) => x.host === h && x.m === m));
    if (!host() || look(host()) !== real) { bad.push(`${m.id}: panel differs from modal`); continue; }
    for (let i = 0; host(); i++) {
      const b = host().querySelectorAll('button:not([disabled]):not(.pin-btn), .toggle-switch')[i];
      if (!b) break; click(b); step(1);
    }
    await sleep(5); // panels hand the ids back on a 0ms timer
    if (!idsHome() || OW.Mechanics.all().some((x) => OW.Cards.isModalOpenFor(x.id))) bad.push(`${m.id}: modal ids or open state leaked`);
    if (host()) click(host().querySelector('.pin-btn'));
    OW.StrangeShard.clear(); // a panel button may start a Strange Shard preview, which locks other cards
  }
  check(`every card (${cards.length}) pins as an exact copy and every panel button runs cleanly`, cards.length > 10 && !bad.length, bad.join('\n        '));
  check('no errors through the whole run', errors.length === 0, errors.join('\n        '));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
