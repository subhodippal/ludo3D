// Heuristic computer opponent
import { SAFE_INDICES, PROGRESS_HOME, PROGRESS_LAST_TRACK, trackIndexFor } from './constants.js';

// How many opponent tokens could hit track index idx next turn
function threatAt(game, p, idx) {
  if (idx < 0 || SAFE_INDICES.has(idx)) return 0;
  let threat = 0;
  for (const q of game.s.seats) {
    if (q === p) continue;
    game.s.tokens[q].forEach((prog) => {
      if (prog < 0 || prog > PROGRESS_LAST_TRACK) return;
      const qi = trackIndexFor(q, prog);
      const d = (idx - qi + 52) % 52;
      if (d >= 1 && d <= 6 && prog + d <= PROGRESS_LAST_TRACK) threat += d === 6 ? 0.6 : 1;
    });
  }
  return threat;
}

export function chooseMove(game, p, v, level = 'normal') {
  const legal = game.s.legal;
  if (legal.length === 1) return legal[0];
  if (level === 'easy' && Math.random() < 0.45) return legal[Math.floor(Math.random() * legal.length)];

  let best = legal[0];
  let bestScore = -Infinity;
  for (const t of legal) {
    const from = game.s.tokens[p][t];
    const to = game.target(p, t, v);
    let score = 0;
    const toIdx = trackIndexFor(p, to);
    const fromIdx = trackIndexFor(p, from);

    if (from < 0) score += 55; // leave yard
    if (to === PROGRESS_HOME) score += 70;
    else if (to > PROGRESS_LAST_TRACK) score += 32; // safe in home column

    if (toIdx >= 0 && !SAFE_INDICES.has(toIdx)) {
      const victims = game.occupantsAt(toIdx, p);
      for (const vctm of victims) score += 80 + game.s.tokens[vctm.player][vctm.token] * 1.2;
    }
    if (toIdx >= 0 && SAFE_INDICES.has(toIdx)) score += 18;

    const dangerNow = threatAt(game, p, fromIdx);
    const dangerNext = threatAt(game, p, toIdx);
    score += dangerNow * (12 + from * 0.5); // escaping danger, more valuable for advanced tokens
    score -= dangerNext * (14 + to * 0.45);

    score += to * 0.35; // general progress
    if (level !== 'hard') score += Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}
