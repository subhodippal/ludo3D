// "Lucky dice": a drama director that nudges dice results toward exciting
// moments. Applied equally to every player (humans and computer). Only the
// authority (local game / online host) rolls, so online games stay in sync.
//
//  1. Stuck in the yard: if a player has no tokens out, they are guaranteed
//     a 6 within 3 turns (50% on the 2nd turn, 100% on the 3rd).
//  2. Capture chance: if some value would let the player cut an opponent,
//     there is a 75% chance the die shows one of those values.
//  3. Revenge: if an opponent's token comes near a player's start square while
//     that player still has tokens in the yard, 70% chance of a 6.
//  4. Homecoming: if an exact roll would bring a token home, 60% chance of it.
//
// All boosts only apply to the first roll of a turn. That keeps bonus rolls
// fair, so captures don't chain endlessly and the director never forces
// the "three sixes" penalty.

import { SAFE_INDICES, START_INDEX, PROGRESS_HOME, PROGRESS_LAST_TRACK, trackIndexFor } from './constants.js';

// Tuning knobs. captureCooldown = own turns without a capture boost after a
// boosted capture (stops endless cut-backs that make games drag).
export const LUCK = { stuckSecond: 0.5, capture: 0.75, revenge: 0.7, revengeRange: 6, captureCooldown: 2, home: 0.6 };

function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}
export function fairDie() {
  const a = new Uint8Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 252);
  return (a[0] % 6) + 1;
}
const pick = (list) => list[Math.floor(rand() * list.length)];

function allInYard(game, p) {
  const t = game.s.tokens[p];
  return t.some((x) => x < 0) && t.every((x) => x < 0 || x === PROGRESS_HOME);
}

// Dice values that would let player p capture an opponent this roll
export function captureValues(game, p) {
  const out = [];
  for (let v = 1; v <= 6; v++) {
    for (const k of game.legalMoves(p, v)) {
      const to = game.target(p, k, v);
      if (to > PROGRESS_LAST_TRACK) continue;
      const idx = trackIndexFor(p, to);
      if (!SAFE_INDICES.has(idx) && game.occupantsAt(idx, p).length) { out.push(v); break; }
    }
  }
  return out;
}

// Is an opponent token within range of p's start square (either side)?
function enemyNearStart(game, p) {
  const start = START_INDEX[p];
  for (const q of game.s.seats) {
    if (q === p) continue;
    for (const prog of game.s.tokens[q]) {
      const idx = trackIndexFor(q, prog);
      if (idx < 0) continue;
      const d = Math.min((idx - start + 52) % 52, (start - idx + 52) % 52);
      if (d >= 1 && d <= LUCK.revengeRange) return true;
    }
  }
  return false;
}

// luck: per-session state { dry: [n,n,n,n], turn } (dry = turns stuck in the yard)
export function luckyRoll(game, p, luck) {
  // first roll of this player's turn (bonus rolls after a 6/capture/home don't count)
  const turn = game.s.turn || 0;
  const firstRoll = luck.turn !== turn;
  luck.turn = turn;
  const stuck = allInYard(game, p);
  let v = null;

  // 2. capture opportunity
  // (first roll of a turn only, so bonus rolls don't chain capture after capture)
  luck.cool ||= [0, 0, 0, 0];
  if (firstRoll && luck.cool[p] > 0) luck.cool[p]--;
  else if (firstRoll) {
    const caps = captureValues(game, p);
    if (caps.length && rand() < LUCK.capture) { v = pick(caps); luck.cool[p] = LUCK.captureCooldown; }
  }

  // 4. exact roll to bring a token home (speeds up the slow endgame)
  if (v === null && firstRoll) {
    const homes = [];
    for (let x = 1; x <= 6; x++) {
      if (game.legalMoves(p, x).some((k) => game.target(p, k, x) === PROGRESS_HOME)) homes.push(x);
    }
    if (homes.length && rand() < LUCK.home) v = pick(homes);
  }

  // 1. stuck in yard pity timer
  if (v === null && stuck && firstRoll) {
    const dry = luck.dry[p] || 0;
    if (dry >= 2 || (dry === 1 && rand() < LUCK.stuckSecond)) v = 6;
  }

  // 3. revenge six
  if (v === null && firstRoll && game.s.tokens[p].some((x) => x < 0) && enemyNearStart(game, p) && rand() < LUCK.revenge) v = 6;

  if (v === null) v = fairDie();

  // update pity counter (counts turns, so only on the first roll of a turn)
  if (v === 6) luck.dry[p] = 0;
  else if (stuck && firstRoll) luck.dry[p] = (luck.dry[p] || 0) + 1;
  return v;
}
