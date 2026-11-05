/* Display preferences (Settings' four sliders). Covers what jsdom can
   actually establish: defaults, the theme/layout mappings, clamping,
   malformed and blocked storage, the persistence round trip, surviving
   an erase, the pointer-only center detent, and the adjusting-state
   lifecycle. Geometry, zoom rendering, clipping and pointer capture are
   browser-only concerns and are checked by hand — see tests/README.md. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

const DKEY = 'orbweaver.display.v1';
const SKEY = 'orbweaver.save.v1';

let STORE = null;
function newStore(opts) {
  const o = opts || {};
  STORE = {
    _d: {}, blocked: !!o.blocked,
    getItem(k) { if (this.blocked && o.blockReads) throw new Error('blocked'); return k in this._d ? this._d[k] : null; },
    setItem(k, v) { if (this.blocked) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
}

function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  w.performance = { now: () => Date.now() };
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  w.__reloaded = false;
  SCRIPTS.forEach((src) => {
    let code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    code = code.replace(/location\.reload\(\);/g, 'window.__doReload();');
    try { w.eval(code); } catch (e) { errors.push(`${src}: ${e.message}`); }
  });
  w.__doReload = () => { w.__reloaded = true; };
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver, errors };
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

const $ = (w, id) => w.document.getElementById(id);
const val = (w, id) => $(w, id).value;
const out = (w, id) => $(w, id).textContent;
const cssVar = (w, name) => w.document.documentElement.style.getPropertyValue(name);
const themeAttr = (w) => w.document.documentElement.getAttribute('data-theme');
const centered = (w) => w.document.body.classList.contains('layout-centered');
const adjusting = (w) => w.document.body.classList.contains('settings-adjusting');
const stored = () => { try { return JSON.parse(STORE._d[DKEY]); } catch (e) { return null; } };

function fire(w, id, type) {
  $(w, id).dispatchEvent(new w.Event(type, { bubbles: true }));
}
function setSlider(w, id, v) {
  $(w, id).value = String(v);
  fire(w, id, 'input');
}

// ─── 1. Defaults on a store with nothing in it ────────────────────────
newStore();
let b = boot();
check('1: boots with no script errors', b.errors.length === 0, b.errors.join(' | '));
check('1: sidebar text defaults to 100', val(b.w, 'sidebar-text-slider') === '100');
check('1: game zoom defaults to 100', val(b.w, 'game-zoom-slider') === '100');
check('1: theme defaults to 6 (top position, Original)', val(b.w, 'display-theme-slider') === '6' && $(b.w, 'display-theme-slider').max === '6');
check('1: Side pins defaults off, Centered layout on', !$(b.w, 'pins-toggle').classList.contains('on') && !b.OW.Pins.isOn() && $(b.w, 'layout-toggle').classList.contains('on') && centered(b.w));
const layoutOn = (w) => $(w, 'layout-toggle').classList.contains('on');
check('1: layout defaults to 1 (Centered layout switch on)', layoutOn(b.w));
check('1: value labels read out the defaults',
  out(b.w, 'sidebar-text-val') === '100%' && out(b.w, 'game-zoom-val') === '100%' &&
  out(b.w, 'display-theme-val') === 'Original', out(b.w, 'display-theme-val'));
check('1: defaults apply Original and centered layout',
  themeAttr(b.w) === 'original' && centered(b.w), 'theme=' + themeAttr(b.w));
check('1: multipliers start at 1',
  cssVar(b.w, '--sidebar-text') === '1' && cssVar(b.w, '--game-zoom') === '1',
  `${cssVar(b.w, '--sidebar-text')} / ${cssVar(b.w, '--game-zoom')}`);
check('1: Wide Mode is gone from the DOM', !$(b.w, 'wide-mode-toggle'));

// ─── 2. Each slider drives its own effect ─────────────────────────────
setSlider(b.w, 'sidebar-text-slider', 125);
check('2: sidebar text writes its multiplier', cssVar(b.w, '--sidebar-text') === '1.25',
  cssVar(b.w, '--sidebar-text'));
check('2: sidebar text label follows', out(b.w, 'sidebar-text-val') === '125%');
setSlider(b.w, 'game-zoom-slider', 75);
check('2: game zoom writes its multiplier', cssVar(b.w, '--game-zoom') === '0.75',
  cssVar(b.w, '--game-zoom'));
check('2: aria-valuetext follows the label',
  $(b.w, 'game-zoom-slider').getAttribute('aria-valuetext') === '75%');

// ─── 3. Theme mapping, top to bottom ──────────────────────────────────
// Original, -1 … -5, Light.
const THEME_ROWS = [[6, 'original', 'Original'], [5, 'dark1', '-1'], [4, 'dark2', '-2'], [3, 'dark3', '-3'],
                    [2, 'dark4', '-4'], [1, 'dark5', '-5'], [0, 'stone', 'Light']];
THEME_ROWS.forEach(([v, attr, name]) => {
  setSlider(b.w, 'display-theme-slider', v);
  check(`3: theme ${v} is ${name}`,
    themeAttr(b.w) === attr && out(b.w, 'display-theme-val') === name,
    `attr=${themeAttr(b.w)} label=${out(b.w, 'display-theme-val')}`);
});
check('3: theme slider sets aria-valuetext too',
  $(b.w, 'display-theme-slider').getAttribute('aria-valuetext') === 'Light');
// -2 … -5 each a bit brighter than the step above; muted text stays readable on cards.
{
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const pal = (n) => Object.fromEntries([...css.split(`:root[data-theme="dark${n}"] {`)[1].split('}')[0].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (h) => { const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const P = [1, 2, 3, 4, 5].map(pal);
  check('3: -1 … -5 each brighter than the last (bg, cards, borders)',
    P.every((p, i) => !i || ['bg', 'card-bg', 'border'].every((k) => lum(p[k]) > lum(P[i - 1][k]))));
  check('3: muted text keeps ≥ 3.5:1 contrast on cards at every step',
    P.every((p) => (lum(p['text-muted']) + 0.05) / (lum(p['card-bg']) + 0.05) >= 3.5));
  check('3: the old New (midpoint) and Slightly lighter (subtle) blocks are gone', !/midpoint"|subtle"/.test(css));
}

// ─── 3b. Font packages, top to bottom ─────────────────────────────────
const fontAttr = (w) => w.document.documentElement.getAttribute('data-font');
check('3b: font slider defaults to 6 (Original) and sits right of the theme slider',
  val(b.w, 'display-font-slider') === '6' && $(b.w, 'display-font-slider').max === '6' && fontAttr(b.w) === 'original'
  && $(b.w, 'display-theme-slider').closest('.disp-ctl').nextElementSibling === $(b.w, 'display-font-slider').closest('.disp-ctl'));
[[6, 'original', 'Original'], [5, 'tome', 'Tome'], [4, 'pixel', 'Pixel'], [3, 'typewriter', 'Typewriter'],
 [2, 'journal', 'Journal'], [1, 'futuristic', 'Futuristic'], [0, 'gothic', 'Gothic']].forEach(([v, attr, name]) => {
  setSlider(b.w, 'display-font-slider', v);
  check(`3b: font ${v} is ${name}`, fontAttr(b.w) === attr && out(b.w, 'display-font-val') === name && stored().font === v,
    `attr=${fontAttr(b.w)} label=${out(b.w, 'display-font-val')}`);
});
fire(b.w, 'display-font-slider', 'pointerdown');
const fontDim = adjusting(b.w);
fire(b.w, 'display-font-slider', 'pointerup');
check('3b: the font slider dims Settings while held, then clears', fontDim && !adjusting(b.w));
setSlider(b.w, 'display-font-slider', 6);
{
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  check('3b: Original keeps today\'s fonts, and no rule names them directly any more',
    /--font-body: 'Inter', sans-serif;/.test(css) && /--font-label: 'JetBrains Mono', monospace;/.test(css)
    && (css.match(/'JetBrains Mono'/g) || []).length === 1 && !/font-family: 'Inter'(?!, sans-serif; font-size: 13px)/.test(css));
  check('3b: every package sets both font roles and its fonts are loaded',
    ['tome', 'pixel', 'typewriter', 'journal', 'futuristic', 'gothic'].every((f) => {
      const m = css.match(new RegExp(`data-font="${f}"\\]\\s*\\{ --font-body: '([^']+)'[^;]*; --font-label: '([^']+)'`));
      return m && [m[1], m[2]].every((fam) => css.includes('family=' + fam.replace(/ /g, '+')));
    }));
}

// ─── 4. Layout mapping ────────────────────────────────────────────────
fire(b.w, 'layout-toggle', 'click');
check('4: switch off is Free and drops the centered class', !centered(b.w) && !layoutOn(b.w) && stored().layout === 0);
fire(b.w, 'layout-toggle', 'click');
check('4: switch on is Centered and restores the class', centered(b.w) && layoutOn(b.w) && stored().layout === 1);

// ─── 5. Persistence, under the hyphenated key names ───────────────────
const saved = stored();
check('5: saved under the hyphenated property names', saved &&
  saved['sidebar-text'] === 125 && saved['game-zoom'] === 75 &&
  saved.tone === 0 && saved.layout === 1, JSON.stringify(saved));
b = boot();                                   // same STORE, fresh page
check('5: preferences come back after a reboot',
  val(b.w, 'sidebar-text-slider') === '125' && val(b.w, 'game-zoom-slider') === '75' &&
  val(b.w, 'display-theme-slider') === '0' && layoutOn(b.w));
check('5: restored preferences are applied, not just loaded',
  themeAttr(b.w) === 'stone' && cssVar(b.w, '--sidebar-text') === '1.25' && centered(b.w));

// ─── 6. Out-of-range and wrong-typed values clamp ─────────────────────
newStore();
STORE._d[DKEY] = JSON.stringify({ 'sidebar-text': 999, 'game-zoom': -50, tone: 9, layout: 'yes', pins: -1 });
b = boot();
check('6: over-max size clamps to 125', val(b.w, 'sidebar-text-slider') === '125');
check('6: under-min size clamps to 75', val(b.w, 'game-zoom-slider') === '75');
check('6: out-of-range theme clamps into 0-6', val(b.w, 'display-theme-slider') === '6');
check('6: a non-numeric layout falls back to the default', layoutOn(b.w) && centered(b.w));
check('6: an old "device default" Side pins (-1) loads as off', !b.OW.Pins.isOn() && b.OW.DisplayPrefs.get('pins') === 0);
check('6: Force right/bottom default off', b.OW.DisplayPrefs.get('pinPos') === 0 && !$(b.w, 'pins-right-toggle').classList.contains('on') && !$(b.w, 'pins-bottom-toggle').classList.contains('on'));
check('6: clamping produced no errors', b.errors.length === 0, b.errors.join(' | '));

// ─── 6b. Old 4-step theme converts once to the 7-step tone ───────────
[[3, 'original'], [2, 'dark1'], [1, 'dark1'], [0, 'stone']].forEach(([old, attr]) => {
  newStore(); STORE._d[DKEY] = JSON.stringify({ theme: old });
  b = boot();
  check(`6b: old theme ${old} loads as ${attr}`, themeAttr(b.w) === attr, themeAttr(b.w));
});
setSlider(b.w, 'sidebar-text-slider', 110);
check('6b: the next write stores tone and drops the old theme key', stored().tone === 0 && !('theme' in stored()), JSON.stringify(stored()));

// ─── 7. Malformed stored blob ─────────────────────────────────────────
newStore();
STORE._d[DKEY] = '{not json at all';
b = boot();
check('7: unparseable preferences fall back to defaults without throwing',
  b.errors.length === 0 && val(b.w, 'sidebar-text-slider') === '100' &&
  themeAttr(b.w) === 'original', b.errors.join(' | '));

// ─── 8. Storage blocked entirely (private browsing) ───────────────────
newStore({ blocked: true, blockReads: true });
b = boot();
check('8: boots with defaults when storage throws on read',
  b.errors.length === 0 && val(b.w, 'game-zoom-slider') === '100', b.errors.join(' | '));
setSlider(b.w, 'game-zoom-slider', 110);
check('8: a write that throws still applies the preference in-session',
  cssVar(b.w, '--game-zoom') === '1.1' && out(b.w, 'game-zoom-val') === '110%',
  cssVar(b.w, '--game-zoom'));

// ─── 9. Display preferences outlive an erase ──────────────────────────
// save.js only ever touches its own key, which is the whole reason these
// live in a separate one — a player who wipes progress keeps their theme.
newStore();
b = boot();
setSlider(b.w, 'display-theme-slider', 0);
setSlider(b.w, 'sidebar-text-slider', 90);
b.OW.Save.saveToStorage();
check('9: both keys are present before the erase',
  !!STORE._d[SKEY] && !!STORE._d[DKEY]);
b.OW.Save.eraseAndReload();
check('9: erase cleared the game save', !STORE._d[SKEY]);
check('9: erase left display preferences untouched',
  !!STORE._d[DKEY] && stored().tone === 0 && stored()['sidebar-text'] === 90,
  JSON.stringify(stored()));
b = boot();
check('9: the erased-and-reloaded game still comes back on Light',
  themeAttr(b.w) === 'stone' && val(b.w, 'sidebar-text-slider') === '90');

// ─── 10. Pointer-only center detent ───────────────────────────────────
// Dragging snaps 98-102 to exactly 100; the keyboard deliberately does
// not, so a player can still pick 99 or 101 on purpose.
newStore();
b = boot();
fire(b.w, 'sidebar-text-slider', 'pointerdown');
setSlider(b.w, 'sidebar-text-slider', 101);
check('10: a pointer drag snaps 101 to 100',
  val(b.w, 'sidebar-text-slider') === '100' && out(b.w, 'sidebar-text-val') === '100%');
setSlider(b.w, 'sidebar-text-slider', 103);
check('10: a pointer drag leaves 103 alone (outside the detent)',
  val(b.w, 'sidebar-text-slider') === '103');
fire(b.w, 'sidebar-text-slider', 'pointerup');
setSlider(b.w, 'sidebar-text-slider', 101);
check('10: the keyboard keeps every step, including 101',
  val(b.w, 'sidebar-text-slider') === '101' && out(b.w, 'sidebar-text-val') === '101%');

// ─── 11. Adjusting state lifecycle ────────────────────────────────────
newStore();
b = boot();
check('11: not adjusting at rest', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
check('11: a pointer press starts adjusting', adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerup');
check('11: release ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'keydown');
check('11: a held key starts it too', adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'keyup');
check('11: key release ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
fire(b.w, 'game-zoom-slider', 'pointercancel');
check('11: a cancelled pointer ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
fire(b.w, 'game-zoom-slider', 'lostpointercapture');
check('11: losing pointer capture ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
b.w.dispatchEvent(new b.w.Event('blur'));
check('11: window blur ends it', !adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerdown');
b.w.dispatchEvent(new b.w.Event('pagehide'));
check('11: pagehide ends it', !adjusting(b.w));
fire(b.w, 'sidebar-text-slider', 'pointerdown'); fire(b.w, 'sidebar-text-slider', 'pointerup');
fire(b.w, 'game-zoom-slider', 'pointerdown'); $(b.w, 'sidebar-text-slider').dispatchEvent(new b.w.Event('blur')); // real blur doesn't bubble
check('11: pressing the other slider (which blurs the first) still fades', adjusting(b.w));
fire(b.w, 'game-zoom-slider', 'pointerup');
// The theme slider never dims anything.
fire(b.w, 'display-theme-slider', 'pointerdown');
check('11: the theme slider never triggers the dimming', !adjusting(b.w));

// ─── Phone size: phones show the game 20% larger (index.html head) ──
function bootPhone(sw, sh, type) {
  const full = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(full.slice(0, full.indexOf('</head>') + 7) + '<body></body></html>', {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      Object.defineProperty(w, 'screen', { value: { width: sw, height: sh, orientation: { type } }, configurable: true });
      Object.defineProperty(w, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });
    }
  });
  const d = dom.window.document;
  return { vp: d.querySelector('meta[name="viewport"]').content, cls: d.documentElement.classList.contains('phone-zoom') };
}
let ph = bootPhone(390, 844, 'portrait-primary');
check('phone: page width is screen / 1.2 (390 -> 325), tagged phone-zoom', ph.vp === 'width=325' && ph.cls);
ph = bootPhone(390, 844, 'landscape-primary');
check('phone rotated: uses the long side (844 -> 703)', ph.vp === 'width=703' && ph.cls);
ph = bootPhone(1920, 1080, 'landscape-primary');
check('desktop: viewport untouched, not tagged', ph.vp === 'width=device-width, initial-scale=1.0' && !ph.cls);
ph = bootPhone(820, 1180, 'portrait-primary');
check('tablet: untouched', ph.vp === 'width=device-width, initial-scale=1.0' && !ph.cls);
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('phone-zoom rail default 135px = 162px on screen; drag still wins', css.includes('html.phone-zoom #left-hand { width: var(--rail-w, 135px); flex-basis: var(--rail-w, 135px); }'));
check('Panels ends with the browser-zoom note', /id="panels-adjust-btn">Adjust now<\/button>\s*<\/div>\s*<div class="settings-note">You can also use your browser's zoom to resize the game\.<\/div>/.test(html));

// ─── 12. The pre-paint <head> initializer ─────────────────────────────
// script.js runs at the end of <body>, i.e. after first paint, so a
// Light player would see a flash of the dark default. The inline
// head script exists to beat that. It is never picked up by the SCRIPTS
// list above (no src attribute), so it needs its own harness: parse
// only as far as </head>, with localStorage seeded via beforeParse, and
// assert the work is already done while script.js does not yet exist.
function bootHead(rawValue) {
  const full = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const headOnly = full.slice(0, full.indexOf('</head>') + 7) + '<body></body></html>';
  const dom = new JSDOM(headOnly, {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      const s = {
        _d: rawValue === null ? {} : { [DKEY]: rawValue },
        getItem(k) { return k in this._d ? this._d[k] : null; },
        setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
      };
      Object.defineProperty(w, 'localStorage', { value: s, configurable: true, writable: true });
      w.console = { log() {}, error() {}, warn() {} };
    }
  });
  const r = dom.window.document.documentElement;
  return {
    theme: r.getAttribute('data-theme'),
    font: r.getAttribute('data-font'),
    zoom: r.style.getPropertyValue('--game-zoom'),
    text: r.style.getPropertyValue('--sidebar-text')
  };
}

let h = bootHead(JSON.stringify({ 'sidebar-text': 125, 'game-zoom': 75, theme: 0, layout: 1 }));
check('12: stone is applied before script.js is even parsed', h.theme === 'stone', h.theme);
check('12: both multipliers are set pre-paint too',
  h.zoom === '0.75' && h.text === '1.25', `${h.zoom} / ${h.text}`);
check('12: head init uses the same mapping (tone 4 is -2)',
  bootHead(JSON.stringify({ tone: 4 })).theme === 'dark2');
check('12: head init converts an old 4-step theme (Slightly lighter, New → -1; Original stays)',
  bootHead(JSON.stringify({ theme: 2 })).theme === 'dark1' && bootHead(JSON.stringify({ theme: 1 })).theme === 'dark1' && bootHead(JSON.stringify({ theme: 3 })).theme === 'original');
check('12: head init applies the stored font before first paint (1 is Futuristic)',
  bootHead(JSON.stringify({ font: 1 })).font === 'futuristic' && !bootHead(JSON.stringify({ font: 9 })).font);
check('12: no stored key leaves Original, forcing no attribute', !bootHead(null).theme);
check('12: a malformed blob neither throws nor sets a theme',
  !bootHead('{{{ not json').theme);
check('12: an out-of-range theme index is ignored',
  !bootHead(JSON.stringify({ theme: 99 })).theme);
check('12: a non-numeric theme is ignored',
  !bootHead(JSON.stringify({ theme: 'stone' })).theme);

// 13: Cheat menu — last Settings row, off each load, first tap only warns.
newStore();
{
  const c = boot(), d = c.w.document, tg = d.getElementById('cheat-toggle'), hd = d.getElementById('cheat-header');
  const tap = () => tg.dispatchEvent(new c.w.Event('click', { bubbles: true }));
  const pop = () => d.querySelector('.pin-pop');
  check('13: Cheat menu is the last Settings row', d.querySelector('.settings-main').lastElementChild === tg.parentElement);
  check('13: boots off with the cheat bar hidden', !tg.classList.contains('on') && hd.style.display === 'none');
  tap();
  check('13: first tap warns and stays off', !tg.classList.contains('on') && hd.style.display === 'none'
    && !!pop() && pop().textContent === 'Cheats will spoil the game. Tap again to turn on.');
  pop().remove(); tap();
  check('13: second tap turns cheats on', tg.classList.contains('on') && hd.style.display === 'flex' && !pop());
  tap(); tap();
  check('13: later off/on toggles with no further warning', tg.classList.contains('on') && hd.style.display === 'flex' && !pop());
  check('13: the warning never reaches the log', !c.OW.Footer.getHistory().some((e) => /spoil/.test(e.t)));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
