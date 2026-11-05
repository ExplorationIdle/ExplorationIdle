/* ============================================================
   MECHANIC: END OF CONTENT — TEMPORARY (demo only)
   EndOfContent.add(cfg) makes one End of Content card: the config's pages,
   then a shared survey filed as ONE comment in the session recording
   (Recorder.comment). The card places itself after cfg.anchor once the game
   has built, shows while cfg.when() is true, and fades in 0.5 s after any
   Motion scene lets go of the anchor's card (a fresh unlock); on load,
   offline catch-up and replay it just appears. Nothing is saved. Cards number
   1 and 2 in the order found this session (same tick: The Below first).
   The Below card: after The Shard Bearer. The Sand Dunes card: after the Caravan,
   from the first Sand Dunes worker (this session).
   Cheat EoC (force()): opens both sections and shows both cards now, this session.
   To remove: delete this file, its script tag and #cheat-eoc in index.html, its line in cheats.js, its block at
   the end of style.css and tests/endofcontent.test.js.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver;
  const SEND_TO = 'Export your recording and send the file to cakesgamedev@gmail.com.';
  const KEEP = ['Yes', 'Neutral', 'No'];
  const QS = [ // [key, short label for the comment, question]
    ['dislike', "Didn't like", "What are two or more things you didn't like about the game?"],
    ['like', 'Liked', 'What are two or more things you did like about the game?'],
    ['future', 'Show your future', 'How did you feel about the two “Show your future” animations? Did they make you more confused, or more intrigued to see what the game has to offer?'],
    ['qol', 'Quality of life', 'What quality of life additions or settings do you wish the game had?'],
    ['thoughts', 'Thoughts', 'Tell me any thoughts you have.']
  ];
  let found = 0, forced = false; // cards found this session; numbers each card on its first show
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // cfg: { id, section, theme, anchor (card id), when(), open() (cheat: opens its section), pages: [{ title, head?, html(n), after?(root, alive) }] }
  function add(cfg) {
    let n = 0, page = 0, run = 0, sent = false, shown = null;
    const draft = { fun: 3, keep: 'Neutral' };
    const survey = () => {
      const on = !!(OW.Recorder && OW.Recorder.on), off = !on || sent ? ' disabled' : '';
      return `<div class="eoc-survey" data-norec><div class="eoc-note">None of the fields are required.</div>${on ? '' : '<div class="eoc-note">Turn on Record sessions in Settings to send the survey.</div>'}
      <div class="settings-row"><span>How fun was the game?</span><span class="eoc-fun"><input type="range" min="1" max="5" step="1" value="${draft.fun}" data-q="fun"${off}><output>${draft.fun}</output></span></div>
      <div class="settings-row"><span>Would you keep playing?</span><div class="unit-seg">${KEEP.map((o) => `<button data-keep="${o}" class="${draft.keep === o ? 'on' : ''}"${off}>${o}</button>`).join('')}</div></div>
      ${QS.map(([k, , q]) => `<label class="eoc-q">${q}<textarea class="save-textarea" data-q="${k}" maxlength="2000"${off}>${esc(draft[k])}</textarea></label>`).join('')}
      <div class="eoc-btns"><button class="action-btn" data-eoc="send"${off}>${sent ? 'Survey saved' : 'Submit survey'}</button><button class="action-btn" data-eoc="export"${OW.Recorder ? '' : ' disabled'}>Export recording</button></div>
      <div class="save-status eoc-status">${sent ? 'Thanks. Survey saved.' : ''}</div><div class="eoc-note">${SEND_TO}</div></div>`;
    };
    const pages = [...cfg.pages, { title: 'Survey', html: survey }], last = pages.length - 1;

    const card = {
      id: cfg.id, section: cfg.section, modalTheme: cfg.theme, startHidden: true, noPin: true,
      stepperReady: () => false,
      cardName: () => 'End of Content',
      getStatText: () => `More coming soon · ${n} of 2`, getSubtitleHtml: () => card.getStatText(),
      getUpgradeBarPct: () => 0, hideUpgradeBar: () => true,
      renderModalHTML: () => `<div class="hs-card eoc"><div class="hs-head"><span class="hs-title">${pages[page].title}</span>${pages[page].head || ''}</div>
        <div class="eoc-nav"><button class="action-btn" data-eoc="back"${page ? '' : ' disabled'}>Back</button>
        <span class="eoc-dots">${pages.map((_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('')}</span>
        <button class="action-btn" data-eoc="next"${page < last ? '' : ' disabled'}>Next</button></div>${pages[page].html(n)}</div>`,
      afterRender() {
        const root = document.querySelector('#card-modal-body .eoc'), my = ++run;
        if (!root) return;
        root.addEventListener('click', onClick);
        root.addEventListener('input', (e) => {
          const q = e.target.dataset.q;
          if (!q) return;
          draft[q] = q === 'fun' ? +e.target.value : e.target.value;
          if (q === 'fun') e.target.nextElementSibling.textContent = draft.fun;
        });
        if (pages[page].after) pages[page].after(root, () => root.isConnected && my === run && OW.Cards.isModalOpenFor(cfg.id));
      },
      tick() {
        const wrap = card.els && card.els.wrap, a = OW.Mechanics.get(cfg.anchor).els;
        if (!wrap) return;
        if (forced) cfg.open();
        if (!cfg.when() && !forced) { if (card.revealed && !OW.Motion.owned(wrap)) OW.Cards.hide(card); shown = false; return; }
        if (!card.revealed) {
          if (!forced && (OW.Motion.owned(wrap) || OW.Motion.owned(a.wrap))) return; // the scene still has the anchor
          n ||= ++found;
          if (shown === false && !forced) OW.Motion.scene(async (s) => { const w = s.hold(wrap); OW.Cards.reveal(card); await s.wait(500); await s.show(w, { ms: 600 }); }, () => OW.Cards.reveal(card));
          else OW.Cards.reveal(card);
        }
        shown = true;
        OW.Cards.refresh(card);
      }
    };

    function onClick(e) {
      const b = e.target.closest('[data-eoc], [data-keep]');
      if (!b || b.disabled) return;
      if (b.dataset.keep) { draft.keep = b.dataset.keep; b.parentNode.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); return; }
      const status = (t) => { const el = document.querySelector('#card-modal-body .eoc-status'); if (el) el.textContent = t; };
      const act = b.dataset.eoc;
      if (act === 'export') return OW.Recorder.exportFile('all').then(status, (err) => status('Export failed: ' + err.message));
      if (act === 'send') {
        const lines = [`Fun: ${draft.fun}/5`, `Keep playing: ${draft.keep}`, ...QS.filter(([k]) => (draft[k] || '').trim()).map(([k, l]) => `${l}: ${draft[k].trim()}`)];
        if (!OW.Recorder.comment(`Survey (End of Content ${n} of 2)\n` + lines.join('\n'))) return status('Survey not saved. Turn on Record sessions in Settings.');
        sent = true; OW.Footer.push('Survey saved.');
      } else page = Math.max(0, Math.min(last, page + (act === 'next' ? 1 : -1)));
      document.getElementById('card-modal-body').innerHTML = card.renderModalHTML();
      card.afterRender();
    }

    OW.Mechanics.register(card);
    // After main.js has built every card (window hears DOMContentLoaded after document does).
    window.addEventListener('DOMContentLoaded', () => OW.Mechanics.get(cfg.anchor).els.wrap.after(OW.Cards.build(card)));
    return card;
  }

  /* ---- The Below card: Challenge preview (display only; Face-off, The Shard Bearer left) ---- */
  const K = ['A', 'D', 'SA', 'SD'], STEPS = ['Roll', 'Stats', 'Type', 'Skill', 'Fight'], SLOTS = ['W', 'Ar', 'SW', 'SAr'];
  const TYPES = ['Water', 'Fire', 'Nature', 'Ground', 'Electricity']; // each beats the next
  const SIDES = {
    bl: { name: 'The Shard Bearer', type: 'Water', skill: 'Water Body', base: { A: 22, D: 20, SA: 22, SD: 5 } },
    ch: { name: 'Challenger', type: 'Fire', skill: 'Fire Fist', base: { A: 20, D: 21, SA: 5, SD: 30 } }
  };
  const MAX = 40; // a full stat bar
  const STAT_WIN = 1.15, TYPE_WIN = 1.1, WATER_BODY = 0.7; // Water Body: 30% less damage from Fire
  const STOP = {};
  const side = (s) => `<div class="eoc-side" data-s="${s}"><div class="eoc-who">${SIDES[s].name}<span class="eoc-type eoc-${SIDES[s].type.toLowerCase()}">${SIDES[s].type}</span><span class="eoc-hex">${SIDES[s].skill}</span></div>
    <div class="eoc-stats">${K.map((k) => `<div class="eoc-st" data-k="${k}"><b>${k}</b><span></span><i></i></div>`).join('')}</div>
    <div class="eoc-slots">${SLOTS.map((t) => `<div>${t}</div>`).join('')}</div></div>`;
  const pt = (j) => { const a = j / 5 * 2 * Math.PI - Math.PI / 2; return [35 + 26 * Math.cos(a), 35 + 26 * Math.sin(a)]; };
  const WHEEL = TYPES.map((t, i) => { const [x, y] = pt(i), [x2, y2] = pt(i + 1);
    return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" data-t="${t}"/><text x="${x}" y="${y + 2.5}" data-t="${t}">${t}</text>`; }).join('');

  let cx = 1; // Challenge speed: 1×, 2×, 4×; back to 1× on each show
  async function loop(root, alive) {
    cx = 1;
    root.addEventListener('click', (e) => { const b = e.target.closest('.eoc-speed b'); if (!b) return; cx = +b.dataset.x; b.parentNode.querySelectorAll('b').forEach((o) => o.classList.toggle('on', o === b)); });
    try { for (;;) await play(root, alive); } catch (e) { if (e !== STOP) throw e; } }

  // One scripted Challenge; every wait ends the run once the modal closes or leaves the page.
  async function play(root, alive) {
    const q = (sel) => root.querySelector(sel), all = (sel) => root.querySelectorAll(sel);
    const wait = (ms) => new Promise((res, rej) => setTimeout(() => (alive() ? res() : rej(STOP)), ms * 1.5 / cx)); // 1.5: demo pace
    const box = (s, k) => q(`[data-s="${s}"] [data-k="${k}"]`), hex = (s) => q(`[data-s="${s}"] .eoc-hex`);
    const mark = (s, k, cls, on = true) => box(s, k).classList.toggle(cls, on);
    const cap = (t) => { q('.eoc-cap').textContent = t; };
    const step = (n) => [...q('.eoc-steps').children].forEach((d, i) => { d.className = i < n ? 'done' : i === n ? 'on' : ''; });
    const roll = async (ms) => { q('.eoc-die').classList.add('spin'); await wait(ms); q('.eoc-die').classList.remove('spin'); };
    const v = { ch: {}, bl: {} };
    const set = (s, k, n, delta, color) => {
      const b = box(s, k), i = b.querySelector('i');
      v[s][k] = n; b.querySelector('span').textContent = n; b.style.setProperty('--pct', Math.min(1, n / MAX));
      if (delta) { i.textContent = delta; i.style.color = `var(--${color})`; i.classList.remove('go'); void i.offsetWidth; i.classList.add('go'); }
    };

    all('.eoc-st, .eoc-hex, .eoc-side, .eoc-wheel *, .eoc-result, .eoc-wheel').forEach((e) => e.classList.remove('win', 'cmp', 'atk', 'hit', 'zero', 'lit', 'off', 'out', 'hl', 'show'));
    for (const s in SIDES) K.forEach((k) => set(s, k, SIDES[s].base[k]));
    step(-1); cap('A Challenger approaches.'); await wait(1600);

    // 1. Roll: Fight picked from the press menu; the luck roll stays hidden.
    step(0); q('.eoc-drop').classList.add('show'); await wait(700);
    q('.eoc-drop').lastChild.classList.add('sel'); await wait(500);
    q('.eoc-drop').classList.remove('show'); q('.eoc-drop').lastChild.classList.remove('sel');
    q('.eoc-btn').classList.add('press'); await wait(250); q('.eoc-btn').classList.remove('press');
    cap('Rolling…'); await roll(1300);

    // 2. Stats: down the line, the higher of each pair gains 15%.
    step(1);
    for (const k of K) {
      const w = v.bl[k] > v.ch[k] ? 'bl' : 'ch', n = Math.round(v[w][k] * STAT_WIN);
      mark('ch', k, 'cmp'); mark('bl', k, 'cmp'); cap(`${k}: ${v.bl[k]} vs ${v.ch[k]}`); await wait(700);
      mark('ch', k, 'cmp', false); mark('bl', k, 'cmp', false); mark(w, k, 'win');
      set(w, k, n, `+${n - v[w][k]}`, 'green'); cap(`${SIDES[w].name} ${k} +15%`); await wait(900);
      mark(w, k, 'win', false);
    }

    // 3. Type: Water beats Fire, +10% to every stat of The Shard Bearer.
    step(2); q('.eoc-wheel').classList.add('show');
    all('.eoc-wheel [data-t="Water"]').forEach((e) => e.classList.add('hl'));
    cap('Water beats Fire'); await wait(1200);
    K.forEach((k) => { const n = Math.round(v.bl[k] * TYPE_WIN); mark('bl', k, 'win'); set('bl', k, n, n > v.bl[k] ? `+${n - v.bl[k]}` : '', 'green'); });
    cap('The Shard Bearer +10% to all stats'); await wait(1500);
    K.forEach((k) => mark('bl', k, 'win', false)); q('.eoc-wheel').classList.remove('show');

    // 4. Skill: a hidden roll; The Shard Bearer wins it.
    step(3); cap('Skill roll…'); await roll(1300);
    hex('bl').classList.add('lit'); hex('ch').classList.add('off');
    cap('Water Body: 30% less damage from Fire'); await wait(2000);

    // 5. Fight: SA → SD, then A → D, the Challenger first in each; a D or SD at 0 loses.
    step(4); cap('The Challenger strikes first.'); await wait(1100);
    for (const [a, d] of [['SA', 'SD'], ['A', 'D']]) {
      for (const [s, t] of [['ch', 'bl'], ['bl', 'ch']]) {
        const dmg = Math.round(v[s][a] * (s === 'ch' ? WATER_BODY : 1)), left = Math.max(0, v[t][d] - dmg);
        mark(s, a, 'atk'); cap(`${SIDES[s].name} ${a} ${v[s][a]}${s === 'ch' ? ' −30%' : ''} → ${d}`); await wait(900);
        mark(t, d, 'hit'); set(t, d, left, `−${v[t][d] - left}`, 'red'); mark(t, d, 'zero', !left); await wait(900);
        mark(s, a, 'atk', false); mark(t, d, 'hit', false);
        if (!left) { q(`[data-s="${t}"]`).classList.add('out'); step(5); cap(''); q('.eoc-result').classList.add('show'); await wait(3200); return; }
      }
    }
  }

  const ORD = ['', 'This is the first of two End of Content cards. The other waits somewhere else.', 'This is the second of two End of Content cards.'];
  const coming = (items) => (n) => `<div class="eoc-coming"><p>${ORD[n]}</p>${items.map(([h, t]) => `<div class="eoc-item"><b>${h}</b><span>${t}</span></div>`).join('')}</div>`;
  const below = add({
    id: 'endofcontent', section: 'The Below', theme: 'theme-below', anchor: 'blessed', open: () => { document.getElementById('thebelow-section').style.display = ''; },
    when: () => OW.RuinedTemple.isRisen(),
    pages: [
      { title: "What's coming", html: coming([
        ['Explore', 'Explore with The Shard Bearer. Climb to find a way out or descend to learn how deep The Below goes.'],
        ['Challenge', 'Fight and capture monsters (Fight preview on next page).'],
        ['Freaks of nature', 'Take your monsters apart to make freaks of nature. Send them topside. How will your people react?']]) },
      { title: 'Challenge', head: '<span class="eoc-speed">Speed <b class="on" data-x="1">1×</b><b data-x="2">2×</b><b data-x="4">4×</b></span>',
        html: () => `<div class="eoc-body"><div class="eoc-steps">${STEPS.map((s, i) => `<div>${i + 1} ${s}</div>`).join('')}</div>${side('bl')}${side('ch')}
          <div class="eoc-mid"><div class="eoc-die">?</div><svg class="eoc-wheel" viewBox="0 0 70 70">${WHEEL}</svg><div class="eoc-cap"></div></div>
          <div class="eoc-act"><div class="eoc-drop"><div>Add Potion</div><div>Fight</div></div><span class="eoc-btn">Fight ▾</span></div>
          <div class="eoc-result">CHALLENGER DEFEATED</div></div>`,
        after: loop }
    ]
  });

  /* ---- Sand Dunes card: Coliseum preview (stake chips on 1 fighter per bracket, watch 15 fights) ---- */
  const NAMES = ['Varro', 'Spiculus', 'Flamma', 'Crixus', 'Priscus', 'Verus', 'Tetraites', 'Carpo', 'Marcus', 'Hermes', 'Calamus', 'Triumph', 'Celadus', 'Amazon', 'Achillia', 'Nasica'];
  const RN = ['Round 1', 'Round 2', 'Bracket final', 'Grand Final'];
  const COLS = [[0, 0], [0, 1], [0, 2], [2, 3], [1, 2], [1, 1], [1, 0]]; // [bracket (2 = Grand Final), round]
  const BAR = '<div class="eoc-col-tb"><i></i><i></i></div>';
  const slot = (i) => (i == null ? '<div class="eoc-col-s">—</div>' : `<div class="eoc-col-s" data-i="${i}">${NAMES[i]}</div>`);
  const box = (t, r, k) => `<div class="eoc-col-bx${r === 3 ? ' fin' : ''}" data-b="${t}-${r}-${k}">${r ? slot() + BAR + slot() : slot(t * 8 + k * 2) + BAR + slot(t * 8 + k * 2 + 1)}</div>`;
  const parent = (t, r, k) => (r < 2 ? `${t}-${r + 1}-${k >> 1}` : '2-3-0');
  const COLISEUM = () => `<div class="eoc-col-bank"></div><div class="eoc-steps">${RN.map((x) => `<div>${x}</div>`).join('')}</div>
    <div class="eoc-col-lab">PICK ONE FIGHTER ON EACH BRACKET</div>
    <div class="eoc-col-brk">${COLS.map(([t, r]) => `<div class="eoc-col-c">${Array.from({ length: r === 3 ? 1 : 4 >> r }, (_, k) => box(t, r, k)).join('')}</div>`).join('')}<svg class="eoc-col-lines"></svg></div>
    <div class="eoc-col-who"><span></span><span></span></div><div class="eoc-col-mtr"><span></span>${BAR}<span></span></div>
    <div class="eoc-col-res"></div><div class="eoc-col-act"><span class="eoc-col-picks"></span><button class="eoc-btn" data-col="go">Fight!</button></div>`;

  // Hidden strength 3–8 each; a fight is won with odds p / (p + rival p). 100 chips, stakes in 5s (min 5 each);
  // a stake pays 4× if its fighter is Champion. Chips carry over on Again (back to 100 below 10). Nothing is saved.
  function coliseum(root, alive) {
    const c = root.querySelector('.eoc-col'), q = (s) => c.querySelector(s), all = (s) => [...c.querySelectorAll(s)];
    let F, bets, st, x = 1, chips = 100;
    const wait = (ms) => new Promise((res, rej) => setTimeout(() => (alive() ? res() : rej(STOP)), ms / x));
    const bet = (f) => bets.includes(f.i);
    const paint = () => all('[data-i]').forEach((e) => { const f = F[e.dataset.i]; e.classList.toggle('bet', bet(f)); e.classList.toggle('out', f.out); });
    const picks = () => { q('.eoc-col-bank').textContent = `◆ ${chips} chips`;
      q('.eoc-col-picks').innerHTML = [0, 1].map((t) => `Bracket ${t + 1}: ${bets[t] != null ? `<em>${NAMES[bets[t]]}</em> <b data-st="${t}-">−</b>${st[t]}<b data-st="${t}+">+</b>` : 'pick one'}`).join(' · ');
      q('[data-col]').disabled = bets[0] == null || bets[1] == null; };
    const stake = (t, d) => { const v = st[t] + d; if (v >= 5 && v + (st[1 - t] || 5) <= chips) st[t] = v; }; // keeps 5 for the other bracket
    const pos = (e) => ({ l: e.offsetLeft + e.parentNode.offsetLeft, t: e.offsetTop + e.parentNode.offsetTop, w: e.offsetWidth, h: e.offsetHeight }); // offsets: immune to the modal's open transform
    const lines = () => { q('.eoc-col-lines').innerHTML = all('.eoc-col-bx:not(.fin)').map((bx) => {
      const [t, r, k] = bx.dataset.b.split('-').map(Number), a = pos(bx), p = pos(q(`[data-b="${parent(t, r, k)}"]`));
      const right = a.l < p.l, sx = right ? a.l + a.w : a.l, px = right ? p.l : p.l + p.w, sy = a.t + a.h / 2, py = p.t + p.h / 2;
      return `<path data-from="${bx.dataset.b}" d="M${sx},${sy}H${(sx + px) / 2}V${py}H${px}"/>`; }).join(''); };
    const onResize = () => (alive() ? lines() : removeEventListener('resize', onResize));
    const reset = () => {
      F = NAMES.map((n, i) => ({ n, i, p: 3 + Math.floor(Math.random() * 6), out: false, won: 0 })); bets = []; st = [0, 0]; if (chips < 10) chips = 100;
      c.innerHTML = COLISEUM(); c.classList.add('pick'); picks(); lines();
    };

    async function fight(t, r, k, a, b) {
      const bx = q(`[data-b="${t}-${r}-${k}"]`), bars = [bx.querySelector('.eoc-col-tb'), q('.eoc-col-mtr .eoc-col-tb')], pc = all('.eoc-col-mtr > span');
      all('.eoc-steps div').forEach((d, i) => { d.className = i < r ? 'done' : i === r ? 'on' : ''; });
      all('.eoc-col-bx').forEach((e) => e.classList.toggle('on', e === bx));
      q('.eoc-col-lab').textContent = t < 2 ? `BRACKET ${t + 1} · ${RN[r].toUpperCase()} · FIGHT ${k + 1}` : 'GRAND FINAL';
      all('.eoc-col-who span').forEach((n, j) => { const f = j ? b : a; n.textContent = f.n; n.dataset.i = f.i; });
      bars.forEach((e) => { e.classList.toggle('bl', bet(a)); e.classList.toggle('br', bet(b)); e.style.setProperty('--ms', '0ms'); [...e.children].forEach((i) => { i.style.width = '0'; }); void e.offsetWidth; });
      paint();
      const set = (v, ms) => { pc[0].textContent = Math.round(v) + '%'; pc[1].textContent = Math.round(100 - v) + '%';
        bars.forEach((e) => { e.style.setProperty('--ms', ms / x + 'ms'); e.children[0].style.width = v + '%'; e.children[1].style.width = 100 - v + '%'; }); };
      set(50, 1000); await wait(1000); // meet in the middle
      const w = Math.random() < a.p / (a.p + b.p) ? a : b, dir = w === a ? 1 : -1, T = 1000 + Math.random() * 3000;
      for (let s = 0; s < T; s += 300) { set(Math.max(12, Math.min(88, 50 + dir * 25 * s / T + (Math.random() - 0.5) * 36)), 300); await wait(300); } // push and pull, drifting to the winner
      set(w === a ? 100 : 0, 400); await wait(700); // overcome
      (w === a ? b : a).out = true; w.won++;
      if (r === 3) bx.classList.add('champ');
      else { const s = q(`[data-b="${parent(t, r, k)}"]`).querySelectorAll('.eoc-col-s')[r < 2 ? k & 1 : t]; s.dataset.i = w.i; s.textContent = w.n; q(`[data-from="${t}-${r}-${k}"]`).classList.add(bet(w) ? 'gold' : 'lit'); }
      paint(); return w;
    }
    async function run() { // track 1's round, then track 2's, …, then the Grand Final
      let tr = [F.slice(0, 8), F.slice(8)];
      for (let r = 0; r < 3; r++) { const nx = [[], []]; for (const t of [0, 1]) for (let k = 0; k < tr[t].length / 2; k++) nx[t].push(await fight(t, r, k, tr[t][2 * k], tr[t][2 * k + 1])); tr = nx; }
      const w = await fight(2, 3, 0, tr[0][0], tr[1][0]), reach = (f) => (f === w ? 'Champion!' : f.won === 3 ? 'lost the Grand Final' : 'out in ' + RN[f.won]);
      bets.forEach((i, t) => { if (F[i] === w) chips += 4 * st[t]; }); picks();
      q('.eoc-col-res').innerHTML = `<b>CHAMPION</b><big>${w.n}</big>${bets.map((i, t) => `<span class="${F[i] === w ? 'ok' : ''}">◆ ${F[i].n}: ${reach(F[i])} · ${F[i] === w ? '+' + 3 * st[t] : '−' + st[t]}</span>`).join('')}<span>◆ ${chips} chips</span>`;
      q('.eoc-col-res').classList.add('show'); Object.assign(q('[data-col]'), { textContent: 'Again', disabled: false });
    }

    root.addEventListener('click', (e) => {
      const sp = e.target.closest('.eoc-speed b'), f = e.target.closest('.eoc-col [data-i]'), go = e.target.closest('[data-col]'), sk = e.target.closest('[data-st]');
      if (sk && c.classList.contains('pick')) { stake(+sk.dataset.st[0], sk.dataset.st[1] === '+' ? 5 : -5); picks(); }
      else if (sp) { x = +sp.dataset.x; sp.parentNode.querySelectorAll('b').forEach((b) => b.classList.toggle('on', b === sp)); }
      else if (f && c.classList.contains('pick')) { const i = +f.dataset.i; bets[i >> 3] = i; st[i >> 3] ||= 5; paint(); picks(); }
      else if (go && !go.disabled) {
        if (!c.classList.contains('pick')) return reset();
        chips -= st[0] + st[1]; picks(); c.classList.remove('pick'); Object.assign(go, { textContent: 'Fighting…', disabled: true });
        run().catch((err) => { if (err !== STOP) throw err; });
      }
    });
    addEventListener('resize', onResize);
    reset();
  }

  let seen = false; // card 2 stays once it has shown, even if Sand Dunes empties
  const dunes = add({
    id: 'endofcontent2', section: 'Sand Dunes', theme: 'theme-sanddunes', anchor: 'sd_caravan', open: () => OW.SandDunes.reveal(),
    when: () => (seen = seen || OW.SandDunes.workerPool.getTotal() > 0),
    pages: [
      { title: "What's coming", html: coming([
        ['More in Sand Dunes', 'Bet on fighters in the Coliseum (playable on the next page) or spend your earnings at the gambling hall, take control of the Settlement, discover the Pyramids, and more.'],
        ['Explore more...', 'Discover new locations, new resources, and the secrets of the land.'],
        ['The goal', 'Over 100 hours of content.']]) },
      { title: 'Coliseum', head: '<span class="eoc-speed">Speed <b class="on" data-x="1">1×</b><b data-x="3">3×</b></span>', html: () => '<div class="eoc-col"></div>', after: coliseum }
    ]
  });

  const force = () => { forced = true; [below, dunes].forEach((c) => c.tick()); OW.Footer.push('Cheat: EoC — both End of Content cards shown.'); };
  OW.EndOfContent = { add, force, cards: [below, dunes] };
})();
