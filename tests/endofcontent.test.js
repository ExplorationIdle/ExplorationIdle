/* End of Content (TEMPORARY, js/mechanics/endofcontent.js): card 1 in The Below, card 2 in Sand Dunes.
   Placement, reveal (hidden until risen, waits for the ceremony to let go of
   The Shard Bearer, just appears on load), ALL cheats, Back / Next, the survey
   (greyed with the recorder off; one comment on Submit, then locked; its fields
   never recorded as input), card 2 (placement, latch on the Caravan card, pages,
   Coliseum bracket, picks and chips) and a clean boot without the script.
   Player input goes through jsdom's trusted dispatch, as in recorder.test.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const idl = require(path.join(path.dirname(require.resolve('jsdom')), 'generated/idl/utils.js'));
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ALL = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const SRC = Object.fromEntries(ALL.map((s) => [s, fs.readFileSync(path.join(root, s), 'utf8')]));
let checks = 0, failures = 0;
async function test(name, fn) {
  try { await fn(); checks++; console.log('PASS  ' + name); }
  catch (e) { failures++; console.error('FAIL  ' + name + '\n' + e.stack); }
}
const shim = (d = {}) => ({ _d: d, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; }, key(i) { return Object.keys(this._d)[i] ?? null; }, get length() { return Object.keys(this._d).length; } });
const RISE = { d: 1, p: 20, c: 1, b: 1 }; // Temple Ruins at The Ceremony

function boot({ rec = true, scripts = ALL, save } = {}) {
  const w = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: new VirtualConsole() }).window;
  const errors = [];
  Object.defineProperty(w, 'localStorage', { value: shim(rec ? {} : { 'orbweaver.recorder.v1': '{"on":0}' }), configurable: true });
  Object.assign(w, { indexedDB: new IDBFactory(), IDBKeyRange, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, TextDecoderStream });
  w.requestAnimationFrame = () => 1;
  w.IntersectionObserver = class { observe() {} unobserve() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  w.console = { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) };
  scripts.forEach((src) => { try { w.eval(SRC[src]); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver, doc = w.document, M = (id) => OW.Mechanics.get(id);
  OW.Loop.stop(); OW.Loop.isRunning = () => true;
  if (save) { const d = JSON.parse(JSON.stringify(OW.Save.serialize())); Object.assign(d.mechanics, save); d.savedAt = 0; OW.Save.deserialize(d); }
  const eoc = () => M('endofcontent');
  const shown = (id = 'endofcontent') => !!M(id).revealed && M(id).els.wrap.style.display !== 'none';
  const tick = (n = 1) => OW.Loop.runBulk(n, 0.2);
  const user = (el, type, init = {}) => { // a trusted event, as a player would make
    const C = { click: w.MouseEvent, input: w.Event }[type] || w.MouseEvent;
    const impl = idl.implForWrapper(new C(type, { bubbles: true, cancelable: true, ...init })); impl.isTrusted = true;
    idl.implForWrapper(el)._dispatch(impl);
  };
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const q = (sel) => doc.querySelector('#card-modal-body ' + sel);
  const open = (id) => { const t0 = Date.now(); while (Date.now() - t0 < 150); click(M(id).els.wrap.querySelector('.card')); }; // past the ghost-click guard
  const rise = () => { // The Ceremony, through its button
    OW.RuinedTemple.addWorkers(61); OW.Resources.add(OW.RuinedTemple.ensureResource('shard', 'Shard'), 1); tick();
    open('ruinedtemple'); click(q('[data-rt="begin"]'));
  };
  return { w, OW, doc, M, eoc, shown, tick, user, click, q, open, rise, errors };
}
const page = (T) => T.q('.hs-title').textContent;

(async () => {
  await test('Boots clean; sits right after The Shard Bearer, hidden; face and subtitle', () => {
    const T = boot();
    assert.equal(T.M('blessed').els.wrap.nextElementSibling, T.eoc().els.wrap);
    assert.equal(T.eoc().els.wrap.parentNode.id, 'grid-thebelow');
    T.tick(); assert.ok(!T.shown());
    assert.equal(T.eoc().cardName(), 'End of Content');
    assert.equal(T.eoc().getSubtitleHtml(), T.eoc().getStatText());
    assert.ok(T.eoc().noPin);
    assert.deepEqual(T.errors, []);
  });

  await test('Hidden at The Ceremony; shown once The Shard Bearer has risen', () => {
    const T = boot({ save: { ruinedtemple: RISE } });
    T.tick(); assert.ok(!T.shown());
    T.rise(); T.tick(); // jsdom skips scenes, as offline and replay do: it just appears
    assert.ok(T.shown('blessed') && T.shown());
    assert.deepEqual(T.errors, []);
  });

  await test('A fresh rise waits for the scene to let go of The Shard Bearer, then fades in 0.5 s later', async () => {
    const T = boot({ save: { ruinedtemple: RISE } });
    T.tick();
    const held = new Set([T.M('blessed').els.wrap]), scenes = [];
    T.OW.Motion.owned = (el) => held.has(el);
    T.OW.Motion.scene = (fn, done) => { scenes.push(fn); return Promise.resolve(); };
    T.OW.RuinedTemple.isRisen = () => true;
    T.tick(3); assert.ok(!T.shown(), 'still held by the ceremony'); assert.equal(scenes.length, 0);
    held.clear(); T.tick();
    assert.deepEqual(T.errors, []); assert.equal(scenes.length, 1, 'one fade scene');
    const steps = [];
    await scenes[0]({ hold: (el) => { steps.push('hold'); return el; }, wait: (ms) => steps.push('wait ' + ms), show: (el, o) => steps.push('show ' + o.ms) });
    assert.deepEqual(steps, ['hold', 'wait 500', 'show 600']);
    assert.ok(T.eoc().revealed);
  });

  await test('Shown straight away on reload after the rise; nothing of its own saved', () => {
    const T = boot({ save: { ruinedtemple: { ...RISE, r: 1 } } });
    T.tick(); assert.ok(T.shown());
    assert.ok(!('endofcontent' in T.OW.Save.serialize().mechanics));
    assert.deepEqual(T.errors, []);
  });

  await test('ALL cheats cannot show it early', () => {
    const T = boot();
    ['cheat-temple', 'cheat-all', 'cheat-all-v2', 'cheat-workers', 'cheat-templeplus'].forEach((id) => T.doc.getElementById(id) && T.click(T.doc.getElementById(id)));
    T.tick(5); assert.ok(!T.shown());
  });

  await test("Back / Next walk What's coming → Challenge → Survey; the Challenge loop runs only on its page", async () => {
    const T = boot({ save: { ruinedtemple: { ...RISE, r: 1 } } }); T.tick();
    T.open('endofcontent');
    assert.equal(page(T), "What's coming");
    assert.ok(T.q('.eoc-coming').textContent.startsWith('This is the first of two End of Content cards. The other waits somewhere else.'));
    assert.ok(T.q('[data-eoc="back"]').disabled);
    T.click(T.q('[data-eoc="next"]')); assert.equal(page(T), 'Challenge');
    assert.equal(T.q('.eoc-side').dataset.s, 'bl', 'The Shard Bearer on the left');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(T.q('[data-s="bl"] [data-k="SD"] span').textContent, '5', 'loop has drawn the stats');
    T.click(T.q('[data-eoc="next"]')); assert.equal(page(T), 'Survey');
    assert.ok(T.q('[data-eoc="next"]').disabled);
    assert.equal(T.q('.eoc-dots .on'), T.q('.eoc-dots').lastElementChild);
    assert.ok(T.q('.eoc-survey').textContent.includes('cakesgamedev@gmail.com'));
    T.click(T.q('[data-eoc="back"]')); assert.equal(page(T), 'Challenge');
    T.OW.Cards.closeModal(); assert.equal(T.doc.querySelector('#card-modal-body .eoc'), null);
  });

  await test('Challenge speed: 1×, 2×, 4× clickable (no Max); 4× cuts every wait to a quarter; back to 1× on reopen', async () => {
    const T = boot({ save: { ruinedtemple: { ...RISE, r: 1 } } }); T.tick();
    const st = T.w.setTimeout, ms = []; T.w.setTimeout = (f, d) => { ms.push(d); return st(f, 0); };
    const nap = () => new Promise((r) => setTimeout(r, 15));
    T.open('endofcontent'); T.click(T.q('[data-eoc="next"]'));
    assert.deepEqual([...T.doc.querySelectorAll('#card-modal-body .eoc-speed b')].map((b) => b.textContent), ['1×', '2×', '4×']);
    await nap(); assert.ok(ms.includes(2400), 'opening wait 1600 × 1.5 at 1×');
    T.click(T.q('.eoc-speed [data-x="4"]')); assert.equal(T.q('.eoc-speed .on').textContent, '4×');
    ms.length = 0; await nap(); await nap(); assert.ok(ms.includes(337.5) && !ms.includes(1350), 'a 900 ms step waits 337.5 (900 × 1.5 / 4), not 1350');
    T.OW.Cards.closeModal(); T.w.setTimeout = st;
    T.open('endofcontent'); assert.equal(page(T), 'Challenge'); assert.equal(T.q('.eoc-speed .on').textContent, '1×');
    T.OW.Cards.closeModal();
  });

  await test('Recorder off: survey greyed with a note', () => {
    const T = boot({ rec: false, save: { ruinedtemple: { ...RISE, r: 1 } } }); T.tick();
    assert.equal(T.OW.Recorder.on, false);
    T.open('endofcontent'); T.click(T.q('[data-eoc="next"]')); T.click(T.q('[data-eoc="next"]'));
    const notes = [...T.doc.querySelectorAll('#card-modal-body .eoc-note')].map((e) => e.textContent);
    assert.equal(notes[0], 'None of the fields are required.');
    assert.ok(notes[1].includes('Turn on Record sessions in Settings'));
    assert.equal(T.doc.querySelectorAll('#card-modal-body .eoc-btns > .action-btn').length, 2, 'Submit and Export each on their own row');
    assert.ok(T.q('.hs-head').nextElementSibling.classList.contains('eoc-nav'), 'Back/Next at top');
    assert.ok([...T.doc.querySelectorAll('#card-modal-body .eoc-survey textarea, #card-modal-body .eoc-survey input, #card-modal-body [data-eoc="send"]')].every((e) => e.disabled));
    assert.ok(!T.q('[data-eoc="export"]').disabled, 'Export still works');
  });

  await test('Submit files ONE comment, locks the form; survey fields are never recorded as input', async () => {
    const T = boot({ save: { ruinedtemple: { ...RISE, r: 1 } } }); T.tick();
    assert.equal(T.OW.Recorder.on, true);
    T.open('endofcontent'); T.click(T.q('[data-eoc="next"]')); T.click(T.q('[data-eoc="next"]'));
    T.tick(); const T0 = T.OW.Rng.ticks;
    const ta = T.q('textarea[data-q="like"]'), fun = T.q('input[data-q="fun"]');
    T.user(ta, 'click'); ta.value = 'The falling'; T.user(ta, 'input');
    fun.value = '5'; T.user(fun, 'input');
    T.user(T.q('[data-keep="Yes"]'), 'click');
    T.user(T.q('[data-eoc="send"]'), 'click');
    assert.equal(T.q('.eoc-status').textContent, 'Thanks. Survey saved.');
    assert.ok(T.q('[data-eoc="send"]').disabled && T.q('textarea').disabled, 'locked');
    assert.ok(T.OW.Footer.getHistory().some((e) => e.t === 'Survey saved.'));
    T.OW.Cards.closeModal(); T.open('endofcontent'); T.click(T.q('[data-eoc="next"]')); T.click(T.q('[data-eoc="next"]'));
    assert.ok(T.q('[data-eoc="send"]').disabled, 'still locked after reopening');
    T.tick();
    const blob = await T.OW.Recorder.exportBlob('cur');
    const lines = zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())).toString().trim().split('\n').map((l) => JSON.parse(l));
    let t = 0; const ev = [];
    lines.filter((l) => l.k === 'c').sort((a, b) => a.n - b.n).forEach((c) => c.ev.forEach((e) => { t += e[0]; ev.push({ T: t, t: e[2], x: e[4] }); }));
    const notes = ev.filter((e) => e.t === 12);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].x, 'Survey (End of Content 1 of 2)\nFun: 5/5\nKeep playing: Yes\nLiked: The falling');
    assert.equal(ev.filter((e) => e.T >= T0 && e.t <= 6).length, 0, 'no survey input recorded');
  });

  await test('Card 2: right after the Sand Dunes Caravan; hidden until the first Sand Dunes worker, then stays; 3 pages, survey last', () => {
    const T = boot(), cv = T.M('sd_caravan'), c2 = T.M('endofcontent2');
    assert.equal(cv.els.wrap.nextElementSibling, c2.els.wrap);
    assert.equal(T.OW.EndOfContent.cards[1], c2);
    T.tick(3); assert.ok(!T.shown('endofcontent2'));
    cv.tick = () => {}; T.OW.Cards.reveal(cv); T.tick(); assert.ok(!T.shown('endofcontent2'), 'the caravan alone does not show it');
    T.OW.SandDunes.addWorkers(1); T.tick(); assert.ok(T.shown('endofcontent2'));
    T.OW.SandDunes.workerPool.deserialize({ total: 0, idle: 0, a: {} }); T.tick(); assert.equal(T.OW.SandDunes.workerPool.getTotal(), 0); assert.ok(T.shown('endofcontent2'), 'stays when Sand Dunes empties');
    T.open('endofcontent2');
    const titles = [page(T)];
    for (let i = 0; i < 2; i++) { T.click(T.q('[data-eoc="next"]')); titles.push(page(T)); }
    assert.deepEqual(titles, ["What's coming", 'Coliseum', 'Survey']);
    assert.ok(T.q('[data-eoc="next"]').disabled);
    assert.ok(!('endofcontent2' in T.OW.Save.serialize().mechanics));
    assert.deepEqual(T.errors, []);
  });

  await test('Numbered in the order found: Sand Dunes first is 1 of 2 (page 1 line, survey); The Below then 2 of 2', () => {
    const T = boot({ save: { ruinedtemple: RISE } }), c1 = T.eoc(), c2 = T.M('endofcontent2');
    T.OW.SandDunes.addWorkers(1); T.tick();
    assert.equal(c2.getStatText(), 'More coming soon · 1 of 2');
    T.open('endofcontent2'); assert.ok(T.q('.eoc-coming').textContent.startsWith('This is the first of two End of Content cards. The other waits somewhere else.'));
    assert.deepEqual([...T.doc.querySelectorAll('#card-modal-body .eoc-item b')].map((e) => e.textContent), ['More in Sand Dunes', 'Explore more...', 'The goal']);
    assert.equal(T.q('.eoc-item:last-child span').textContent, 'Over 100 hours of content.');
    for (let i = 0; i < 3; i++) T.click(T.q('[data-eoc="next"]'));
    const notes = []; T.OW.Recorder.comment = (x) => notes.push(x); T.click(T.q('[data-eoc="send"]'));
    assert.match(notes[0], /^Survey \(End of Content 1 of 2\)/);
    T.rise(); T.tick();
    assert.ok(T.shown()); assert.equal(c1.getStatText(), 'More coming soon · 2 of 2');
    T.open('endofcontent'); assert.equal(T.q('.eoc-coming p').textContent, 'This is the second of two End of Content cards.');
    assert.ok(T.q('.eoc-coming').textContent.includes('Fight and capture monsters (Fight preview on next page).'));
    const B = boot({ save: { ruinedtemple: { ...RISE, r: 1 } } }); B.OW.SandDunes.addWorkers(1); B.tick();
    assert.equal(B.eoc().getStatText(), 'More coming soon · 1 of 2'); assert.equal(B.M('endofcontent2').getStatText(), 'More coming soon · 2 of 2', 'same tick: The Below first');
    assert.deepEqual(T.errors, []); assert.deepEqual(B.errors, []);
  });

  await test('Cheat EoC: from a fresh save opens The Below and Sand Dunes and shows both cards, 1 and 2', () => {
    const T = boot(), $ = (id) => T.doc.getElementById(id);
    assert.equal($('thebelow-section').style.display, 'none'); assert.equal($('sanddunes-section').style.display, 'none');
    T.click($('cheat-eoc')); T.tick(3);
    assert.ok(T.shown() && T.shown('endofcontent2'));
    assert.equal($('thebelow-section').style.display, ''); assert.equal($('sanddunes-section').style.display, '');
    assert.equal(T.eoc().getStatText(), 'More coming soon · 1 of 2'); assert.equal(T.M('endofcontent2').getStatText(), 'More coming soon · 2 of 2');
    assert.deepEqual(T.errors, []);
  });

  await test('Coliseum: 16 names in R1, 15 boxes, 14 lines; one pick per track enables Fight', () => {
    const T = boot(), cv = T.M('sd_caravan'), all = (s) => [...T.doc.querySelectorAll('#card-modal-body ' + s)];
    T.OW.SandDunes.addWorkers(1); T.tick();
    T.open('endofcontent2'); T.click(T.q('[data-eoc="next"]'));
    assert.equal(page(T), 'Coliseum');
    assert.deepEqual(all('.eoc-col-s[data-i]').map((e) => e.textContent), ['Varro', 'Spiculus', 'Flamma', 'Crixus', 'Priscus', 'Verus', 'Tetraites', 'Carpo', 'Marcus', 'Hermes', 'Calamus', 'Triumph', 'Celadus', 'Amazon', 'Achillia', 'Nasica']);
    assert.equal(all('.eoc-col-bx').length, 15); assert.equal(all('.eoc-col-lines path').length, 14);
    const go = T.q('[data-col="go"]'), name = (i) => T.q(`.eoc-col-s[data-i="${i}"]`);
    assert.ok(go.disabled);
    T.click(name(0)); T.click(name(3)); assert.ok(go.disabled, 'both picks on bracket 1: still one bracket');
    assert.equal(T.q('.eoc-col-picks').textContent, 'Bracket 1: Crixus −5+ · Bracket 2: pick one');
    T.click(name(9)); assert.ok(!go.disabled);
    assert.deepEqual(all('.eoc-col-s.bet').map((e) => e.textContent), ['Crixus', 'Hermes']);
    assert.deepEqual(T.errors, []);
  });

  await test('Coliseum: no column headers, pick label above the bracket; 100 chips, stakes in 5s within the bank; Champion pays 4×', async () => {
    const T = boot(); T.OW.SandDunes.addWorkers(1); T.tick();
    T.open('endofcontent2'); T.click(T.q('[data-eoc="next"]')); T.click(T.q('.eoc-speed [data-x="3"]'));
    assert.ok(!T.q('[data-h]')); assert.equal(T.q('.eoc-col-lab').nextElementSibling, T.q('.eoc-col-brk'));
    assert.equal(T.q('.eoc-col-lab').textContent, 'PICK ONE FIGHTER ON EACH BRACKET'); assert.equal(T.q('.eoc-col-bank').textContent, '◆ 100 chips');
    T.click(T.q('.eoc-col-s[data-i="0"]')); const st = (k) => T.click(T.q(`[data-st="${k}"]`)), amt = () => T.q('.eoc-col-picks').textContent;
    st('0-'); assert.match(amt(), /Varro −5\+/, 'min 5');
    for (let i = 0; i < 30; i++) st('0+');
    assert.match(amt(), /Varro −95\+/, 'keeps 5 for bracket 2');
    T.click(T.q('.eoc-col-s[data-i="9"]')); st('1+'); assert.match(amt(), /Hermes −5\+/);
    st('0-'); st('1+'); assert.match(amt(), /Varro −90\+.*Hermes −10\+/);
    T.doc.defaultView.Math.random = () => 0; // the first-listed fighter wins every fight: Varro is Champion
    T.click(T.q('[data-col="go"]')); assert.equal(T.q('.eoc-col-bank').textContent, '◆ 0 chips');
    for (let i = 0; i < 200 && !T.q('.eoc-col-res.show'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(T.q('.eoc-col-bank').textContent, '◆ 360 chips');
    assert.match(T.q('.eoc-col-res').textContent, /Varro: Champion! · \+270.*Hermes: out in Round 1 · −10.*360 chips/);
    T.click(T.q('[data-col="go"]')); assert.equal(T.q('.eoc-col-bank').textContent, '◆ 360 chips', 'chips carry over on Again');
    assert.deepEqual(T.errors, []);
  });

  await test('Coliseum: a fight moves the bottom meter and only the active box', async () => {
    const T = boot(); T.OW.SandDunes.addWorkers(1); T.tick();
    T.open('endofcontent2'); T.click(T.q('[data-eoc="next"]')); T.click(T.q('.eoc-speed [data-x="3"]'));
    T.click(T.q('.eoc-col-s[data-i="0"]')); T.click(T.q('.eoc-col-s[data-i="9"]')); T.click(T.q('[data-col="go"]'));
    await new Promise((r) => setTimeout(r, 150));
    const w = (sel) => T.q(sel + ' .eoc-col-tb i').style.width;
    assert.equal(w('.eoc-col-mtr'), '50%'); assert.equal(w('[data-b="0-0-0"]'), '50%'); assert.equal(w('[data-b="0-0-1"]'), '');
    assert.deepEqual(T.errors, []);
  });

  await test('Game boots clean without the script', () => {
    const T = boot({ scripts: ALL.filter((s) => !/endofcontent/.test(s)), save: { ruinedtemple: RISE } });
    T.rise(); T.tick(3);
    assert.ok(T.shown('blessed'));
    assert.equal(T.OW.EndOfContent, undefined);
    assert.deepEqual(T.errors, []);
  });

  console.log(`\n${checks} passed, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
})();
