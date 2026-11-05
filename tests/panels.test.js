/* Panels (js/core/panels.js). Boots the real game headless and covers:
   defaults (Lock panels off, Default on, lines grabbable, no sizes), the
   Settings section and version slot, Adjust now (works with the switch
   off, shows the lines, a drag sizes the rail within its limits and turns
   Default off, the next tap elsewhere ends it and is swallowed), direct
   dragging only while Lock panels is off, Default resetting every
   size, and the pin column / bottom strip lines.
   jsdom has no layout, so the rail, game and dock rectangles are stubbed. */
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
w.requestAnimationFrame = () => 0;
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
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const ptr = (el, type, x = 0, y = 0) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const rect = (l, t, wd, h) => () => ({ left: l, top: t, width: wd, height: h, right: l + wd, bottom: t + h, x: l, y: t });
$('left-hand').getBoundingClientRect = rect(0, 50, 260, 800);
$('main-wrap').getBoundingClientRect = rect(0, 50, 1600, 800);
$('pin-dock').getBoundingClientRect = rect(900, 50, 700, 800);
w.innerHeight = 900;
const line = (i) => doc.querySelectorAll('.panel-line')[i]; // 0 rail, 1 pins column, 2 bottom strip
const cssVar = (n) => doc.documentElement.style.getPropertyValue(n);
const prefs = () => JSON.parse(STORE._d['orbweaver.display.v1'] || '{}');
const on = (id) => $(id).classList.contains('on');
const raf = []; w.requestAnimationFrame = (f) => (raf.push(f), 0); // panels.js places lines one frame late
const refresh = () => { w.dispatchEvent(new w.Event('resize')); raf.splice(0).forEach((f) => f()); };
const drag = (el, x0, x1, y0 = 0, y1 = 0) => { ptr(el, 'pointerdown', x0, y0); const held = el.classList.contains('drag'); ptr(el, 'pointermove', x1, y1); ptr(el, 'pointerup', x1, y1); return held; };

check('game boots with no script errors', errors.length === 0, errors.join('\n        '));
check('Settings has a Panels section (subtitle): Lock panels, Default, Adjust now', [...doc.querySelectorAll('.settings-section-label')].some((l) => l.firstChild.textContent.trim() === 'Panels' && l.querySelector('.settings-sub').textContent === 'Resize the game UI' && l.nextElementSibling.contains($('panels-adj-toggle'))) && $('panels-default-toggle') && $('panels-adjust-btn').textContent === 'Adjust now');
check('version slot: 12 digits, bottom-right of the footer row, which sits just above the Cheat menu row at the end of the scrolling Settings content', /^\d{12}$/.test($('build-version').textContent) && doc.querySelector('.settings-main').lastElementChild.previousElementSibling === $('settings-foot') && $('settings-foot').lastElementChild === $('build-version') && fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').includes('.settings-foot { display: flex;'));
check('defaults: Lock panels off, Default on, no sizes', !on('panels-adj-toggle') && $('panels-adj-toggle').previousElementSibling.textContent === 'Lock panels' && on('panels-default-toggle') && !cssVar('--rail-w') && !cssVar('--game-w') && !cssVar('--strip-h'));
refresh(); // rects are stubbed after boot
check('three lines exist; only the rail line is grabbable with no pins', doc.querySelectorAll('.panel-line').length === 3 && !line(0).hidden && line(1).hidden && line(2).hidden);
click($('panels-adj-toggle'));
check('Lock panels on: remembered, lines hidden (untouched look unchanged)', on('panels-adj-toggle') && prefs().adjPanels === 0 && [0, 1, 2].every((i) => line(i).hidden));

// Adjust now works with the switch off.
click($('panels-adjust-btn'));
check('Adjust now works while locked: Settings fades, rail line shown, lock stays on', doc.body.classList.contains('panels-adjust') && !line(0).hidden && OW.Panels.isAdjusting() && on('panels-adj-toggle'));
check('Adjust now: no pins, so no pin lines', line(1).hidden && line(2).hidden);
check('holding a line marks it (white state)', drag(line(0), 260, 340));
check('drag sizes the rail and is remembered', cssVar('--rail-w') === '340px' && prefs().railW === 340 && !line(0).classList.contains('drag'));
check('a drag turns Default off', !on('panels-default-toggle'));
drag(line(0), 340, 2000);
check('rail max 420', prefs().railW === 420);
drag(line(0), 420, 5);
check('rail min 150', prefs().railW === 150);
w.innerWidth = 390; $('main-wrap').getBoundingClientRect = rect(0, 50, 390, 800);
drag(line(0), 150, 2);
check('phone: rail min 60', prefs().railW === 60);
drag(line(0), 60, 389);
check('phone: rail max leaves the cards 80px', prefs().railW === 310);
drag(line(0), 310, 150);
w.innerWidth = 1600; $('main-wrap').getBoundingClientRect = rect(0, 50, 1600, 800);
check('Adjust now doubles the grab area (CSS only)', fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8').includes('body.panels-adjust .panel-line::before { inset: 0 -12px; }'));
let hits = 0; const target = $('settings-gear-btn'); target.addEventListener('click', () => hits++);
ptr(target, 'pointerdown'); click(target);
check('tap elsewhere ends Adjust now and does nothing else', !OW.Panels.isAdjusting() && !doc.body.classList.contains('panels-adjust') && hits === 0 && line(0).hidden);
click(target);
check('the next tap works normally', hits === 1);
click($('panels-adjust-btn')); ptr(target, 'pointerdown'); // ended by a swipe: no click follows
ptr($('panels-adjust-btn'), 'pointerdown'); click($('panels-adjust-btn'));
check('after a swipe ends Adjust now, the next tap is not eaten', OW.Panels.isAdjusting());
ptr(target, 'pointerdown'); click(target);

// Direct dragging only while Lock panels is off.
drag(line(0), 150, 300);
check('locked: lines cannot be grabbed outside Adjust now', prefs().railW === 150);
click($('panels-adj-toggle'));
check('Lock panels off: remembered, rail line available', !on('panels-adj-toggle') && prefs().adjPanels === 1 && !line(0).hidden);
drag(line(0), 150, 300);
check('unlocked: direct drag works', prefs().railW === 300 && cssVar('--rail-w') === '300px');

// Pin column and bottom strip lines.
doc.body.classList.add('pins-side'); refresh();
check('side pins: column line shown at the dock edge', !line(1).hidden && line(1).style.left === '900px' && line(2).hidden);
drag(line(1), 900, 1000);
check('column line sets the game width (pins keep 200px)', prefs().gameW === 1000 && cssVar('--game-w') === '1000px');
drag(line(1), 1000, 1590);
check('game width capped so pins keep 200px', prefs().gameW === 1400);
doc.body.classList.replace('pins-side', 'pins-bottom'); refresh();
check('bottom strip: horizontal line shown', !line(2).hidden && line(2).classList.contains('horiz') && line(1).hidden);
drag(line(2), 0, 0, 648, 450);
check('strip line sets the strip height in vh', prefs().stripH === 50 && cssVar('--strip-h') === '50vh');
drag(line(2), 0, 0, 450, 10);
check('strip max 60vh', prefs().stripH === 60);
doc.body.classList.remove('pins-bottom'); refresh();

// Default resets everything.
click($('panels-default-toggle'));
check('Default on resets every size', on('panels-default-toggle') && !cssVar('--rail-w') && !cssVar('--game-w') && !cssVar('--strip-h') && prefs().railW === 0 && prefs().gameW === 0 && prefs().stripH === 0);
click($('panels-adj-toggle'));
check('Lock panels on hides the lines again', on('panels-adj-toggle') && [0, 1, 2].every((i) => line(i).hidden));
check('touch devices: no text selection except the save box', /@media \(hover: none\) and \(pointer: coarse\) \{\s*body \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}\s*\.save-textarea \{ -webkit-user-select: text;/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));
check('the game area never scrolls itself (no stray unstyled scrollbar when very short)', /#main-wrap \{[^}]*overflow: hidden;/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));
check('no script errors during the run', errors.length === 0, errors.join('\n        '));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
