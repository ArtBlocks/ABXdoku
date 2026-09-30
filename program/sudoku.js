/**
 * SUDOKU — an ABX code project.
 *
 * The puzzle is a pure function of the token's mint-time seed, generated at view
 * time. Uniqueness holds by construction, not by sampling: a complete legal grid
 * is filled, then cells are removed one at a time (in rotationally symmetric
 * pairs, mostly) and a removal is KEPT only while a solution counter still finds
 * exactly one solution. Difficulty is then read off the given count actually
 * reached, so the reported trait can never disagree with the puzzle. The palette
 * is dealt from the same seed; a player can repaint locally without touching it.
 *
 * Runtime contract: reads abx.tokenData, reports abx.traits(), signals abx.done().
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ token state
  var td = (window.abx && abx.tokenData) || {};
  var seedHex = td.seed || '0x5eed1234abcd5eed9876fedc5eed4321cafe5eedbeef5eed0f0f5eedfeed5eed';
  var tokenId = (td.tokenId === undefined || td.tokenId === null) ? 0 : td.tokenId;

  // An augment hook, if the contract wires one, folds a rotating `day` into tokenData at
  // view time -- the resolver reads it fresh on every view, so the puzzle turns over on its
  // own with no transaction and nothing running. The hook cannot touch `seed` (the resolver
  // skips the reserved coordinates), so the rotation arrives as its own key and is mixed in
  // here. Absent a hook there is no `day`, the RNG string is exactly the seed, and the token
  // generates precisely the puzzle it always has.
  var day = (td.day === undefined || td.day === null || td.day === '') ? null : String(td.day);

  // `day` is a whole-day index (days since the Unix epoch), so the calendar date it names is
  // a pure conversion -- no date arithmetic needed on-chain. A hook that reports something
  // else stays perfectly playable; the header just falls back to the token number.
  var dayLabel = null;
  if (day !== null && /^\d{1,7}$/.test(day)) {
    dayLabel = 'ABXDOKU · ' + new Date(Number(day) * 86400000).toISOString().slice(0, 10);
  }

  // No PostParams: the token is entirely a function of its seed, palette
  // included. A player can repaint it locally for their own eyes, which changes
  // nothing on-chain and nothing for anyone else.

  // ------------------------------------------------------------------- PRNG
  // xmur3 seeding + sfc32: all integer ops, so every engine agrees.
  function makeRng(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    function next32() {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    }
    var a = next32(), b = next32(), c = next32(), d = next32();
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      var t = ((a + b) | 0) + d | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var rnd = makeRng(day === null ? String(seedHex) : String(seedHex) + ':' + day);

  // -------------------------------------------------------- generation core
  function boxOf(i) { return (((i / 9) | 0) / 3 | 0) * 3 + (((i % 9) / 3) | 0); }

  /** Cell index of slot n in unit u — rows 0-8, columns 9-17, boxes 18-26. */
  function unitCell(u, n) {
    if (u < 9) return u * 9 + n;
    if (u < 18) return n * 9 + u - 9;
    var b = u - 18;
    return (3 * ((b / 3) | 0) + ((n / 3) | 0)) * 9 + 3 * (b % 3) + (n % 3);
  }

  function fillGrid(rnd) {
    var g = new Int8Array(81);
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    function rec(i) {
      if (i === 81) return true;
      var r = (i / 9) | 0, c = i % 9, b = boxOf(i);
      var used = rows[r] | cols[c] | boxes[b];
      var cand = [];
      for (var d = 1; d <= 9; d++) if (!(used & (1 << d))) cand.push(d);
      shuffle(cand, rnd);
      for (var k = 0; k < cand.length; k++) {
        var d2 = cand[k], m = 1 << d2;
        g[i] = d2; rows[r] |= m; cols[c] |= m; boxes[b] |= m;
        if (rec(i + 1)) return true;
        g[i] = 0; rows[r] &= ~m; cols[c] &= ~m; boxes[b] &= ~m;
      }
      return false;
    }
    rec(0);
    return g;
  }

  /** Count solutions, aborting once `cap` is reached. Fewest-candidates first. */
  function countSolutions(grid, cap) {
    var g = grid.slice();
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (var i = 0; i < 81; i++) {
      var d = g[i];
      if (d) { var m = 1 << d; rows[(i / 9) | 0] |= m; cols[i % 9] |= m; boxes[boxOf(i)] |= m; }
    }
    var count = 0;
    function rec() {                       // returns true to abort the whole search
      var best = -1, bestUsed = 0, bestN = 10;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var used = rows[(i / 9) | 0] | cols[i % 9] | boxes[boxOf(i)];
        var n = 0;
        for (var d = 1; d <= 9; d++) if (!(used & (1 << d))) n++;
        if (n === 0) return false;          // dead end
        if (n < bestN) { bestN = n; best = i; bestUsed = used; if (n === 1) break; }
      }
      if (best === -1) { count++; return count >= cap; }
      var r = (best / 9) | 0, c = best % 9, b = boxOf(best);
      for (var d2 = 1; d2 <= 9; d2++) {
        var m2 = 1 << d2;
        if (bestUsed & m2) continue;
        g[best] = d2; rows[r] |= m2; cols[c] |= m2; boxes[b] |= m2;
        var abort = rec();
        g[best] = 0; rows[r] &= ~m2; cols[c] &= ~m2; boxes[b] &= ~m2;
        if (abort) return true;
      }
      return false;
    }
    rec();
    return count;
  }

  /** Remove cells while a unique solution survives every step. */
  function carve(solution, rnd, targetGivens, symmetric) {
    var puzzle = solution.slice();
    var order = [];
    for (var i = 0; i < 81; i++) order.push(i);
    shuffle(order, rnd);

    var givens = 81;
    for (var k = 0; k < order.length && givens > targetGivens; k++) {
      var idx = order[k];
      if (!puzzle[idx]) continue;
      var group = (symmetric && idx !== 40) ? [idx, 80 - idx] : [idx];

      var saved = [];
      for (var t = 0; t < group.length; t++) { saved.push(puzzle[group[t]]); puzzle[group[t]] = 0; }

      if (countSolutions(puzzle, 2) !== 1) {
        for (var t2 = 0; t2 < group.length; t2++) puzzle[group[t2]] = saved[t2];
      } else {
        for (var t3 = 0; t3 < group.length; t3++) if (saved[t3]) givens--;
      }
    }
    return { puzzle: puzzle, givens: givens };
  }

  // ------------------------------------------------------------- the puzzle
  var solution = fillGrid(rnd);
  var symmetric = rnd() < 0.7;
  var TIERS = [42, 36, 30, 24];
  var target = TIERS[Math.floor(rnd() * TIERS.length)];
  var carved = carve(solution, rnd, target, symmetric);
  var puzzle = carved.puzzle;
  var givenCount = carved.givens;

  // The proof, re-checked on the finished artifact rather than assumed.
  var uniqueSolutions = countSolutions(puzzle, 2);

  var difficulty = givenCount >= 40 ? 'Gentle'
    : givenCount >= 34 ? 'Steady'
      : givenCount >= 29 ? 'Tricky' : 'Fiendish';

  // ----------------------------------------------------------- the palettes
  // Five families, each light + dark, so the picker is five rows plus a switch.
  // The seed deals one of the eight aesthetic palettes as the token's own.
  // Packed as hex triplets in FIELDS order — the same data as an object literal
  // per palette, minus ~2.5KB of repeated key names and quoting.
  var FIELDS = 'bg board thin thick given user note sel peer same errBg ui uiDim padBg'.split(' ');
  var FAMILY_DATA = [
    ['Newsprint', 'Newsprint', 'Newsprint Dark',
      'efeae0 faf7f1 c9bfae 2a2622 221f1c 1f5fbf 8b8272 dbe9fb efe9dd e2d9c4 f0b3a9 5c5449 a79d8d f3efe6',
      '1a1714 211d19 453d34 b8ac9c ece4d8 8ab8ff 7a7062 2d3b4e 262118 463c29 6e2c23 c9bfae 7a7062 201c18'],
    ['Rose Ink', 'Rose Ink', 'Rose Ink Dark',
      'f7e9ee fdf6f8 dcbcc7 4a2531 2e1a21 b3246b b08c99 fbdde8 f6ecf0 f2d4e0 f0aca4 6b4552 b2919c f9eff3',
      '1b1015 23151b 4d2f3b c99fb0 f4e3ea ff8ac0 8a6472 3e2030 2a1820 4b2535 71212a d6b3c1 8a6472 221419'],
    ['Fern', 'Fern', 'Terminal',
      'e6ece0 f3f7ee b3c4a6 2b3a26 1e2b1a 1f7a4d 7d9070 d4ead6 e9efe2 cfe0c0 f0b3a9 4c5a44 93a288 eaf0e4',
      '06120a 0a1c10 1e4a2b 57c97a c8f7d5 f2ff7a 4a8f60 123f22 0d2a17 1a5230 6e1d1d 7fd99a 3d7a52 0c2413'],
    ['Cyanotype', 'Cyanotype', 'Blueprint',
      'e2e9f0 f2f6fa a9bece 1f3a52 16283a 1f5fbf 7690a5 cfe2f7 e6edf4 c3d8ea f0b3a9 44586b 8ba0b2 e8eef4',
      '0a2138 0f2c4a 2a5680 8fc4e8 dfeefc ffd166 6f9dc4 1b4a75 143a5f 215a8c 8c2a3c 9dc6e5 4d7ba3 123252'],
    // trailing 1 = accessibility tool: offered in the picker, never dealt by the
    // seed, because it is not an aesthetic identity for a token to carry
    ['High Contrast', 'High Contrast', 'High Contrast Dark',
      'ffffff ffffff 8a8a8a 000000 000000 0033cc 555555 b9d4ff ededed ffd24a ff9a9a 000000 555555 f5f5f5',
      '000000 000000 808080 ffffff ffffff 66ccff b3b3b3 16457a 1c1c1c 6b5200 8a1f1f ffffff a6a6a6 121212', 1]
  ];

  var PALETTES = [], FAMILIES = [], SEED_POOL = [];
  for (var fd = 0; fd < FAMILY_DATA.length; fd++) {
    var row = FAMILY_DATA[fd];
    FAMILIES.push(row[0]);
    for (var mode = 0; mode < 2; mode++) {
      var pal = { name: row[1 + mode], family: row[0], dark: mode === 1, pickerOnly: !!row[5] };
      var hex = row[3 + mode].split(' ');
      for (var fk = 0; fk < FIELDS.length; fk++) pal[FIELDS[fk]] = '#' + hex[fk];
      if (!pal.pickerOnly) SEED_POOL.push(PALETTES.length);
      PALETTES.push(pal);
    }
  }

  function paletteByName(name) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].name === name) return i;
    return -1;
  }

  function paletteFor(family, wantDark) {
    for (var i = 0; i < PALETTES.length; i++) {
      if (PALETTES[i].family === family && PALETTES[i].dark === wantDark) return i;
    }
    return 0;
  }

  // The token's own palette, dealt from the seed out of the aesthetic families.
  // This is the LAST draw from the random stream, so it cannot shift a puzzle.
  var defaultIndex = SEED_POOL[Math.floor(rnd() * SEED_POOL.length)];

  // Precedence: this viewer's local choice → the token's own palette. The saved
  // choice is looked up by NAME, so reordering the list can't repoint it.
  var THEME_KEY = 'abx-sudoku-theme', WEIGHT_KEY = 'abx-sudoku-weight';
  var paletteIndex = defaultIndex;
  var boldGivens = false;
  try {
    var store = window.localStorage;
    var saved = store ? paletteByName(store.getItem(THEME_KEY)) : -1;
    if (saved >= 0) paletteIndex = saved;
    if (store && store.getItem(WEIGHT_KEY) === '1') boldGivens = true;
  } catch (e) { /* sandboxed iframe: no persistence, follow the token default */ }
  var palette = PALETTES[paletteIndex];

  /** Picking the token's own palette CLEARS the override rather than storing
   *  it, so the token goes back to showing what its seed dealt. */
  function setPalette(i) {
    if (i < 0 || i >= PALETTES.length) return;
    paletteIndex = i;
    palette = PALETTES[i];
    try {
      if (window.localStorage) {
        if (i === defaultIndex) window.localStorage.removeItem(THEME_KEY);
        else window.localStorage.setItem(THEME_KEY, palette.name);
      }
    } catch (e) { /* preference just won't outlive the session */ }
    if (document.body) document.body.style.background = palette.bg;
    draw();
  }

  /** Weight reinforces given-vs-entered, which every palette otherwise carries
   *  by hue alone — the weakest signal for a color-blind player. */
  function setBoldGivens(on) {
    boldGivens = !!on;
    try {
      if (window.localStorage) window.localStorage.setItem(WEIGHT_KEY, boldGivens ? '1' : '0');
    } catch (e) { /* session-only, fine */ }
    digitFonts();
    draw();
  }

  // --------------------------------------------------------------- gameplay
  var values = puzzle.slice();
  var given = new Uint8Array(81);
  for (var gi = 0; gi < 81; gi++) given[gi] = puzzle[gi] ? 1 : 0;
  var notes = new Int16Array(81);

  var selected = -1;
  var notesMode = false;
  var lockedDigit = 0;        // pad digit clicked with no cell selected → board-wide highlight
  var hoverPad = 0;
  var conflicts = {};
  var solved = false;
  var askRestart = false, askTheme = false;
  var startedAt = 0, elapsed = 0;     // a plain clock: not stored, not on-chain
  var undoStack = [], redoStack = [];

  function snapshot() { return { v: values.slice(), n: notes.slice() }; }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 250) undoStack.shift();
    redoStack.length = 0;              // a fresh move abandons the redo branch
  }

  function step(from, to) {
    var s = from.pop();
    if (!s) return;
    to.push(snapshot());
    values = s.v; notes = s.n;
    recompute();
    draw();
  }

  function undo() { step(undoStack, redoStack); }
  function redo() { step(redoStack, undoStack); }

  function isPeer(a, b) {
    return ((a / 9) | 0) === ((b / 9) | 0) || (a % 9) === (b % 9) || boxOf(a) === boxOf(b);
  }

  // One pass per unit (27 × 9) rather than every pair of cells (81 × 81).
  var seenIn = new Int16Array(10);
  function recompute() {
    conflicts = {};
    var bad = 0, filled = 0;
    for (var u = 0; u < 27; u++) {
      seenIn.fill(0);
      for (var n = 0; n < 9; n++) {
        var i = unitCell(u, n), v = values[i];
        if (!v) continue;
        if (seenIn[v]) {
          var first = seenIn[v] - 1;
          if (!conflicts[first]) { conflicts[first] = 1; bad++; }
          if (!conflicts[i]) { conflicts[i] = 1; bad++; }
        } else seenIn[v] = i + 1;
      }
    }
    for (var k = 0; k < 81; k++) if (values[k]) filled++;
    var wasSolved = solved;
    solved = filled === 81 && bad === 0;
    if (solved && !wasSolved) elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  }

  /** Back to the givens. The puzzle itself never changes — it's the seed's. */
  function restart() {
    pushUndo();
    startedAt = 0; elapsed = 0;
    values = puzzle.slice();
    notes = new Int16Array(81);
    selected = -1;
    lockedDigit = 0;
    recompute();
    draw();
  }

  function place(i, d) {
    if (i < 0 || given[i] || solved) return;
    if (!startedAt) startedAt = Date.now();
    pushUndo();
    if (notesMode) {
      notes[i] ^= (1 << d);                    // toggle a pencil mark
    } else {
      values[i] = (values[i] === d) ? 0 : d;   // tapping the same digit clears it
      notes[i] = 0;
      if (values[i]) {                          // tidy peers' notes automatically
        for (var j = 0; j < 81; j++) if (j !== i && isPeer(i, j)) notes[j] &= ~(1 << d);
      }
    }
    recompute();
    draw();
  }

  function erase(i) {
    if (i < 0 || given[i] || solved) return;
    if (!values[i] && !notes[i]) return;
    pushUndo();
    values[i] = 0; notes[i] = 0;
    recompute();
    draw();
  }

  // ----------------------------------------------------------------- layout
  var W = 1000, H = 1200;
  var BX = 50, BY = 116, BW = 900, CELL = 100;
  var PAD_Y = 1032, PAD_H = 80;
  var ACT_Y = 1124, ACT_H = 58;

  var STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  function font(weight, size) { return weight + ' ' + size + 'px ' + STACK; }
  function mono(size) { return '500 ' + size + 'px ui-monospace, monospace'; }

  function fmt(sec) {
    var t = Math.max(0, Math.floor(sec)), m = (t / 60) | 0, r = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  // 700 vs 400, not 800 vs 300: many systems ship only two real weights for
  // system-ui (measured: every value >=600 renders identically, as does every
  // value <=400), so anything finer is precision that silently collapses.
  var fontGiven, fontEntered;
  function digitFonts() {
    fontGiven = font(boldGivens ? 700 : 600, 56);
    fontEntered = font(boldGivens ? 400 : 600, 56);
  }
  digitFonts();

  var canvas, ctx, scale = 1;

  function setup() {
    document.documentElement.style.height = '100%';
    var b = document.body;
    b.style.margin = '0';
    b.style.height = '100%';
    b.style.background = palette.bg;
    b.style.overflow = 'hidden';
    b.style.display = 'flex';
    b.style.alignItems = 'center';
    b.style.justifyContent = 'center';
    b.style.userSelect = 'none';
    b.style.touchAction = 'manipulation';

    canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    b.appendChild(canvas);
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousedown', onPoint);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', function () { hoverPad = 0; draw(); });
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length) { onPoint(e.touches[0]); e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('keydown', onKey);
    setInterval(function () { if (startedAt && !solved) draw(); }, 1000);
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var vw = window.innerWidth || W, vh = window.innerHeight || H;
    scale = Math.min(vw / W, vh / H);
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    draw();
  }

  function toLogical(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
  }

  function inBox(b, p) {
    return p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
  }

  // ------------------------------------------------------------------ input
  function onPoint(ev) {
    var p = toLogical(ev);

    // Both dialogs are modal — they swallow every click while open. The picker
    // stays open on a choice so palettes can be compared.
    if (askTheme) {
      var tm = themeDialog();
      var fam = PALETTES[paletteIndex].family;
      if (inBox(tm.light, p)) return setPalette(paletteFor(fam, false));
      if (inBox(tm.dark, p)) return setPalette(paletteFor(fam, true));
      if (inBox(tm.weight, p)) return setBoldGivens(!boldGivens);
      for (var ti = 0; ti < tm.items.length; ti++) {
        if (inBox(tm.items[ti], p)) return setPalette(tm.items[ti].index);
      }
      if (!inBox(tm, p)) { askTheme = false; draw(); }
      return;
    }

    if (askRestart) {
      var m = restartDialog();
      if (inBox(m.yes, p)) { askRestart = false; restart(); }
      else if (inBox(m.no, p) || !inBox(m, p)) { askRestart = false; draw(); }
      return;
    }

    if (p.x >= BX && p.x < BX + BW && p.y >= BY && p.y < BY + BW) {
      selected = Math.floor((p.y - BY) / CELL) * 9 + Math.floor((p.x - BX) / CELL);
      lockedDigit = 0;
      draw();
      return;
    }

    if (p.y >= PAD_Y && p.y < PAD_Y + PAD_H && p.x >= BX && p.x < BX + BW) {
      var d = Math.floor((p.x - BX) / CELL) + 1;
      if (selected >= 0 && !given[selected]) place(selected, d);
      else { lockedDigit = (lockedDigit === d) ? 0 : d; selected = -1; draw(); }
      return;
    }

    var btns = actionButtons();
    for (var b = 0; b < btns.length; b++) {
      if (!inBox(btns[b], p)) continue;
      var id = btns[b].id;
      if (!btns[b].enabled) return;
      if (id === 'notes') { notesMode = !notesMode; draw(); }
      else if (id === 'undo') undo();
      else if (id === 'redo') redo();
      else if (id === 'erase') erase(selected);
      else if (id === 'restart') { askRestart = true; draw(); }
      else { askTheme = !askTheme; draw(); }
      return;
    }
    if (p.y >= ACT_Y && p.y < ACT_Y + ACT_H) return;   // a gap between buttons

    selected = -1; lockedDigit = 0; draw();
  }

  function onMove(ev) {
    var p = toLogical(ev);
    var d = 0;
    if (p.y >= PAD_Y && p.y < PAD_Y + PAD_H && p.x >= BX && p.x < BX + BW) {
      d = Math.floor((p.x - BX) / CELL) + 1;
    }
    if (d !== hoverPad) { hoverPad = d; draw(); }
  }

  function onKey(e) {
    var k = e.key || '', low = k.toLowerCase();
    var mod = e.ctrlKey || e.metaKey;

    // An open dialog owns the keyboard too.
    if (askTheme) {
      if (k === 'Escape' || low === 't') { askTheme = false; draw(); }
      e.preventDefault();
      return;
    }
    if (askRestart) {
      if (k === 'Enter' || low === 'y') { askRestart = false; restart(); }
      else if (k === 'Escape' || low === 'n') { askRestart = false; draw(); }
      e.preventDefault();
      return;
    }

    if (mod && (low === 'y' || (e.shiftKey && low === 'z'))) { redo(); e.preventDefault(); return; }
    if (k >= '1' && k <= '9') { place(selected, +k); e.preventDefault(); return; }
    if (k === '0' || k === 'Backspace' || k === 'Delete') { erase(selected); e.preventDefault(); return; }
    if (low === 'n') { notesMode = !notesMode; draw(); return; }
    if (low === 't') { askTheme = true; draw(); return; }
    if (low === 'u' || (mod && low === 'z')) { undo(); e.preventDefault(); return; }
    if (k === 'Escape') { selected = -1; lockedDigit = 0; draw(); return; }

    var dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
    var dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
    if (!dx && !dy) return;
    if (selected < 0) selected = 40;
    else {
      var r = Math.min(8, Math.max(0, ((selected / 9) | 0) + dy));
      var c = Math.min(8, Math.max(0, (selected % 9) + dx));
      selected = r * 9 + c;
    }
    lockedDigit = 0;
    draw();
    e.preventDefault();
  }

  // ----------------------------------------------------------------- render
  function activeDigit() {
    if (hoverPad) return hoverPad;
    if (selected >= 0 && values[selected]) return values[selected];
    return lockedDigit;
  }

  /** How many of each digit are on the board, in one pass instead of nine. */
  function digitCounts() {
    var c = new Int8Array(10);
    for (var i = 0; i < 81; i++) c[values[i]]++;
    return c;
  }

  /**
   * Buttons and their hit boxes come from ONE place, so click targets can't
   * drift. `icon` buttons take a fixed narrow width; text buttons share the rest.
   */
  function actionButtons() {
    var list = [
      { id: 'notes', label: notesMode ? 'NOTES ON' : 'NOTES', on: notesMode, enabled: true },
      { id: 'undo', icon: 'undo', on: false, enabled: undoStack.length > 0 },
      { id: 'redo', icon: 'redo', on: false, enabled: redoStack.length > 0 },
      { id: 'erase', label: 'ERASE', on: false, enabled: true },
      { id: 'restart', label: 'RESTART', on: false, enabled: true },
      { id: 'theme', icon: 'theme', on: askTheme, enabled: true }
    ];
    var gap = 15, iconW = 108, icons = 0;
    for (var i = 0; i < list.length; i++) if (list[i].icon) icons++;
    var textW = (BW - gap * (list.length - 1) - iconW * icons) / (list.length - icons);
    var x = BX;
    for (var j = 0; j < list.length; j++) {
      list[j].w = list[j].icon ? iconW : textW;
      list[j].x = x;
      list[j].y = ACT_Y;
      list[j].h = ACT_H;
      x += list[j].w + gap;
    }
    return list;
  }

  /** Appearance panel: mode switch, one row per family, weight toggle. */
  function themeDialog() {
    var pad = 20, gap = 10, cols = 2;
    var headH = 86, modeH = 46, rowH = 56, weightH = 52;
    var rows = Math.ceil(FAMILIES.length / cols);
    var famH = rows * rowH + (rows - 1) * gap;
    var w = BW - 100, x = BX + 50;
    var h = headH + modeH + 12 + famH + 14 + weightH + pad;
    var y = BY + BW / 2 - h / 2;

    var modeW = (w - pad * 2 - 12) / 2, modeY = y + headH;
    var famY = modeY + modeH + 12;
    var cellW = (w - pad * 2 - gap) / cols;
    var isDark = PALETTES[paletteIndex].dark;

    var items = [];
    for (var i = 0; i < FAMILIES.length; i++) {
      items.push({
        index: paletteFor(FAMILIES[i], isDark),
        x: x + pad + (i % cols) * (cellW + gap),
        y: famY + ((i / cols) | 0) * (rowH + gap),
        w: cellW, h: rowH
      });
    }
    return {
      x: x, y: y, w: w, h: h, items: items, isDark: isDark,
      light: { x: x + pad, y: modeY, w: modeW, h: modeH },
      dark: { x: x + pad + modeW + 12, y: modeY, w: modeW, h: modeH },
      weight: { x: x + pad, y: famY + famH + 14, w: w - pad * 2, h: weightH }
    };
  }

  function restartDialog() {
    var w = BW - 180, h = 230;
    var x = BX + 90, y = BY + BW / 2 - h / 2;
    var bw = (w - 60) / 2, by = y + h - 90;
    return {
      x: x, y: y, w: w, h: h,
      yes: { x: x + 20, y: by, w: bw, h: 58, label: 'YES, RESTART' },
      no: { x: x + 40 + bw, y: by, w: bw, h: 58, label: 'NO, TAKE ME BACK' }
    };
  }

  /**
   * A curved undo arrow as vectors, not a glyph — the document carries no fonts,
   * so ↶ would be at the mercy of whatever the viewer has. `mirror` gives redo.
   */
  function curvedArrow(cx, cy, mirror) {
    var r = 12, a0 = Math.PI * 0.98;
    ctx.save();
    if (mirror) { ctx.translate(cx, cy); ctx.scale(-1, 1); ctx.translate(-cx, -cy); }
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy + 2, r, a0, Math.PI * 2.15, false);
    ctx.stroke();

    // arrowhead at the tail, pointing back along the arc
    var hx = cx + r * Math.cos(a0), hy = cy + 2 + r * Math.sin(a0);
    var tx = Math.sin(a0), ty = -Math.cos(a0);        // reversed tangent
    ctx.beginPath();
    ctx.moveTo(hx + tx * 8, hy + ty * 8);
    ctx.lineTo(hx - ty * 5, hy + tx * 5);
    ctx.lineTo(hx + ty * 5, hy - tx * 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A half-filled circle: the conventional contrast/appearance control. */
  function contrastIcon(cx, cy) {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 12, -Math.PI / 2, Math.PI / 2, false);
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** One rounded button. `strong` gives an active button the heavier border. */
  function pill(b, on, strong) {
    ctx.fillStyle = on ? palette.same : palette.padBg;
    roundRect(b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.strokeStyle = (on && strong) ? palette.thick : palette.thin;
    ctx.lineWidth = (on && strong) ? 3 : 1.5;
    ctx.stroke();
  }

  function centered(b, label, size, ink) {
    ctx.font = font(600, size);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }

  /** An opaque framed panel — the digits behind a dialog read as noise. */
  function frame(b) {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = palette.thick;
    ctx.lineWidth = 4;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }

  function draw() {
    if (!ctx) return;
    var p = palette, i, d;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    // ---- header: title left, the puzzle's own facts right
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.ui;
    ctx.font = font(600, 34);
    ctx.textAlign = 'left';
    ctx.fillText(dayLabel || ('ABXDOKU #' + tokenId), BX, 46);
    ctx.fillStyle = p.uiDim;
    ctx.font = font(500, 26);
    ctx.fillText(difficulty.toUpperCase() + ' · ' + givenCount + ' GIVEN · ' +
      (symmetric ? 'SYMMETRIC' : 'FREE'), BX, 86);
    ctx.textAlign = 'right';
    ctx.font = mono(34);
    ctx.fillStyle = solved ? p.user : p.ui;
    ctx.fillText(fmt(solved ? elapsed : (startedAt ? (Date.now() - startedAt) / 1000 : 0)),
      BX + BW, 46);

    // ---- board
    ctx.fillStyle = p.board;
    ctx.fillRect(BX, BY, BW, BW);

    var hl = activeDigit();
    for (i = 0; i < 81; i++) {
      var bgc = conflicts[i] ? p.errBg
        : i === selected ? p.sel
          : (hl && values[i] === hl) ? p.same
            : (selected >= 0 && isPeer(i, selected)) ? p.peer : null;
      if (bgc) {
        ctx.fillStyle = bgc;
        ctx.fillRect(BX + (i % 9) * CELL, BY + ((i / 9) | 0) * CELL, CELL, CELL);
      }
    }

    for (i = 0; i <= 9; i++) {                 // grid lines
      var heavy = (i % 3) === 0, at = BX + i * CELL, atY = BY + i * CELL;
      ctx.strokeStyle = heavy ? p.thick : p.thin;
      ctx.lineWidth = heavy ? 4 : 1.5;
      ctx.beginPath(); ctx.moveTo(at, BY); ctx.lineTo(at, BY + BW); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(BX, atY); ctx.lineTo(BX + BW, atY); ctx.stroke();
    }

    ctx.textAlign = 'center';
    for (i = 0; i < 81; i++) {                 // digits + pencil marks
      var col = i % 9, rw = (i / 9) | 0;
      if (values[i]) {
        ctx.font = given[i] ? fontGiven : fontEntered;
        ctx.fillStyle = given[i] ? p.given : p.user;   // a conflict recolors the TILE, not the digit
        ctx.fillText(String(values[i]), BX + col * CELL + 50, BY + rw * CELL + 53);
      } else if (notes[i]) {
        ctx.font = font(500, 24);
        for (d = 1; d <= 9; d++) {
          if (!(notes[i] & (1 << d))) continue;
          ctx.fillStyle = (hl === d) ? p.user : p.note;
          ctx.fillText(String(d), BX + col * CELL + 20 + ((d - 1) % 3) * 30,
            BY + rw * CELL + 22 + (((d - 1) / 3) | 0) * 30);
        }
      }
    }

    // ---- digit pad
    var counts = digitCounts();
    for (d = 1; d <= 9; d++) {
      var box = { x: BX + (d - 1) * CELL + 4, y: PAD_Y, w: CELL - 8, h: PAD_H };
      var left = 9 - counts[d];
      pill(box, hl === d || lockedDigit === d, false);
      ctx.font = font(600, 42);
      ctx.fillStyle = left === 0 ? p.uiDim : (notesMode ? p.note : p.user);
      ctx.fillText(String(d), box.x + box.w / 2, PAD_Y + 34);
      ctx.font = mono(18);
      ctx.fillStyle = p.uiDim;
      ctx.fillText(left === 0 ? '·' : String(left), box.x + box.w / 2, PAD_Y + 64);
    }

    // ---- actions
    var acts = actionButtons();
    for (i = 0; i < acts.length; i++) {
      var bt = acts[i];
      pill(bt, bt.on, false);
      var ink = !bt.enabled ? p.uiDim : (bt.on ? p.user : p.ui);
      if (!bt.icon) { centered(bt, bt.label, 22, ink); continue; }
      ctx.strokeStyle = ink; ctx.fillStyle = ink;
      if (bt.icon === 'theme') contrastIcon(bt.x + bt.w / 2, ACT_Y + ACT_H / 2);
      else curvedArrow(bt.x + bt.w / 2, ACT_Y + ACT_H / 2, bt.icon === 'redo');
    }

    if (solved) {
      frame({ x: BX, y: BY + BW / 2 - 85, w: BW, h: 170 });
      ctx.textAlign = 'center';
      ctx.fillStyle = p.user;
      ctx.font = font(700, 74);
      ctx.fillText('SOLVED', BX + BW / 2, BY + BW / 2 - 24);
      ctx.fillStyle = p.ui;
      ctx.font = mono(34);
      ctx.fillText(fmt(elapsed), BX + BW / 2, BY + BW / 2 + 46);
    }

    if (askTheme) drawThemeDialog(p);
    if (askRestart) drawRestartDialog(p);   // drawn last: it sits above everything
  }

  function drawThemeDialog(p) {
    var tm = themeDialog();
    frame(tm);

    ctx.textAlign = 'center';
    ctx.fillStyle = p.ui;
    ctx.font = font(700, 34);
    ctx.fillText('Appearance', tm.x + tm.w / 2, tm.y + 38);
    ctx.fillStyle = p.uiDim;
    ctx.font = font(500, 20);
    ctx.fillText('Changes only what YOU see. The token keeps the palette its seed dealt.',
      tm.x + tm.w / 2, tm.y + 66);

    // light / dark switch, applied within the current family
    var modes = [[tm.light, 'LIGHT', !tm.isDark], [tm.dark, 'DARK', tm.isDark]];
    for (var v = 0; v < 2; v++) {
      pill(modes[v][0], modes[v][2], true);
      centered(modes[v][0], modes[v][1], 21, modes[v][2] ? p.user : p.ui);
    }

    for (var m = 0; m < tm.items.length; m++) {
      var it = tm.items[m], q = PALETTES[it.index], active = it.index === paletteIndex;
      pill(it, active, true);

      // a real preview: that palette's own board, given and entered colors, at
      // whatever weights are currently in effect
      var sw = 62, sh = 36, sx = it.x + 13, sy = it.y + (it.h - sh) / 2;
      ctx.fillStyle = q.board;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = q.thick; ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.textAlign = 'center';
      ctx.font = font(boldGivens ? 700 : 600, 21);
      ctx.fillStyle = q.given;
      ctx.fillText('5', sx + sw * 0.3, sy + sh / 2 + 1);
      ctx.font = font(boldGivens ? 400 : 600, 21);
      ctx.fillStyle = q.user;
      ctx.fillText('7', sx + sw * 0.7, sy + sh / 2 + 1);

      ctx.textAlign = 'left';
      ctx.font = font(600, 20);
      ctx.fillStyle = active ? p.user : p.ui;
      var isDefault = it.index === defaultIndex;
      ctx.fillText(q.name, sx + sw + 13, it.y + it.h / 2 + (isDefault ? -9 : 1));
      if (isDefault) {
        ctx.font = font(500, 14);
        ctx.fillStyle = p.uiDim;
        ctx.fillText("THIS TOKEN'S DEFAULT", sx + sw + 13, it.y + it.h / 2 + 13);
      }
    }

    // weight toggle — a checkbox, because it reads as a setting not a choice
    var wb = tm.weight;
    pill(wb, boldGivens, true);
    var bx = wb.x + 18, by = wb.y + wb.h / 2 - 11;
    ctx.strokeStyle = p.ui; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, 22, 22);
    if (boldGivens) {
      ctx.strokeStyle = p.user; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + 12);
      ctx.lineTo(bx + 9, by + 17);
      ctx.lineTo(bx + 18, by + 5);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.font = font(600, 20);
    ctx.fillStyle = boldGivens ? p.user : p.ui;
    ctx.fillText('Tell givens apart by weight, not just color', bx + 36, wb.y + wb.h / 2 + 1);
    ctx.textAlign = 'center';
  }

  function drawRestartDialog(p) {
    var m = restartDialog();
    frame(m);
    ctx.textAlign = 'center';
    ctx.fillStyle = p.ui;
    ctx.font = font(700, 40);
    ctx.fillText('Are you sure?', m.x + m.w / 2, m.y + 56);
    ctx.fillStyle = p.uiDim;
    ctx.font = font(500, 22);
    ctx.fillText('This clears every entry and note. The puzzle stays the same.',
      m.x + m.w / 2, m.y + 98);
    pill(m.yes, true, false);
    centered(m.yes, m.yes.label, 22, p.user);
    pill(m.no, false, false);
    centered(m.no, m.no.label, 22, p.ui);
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    setup();
    recompute();
    draw();
    // A live self-check, not a trait: a value that reads 1 on every token can't
    // be filtered on.
    if (uniqueSolutions !== 1 && window.console && console.warn) {
      console.warn('[abxdoku] uniqueness check FAILED: ' + uniqueSolutions + ' solutions for seed ' + seedHex);
    }
    if (window.abx) {
      // Traits are cached metadata, so they must not state anything that expires.
      // A fixed token has one puzzle forever and can describe it. A rotating one
      // cannot: by tomorrow "Fiendish · 24 given" is simply false, and a stale trait
      // is worse than no trait because it reads as a fact. So the daily reports only
      // what holds of EVERY puzzle it will ever show. Today's difficulty and given
      // count are still on the board itself, drawn in the header, which is where a
      // player reads them and where nothing caches.
      abx.traits(day === null ? {
        Difficulty: difficulty,
        Givens: givenCount,
        Symmetry: symmetric ? 'Rotational' : 'Free',
        Palette: PALETTES[defaultIndex].name      // the seed's, not the viewer's
      } : {
        Rotation: 'Daily',
        Solutions: 'Exactly one',
        Program: 'On-chain'
      });
      abx.done();
    }
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
