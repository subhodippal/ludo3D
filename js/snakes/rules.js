// Snakes & Ladders: board layouts (3 fixed + random generator) and a pure,
// deterministic rules engine. No rendering and no randomness in the engine:
// the controller supplies each dice value.

export const LAST = 100;

// ---------------------------------------------------------------- geometry
// Cells 1..100 snake back and forth from the bottom-left corner.
// Returns grid col (0..9, left→right) and row (0..9, bottom→top).
export function cellGrid(n) {
  const i = n - 1;
  const row = Math.floor(i / 10);
  const k = i % 10;
  return { col: row % 2 === 0 ? k : 9 - k, row };
}
// world x/z of a cell centre (row 0 is nearest the camera at +z)
export function cellXZ(n) {
  const { col, row } = cellGrid(n);
  return { x: col - 4.5, z: 4.5 - row };
}

// ---------------------------------------------------------------- layouts
// snakes: [head, tail], ladders: [bottom, top]
export const LAYOUTS = {
  easy: {
    name: 'Easy',
    ladders: [[3, 22], [8, 30], [17, 45], [28, 55], [36, 57], [51, 72], [63, 85], [71, 91], [80, 99]],
    snakes: [[32, 12], [48, 26], [62, 43], [88, 67], [95, 76]],
  },
  medium: {
    name: 'Medium',
    ladders: [[4, 25], [13, 46], [33, 49], [42, 63], [50, 69], [62, 81], [74, 92]],
    snakes: [[27, 5], [40, 3], [43, 18], [54, 31], [66, 45], [89, 53], [93, 70], [97, 78]],
  },
  hard: {
    name: 'Hard',
    ladders: [[6, 27], [20, 39], [38, 59], [52, 73], [67, 86]],
    snakes: [[17, 4], [34, 12], [47, 19], [56, 24], [64, 36], [72, 51], [79, 42], [87, 57], [91, 61], [94, 75], [98, 63]],
  },
};

export function validLayout({ snakes, ladders }) {
  const used = new Set();
  const take = (n) => {
    if (n < 2 || n > 99 || used.has(n)) return false;
    used.add(n);
    return true;
  };
  for (const [h, t] of snakes) {
    if (!(h > t) || !take(h) || !take(t)) return false;
    if (cellGrid(h).row === cellGrid(t).row) return false;
  }
  for (const [b, t] of ladders) {
    if (!(t > b) || !take(b) || !take(t)) return false;
    if (cellGrid(b).row === cellGrid(t).row) return false;
  }
  // never six snake heads in a row (the board must always be finishable)
  const heads = new Set(snakes.map((s) => s[0]));
  for (let n = 2; n <= 94; n++) {
    let run = 0;
    while (run < 6 && heads.has(n + run)) run++;
    if (run === 6) return false;
  }
  return true;
}

// do two snakes (or two ladders) cross each other on the board?
function crosses([a, b], [c, d]) {
  const P = (n) => { const { col, row } = cellGrid(n); return [col, row]; };
  const [p1, p2, p3, p4] = [P(a), P(b), P(c), P(d)];
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;
  if (near(p1, p3) || near(p1, p4) || near(p2, p3) || near(p2, p4)) return true;
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}

// Random but fair-ish board: 6–9 snakes and 6–9 ladders spread over the rows
export function randomLayout(rnd = Math.random) {
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  for (let attempt = 0; attempt < 500; attempt++) {
    const used = new Set();
    const snakes = [];
    const ladders = [];
    const nS = ri(6, 9);
    const nL = ri(6, 9);
    const free = (n) => n >= 2 && n <= 99 && !used.has(n);
    let guard = 0;
    while ((snakes.length < nS || ladders.length < nL) && guard++ < 400) {
      const snake = snakes.length < nS && (ladders.length >= nL || rnd() < 0.5);
      const rows = ri(1, snake ? 5 : 4);
      const lo = ri(2, 99 - rows * 10);
      const hi = Math.min(99, lo + rows * 10 + ri(-4, 4));
      if (hi <= lo || !free(lo) || !free(hi) || cellGrid(lo).row === cellGrid(hi).row) continue;
      if (Math.abs(cellGrid(lo).col - cellGrid(hi).col) > 4) continue; // keep them tidy, no board-wide diagonals
      const seg = [lo, hi];
      if ((snake ? snakes : ladders).some((o) => crosses(o, seg))) continue;
      used.add(lo); used.add(hi);
      if (snake) snakes.push([hi, lo]); else ladders.push([lo, hi]);
    }
    const layout = { name: 'Random', snakes, ladders };
    if (snakes.length === nS && ladders.length === nL && validLayout(layout)) return layout;
  }
  return { ...structuredClone(LAYOUTS.medium), name: 'Random' };
}

export function layoutFor(kind) {
  return kind === 'random' ? randomLayout() : structuredClone(LAYOUTS[kind] || LAYOUTS.medium);
}

// ---------------------------------------------------------------- engine
export class SnakesGame {
  constructor(seats, layout, opts = {}, state = null) {
    if (state) { this.s = structuredClone(state); return; }
    this.s = {
      seats: seats.slice(),
      pos: [0, 0, 0, 0], // 0 = waiting on the start pad
      turnPos: 0,
      dice: null,
      phase: 'roll', // 'roll' | 'over'
      sixes: 0,
      winner: -1,
      moves: 0,
      layout: structuredClone(layout),
      opts: { bounce: !!opts.bounce, needSix: !!opts.needSix },
      stats: [0, 1, 2, 3].map(() => ({ ladders: 0, snakes: 0 })),
    };
  }

  static from(state) { return new SnakesGame(null, null, null, state); }
  toJSON() { return structuredClone(this.s); }

  get current() { return this.s.seats[this.s.turnPos]; }
  get phase() { return this.s.phase; }

  jumpAt(n) {
    const L = this.s.layout;
    const li = L.ladders.findIndex((l) => l[0] === n);
    if (li >= 0) return { kind: 'ladder', index: li, from: n, to: L.ladders[li][1] };
    const si = L.snakes.findIndex((s) => s[0] === n);
    if (si >= 0) return { kind: 'snake', index: si, from: n, to: L.snakes[si][1] };
    return null;
  }

  // Apply one dice roll for the current player.
  roll(v) {
    const s = this.s;
    if (s.phase !== 'roll') throw new Error('not rolling');
    const p = this.current;
    const from = s.pos[p];
    s.dice = v;
    s.moves++;
    s.sixes = v === 6 ? s.sixes + 1 : 0;
    const res = { player: p, v, from, path: [], landed: from, jump: null, to: from, again: false, forfeit: false, overshoot: false, needSix: false, bounced: false, won: false };

    if (s.sixes >= 3) {
      res.forfeit = true;
      s.sixes = 0;
      this._next();
      return res;
    }
    if (from === 0 && s.opts.needSix && v !== 6) {
      res.needSix = true;
      this._next();
      return res;
    }

    let target = from + v;
    if (target > LAST) {
      if (!s.opts.bounce) {
        res.overshoot = true;
        this._next();
        return res;
      }
      res.bounced = true;
      for (let n = from + 1; n <= LAST; n++) res.path.push(n);
      target = LAST - (target - LAST);
      for (let n = LAST - 1; n >= target; n--) res.path.push(n);
    } else {
      for (let n = from + 1; n <= target; n++) res.path.push(n);
    }
    res.landed = target;
    const jump = this.jumpAt(target);
    if (jump) {
      res.jump = jump;
      target = jump.to;
      s.stats[p][jump.kind === 'ladder' ? 'ladders' : 'snakes']++;
    }
    res.to = target;
    s.pos[p] = target;

    if (target === LAST) {
      res.won = true;
      s.winner = p;
      s.phase = 'over';
      return res;
    }
    if (v === 6) { res.again = true; return res; }
    this._next();
    return res;
  }

  _next() {
    this.s.sixes = 0;
    this.s.turnPos = (this.s.turnPos + 1) % this.s.seats.length;
  }

  // winner first, then everyone else by how far they got
  ranking() {
    const s = this.s;
    return s.seats.slice().sort((a, b) => (b === s.winner) - (a === s.winner) || s.pos[b] - s.pos[a]);
  }
}
