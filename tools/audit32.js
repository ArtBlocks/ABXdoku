/**
 * Audit the 32 real on-chain seeds: run the DEPLOYED artwork bytes for each,
 * collect the traits it reports, and independently re-verify uniqueness with a
 * solution counter written separately from the one inside the artwork.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SD = __dirname;
const src = fs.readFileSync(path.join(SD, '..', 'program', 'sudoku.js'), 'utf8');
// exposure only — appended AFTER the artwork's own code, generation untouched
const instrumented = src.replace(
  'if (document.body) boot();',
  'window.__grid = puzzle; window.__sol = solution; if (document.body) boot();'
);
if (instrumented === src) throw new Error('instrumentation anchor not found');

const seeds = JSON.parse(fs.readFileSync(path.join(SD, 'seeds.json'), 'utf8'));

function noop() { return noopCtx; }
const noopCtx = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    return function () { return noopCtx; };
  },
  set(t, k, v) { t[k] = v; return true; }
});
noopCtx.measureText = () => ({ width: 10 });
noopCtx.createLinearGradient = () => ({ addColorStop() {} });

function makeWindow(seed, tokenId) {
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => noopCtx,
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1200 }),
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
  const traits = {};
  const win = {
    document: doc,
    devicePixelRatio: 1,
    innerWidth: 1000, innerHeight: 1200,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() { return 0; },
    setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; },
    localStorage: null,
    console: { warn: (m) => { win.__warn = String(m); }, log() {}, error() {} },
    abx: {
      tokenData: { seed, tokenId, chainId: 84532, contractAddress: '0xB844F4D2137a8Ce785Cbc80D281A36DBD1c35E56' },
      traits: (t) => Object.assign(traits, t),
      done: () => { win.__done = true; }
    },
    __traits: traits
  };
  win.window = win;
  return win;
}

// ---- independent solution counter (written for this audit, not the artwork's)
function countSolutionsIndep(grid, cap) {
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
      g[best] = v;
      rec();
      g[best] = 0;
      if (found >= cap) return;
    }
  }
  rec();
  return found;
}

function legal(grid) {
  for (let u = 0; u < 27; u++) {
    const seen = {};
    for (let n = 0; n < 9; n++) {
      let i;
      if (u < 9) i = u * 9 + n;
      else if (u < 18) i = n * 9 + (u - 9);
      else {
        const b = u - 18;
        i = (3 * ((b / 3) | 0) + ((n / 3) | 0)) * 9 + 3 * (b % 3) + (n % 3);
      }
      const v = grid[i];
      if (!v) continue;
      if (seen[v]) return false;
      seen[v] = 1;
    }
  }
  return true;
}

const rows = [];
let failures = 0;
for (const id of Object.keys(seeds).map(Number).sort((a, b) => a - b)) {
  const win = makeWindow(seeds[id], id);
  const t0 = process.hrtime.bigint();
  vm.createContext(win);
  vm.runInContext(instrumented, win, { filename: 'sudoku.js' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const t = win.__traits;
  const grid = Array.from(win.__grid);
  const sol = Array.from(win.__sol);
  const givens = grid.filter((v) => v).length;
  const n = countSolutionsIndep(grid, 2);
  const solLegal = legal(sol) && sol.every((v) => v >= 1 && v <= 9);
  const consistent = grid.every((v, i) => !v || v === sol[i]);
  const bad = n !== 1 || givens !== t.Givens || !solLegal || !consistent || !win.__done || win.__warn;
  if (bad) failures++;
  rows.push({
    id, givens, trait: t.Givens, diff: t.Difficulty, sym: t.Symmetry,
    pal: t.Palette, solutions: n, solLegal, consistent, done: !!win.__done,
    warn: win.__warn || '', ms: ms.toFixed(0), bad
  });
}

console.log('id  givens  difficulty  symmetry    palette              sols  gen(ms)');
for (const r of rows) {
  console.log(
    String(r.id).padStart(2) + '  ' +
    String(r.givens).padStart(6) + '  ' +
    r.diff.padEnd(10) + '  ' +
    r.sym.padEnd(10) + '  ' +
    r.pal.padEnd(20) + '  ' +
    String(r.solutions).padStart(4) + '  ' +
    String(r.ms).padStart(7) +
    (r.bad ? '   <-- FAIL ' + JSON.stringify(r) : '')
  );
}

function tally(key) {
  const m = {};
  for (const r of rows) m[r[key]] = (m[r[key]] || 0) + 1;
  return m;
}
console.log('\nfailures:', failures, 'of', rows.length);
console.log('difficulty:', JSON.stringify(tally('diff')));
console.log('givens    :', JSON.stringify(tally('givens')));
console.log('symmetry  :', JSON.stringify(tally('sym')));
console.log('palette   :', JSON.stringify(tally('pal')));
console.log('gen ms    : max', Math.max(...rows.map((r) => +r.ms)), 'mean',
  (rows.reduce((a, r) => a + +r.ms, 0) / rows.length).toFixed(0));
