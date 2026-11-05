/* Clock guard. Game logic must run on game time (ticks), never the wall
   clock, or replays (js/core/replay.js) and offline catch-up drift. Scans
   mechanics and simulation core files for Date.now / performance.now and
   fails on any read not allowlisted here with a reason. Node only. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CORE = ['cycles', 'upgrades', 'workers', 'upkeep', 'resources', 'rates', 'locations', 'hiddenRes', 'scoutstable', 'strangeshard', 'toolUse'];
const FILES = [...fs.readdirSync(path.join(ROOT, 'js/mechanics')).map((f) => 'js/mechanics/' + f), ...CORE.map((f) => `js/core/${f}.js`)];
// [file, text the line contains, reason]
const ALLOW = [
  ['js/mechanics/goldmine.js', 'c.bonus = { t: performance.now()', 'bonus text fade start; display only, not saved'],
  ['js/mechanics/goldmine.js', 'now = performance.now();', 'bonus text fade in the modal patch; display only'],
  ['js/core/upgrades.js', 'r.bumpUntil = performance.now() + 160', 'toggle bump animation'],
  ['js/core/upgrades.js', 'const now = performance.now();', 'bump animation render'],
  ['js/core/upgrades.js', 'performance.now() - lastCollapseAt < 300', 'double-tap guard on a section collapse; replay pins the clock'],
  ['js/core/upgrades.js', 'lastCollapseAt = performance.now();', 'same guard']
];
let failed = 0, seen = 0;
for (const f of FILES) {
  fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
    if (!/Date\.now|performance\.now/.test(line)) return;
    seen++;
    if (!ALLOW.some(([af, text]) => af === f && line.includes(text))) { failed++; console.log(`FAIL  ${f}:${i + 1} reads the wall clock: ${line.trim()}`); }
  });
}
console.log(`${failed ? 'FAIL' : 'PASS'}  ${seen} wall-clock reads in ${FILES.length} simulation files, all allowlisted with a reason`);
const stale = ALLOW.filter(([af, text]) => !fs.readFileSync(path.join(ROOT, af), 'utf8').includes(text));
console.log(`${stale.length ? 'FAIL' : 'PASS'}  every allowlist entry still matches a line${stale.length ? ': ' + stale.map((s) => s[1]).join(', ') : ''}`);
process.exit(failed || stale.length ? 1 : 0);
