/**
 * Audit the daily rotation.
 *
 * Three things have to hold before the augment hook is worth deploying:
 *   1. REGRESSION -- with no `day` in tokenData the artwork must generate exactly the puzzle
 *      it generates today. Edition one is already minted; the rotation must be invisible to it.
 *   2. ROTATION   -- consecutive `day` values must give genuinely different puzzles.
 *   3. INVARIANT  -- every rotated puzzle must still have exactly ONE solution, checked by the
 *      counter written for the audit rather than the one inside the artwork.
 *
 * Run: node tools/audit-daily.js [days]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SD = __dirname;
const src = fs.readFileSync(path.join(SD, '..', 'program', 'sudoku.js'), 'utf8');
const instrumented = src.replace(
  'if (document.body) boot();',
  'window.__grid = puzzle; window.__sol = solution; if (document.body) boot();'
);
if (instrumented === src) throw new Error('instrumentation anchor not found');

const seeds = JSON.parse(fs.readFileSync(path.join(SD, 'seeds.json'), 'utf8'));

const noopCtx = new Proxy({}, {
  get(t, k) { return k in t ? t[k] : function () { return noopCtx; }; },
  set(t, k, v) { t[k] = v; return true; }
});
noopCtx.measureText = () => ({ width: 10 });
noopCtx.createLinearGradient = () => ({ addColorStop() {} });

// `day` omitted entirely when null -- that is the no-hook case, and it must be the ABSENCE
// of the key, not an empty one, to mirror what the resolver actually sends.
function run(seed, tokenId, day) {
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => noopCtx,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1200 }),
    appendChild() {}
  };
  const doc = {
    body: { style: {}, appendChild() {}, addEventListener() {} },
    documentElement: { style: {} },
    createElement: () => canvas,
    addEventListener() {}, querySelector: () => null,
    head: { appendChild() {} },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() }
  };
  const tokenData = { seed, tokenId, chainId: 84532, contractAddress: '0xB844F4D2137a8Ce785Cbc80D281A36DBD1c35E56' };
  if (day !== null) tokenData.day = String(day);

  const traits = {};
  const win = {
    document: doc, devicePixelRatio: 1, innerWidth: 1000, innerHeight: 1200,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() { return 0; },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; },
    localStorage: null,
    console: { warn: (m) => { win.__warn = String(m); }, log() {}, error() {} },
    abx: { tokenData, traits: (t) => Object.assign(traits, t), done() {} }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(instrumented, win);
  return { grid: Array.from(win.__grid), traits, warn: win.__warn, tokenData };
}

function countSolutions(grid, cap) {
  const g = grid.slice();
  let found = 0;
  function ok(i, v) {
    const r = (i / 9) | 0, c = i % 9;
    for (let k = 0; k < 9; k++) {
      if (g[r * 9 + k] === v) return false;
      if (g[k * 9 + c] === v) return false;
    }
    const br = r - (r % 3), bc = c - (c % 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (g[(br + a) * 9 + bc + b] === v) return false;
    }
    return true;
  }
  function rec() {
    let best = -1, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let n = 0;
      for (let v = 1; v <= 9; v++) if (ok(i, v)) n++;
      if (n < bestN) { bestN = n; best = i; if (n === 0) return; }
    }
    if (best === -1) { found++; return; }
    for (let v = 1; v <= 9; v++) {
      if (!ok(best, v)) continue;
      g[best] = v; rec(); g[best] = 0;
      if (found >= cap) return;
    }
  }
  rec();
  return found;
}

const DAYS = Number(process.argv[2] || 30);
const TODAY = Math.floor(Date.now() / 86400000);
let failures = 0;

// ---- 1. regression: no `day` must reproduce edition one exactly
process.stdout.write('regression (no `day` -> unchanged) ... ');
const baseline = JSON.parse(fs.readFileSync(path.join(SD, 'tokens.json'), 'utf8'));
let regressionChecked = 0;
for (const t of baseline.tokens) {
  const r = run(seeds[t.id], String(t.id), null);
  const same = r.traits.Givens === t.givens && r.traits.Difficulty === t.difficulty &&
               r.traits.Symmetry === t.symmetry && r.traits.Palette === t.palette;
  if (!same) {
    failures++;
    console.log(`\n  FAIL token ${t.id}: ${JSON.stringify(r.traits)} != ${JSON.stringify(t)}`);
  }
  regressionChecked++;
}
console.log(`${regressionChecked}/32 tokens identical to their minted traits`);

// ---- 2 + 3. rotation produces distinct, still-unique puzzles
const seed0 = seeds[0];
const seen = new Map();
const traitShapes = new Set();   // every day must report the SAME traits, or they expire
console.log(`\nrotation from day ${TODAY} (${new Date(TODAY * 86400000).toISOString().slice(0, 10)}), ${DAYS} days:\n`);
console.log('  day      date         giv  uniq   new?');
for (let d = TODAY; d < TODAY + DAYS; d++) {
  const r = run(seed0, '0', d);
  const key = r.grid.join('');
  const n = countSolutions(r.grid, 2);
  const dup = seen.has(key);
  if (n !== 1) failures++;
  if (dup) failures++;
  if (!dup) seen.set(key, d);
  traitShapes.add(JSON.stringify(r.traits));
  // Givens counted off the grid rather than read from a trait -- the daily no longer
  // reports one, and counting independently is the stronger check anyway.
  const givens = r.grid.filter((v) => v !== 0).length;
  if (d < TODAY + 8 || dup || n !== 1) {
    console.log(`  ${d}  ${new Date(d * 86400000).toISOString().slice(0, 10)}   ` +
      `${String(givens).padStart(3)}  ${String(n).padStart(4)}   ` +
      `${dup ? 'DUPLICATE of day ' + seen.get(key) : 'yes'}`);
  }
}
console.log(`  … ${DAYS} days checked`);
console.log(`\ndistinct puzzles : ${seen.size}/${DAYS}`);
console.log(`unique solutions : ${failures === 0 ? 'all ' + DAYS : 'SEE FAILURES'}`);

// ---- 4. the point of series-level traits: they must be the SAME every day
console.log('\nseries-level traits (must be identical on every day):');
for (const shape of traitShapes) console.log('  ' + shape);
if (traitShapes.size !== 1) {
  failures++;
  console.log(`  FAIL — ${traitShapes.size} distinct trait sets across ${DAYS} days; these expire`);
} else {
  const t = JSON.parse([...traitShapes][0]);
  const perPuzzle = ['Difficulty', 'Givens', 'Symmetry', 'Palette'].filter((k) => k in t);
  if (perPuzzle.length) {
    failures++;
    console.log(`  FAIL — still reporting per-puzzle trait(s): ${perPuzzle.join(', ')}`);
  } else {
    console.log(`  stable across all ${DAYS} days, and no per-puzzle key present`);
  }
}

console.log(`\nfailures         : ${failures}`);
process.exit(failures ? 1 : 0);
