// Pure, deterministic Ludo rules engine (no rendering, no randomness).
// The same sequence of roll(value)/move(token) calls yields the same state
// on every device, which is what keeps online games in sync.

import { SAFE_INDICES, PROGRESS_HOME, PROGRESS_LAST_TRACK, trackIndexFor } from './constants.js';

export class LudoGame {
  constructor(seats, state = null) {
    if (state) {
      this.s = structuredClone(state);
      return;
    }
    this.s = {
      seats: seats.slice(), // active player indices (0..3) in turn order
      tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]),
      turnPos: 0,
      dice: null,
      phase: 'roll', // 'roll' | 'move' | 'over'
      sixes: 0,
      legal: [],
      finished: [], // finishing order
      moves: 0,
    };
  }

  static from(state) { return new LudoGame(null, state); }
  toJSON() { return structuredClone(this.s); }

  get current() { return this.s.seats[this.s.turnPos]; }
  get phase() { return this.s.phase; }
  get tokens() { return this.s.tokens; }

  isFinished(p) { return this.s.tokens[p].every((t) => t === PROGRESS_HOME); }
  homeCount(p) { return this.s.tokens[p].filter((t) => t === PROGRESS_HOME).length; }

  legalMoves(p, v) {
    const out = [];
    this.s.tokens[p].forEach((prog, i) => {
      if (prog === PROGRESS_HOME) return;
      if (prog < 0) { if (v === 6) out.push(i); return; }
      if (prog + v <= PROGRESS_HOME) out.push(i);
    });
    return out;
  }

  // Where would token i of player p land with roll v
  target(p, i, v) {
    const prog = this.s.tokens[p][i];
    return prog < 0 ? 0 : prog + v;
  }

  // Tokens of other players sitting on track index idx
  occupantsAt(idx, exceptPlayer) {
    const out = [];
    for (const p of this.s.seats) {
      if (p === exceptPlayer) continue;
      this.s.tokens[p].forEach((prog, i) => {
        if (trackIndexFor(p, prog) === idx) out.push({ player: p, token: i });
      });
    }
    return out;
  }

  roll(value) {
    if (this.s.phase !== 'roll') throw new Error('Not time to roll');
    const p = this.current;
    this.s.dice = value;
    if (value === 6) this.s.sixes++;
    if (this.s.sixes >= 3) {
      this.s.legal = [];
      this._nextTurn();
      return { player: p, value, legal: [], forfeit: true, pass: true };
    }
    const legal = this.legalMoves(p, value);
    this.s.legal = legal;
    if (legal.length === 0) {
      if (value === 6) { this.s.phase = 'roll'; return { player: p, value, legal, pass: false, again: true }; }
      this._nextTurn();
      return { player: p, value, legal, pass: true };
    }
    this.s.phase = 'move';
    return { player: p, value, legal, pass: false };
  }

  move(token) {
    if (this.s.phase !== 'move') throw new Error('Not time to move');
    if (!this.s.legal.includes(token)) throw new Error('Illegal move');
    const p = this.current;
    const v = this.s.dice;
    const from = this.s.tokens[p][token];
    const to = this.target(p, token, v);
    const path = [];
    if (from < 0) path.push(0);
    else for (let k = from + 1; k <= to; k++) path.push(k);

    this.s.tokens[p][token] = to;
    this.s.moves++;

    const captures = [];
    if (to <= PROGRESS_LAST_TRACK) {
      const idx = trackIndexFor(p, to);
      if (!SAFE_INDICES.has(idx)) {
        for (const o of this.occupantsAt(idx, p)) {
          captures.push({ ...o, from: this.s.tokens[o.player][o.token] });
          this.s.tokens[o.player][o.token] = -1;
        }
      }
    }
    const home = to === PROGRESS_HOME;
    let won = false;
    if (this.isFinished(p) && !this.s.finished.includes(p)) {
      this.s.finished.push(p);
      won = true;
    }
    const remaining = this.s.seats.filter((q) => !this.s.finished.includes(q));
    let gameOver = false;
    if (remaining.length <= 1) {
      if (remaining.length === 1) this.s.finished.push(remaining[0]);
      this.s.phase = 'over';
      gameOver = true;
    }

    let extra = false;
    if (!gameOver) {
      extra = !won && (v === 6 || captures.length > 0 || home);
      if (extra) {
        if (v !== 6) this.s.sixes = 0;
        this.s.phase = 'roll';
      } else {
        this._nextTurn();
      }
    }
    this.s.legal = [];
    return { player: p, token, from, to, path, captures, home, won, extra, gameOver, value: v };
  }

  _nextTurn() {
    this.s.turn = (this.s.turn || 0) + 1; // increments once per hand-over
    this.s.sixes = 0;
    this.s.phase = 'roll';
    const n = this.s.seats.length;
    for (let k = 1; k <= n; k++) {
      const pos = (this.s.turnPos + k) % n;
      if (!this.s.finished.includes(this.s.seats[pos])) { this.s.turnPos = pos; return; }
    }
  }
}
