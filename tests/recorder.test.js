/* Session recorder, replay mode and seeded randomness (js/core/rng.js,
   js/core/recorder.js, js/core/replay.js). Boots the real game headless.
   Needs: npm install jsdom fake-indexeddb.

   Player actions are dispatched as TRUSTED events through jsdom's internal
   dispatch (the recorder ignores synthetic ones). The live loop is stopped
   and isRunning() held true, as in a running game, and ticks are driven
   with Loop.runBulk so recording and replay see the same tick numbers. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory, IDBKeyRange, IDBObjectStore } = require('fake-indexeddb');
const idl = require(path.join(path.dirname(require.resolve('jsdom')), 'generated/idl/utils.js'));

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ALL = HTML.match(/<script src="([^"]+)"><\/script>/g).map((t) => t.match(/src="([^"]+)"/)[1]);
const NO_REC = ALL.filter((s) => !/recorder|replay/.test(s));
const SRC = Object.fromEntries(ALL.map((s) => [s, fs.readFileSync(path.join(ROOT, s), 'utf8')]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await sleep(5); } };

function shim(d = {}) {
  return { _d: d, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; }, key(i) { return Object.keys(this._d)[i] ?? null; }, get length() { return Object.keys(this._d).length; } };
}
const clock = { now: 1000 };
function boot({ store = shim(), session = shim(), idb = new IDBFactory(), scripts = ALL, before } = {}) {
  const w = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: new VirtualConsole() }).window;
  const errors = [];
  Object.defineProperty(w, 'localStorage', { value: store, configurable: true, writable: true });
  Object.defineProperty(w, 'sessionStorage', { value: session, configurable: true, writable: true });
  if (idb) Object.assign(w, { indexedDB: idb, IDBKeyRange });
  Object.assign(w, { TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, TextDecoderStream });
  w.performance.now = () => clock.now;
  w.Date.now = () => 1.9e12 + clock.now;
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(clock.now), 0);
  w.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (s) => ({ width: s.length * 6 }) });
  w.console = { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) };
  if (before) before(w);
  scripts.forEach((src) => { try { w.eval(SRC[src]); } catch (e) { errors.push(`${src}: ${e.message}`); } });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.addEventListener('DOMContentLoaded', (e) => e.stopPropagation(), true);
  const OW = w.OrbWeaver;
  return { w, OW, store, session, idb, errors };
}
// A running game whose live pump never fires: ticks come only from run().
function live(g) { if (!g.OW.Replay) { g.OW.Loop.stop(); g.OW.Loop.isRunning = () => true; } return g; }
function run(g, ticks) { clock.now += ticks * 200; g.OW.Loop.runBulk(ticks); }
function user(g, el, type, init = {}) {
  const C = { click: g.w.MouseEvent, keydown: g.w.KeyboardEvent, blur: g.w.FocusEvent, input: g.w.Event, change: g.w.Event }[type] || g.w.PointerEvent || g.w.MouseEvent;
  const impl = idl.implForWrapper(new C(type, { bubbles: type !== 'blur', cancelable: true, ...init }));
  impl.isTrusted = true;
  idl.implForWrapper(el)._dispatch(impl);
}
function tap(g, el) { clock.now += 250; user(g, el, 'pointerdown'); user(g, el, 'pointerup'); user(g, el, 'click', { detail: 1 }); }
const $ = (g, sel) => g.w.document.querySelector(sel);
const plus = (g, id) => g.OW.Mechanics.get(id).els.cardStepperPlus;
const world = (g) => { const d = JSON.parse(JSON.stringify(g.OW.Save.serialize())); delete d.savedAt; delete d.log; return JSON.stringify(d); };
const pulse = (g, n = 10) => { for (let i = 0; g.OW.Recorder && i < n; i++) g.OW.Recorder.pulse(); };
const footerErrors = (g) => g.OW.Footer.getHistory ? g.OW.Footer.getHistory().filter((e) => /went wrong/.test(e.t)).length : 0;
function addInput(g) { // stand-in for the Scout / Pulley inputs: typed text plus Enter changes the game
  const el = g.w.document.createElement('input');
  el.id = 'test-input';
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') g.OW.Resources.add('wood', +el.value || 0); });
  g.w.document.body.appendChild(el);
  return el;
}

const results = [];
function check(label, cond, detail) {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : '\n        ' + detail}`);
}

// Scripted play: cheats, card + steppers on random-roll cards, a hold, typed text, fingerprints and a checkpoint.
async function play(g, { hold = true } = {}) {
  live(g);
  tap(g, $(g, '#grid-camp')); // a tap on empty space: replayed, never logged
  tap(g, $(g, '#cheat-loc2')); // not ALL: a save that holds an ALL-revealed Sand Dunes reloads as peered (known ALL-cheat limitation)
  for (let i = 0; i < 4; i++) tap(g, $(g, '#cheat-gold'));
  run(g, 5);
  ['goldpanning', 'goldmine', 'quarry', 'wood'].forEach((id) => { for (let i = 0; i < 3; i++) tap(g, plus(g, id)); });
  run(g, 400); pulse(g);
  if (hold) { // real hold: 600ms, then 50ms repeats
    const btn = plus(g, 'goldpanning');
    user(g, btn, 'pointerdown'); await sleep(900); user(g, btn, 'pointerup'); user(g, btn, 'click', { detail: 1 });
  }
  run(g, 300);
  const input = addInput(g);
  input.value = '42'; user(g, input, 'input'); user(g, input, 'keydown', { key: 'Enter' }); user(g, input, 'blur');
  $(g, '#rec-comments').click(); // tester comment: stamped when the box opens, saved on Enter 50 ticks later
  $(g, '#rec-comment-btn').click(); g.commentT = g.OW.Rng.ticks;
  run(g, 50);
  const box = $(g, '.rec-comment-box'); box.value = 'gold mine bar looks stuck'; box.dispatchEvent(new g.w.KeyboardEvent('keydown', { key: 'Enter' }));
  run(g, 9000); pulse(g); // checkpoint (30 min of active play)
  tap(g, plus(g, 'goldmine'));
  run(g, 700); pulse(g);
  await g.OW.Recorder.flush(); await until(() => !g.OW.Recorder.session || g.OW.Recorder.session.cps >= 2);
  await g.OW.Recorder.flush();
}
async function replayBoot(store, session, idb, opts = {}) {
  const r = boot({ store, session, idb, before: (w) => { addInput({ w, get OW() { return w.OrbWeaver; } }); if (opts.before) opts.before(w); } });
  await until(() => r.OW.Replay && r.OW.Replay.ready);
  return r;
}
// What Settings > Import > picking a session does (jsdom ignores the reload); `g` owns the sessionStorage.
const startReplay = (g, d, s) => g.OW.Recorder.util.replaySession(d, s);

(async () => {
  const SEED = { 'orbweaver.rng.v1': '777' };

  // 1. Exact replay, through export -> import -> replay boot.
  {
    const A = boot({ store: shim({ ...SEED }) });
    await play(A);
    const recorded = world(A), endTicks = A.OW.Rng.ticks;
    const blob = await A.OW.Recorder.exportBlob('cur');
    check('export produces a gzip recording', blob && blob.size > 0);

    const store = shim({ ...A.store._d }), session = shim(), idb = new IDBFactory();
    // The replay boots on top of the player's real (later) save: it must never be read or written.
    store.setItem('orbweaver.save.v1', A.store.getItem('orbweaver.save.v1'));
    const C = boot({ store: shim({ ...SEED }), session, idb });
    const d = await C.OW.Recorder.importFile(blob);
    const sessions = await C.OW.Recorder.util.req(C.OW.Recorder.util.store(d, 'sessions').getAll());
    check('import lists the recorded session', sessions.length === 1 && sessions[0].ticks === endTicks);
    await startReplay(C, d, sessions[0]);
    const before = JSON.stringify(store._d);
    const R = await replayBoot(store, session, idb);
    check('replay boots into replay mode with its loop held', !!R.OW.Replay && R.OW.Replay.ready && !R.OW.Recorder.on, R.errors.join(' | '));
    check('replay flag removed the moment it was read (a reload is the normal game)', session.getItem('orbweaver.replay.v1') === null);
    await R.OW.Replay.runTo(endTicks); await R.OW.Replay.advance(0);
    check('replayed world is byte-identical to the recorded one (Market, Gold Mine, Gold Panning dice, hold, typed text)', world(R) === recorded, `${world(R).length} vs ${recorded.length}`);
    check('comment replays as a highlighted log line at the moment its box was opened, and the button hides in replay',
      R.OW.Replay.lines.some((l) => l.c && l.T === A.commentT && l.text === '💬 "gold mine bar looks stuck"') && $(R, '#rec-comment-btn').hidden);
    check('Settings and the replay bar show the recorded seed', $(R, '#build-seed').textContent === String(sessions[0].rng[0]) && $(R, '.replay-seed').textContent === 'Seed ' + sessions[0].rng[0]);
    check('every fingerprint matched along the way', R.OW.Replay.sync === '✓ in sync', R.OW.Replay.sync);
    const lines = R.OW.Replay.lines.map((l) => l.text + (l.held ? ` (held ×${l.held})` : ''));
    check('action log names what was pressed, folds holds and typing, and nothing extra was recorded',
      lines.some((l) => /Cheat · Loc 2$/.test(l)) && lines.some((l) => /Gold Panning · \+ \(held ×\d+\)/.test(l)) && lines.some((l) => /typed "42" ⏎/.test(l)) && !lines.some((l) => /out of sync|Rich Uncle|Click to open/.test(l)),
      lines.slice(0, 8).join(' | '));
    const strip = [...R.w.document.querySelectorAll('.replay-msgs span')].map((s) => s.textContent);
    R.w.document.querySelector('.replay-log-btn').click();
    const pop = R.w.document.querySelector('.replay-log');
    check('one-line strip shows the newest action first; "!" opens Earlier / Now / Next hour with jumpable lines',
      strip[0].endsWith(lines[lines.length - 1]) && !pop.hidden && /Earlier.*Now.*Next hour/s.test(pop.textContent) && pop.querySelectorAll('[data-t]').length === lines.length, strip.join(' | '));
    const [chunks] = await C.OW.Recorder.util.sessionData(d, sessions[0].id), ev = chunks.flatMap((c) => c.ev);
    check('hold repeats stored as one entry per tick, taps as one entry', ev.some((a) => a[2] === 8 && a[4] > 1) && ev.some((a) => a[2] === 7));
    R.w.dispatchEvent(new R.w.Event('pagehide'));
    R.w.document.getElementById('save-reset-btn').click(); R.w.document.getElementById('save-reset-btn').click(); R.w.document.getElementById('save-reset-btn').click();
    check('replay sandbox: localStorage byte-identical after replay, autosave and a 3-click Erase', JSON.stringify(store._d) === before);
    const N = boot({ store, session, idb });
    check('reload after a replay boots the normal game', !N.OW.Replay && N.OW.Recorder.on);
    $(R, '.replay-comments-btn').click();
    const cl = $(R, '.replay-comments');
    const listed = $(R, '.replay-comments-btn span').textContent === '1' && !cl.hidden && /💬 "gold mine bar looks stuck"/.test(cl.textContent);
    cl.querySelector('[data-t]').click();
    await until(() => session.getItem('orbweaver.replay.v1'));
    check('rail comments button shows the count and lists every comment; clicking one jumps to just before it',
      listed && cl.hidden && JSON.parse(session.getItem('orbweaver.replay.v1')).T === A.commentT);
    session.removeItem('orbweaver.replay.v1');

    // 9. Checkpoint jump: boot from the 30-minute checkpoint and fast-run to the end.
    const cps = await C.OW.Recorder.util.req(C.OW.Recorder.util.store(d, 'cps').getAll());
    const cp = cps.find((c) => c.i === 1), save = JSON.parse(cp.save);
    const session2 = shim();
    session2.setItem('orbweaver.replay.v1', JSON.stringify({ sid: sessions[0].id, cp: 1, raw: C.OW.Save.encode(save), rng: cp.rng, date: save.savedAt, vms: cp.ms, prefs: cp.prefs, pins: cp.pins }));
    const J = await replayBoot(shim({ ...store._d }), session2, idb);
    check('checkpoint boot resumes at the checkpoint tick', J.OW.Rng.ticks === cp.T, `${J.OW.Rng.ticks} vs ${cp.T}`);
    await J.OW.Replay.runTo(endTicks); await J.OW.Replay.advance(0);
    const jw = world(J); // a checkpoint is a save: also proves Loc 2's empty Mountains path list reloads empty
    check('checkpoint jump + fast-run matches the recording (fingerprints and final world)', jw === recorded && J.OW.Replay.sync === '✓ in sync', J.OW.Replay.sync);
    if (process.env.DIFF) { const a = JSON.parse(jw), b = JSON.parse(recorded); const walk = (x, y, p) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object') Object.keys({ ...x, ...y }).forEach((k) => walk(x[k], y[k], p + '.' + k)); else console.log('DIFF', p, String(JSON.stringify(x)).slice(0, 200), '|', String(JSON.stringify(y)).slice(0, 200)); }; walk(a, b, ''); }

    const follow = J.w.document.querySelector('[data-r="follow"]');
    check('Follow is on by default and toggles from the replay bar', J.OW.Replay.follow && (follow.click(), !J.OW.Replay.follow) && (follow.click(), J.OW.Replay.follow));

    // 11. Build label mismatch: warned, still playable.
    const session3 = shim(), C3 = boot({ store: shim(), session: session3, idb });
    await startReplay(C3, d, sessions[0]);
    const M = await replayBoot(shim({ ...store._d }), session3, idb, { before: (w) => { w.document.getElementById('build-version').textContent = '000000000000'; } });
    check('build mismatch shows the warning', /Recorded on build .* you're on build 000000000000/.test(M.w.document.querySelector('.replay-note').textContent));
    await M.OW.Replay.runTo(endTicks); await M.OW.Replay.advance(0);
    check('build mismatch still replays', world(M) === recorded);

    // 4b. Corrupt recorded save: the game's own corrupt-save handling must not touch the real save.
    const session4 = shim(), store4 = shim({ ...store._d }), snap = JSON.stringify(store4._d);
    session4.setItem('orbweaver.replay.v1', JSON.stringify({ sid: sessions[0].id, raw: 'garbage', rng: sessions[0].rng, date: 1.9e12, vms: 0, prefs: null, pins: [] }));
    const X = await replayBoot(store4, session4, idb);
    X.w.dispatchEvent(new X.w.Event('pagehide'));
    check('corrupt recording: real save untouched (its .broken/remove path is blocked)', JSON.stringify(store4._d) === snap);
    // 4c. Crash mid-replay: storage still untouched.
    X.OW.Loop.runBulk = () => { throw new Error('boom'); };
    try { await X.OW.Replay.advance(5); } catch (e) {}
    check('crash mid-replay leaves storage untouched', JSON.stringify(store4._d) === snap);
  }

  // 2. Off = absent; on = no different. Same seed, same API-driven play.
  {
    const script = (g) => { live(g); tap(g, $(g, '#cheat-all-v2')); tap(g, $(g, '#cheat-gold')); ['goldpanning', 'goldmine', 'quarry'].forEach((id) => tap(g, plus(g, id))); run(g, 3000); pulse(g); run(g, 3000); return world(g); };
    const on = script(boot({ store: shim({ ...SEED }) }));
    const off = script(boot({ store: shim({ ...SEED, 'orbweaver.recorder.v1': '{"on":0}' }) }));
    const absent = script(boot({ store: shim({ ...SEED }), scripts: NO_REC }));
    check('recorder off = recorder.js absent (identical saves, both seeded)', off === absent);
    check('recorder on = recorder.js absent (it never steers)', on === absent);
    const g = boot({ store: shim({ ...SEED, 'orbweaver.recorder.v1': '{"on":0}' }) });
    check('off: no recorder listeners or timers (not recording), Settings row still shown, Comments greyed and no comment button', !g.OW.Recorder.on && !$(g, '#rec-row').hidden && !$(g, '#rec-dot').classList.contains('on') && $(g, '#rec-comments').classList.contains('disabled') && $(g, '#rec-comment-btn').hidden);
    const gone = boot({ store: shim(), scripts: NO_REC });
    check('recorder.js missing: Settings row stays hidden, dot empty, game boots clean', $(gone, '#rec-row').hidden && !$(gone, '#rec-dot').classList.contains('on') && gone.errors.length === 0, gone.errors.join(' | '));

    // 12. Holds with the recorder off behave exactly as with it absent.
    const holdRun = async (g) => { live(g); tap(g, $(g, '#cheat-all-v2')); const b = plus(g, 'quarry'); user(g, b, 'pointerdown'); await sleep(900); user(g, b, 'pointerup'); return g.OW.Mechanics.get('quarry').workerPool.getAssigned('quarry'); };
    const hOff = await holdRun(boot({ store: shim({ ...SEED, 'orbweaver.recorder.v1': '{"on":0}' }) }));
    const hAbsent = await holdRun(boot({ store: shim({ ...SEED }), scripts: NO_REC }));
    check('hold-to-repeat works with the recorder off and absent', hOff > 3 && hAbsent > 3, `${hOff} / ${hAbsent}`);
  }

  // 3. Failure injection: the game keeps ticking, matches the baseline, shows nothing.
  {
    const base = (opts) => { const g = boot({ store: shim({ ...SEED }), ...opts }); live(g); tap(g, $(g, '#cheat-all-v2')); tap(g, plus(g, 'goldpanning')); return g; };
    const finish = async (g) => { run(g, 2000); pulse(g); await sleep(20); if (g.OW.Recorder) await g.OW.Recorder.flush(); run(g, 1000); return world(g); };
    const baseline = await finish(base({ scripts: NO_REC }));
    const cases = [
      ['IndexedDB missing (memory fallback)', { idb: null }, null],
      ['indexedDB.open throws', { idb: { open() { throw new Error('nope'); } } }, null],
      ['put throws a quota error', {}, null],
      ['CompressionStream missing', { before: (w) => { w.CompressionStream = undefined; } }, null],
      ['Save.serialize throws during a checkpoint', {}, (g) => { const s = g.OW.Save.serialize; g.OW.Save.serialize = () => { throw new Error('bad'); }; run(g, 9000); pulse(g); g.OW.Save.serialize = s; clock.now -= 0; }],
      ['recorder throws inside its capture listener', {}, (g) => { const b = plus(g, 'quarry'); b.closest = function (s) { if (/cheat-seed/.test(s)) throw new Error('bad'); return g.w.Element.prototype.closest.call(this, s); }; tap(g, b); delete b.closest; }],
      ['seeded random returns garbage', {}, (g) => { g.OW.Rng.gen = () => NaN; }]
    ];
    for (const [label, opts, inject] of cases) {
      const quota = label.startsWith('put');
      const idb = opts.idb === undefined ? new IDBFactory() : opts.idb;
      const g = base({ ...opts, idb, before: (w) => { if (opts.before) opts.before(w); if (quota) { const put = IDBObjectStore.prototype.put; w.__restore = () => { IDBObjectStore.prototype.put = put; }; IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; } } });
      if (inject) inject(g);
      const garbage = label.startsWith('seeded');
      const w2 = garbage ? null : await finish(g);
      if (quota) g.w.__restore();
      if (garbage) { run(g, 200); pulse(g); }
      const dot = $(g, '#rec-dot').classList.contains('on');
      const stopped = !g.OW.Recorder.on;
      const same = garbage ? g.OW.Rng.fallback === 'invalid output' && Math.random() >= 0 : label.startsWith('Save.serialize') || label.startsWith('recorder throws') ? true : w2 === baseline;
      const fallback = label.startsWith('Compression'); // not a failure: stored uncompressed, recording carries on
      check(`failure: ${label} — game ticks on, no footer error, ${fallback ? 'still recording (uncompressed)' : 'dot empty'}${stopped ? ', recorder stopped' : ''}`, same && (fallback ? g.OW.Recorder.on : !dot) && footerErrors(g) === 0 && g.errors.length === 0 && (label.startsWith('Compression') || label.startsWith('IndexedDB') || label.startsWith('indexedDB') || label.startsWith('put') || stopped), `same=${same} dot=${dot} errs=${g.errors.join('|')} on=${g.OW.Recorder.on}`);
    }
  }

  // 5 is covered in 1. 6. Fair odds and independence.
  {
    const g = boot({ store: shim() }), Rng = g.OW.Rng;
    let sum = 0, lo = 0, hi = 0; const N = 100000;
    for (let i = 0; i < N; i++) { const r = g.w.Math.random(); sum += r; if (r < 0.05) lo++; if (r < 0.3) hi++; }
    check('100k seeded rolls: mean ≈ 0.5, P(r<0.05) ≈ 5% (Gold Mine-style chance), P(r<0.3) ≈ 30% (Market-style shock)', Math.abs(sum / N - 0.5) < 0.005 && Math.abs(lo / N - 0.05) < 0.003 && Math.abs(hi / N - 0.3) < 0.006, `${sum / N} ${lo / N} ${hi / N}`);
    const firsts = []; for (let t = 0; t < N; t++) { Rng.tick(); firsts.push(g.w.Math.random()); }
    let num = 0, den = 0; for (let i = 1; i < N; i++) { num += (firsts[i] - 0.5) * (firsts[i - 1] - 0.5); den += (firsts[i] - 0.5) ** 2; }
    check('no correlation between consecutive ticks\' first rolls', Math.abs(num / den) < 0.01, String(num / den));
    const s = Rng.getState(), a = [g.w.Math.random(), g.w.Math.random()]; Rng.setState(s);
    check('getState/setState resumes the exact stream', a[0] === g.w.Math.random() && a[1] === g.w.Math.random());
  }

  // 7. serialize() is read-only: calling it changes nothing.
  {
    const A = boot({ store: shim({ ...SEED }), scripts: NO_REC }), B = boot({ store: shim({ ...SEED }), scripts: NO_REC });
    [A, B].forEach((g) => { live(g); tap(g, $(g, '#cheat-all-v2')); tap(g, plus(g, 'goldpanning')); });
    for (let i = 0; i < 10; i++) { run(A, 500); A.OW.Save.serialize(); A.OW.Save.serialize(); run(B, 500); }
    const one = JSON.parse(JSON.stringify(A.OW.Save.serialize())), two = JSON.parse(JSON.stringify(A.OW.Save.serialize()));
    delete one.savedAt; delete two.savedAt;
    check('two consecutive serialize() calls are identical', JSON.stringify(one) === JSON.stringify(two));
    check('a world serialized 20 times evolves exactly like one never serialized', world(A) === world(B));
  }

  // 8. Chain link across sessions; break after a save import; break after the recorder was off.
  {
    const store = shim({ ...SEED }), idb = new IDBFactory();
    const s1 = boot({ store, idb }); live(s1); tap(s1, $(s1, '#cheat-gold')); run(s1, 100); pulse(s1, 11);
    await until(() => s1.OW.Recorder.session.link); await s1.OW.Recorder.flush();
    s1.w.dispatchEvent(new s1.w.Event('pagehide')); await sleep(30);
    const s2 = boot({ store, idb }); await until(() => s2.OW.Recorder.session.link);
    check('second session continues from the first (✓ chain link)', s2.OW.Recorder.session.link.ok, JSON.stringify(s2.OW.Recorder.session.link));
    live(s2); run(s2, 50); pulse(s2, 11); await s2.OW.Recorder.flush(); s2.w.dispatchEvent(new s2.w.Event('pagehide')); await sleep(30);
    const other = boot({ store: shim(), scripts: NO_REC }); live(other); run(other, 10);
    store.setItem('orbweaver.save.v1', other.OW.Save.encode(other.OW.Save.serialize())); // a save import
    const s3 = boot({ store, idb }); await until(() => s3.OW.Recorder.session.link);
    check('session after a save import shows a break with a reason', !s3.OW.Recorder.session.link.ok && /changed|import/.test(s3.OW.Recorder.session.link.why), JSON.stringify(s3.OW.Recorder.session.link));
    tap(s3, $(s3, '#rec-toggle')); // switch off: stops now, gap noted
    check('toggle off stops immediately and keeps the switch off', !s3.OW.Recorder.on && JSON.parse(store.getItem('orbweaver.recorder.v1')).on === 0);
    tap(s3, $(s3, '#rec-toggle'));
    const s4 = boot({ store, idb }); await until(() => s4.OW.Recorder.session.link);
    check('toggle back on starts at the next load, marked as a gap', s4.OW.Recorder.on && !s4.OW.Recorder.session.link.ok && /off/.test(s4.OW.Recorder.session.link.why), JSON.stringify(s4.OW.Recorder.session.link));
    check('recorder never writes into the save (not a Save participant)', !('recorder' in s4.OW.Save.serialize().mechanics) && !/orbweaver-rec/.test(store.getItem('orbweaver.save.v1') || ''));
  }

  // 10. Fixed seed: identical rolls every boot; applying it marks the save cheated.
  {
    const a = boot({ store: shim({ 'orbweaver.rng.v1': '12345' }) }), b = boot({ store: shim({ 'orbweaver.rng.v1': '12345' }) });
    const ra = Array.from({ length: 5 }, () => a.w.Math.random()), rb = Array.from({ length: 5 }, () => b.w.Math.random());
    check('fixed seed: two boots roll identically', a.OW.Rng.seed === 12345 && JSON.stringify(ra) === JSON.stringify(rb));
    const store = shim(), g = boot({ store }); live(g);
    $(g, '#cheat-seed').value = 'lucky';
    try { $(g, '#cheat-seed-apply').click(); } catch (e) {}
    const saved = g.OW.Save.decode(store.getItem('orbweaver.save.v1'));
    check('Apply & reload stores the seed and marks the save cheated', !!store.getItem('orbweaver.rng.v1') && saved.cheatsUsed === true);
    check('random seeds differ between loads when none is fixed', boot({ store: shim() }).OW.Rng.seed !== boot({ store: shim() }).OW.Rng.seed);
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL  harness error: ' + (e.stack || e)); process.exit(1); });
