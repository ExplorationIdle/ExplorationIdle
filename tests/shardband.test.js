/* Shard rail bands: every location's Shard row takes the Shard colour rule,
   and a Shard row only shows while it holds one (display only — `hidden` is
   the saved state and stays revealed). Run: node tests/shardband.test.js */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPTS = HTML.match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

function boot() {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window, store = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  Object.defineProperty(w, 'localStorage', { value: store, configurable: true, writable: true });
  w.requestAnimationFrame = () => 0;
  w.console = { log: () => {}, error: (...a) => { throw new Error(a.join(' ')); }, warn: () => {} };
  SCRIPTS.forEach((src) => w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  return { w, OW: w.OrbWeaver };
}

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok', name); } catch (e) { console.log('  FAIL', name, '\n   ', e.message); process.exitCode = 1; } };
console.log('shardband');

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const rule = css.match(/^(\.res-band\[data-res[^{]*shard[^{]*)\{/m)[1].split(',')[0].replace(/ \.res-name\s*$/, '').trim();

const { w, OW } = boot(), R = OW.Resources;
const band = (id) => w.document.querySelector(`.res-band[data-res="${id}"]`);
const shown = (id) => band(id).style.display !== 'none';
const ids = ['shard', OW.RuinedTemple.ensureResource('shard', 'Shard'), OW.Mountains.ensureResource('shard', 'Shard')];

test('every location\'s Shard band takes the Shard colour rule', () => {
  ids.forEach((id) => assert.ok(band(id).matches(rule), `${id} matches ${rule}`));
  assert.ok(!band('wood').matches(rule), 'wood does not');
});

test('a Shard row at 0 is not listed, even once revealed', () => {
  ids.forEach((id) => { R.reveal(id); assert.ok(!shown(id), id); assert.equal(R.isHidden(id), false, `${id} stays revealed`); });
});

test('a Shard row shows at 1+ and drops off again when spent', () => {
  ids.forEach((id) => {
    R.add(id, 1); assert.ok(shown(id), `${id} shown at 1`);
    R.add(id, 1); assert.ok(shown(id), `${id} shown at 2`);
    R.spend(id, 2); assert.ok(!shown(id), `${id} hidden at 0`);
    assert.equal(R.isHidden(id), false, `${id} saved state still revealed`);
  });
});

test('save keeps revealed state; reload of a 0 Shard stays off the list, of a 1 Shard shows', () => {
  R.add(ids[1], 1);
  const s = R.serialize();
  assert.equal(s.shard.h, false); assert.equal(s[ids[1]].v, 1);
  R.setRaw(ids[1], 0); assert.ok(!shown(ids[1]));
  R.setRaw(ids[1], 1); assert.ok(shown(ids[1]));
});

test('other rows still show at 0 (wood)', () => {
  R.reveal('wood'); R.setRaw('wood', 0); assert.ok(shown('wood'));
});

console.log(`${pass}/5 passed`);
process.exit(process.exitCode || 0);
