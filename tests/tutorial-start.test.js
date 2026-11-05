/* Tutorial start: Camp label hidden. Builders Bench holds its slot above Wood Pile
   at 0%, shows at 5% on the first wood and fades to 100% at 4 wood; Dig Site (10 stone) and
   Research Bench (15 Dig Site rolls) hold their slots and fade 0% → 100%. All: never drop back, blank face and no clicks until full,
   fade kept on reload. Also Dig Site's face: left-aligned (no stepper space)
   before its intro, "Dark" while staffed with an empty brazier. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);

const STORE = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
function boot() {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  Object.defineProperty(w, 'localStorage', { value: STORE, configurable: true, writable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.requestAnimationFrame = () => 0;
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (t) => ({ width: (t || '').length * 6 }) });
  const errors = [];
  w.console = { log: () => {}, error: (...a) => errors.push(a.join(' ')), warn: () => {} };
  SCRIPTS.forEach((src) => { try { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  w.OrbWeaver.Loop.stop();
  return { w, OW: w.OrbWeaver, M: (id) => w.OrbWeaver.Mechanics.get(id), errors };
}
const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

const A = boot(), { OW, M } = A, R = OW.Resources;
const tickAll = () => OW.Loop.runBulk(1, 0.2);
const face = (id) => { const s = M(id).els.wrap.style; return { op: +s.opacity, pe: s.pointerEvents }; };
const blank = (id) => M(id).els.nameEl.textContent === '' && M(id).els.statEl.textContent === '';
const near = (a, b) => Math.abs(a - b) < 1e-9;
const camp = Array.from(A.w.document.querySelectorAll('#grid-camp > .card-wrap')).filter((e) => e.style.display !== 'none').map((e) => OW.Mechanics.all().find((m) => m.els && m.els.wrap === e).id).join();
check('boots clean', A.errors.length === 0, A.errors.join('\n'));
check('start: Bench slot held above Wood Pile, then Stone Pit and Dig Site; no Research Bench slot before a dig', camp === 'buildersbench,wood,stone,digsite', camp);
check('Camp label hidden at start', A.w.document.getElementById('camp-section-label').style.display === 'none');
check('Wood card reads Wood Pile', M('wood').cardName() === 'Wood Pile');
const visible = () => Array.from(A.w.document.querySelectorAll('#grid-camp > .card-wrap')).filter((e) => e.style.display !== 'none').map((e) => OW.Mechanics.all().find((m) => m.els && m.els.wrap === e).id).join();
const cls = (id) => M(id).els.wrap.className;
check('Bench, Dig Site and Research Bench start at 0 (.tut-fade)', ['buildersbench', 'digsite', 'researchbench'].every((id) => /tut-fade/.test(cls(id))));
check('all three faces blank at start', blank('buildersbench') && blank('digsite') && blank('researchbench'));
check('Stone Pit is off the Construction list', !M('buildersbench').renderModalHTML().includes('Stone Pit'));

R.add('wood', 0.5); tickAll();
check('first wood → Bench shows in its slot at 5%, blank, not clickable', visible().startsWith('buildersbench,wood,') && near(face('buildersbench').op, 0.05) && face('buildersbench').pe === 'none' && blank('buildersbench'), JSON.stringify(face('buildersbench')));
R.add('wood', 2.4); R.add('stone', 5); R.add('stonecrate', 5); tickAll();
let b = face('buildersbench'), d = face('digsite');
check('2.9 wood → Bench 5 + 95×2/4 = 52.5%, not clickable', near(b.op, 0.525) && b.pe === 'none', JSON.stringify(b));
check('5 stone (crates ignored) → Dig Site 50%, not clickable', near(d.op, 0.5) && d.pe === 'none', JSON.stringify(d));
check('faces still blank while fading', blank('buildersbench') && blank('digsite'));

R.add('wood', 1.1); R.add('stone', 5); tickAll();
b = face('buildersbench'); d = face('digsite');
check('4 wood / 10 stone → both fully visible and clickable', b.op === 1 && b.pe === 'auto' && d.op === 1 && d.pe === 'auto', JSON.stringify([b, d]));
check('faces read again when full', M('buildersbench').els.nameEl.textContent === 'Builders Bench' && M('digsite').els.nameEl.textContent === 'Dig Site' && M('digsite').els.statEl.textContent === 'Strange Shard');
R.spend('wood', 4); R.spend('stone', 10); tickAll();
check('spending never fades them back', face('buildersbench').op === 1 && face('digsite').op === 1);

// Dig Site face: no reserved stepper space before the intro; steppers after it.
const ds = M('digsite'), rb = M('researchbench');
check('Dig Site steppers take no space before the intro (text sits left)', ds.els.cardSteppersWrap.style.display === 'none');
OW.DigSite.completeIntro(); OW.StrangeShard.clear(); OW.Workers.addWorkers(2); tickAll();
check('Dig Site steppers show after the intro', ds.els.cardSteppersWrap.style.display === '');
OW.DigSite.subAssign('dig'); tickAll();
check('staffed with an empty brazier → "Dark"', ds.els.statEl.textContent === 'Dark', ds.els.statEl.textContent);

// Research Bench: 15 Dig Site rolls.
R.add('gold', 1e6);
const digTo = (n) => { while (OW.DigSite.digs() < n) OW.Loop.runBulk(1, 0.2); };
digTo(1);
check('first dig → Research Bench takes its slot below Dig Site', rb.revealed && rb.els.wrap.style.display === '' && rb.els.wrap.previousElementSibling === ds.els.wrap);
digTo(6);
check('6 digs → Research Bench 40%, blank, not clickable', near(+rb.els.wrap.style.opacity, 0.4) && rb.els.wrap.style.pointerEvents === 'none' && blank('researchbench'), rb.els.wrap.style.opacity);
digTo(15);
check('15 digs → Research Bench full, named, clickable, with steppers', rb.els.wrap.style.opacity === '1' && rb.els.wrap.style.pointerEvents === 'auto' && rb.els.nameEl.textContent === 'Research Bench' && rb.els.cardSteppersWrap.style.display !== 'none');

const saved = JSON.parse(JSON.stringify(OW.Save.serialize())); saved.savedAt = 0;
const B = boot(); B.OW.Save.deserialize(saved);
const bb = B.M('buildersbench').els.wrap.style, bd = B.M('digsite').els.wrap.style;
const br = B.M('researchbench').els.wrap.style;
check('reload restores all three fades before any tick', [bb, bd, br].every((x) => x.opacity === '1' && x.pointerEvents === 'auto'), [bb.opacity, bd.opacity, br.opacity].join());

[A.w, B.w].forEach((w) => w.close());
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
