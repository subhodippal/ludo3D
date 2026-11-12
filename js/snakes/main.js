// Snakes & Ladders game controller: menus, turns, HUD, celebrations, saving,
// and online play (rooms with friends, matchmaking, reconnects).

import { SnakesScene, SNAKE_CSS } from './scene.js';
import { SnakesGame, LAYOUTS, layoutFor, randomLayout, cellGrid, LAST } from './rules.js';
import { sfx } from '../audio.js';
import { wait, flushTweens } from '../anim.js';
import { COLORS, COLOR_CSS, COLOR_NAME } from '../constants.js';
import * as bgfx from '../bgfx.js';
import { fairDie } from '../luck.js';
import { initViewControls, initOrientationSetting } from '../viewctl.js';
import { HostNet, ClientNet, scanRooms, matchCode, isMatchCode, MATCH_SLOTS, setGame } from '../net.js';

setGame('snakes3d-v1-'); // separate rooms from Ludo

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'snakes3d.settings';
const SAVE_KEY = 'snakes3d.save';
const NAME_KEY = 'ludo3d.name'; // shared with Ludo
function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function load(k) { try { return safeJSON(localStorage.getItem(k)); } catch { return null; } }
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
function drop(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
const ONLINE_KEY = 'snakes3d.online'; // the room we're in, so a reload can rejoin it
// stable per-device id (shared with Ludo) so a reconnecting player gets their seat back
const PID = (() => {
  let id = load('ludo3d.pid');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); store('ludo3d.pid', id); }
  return id;
})();
const settings = Object.assign(
  { sound: true, vibrate: true, needSix: false, bounce: false, fast: false, hq: !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (window.devicePixelRatio || 1) <= 2 },
  load(SETTINGS_KEY) || {},
);
function applySettings() {
  sfx.enabled = settings.sound;
  sfx.vibrate = settings.vibrate;
  $('#btnSound').classList.toggle('muted', !settings.sound);
  store(SETTINGS_KEY, settings);
}

const view = new SnakesScene($('#c'), { quality: settings.hq ? 'high' : 'low' });
applySettings();

// ---------------------------------------------------------------- screens
let screenStack = [];
function show(id, push = false) {
  $$('.screen').forEach((s) => s.classList.add('hidden'));
  if (id) $(id).classList.remove('hidden');
  if (push) screenStack.push(id); else screenStack = id ? [id] : [];
}
function back() {
  screenStack.pop();
  const prev = screenStack[screenStack.length - 1];
  $$('.screen').forEach((s) => s.classList.add('hidden'));
  if (prev) $(prev).classList.remove('hidden');
  else if (session) resume();
}
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { sfx.click(); back(); }));
document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

function toast(text, color = null, dur = 1.8) {
  const el = document.createElement('div');
  el.className = 'msg';
  el.textContent = text;
  if (color) el.style.setProperty('--c', color);
  el.style.setProperty('--d', dur + 's');
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), dur * 1000 + 400);
  while ($('#toast').children.length > 3) $('#toast').firstChild.remove();
}

initViewControls(view, { toast, onClick: () => sfx.click() });
initOrientationSetting({ toast, onClick: () => sfx.click() });

// ---------------------------------------------------------------- session
/** @type {null | {mode:'local'|'host'|'client', players:any[], board:string, game:SnakesGame, mySeats:Set<number>, busy:boolean, net?:any, seq:number, rx:number, queue:number[], paused?:boolean, over?:boolean, timer?:any}} */
let session = null;
const pname = (p) => session.players[p]?.name || COLOR_NAME[COLORS[p]];
const pcss = (p) => COLOR_CSS[COLORS[p]];

function newGameState(players, board, layout = null) {
  const seats = players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0);
  return new SnakesGame(seats, layout || layoutFor(board), { bounce: settings.bounce, needSix: settings.needSix }).toJSON();
}

function startSession({ mode = 'local', players, board, layout = null, state = null, net = null, mySeat = null, seq = 0 }) {
  clearTimeout(session?.timer);
  const game = SnakesGame.from(state || newGameState(players, board, layout));
  const mySeats = mode === 'local' ? new Set(game.s.seats.filter((p) => players[p].type === 'human')) : new Set([mySeat]);
  // seq numbers every roll the host sends, so clients can spot gaps/repeats after a reconnect
  session = { mode, players, board, game, mySeats, busy: false, over: false, net, seq, rx: seq, queue: [] };
  view.controls.autoRotate = false;
  view.setLayout(game.s.layout);
  view.setPlayers(game.s.seats);
  view.layout(game, 0);
  view.setView(true);
  buildChips();
  const room = !net?.code ? '' : isMatchCode(net.code) ? ' · ONLINE' : ` · ${net.code}`;
  $('#boardTag').textContent = `${game.s.layout.name.toUpperCase()} BOARD${room}`;
  $('#btnRestart').classList.toggle('hidden', mode === 'client');
  $('#hud').classList.remove('hidden');
  show(null);
  bgfx.ambient(null); // no idle background fireworks: keeps the game light
  randomBackdrop();
  view.ripple(1, 0x7c4dff, 1.2);
  requestWakeLock();
  save();
  saveOnline();
  setTimeout(() => afterIdle(), 900);
}

function save() {
  if (!session || session.mode !== 'local') return;
  if (session.game.phase === 'over') { drop(SAVE_KEY); return; }
  store(SAVE_KEY, { players: session.players, board: session.board, state: session.game.toJSON() });
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session.net?.close();
  session = null;
  view.setTurn(-1);
  view.dice.setInvite(false);
  $('#hud').classList.add('hidden');
  releaseWakeLock();
  attract();
}

// ---------------------------------------------------------------- turns
// Local games and the online host roll here; the host shares each value.
async function doRoll(forced) {
  const s = session;
  if (!s || s.mode === 'client' || s.busy || s.over || s.game.phase !== 'roll') return;
  s.busy = true;
  s.pendingRoll = null;
  clearTimeout(s.timer);
  hideControls();
  const v = forced >= 1 && forced <= 6 ? forced : fairDie();
  if (s.mode === 'host') { s.seq++; s.net.broadcast({ t: 'act', v, seq: s.seq }); }
  try {
    await playTurn(v);
  } catch (err) {
    console.error(err);
  }
  if (session !== s) return;
  s.busy = false;
  if (s.mode === 'host') saveOnline();
  // a remote player tapped while we were still animating
  if (s.pendingRoll === s.game.current && s.game.phase === 'roll') { doRoll(); return; }
  afterIdle();
}

// Online player: replay the host's rolls in order.
async function pumpClient() {
  const s = session;
  if (!s || s.busy) return;
  s.busy = true;
  try {
    while (s.queue.length && session === s) {
      hideControls();
      await playTurn(s.queue.shift());
    }
  } catch (err) {
    console.error(err);
    s.net?.send({ t: 'resync' });
  }
  if (session !== s) return;
  s.busy = false;
  afterIdle();
}

async function playTurn(v) {
  const s = session;
  const g = s.game;
  const p = g.current;
  const css = pcss(p);
  const fast = settings.fast && s.players[p].type === 'ai' && s.mode === 'local';
  const res = g.roll(v);
  setChipDie(p, 'rolling');
  await view.rollDice(v, p);
  setChipDie(p, 'value', v);
  if (session !== s) return;

  if (res.forfeit) {
    toast(`${pname(p)} rolled three 6s — turn lost!`, css);
    sfx.error();
    view.nope(p);
    await wait(1100);
  } else if (res.needSix) {
    toast(`${pname(p)} needs a 6 to start`, css, 1.3);
    view.nope(p);
    await wait(750);
  } else if (res.overshoot) {
    const need = LAST - res.from;
    toast(`So close! ${pname(p)} needs exactly ${need}`, css, 1.6);
    sfx.error();
    view.nope(p);
    await wait(900);
  } else {
    if (v === 6 && !res.won) {
      sfx.six();
      celebrate('six', p);
    }
    await view.animateMove(g, res, { fast });
    if (session !== s) return;
    const j = res.jump;
    if (j?.kind === 'ladder') {
      const climb = j.to - j.from;
      celebrate('ladder', p, `${pname(p)} climbed ${j.from} → ${j.to}`, climb >= 30 ? 3 : 2);
    } else if (j?.kind === 'snake') {
      celebrate('snake', p, `${pname(p)} slid ${j.from} → ${j.to}`, 0, SNAKE_CSS[j.index % SNAKE_CSS.length]);
    } else if (res.bounced) toast('Boing! Bounced back from 100', css, 1.4);
    updateChips();
    save();
    if (res.won) { await winner(p); return; }
    if (res.again) { toast(`${pname(p)} rolls again!`, css, 1.1); await wait(300); }
    await wait(j ? 450 : 120);
  }
  updateChips();
  save();
}

function hideControls() {
  $$('.chip .die.ready').forEach((d) => d.classList.remove('ready'));
  $('#hint').textContent = '';
  view.dice.setInvite(false);
}

function afterIdle() {
  const s = session;
  if (!s || s.busy || s.over) return;
  const g = s.game;
  if (g.phase === 'over') { gameOver(); return; }
  const p = g.current;
  const pl = s.players[p];
  view.setTurn(p);
  setTurnGlow(pcss(p));
  updateChips();
  const mine = s.mySeats.has(p) && pl.type !== 'ai';
  clearTimeout(s.timer);
  if (mine && !s.paused) {
    setChipDie(p, 'ready');
    view.dice.setInvite(true, parseInt(pcss(p).slice(1), 16));
    $('#hint').textContent = s.mySeats.size > 1 ? `${pname(p)}: tap to roll 🎲` : 'Tap your dice 🎲';
  } else {
    hideControls();
    setChipDie(p, 'idle');
    $('#hint').textContent = pl.type === 'ai' ? `${pname(p)} is rolling…` : pl.away ? `${pname(p)} is reconnecting…` : `Waiting for ${pname(p)}…`;
    if (s.paused || s.mode === 'client') return;
    // computers roll; a player whose connection dropped is covered after a long wait
    if (pl.type === 'ai') s.timer = setTimeout(() => doRoll(), settings.fast && s.mode === 'local' ? 300 : 750);
    else if (pl.type === 'remote' && pl.away) s.timer = setTimeout(() => doRoll(), 12000);
  }
}

function humanRoll() {
  const s = session;
  if (!s || s.busy || s.paused || s.over) return;
  const p = s.game.current;
  if (!s.mySeats.has(p) || s.players[p].type === 'ai' || s.game.phase !== 'roll') return;
  sfx.click();
  if (s.mode === 'client') { s.net.send({ t: 'intent' }); hideControls(); return; }
  doRoll();
}
$('#chips').addEventListener('click', (e) => { if (e.target.closest('.die.ready')) humanRoll(); });
view.onDicePick = humanRoll;
view.onBoardTap = humanRoll;
document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && session && !e.target.closest('input')) { e.preventDefault(); humanRoll(); }
  if (e.code === 'Escape' && session) pause();
});

// ---------------------------------------------------------------- chips
const CORNERS = ['bl', 'br', 'tl', 'tr'];
function buildChips() {
  const wrap = $('#chips');
  wrap.innerHTML = '';
  if (!session) return;
  session.game.s.seats.forEach((p, i) => {
    const pl = session.players[p];
    const el = document.createElement('div');
    el.className = 'chip ' + CORNERS[i];
    el.dataset.p = p;
    el.style.setProperty('--c', pcss(p));
    const icon = pl.type === 'ai' ? '🤖' : session.mode !== 'local' && !session.mySeats.has(p) ? '🌐' : '🙂';
    el.classList.toggle('away', !!pl.away);
    el.innerHTML = `<div class="avatar">${icon}</div><div class="info"><div class="name"></div><div class="sq"></div><div class="bar"><i></i></div></div><button class="die" aria-label="Roll dice"><span class="face">${'<i></i>'.repeat(9)}</span></button>`;
    el.querySelector('.name').textContent = pname(p);
    paintDie(el.querySelector('.die'), session.game.s.dice || 5);
    wrap.appendChild(el);
  });
  updateChips();
}

function updateChips() {
  if (!session) return;
  const g = session.game;
  const best = Math.max(...g.s.seats.map((p) => g.s.pos[p]));
  $$('.chip').forEach((el) => {
    const p = Number(el.dataset.p);
    const pos = g.s.pos[p];
    el.classList.toggle('active', p === g.current && g.phase !== 'over');
    el.classList.toggle('leader', pos > 0 && pos === best);
    el.querySelector('.sq').innerHTML = pos === 0 ? 'On start' : `Square <b>${pos}</b>`;
    el.querySelector('.bar i').style.width = `${pos}%`;
  });
}

const PIP_LAYOUT = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function paintDie(el, v) {
  el.querySelectorAll('.face i').forEach((i, k) => i.classList.toggle('on', PIP_LAYOUT[v].includes(k)));
}
function setChipDie(p, state, v) {
  const el = $(`.chip[data-p="${p}"] .die`);
  if (!el) return;
  clearInterval(el._spin);
  el.classList.remove('ready', 'rolling', 'value');
  if (state === 'ready') el.classList.add('ready');
  if (state === 'rolling') {
    el.classList.add('rolling');
    el._spin = setInterval(() => paintDie(el, 1 + Math.floor(Math.random() * 6)), 90);
  }
  if (state === 'value') {
    paintDie(el, v);
    el.classList.add('value');
    el.classList.toggle('six', v === 6);
  }
}

// ---------------------------------------------------------------- celebrations
const CELEBRATE = {
  six: { title: 'SIX!', sub: 'Roll again', emoji: ['🎲', '✨', '⭐', '🌟'], n: 10, small: true },
  ladder: { title: 'LADDER!', emoji: ['🪜', '🚀', '⬆️', '✨', '🌟', '🎉'], n: 16 },
  snake: { title: 'SSSNAKE!', emoji: ['🐍', '😱', '💀', '😵', '🐍'], n: 16 },
  win: { title: 'WINNER!', emoji: ['🏆', '👑', '🎉', '🎊', '⭐', '🥳'], n: 26 },
};
function celebrate(kind, p, sub, level = 1, colorOverride = null) {
  const c = CELEBRATE[kind];
  const fx = $('#fx');
  const css = colorOverride || pcss(p);
  const box = document.createElement('div');
  box.className = `cele cele-${kind}${c.small ? ' small' : ''}`;
  box.style.setProperty('--c', css);
  box.innerHTML = '<div class="title"></div><div class="sub"></div>';
  box.querySelector('.title').textContent = c.title;
  box.querySelector('.sub').textContent = sub ?? c.sub ?? '';
  fx.appendChild(box);
  const flat = view.mode === '2d'; // 2D view: banner text only, no effects
  for (let i = 0; i < (flat ? 0 : c.n); i++) {
    const e = document.createElement('span');
    e.className = 'fly';
    e.textContent = c.emoji[i % c.emoji.length];
    const a = (i / c.n) * Math.PI * 2 + Math.random() * 0.5;
    const d = 90 + Math.random() * (c.small ? 60 : 150);
    e.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    e.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
    e.style.setProperty('--r', `${(Math.random() - 0.5) * 120}deg`);
    e.style.setProperty('--s', `${0.8 + Math.random() * 0.8}`);
    e.style.animationDelay = `${Math.random() * 0.12}s`;
    box.appendChild(e);
  }
  if (kind === 'snake') {
    const v = document.createElement('div');
    v.className = 'vignette';
    v.style.setProperty('--c', css);
    fx.appendChild(v);
    setTimeout(() => v.remove(), 1200);
    if (!flat) bgfx.flash(css);
    view.shake(0.5);
  } else {
    if (!flat) bgfx.party(pcss(p), level || 1);
    if (kind === 'ladder') sfx.cheer();
  }
  setTimeout(() => box.remove(), 1900);
  while (fx.querySelectorAll('.cele').length > 2) fx.querySelector('.cele').remove();
}

async function winner(p) {
  const s = session;
  hideControls();
  celebrate('win', p, `${pname(p)} reached 100!`, 4);
  sfx.win();
  if (view.mode !== '2d') {
    view.fx.confetti(160, 10);
    await view.winDance(p);
  }
  if (session !== s) return;
  gameOver();
}

function gameOver() {
  const s = session;
  if (!s || s.over) return;
  s.over = true;
  clearTimeout(s.timer);
  hideControls();
  view.setTurn(-1);
  drop(SAVE_KEY);
  const g = s.game;
  const w = g.s.winner;
  setTurnGlow(pcss(w));
  const anyHuman = s.mySeats.size > 0;
  $('#overTitle').textContent = s.mySeats.size > 1 || !anyHuman ? `${pname(w)} wins!` : s.mySeats.has(w) ? 'You win! 🎉' : `${pname(w)} wins`;
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  $('#ranking').innerHTML = '';
  g.ranking().forEach((p, i) => {
    const li = document.createElement('li');
    const st = g.s.stats[p];
    li.innerHTML = `<span class="medal">${medals[i]}</span><span class="dot" style="--c:${pcss(p)}"></span><span class="nm"></span><span class="muted rk-stats">🪜${st.ladders} 🐍${st.snakes} · ${g.s.pos[p]}</span>`;
    li.querySelector('.nm').textContent = pname(p);
    $('#ranking').appendChild(li);
  });
  const wcss = pcss(w);
  if (view.mode !== '2d') {
    setTimeout(() => bgfx.confettiRain(wcss, 120), 1500);
    setTimeout(() => bgfx.launch(wcss, 6, 1.1), 2600);
  }
  $('#btnAgain').textContent = s.mode === 'client' ? 'Waiting for host…' : 'Play again';
  $('#btnAgain').disabled = s.mode === 'client';
  $('#btnNewBoard').classList.toggle('hidden', s.mode === 'client');
  setTimeout(() => { if (session === s) show('#scrOver'); }, 900);
}

// local: restart straight away; online host: start everyone on the new game
function newGame(board, layout) {
  const s = session;
  if (!s || s.mode === 'client') return;
  if (s.mode === 'local') { startSession({ players: s.players, board, layout }); return; }
  const state = newGameState(s.players, board, layout);
  s.net.broadcast({ t: 'start', players: publicPlayers(s.players), board, state, seq: 0 });
  const net = s.net;
  s.net = null; // keep the connection while replacing the session
  startSession({ mode: 'host', players: s.players, board, net, mySeat: [...s.mySeats][0], state, seq: 0 });
}
$('#btnAgain').addEventListener('click', () => {
  sfx.click();
  // same board again (a random board keeps its layout); "New random board" shuffles
  if (session) newGame(session.board, session.game.s.layout);
});
$('#btnNewBoard').addEventListener('click', () => {
  sfx.click();
  if (session) newGame('random', randomLayout());
});
$('#btnOverMenu').addEventListener('click', () => { sfx.click(); leaveOnline(); endSession(); show('#scrMenu'); refreshMenu(); });

// ---------------------------------------------------------------- pause
function pause() {
  if (!session) return;
  sfx.click();
  if (session.mode === 'local') { session.paused = true; clearTimeout(session.timer); }
  $('#scrPause h2').textContent = session.mode === 'local' ? 'Paused' : 'Menu';
  show('#scrPause', false);
}
function resume() {
  show(null);
  if (!session) return;
  session.paused = false;
  afterIdle();
}
$('#btnPause').addEventListener('click', pause);
$('#btnResume').addEventListener('click', () => { sfx.click(); resume(); });
$('#btnRestart').addEventListener('click', () => {
  sfx.click();
  if (!session || !confirm('Restart this game?')) return;
  newGame(session.board, session.game.s.layout);
});
$('#btnQuit').addEventListener('click', () => {
  sfx.click();
  if (session && session.mode !== 'local' && !confirm('Leave the online game?')) return;
  leaveOnline();
  endSession();
  show('#scrMenu');
  refreshMenu();
});
$('#btnPauseSettings').addEventListener('click', () => openSettings());
$('#btnSound').addEventListener('click', () => { settings.sound = !settings.sound; applySettings(); sfx.click(); });

function openSettings() {
  $$('[data-set]').forEach((inp) => { inp.checked = !!settings[inp.dataset.set]; });
  show('#scrSettings', true);
}
$$('[data-set]').forEach((inp) => inp.addEventListener('change', () => {
  settings[inp.dataset.set] = inp.checked;
  applySettings();
  sfx.click();
}));
$('#btnSettings').addEventListener('click', () => { sfx.click(); openSettings(); });
$('#btnHelp').addEventListener('click', () => { sfx.click(); show('#scrHelp', true); });

// ---------------------------------------------------------------- setup
let setup = null; // { players, board, layout }

function seatRow(p, cfg, onChange) {
  const row = document.createElement('div');
  row.className = 'seat' + (cfg.type === 'off' ? ' off' : '');
  row.style.setProperty('--c', pcss(p));
  row.innerHTML = '<span class="dot"></span>';
  const inp = document.createElement('input');
  inp.maxLength = 14;
  inp.value = cfg.name;
  inp.placeholder = COLOR_NAME[COLORS[p]];
  inp.addEventListener('input', () => { cfg.name = inp.value.trim(); });
  row.appendChild(inp);
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [o, label] of [['human', 'Human'], ['ai', 'CPU'], ['off', 'Off']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('on', cfg.type === o);
    b.addEventListener('click', () => { sfx.click(); onChange(o); });
    seg.appendChild(b);
  }
  row.appendChild(seg);
  return row;
}

function renderSetup() {
  const wrap = $('#seatRows');
  wrap.innerHTML = '';
  setup.players.forEach((cfg, p) => {
    wrap.appendChild(seatRow(p, cfg, (type) => {
      cfg.type = type;
      if (type === 'ai' && (!cfg.name || cfg.name === 'You')) cfg.name = `CPU ${COLOR_NAME[COLORS[p]]}`;
      if (type === 'human' && cfg.name.startsWith('CPU')) cfg.name = COLOR_NAME[COLORS[p]];
      renderSetup();
    }));
  });
  $$('#segBoard button').forEach((b) => b.classList.toggle('on', b.dataset.v === setup.board));
  $('#btnShuffle').classList.toggle('hidden', setup.board !== 'random');
  const L = setup.layout;
  const blurb = { easy: 'Lots of ladders, short snakes.', medium: 'A balanced classic.', hard: 'Long snakes everywhere!', random: 'A brand-new board.' }[setup.board];
  $('#previewStats').innerHTML = `<b>${L.ladders.length}</b> ladders · <b>${L.snakes.length}</b> snakes<br>${blurb}`;
  drawPreview($('#preview'), L);
  $('#setupErr').textContent = '';
}

$$('#segBoard button').forEach((b) => b.addEventListener('click', () => {
  sfx.click();
  setup.board = b.dataset.v;
  setup.layout = layoutFor(setup.board);
  renderSetup();
  previewOnBoard();
}));
$('#btnShuffle').addEventListener('click', () => {
  sfx.diceShake();
  setup.layout = randomLayout();
  renderSetup();
  previewOnBoard();
});
// show the chosen board in 3D behind the setup card
function previewOnBoard() {
  view.setLayout(setup.layout);
  view.ripple(1, 0x7c4dff, 1);
}

function openSetup(kind) {
  const myName = load(NAME_KEY) || '';
  const prevBoard = load(SETTINGS_KEY)?.lastBoard || 'medium';
  if (kind === 'cpu') {
    $('#setupTitle').textContent = 'Single Player';
    setup = { players: COLORS.map((c, p) => (p === 0 ? { type: 'human', name: myName || 'You' } : p < 2 ? { type: 'ai', name: `CPU ${COLOR_NAME[c]}` } : { type: 'off', name: COLOR_NAME[c] })) };
  } else {
    $('#setupTitle').textContent = 'Group Play';
    setup = { players: COLORS.map((c, p) => ({ type: p < 2 ? 'human' : 'off', name: COLOR_NAME[c] })) };
  }
  setup.board = prevBoard;
  setup.layout = layoutFor(prevBoard);
  renderSetup();
  previewOnBoard();
  show('#scrSetup', true);
}
$('#btnVsCpu').addEventListener('click', () => { sfx.click(); openSetup('cpu'); });
$('#btnLocal').addEventListener('click', () => { sfx.click(); openSetup('local'); });
$('#btnStart').addEventListener('click', () => {
  sfx.click();
  const players = setup.players.map((p, i) => ({ type: p.type, name: p.name || COLOR_NAME[COLORS[i]] }));
  if (players.filter((p) => p.type !== 'off').length < 2) { $('#setupErr').textContent = 'Need at least 2 players.'; sfx.error(); return; }
  const me = players.find((p) => p.type === 'human');
  if (me && me.name !== 'You') store(NAME_KEY, me.name);
  settings.lastBoard = setup.board;
  applySettings();
  startSession({ players, board: setup.board, layout: setup.layout });
});
$('#btnContinue').addEventListener('click', () => {
  sfx.click();
  const sv = load(SAVE_KEY);
  if (!sv) return refreshMenu();
  startSession({ players: sv.players, board: sv.board, state: sv.state });
});

// Mini map of a layout: rainbow grid, green ladders, coloured snakes
function drawPreview(cv, L) {
  const g = cv.getContext('2d');
  const N = cv.width, C = N / 10;
  const center = (n) => { const { col, row } = cellGrid(n); return [(col + 0.5) * C, (9 - row + 0.5) * C]; };
  for (let n = 1; n <= 100; n++) {
    const { col, row } = cellGrid(n);
    g.fillStyle = (col + row) % 2 === 0 ? '#ffe3ec' : '#ffe7d1';
    g.fillRect(col * C, (9 - row) * C, C, C);
  }
  g.strokeStyle = '#f2b8c6';
  g.lineWidth = 1.5;
  for (let i = 1; i < 10; i++) {
    g.beginPath(); g.moveTo(i * C, 0); g.lineTo(i * C, N); g.stroke();
    g.beginPath(); g.moveTo(0, i * C); g.lineTo(N, i * C); g.stroke();
  }
  g.lineCap = 'round';
  for (const [b, t] of L.ladders) {
    const [x1, y1] = center(b), [x2, y2] = center(t);
    const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
    const ox = Math.cos(a) * C * 0.18, oy = Math.sin(a) * C * 0.18;
    g.strokeStyle = '#f2a900';
    g.lineWidth = C * 0.09;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x1 + ox * s, y1 + oy * s); g.lineTo(x2 + ox * s, y2 + oy * s); g.stroke(); }
    const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / (C * 0.45)));
    g.lineWidth = C * 0.06;
    for (let i = 1; i < steps; i++) {
      const k = i / steps, x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k;
      g.beginPath(); g.moveTo(x - ox, y - oy); g.lineTo(x + ox, y + oy); g.stroke();
    }
  }
  L.snakes.forEach(([h, t], i) => {
    const [x1, y1] = center(h), [x2, y2] = center(t);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const px = -dy / len, py = dx / len;
    g.strokeStyle = SNAKE_CSS[i % SNAKE_CSS.length];
    g.lineWidth = C * 0.22;
    g.beginPath();
    for (let k = 0; k <= 30; k++) {
      const s = k / 30;
      const w = Math.sin(s * Math.PI * Math.max(2.4, len / (C * 1.1))) * C * 0.35 * Math.sin(Math.PI * s);
      const x = x1 + dx * s + px * w, y = y1 + dy * s + py * w;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = SNAKE_CSS[i % SNAKE_CSS.length];
    g.beginPath(); g.arc(x1, y1, C * 0.24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x1 - C * 0.08, y1 - C * 0.05, C * 0.06, 0, Math.PI * 2); g.arc(x1 + C * 0.08, y1 - C * 0.05, C * 0.06, 0, Math.PI * 2); g.fill();
  });
}

// ---------------------------------------------------------------- online
// Same model as Ludo: the host runs the game and shares every roll; players
// are matched to seats by a per-device id so reloads and dropped links keep
// their seat; rooms come back after the host reloads.
const publicPlayers = (players) => players.map((p) => ({ type: p.type, name: p.name, away: !!p.away }));
let lobby = null; // { role:'host'|'client', net, players, mySeat, match, board }
const awayTimers = new Map();
const kickedPids = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const openSeat = () => ({ type: 'open', name: '', peer: null });

function saveOnline() {
  const strip = (list) => list.map(({ peer, ...p }) => p);
  if (session?.mode === 'host' && session.net?.code) {
    const n = session.net;
    store(ONLINE_KEY, { role: 'host', code: n.code, epoch: n.epoch, roomId: n.roomId, board: session.board, players: strip(session.players), state: session.game.toJSON(), seq: session.seq });
  } else if (!session && lobby?.role === 'host') {
    const n = lobby.net;
    store(ONLINE_KEY, { role: 'host', code: n.code, epoch: n.epoch, roomId: n.roomId, board: lobby.board, match: !!lobby.match, players: strip(lobby.players) });
  }
}

// deliberate exit (not a reload): tell the others, forget the room
function leaveOnline() {
  const net = session?.mode !== 'local' ? session?.net : lobby?.net;
  const role = session ? session.mode : lobby?.role;
  if (net) {
    if (role === 'host') net.broadcast({ t: 'ended' });
    else if (role === 'client') net.send({ t: 'bye' });
  }
  drop(ONLINE_KEY);
  setNetBanner(null);
}

function setNetBanner(text) {
  $('#netBanner').textContent = text || '';
  $('#netBanner').classList.toggle('hidden', !text);
}

function myName(sel) {
  const n = ($(sel).value || '').trim().slice(0, 14) || 'Player';
  store(NAME_KEY, n);
  return n;
}

// ----- play with friends: create / join a room by code
$('#btnOnline').addEventListener('click', () => {
  sfx.click();
  $('#inpName').value = load(NAME_KEY) || '';
  $('#onlineMsg').textContent = '';
  show('#scrOnline', true);
});

$('#btnCreate').addEventListener('click', async () => {
  sfx.click();
  const name = myName('#inpName');
  $('#onlineMsg').textContent = 'Creating room…';
  $('#btnCreate').disabled = true;
  const net = new HostNet();
  try {
    const code = await net.start();
    $('#onlineMsg').textContent = '';
    openHostLobby(net, name, false);
    $('#lobbyCode').textContent = code;
  } catch (e) {
    $('#onlineMsg').textContent = e.message;
    sfx.error();
  }
  $('#btnCreate').disabled = false;
});

function openHostLobby(net, name, match) {
  lobby = {
    role: 'host', net, mySeat: 0, match, board: match ? 'medium' : (settings.lastBoard || 'medium'),
    players: [{ type: 'human', name, peer: null }, openSeat(), openSeat(), openSeat()],
  };
  wireHost(net);
  renderLobby();
  show('#scrLobby', true);
  saveOnline();
}

$('#btnJoin').addEventListener('click', joinRoom);
$('#inpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
async function joinRoom() {
  sfx.click();
  const code = $('#inpCode').value.trim().toUpperCase();
  if (code.length !== 5) { $('#onlineMsg').textContent = 'Enter the 5-letter room code.'; sfx.error(); return; }
  const name = myName('#inpName');
  $('#onlineMsg').textContent = 'Connecting…';
  $('#btnJoin').disabled = true;
  if (await connectAsPlayer(code, name)) $('#onlineMsg').textContent = 'Joined! Waiting for host…';
  else { $('#onlineMsg').textContent = 'Could not join. Check the code.'; sfx.error(); }
  $('#btnJoin').disabled = false;
}

async function connectAsPlayer(code, name, { matching = false, patient = false, epoch = 0, roomId = null } = {}) {
  const net = new ClientNet();
  net.myName = name;
  net.matching = matching;
  try { await net.join(code, { patient, epoch, roomId }); } catch { net.close(); return false; }
  wireClient(net);
  net.send({ t: 'hello', pid: PID, name });
  store(ONLINE_KEY, { role: 'client', code: net.code, epoch: net.epoch, roomId: net.roomId, name });
  return true;
}

// ----- host side
function hostSeatOf(peerId) {
  const list = session ? session.players : lobby?.players;
  return list ? list.findIndex((p) => p.peer === peerId) : -1;
}

function wireHost(net) {
  net.describe = () => {
    const list = session ? session.players : lobby?.players || [];
    return {
      name: list[0]?.name || 'Host',
      players: list.filter((p) => p.type === 'human' || p.type === 'remote').length,
      open: session ? 0 : list.filter((p) => p.type === 'open').length,
      started: !!session,
      match: isMatchCode(net.code),
    };
  };
  const startMsg = () => ({ t: 'start', players: publicPlayers(session.players), board: session.board, state: session.game.toJSON(), seq: session.seq, resync: true });
  net.on('message', (peer, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const pid = String(msg.pid || peer);
      const list = session ? session.players : lobby?.players;
      if (!list) return;
      // same device coming back (reload / dropped link): give the seat back
      const back = list.findIndex((p) => p.type === 'remote' && p.pid === pid);
      if (back >= 0) {
        const pl = list[back];
        if (pl.peer && pl.peer !== peer) net.kick(pl.peer);
        const wasAway = pl.away;
        pl.peer = peer;
        pl.away = false;
        clearTimeout(awayTimers.get(back));
        awayTimers.delete(back);
        net.send(peer, { t: 'welcome', seat: back });
        if (session) {
          net.send(peer, startMsg());
          net.broadcast({ t: 'players', players: publicPlayers(session.players) });
          if (wasAway) toast(`${pl.name} is back`, pcss(back), 1.6);
          buildChips();
          if (!session.busy) afterIdle();
          saveOnline();
        } else { renderLobby(); broadcastLobby(); }
        return;
      }
      if (session) { net.send(peer, { t: 'full', why: 'Game already started.' }); setTimeout(() => net.kick(peer), 300); return; }
      if (kickedPids.has(pid)) { net.send(peer, { t: 'kicked' }); setTimeout(() => net.kick(peer), 300); return; }
      const seat = [1, 2, 3].find((i) => lobby.players[i].type === 'open');
      if (seat === undefined) { net.send(peer, { t: 'full', why: 'Room is full.' }); setTimeout(() => net.kick(peer), 300); return; }
      lobby.players[seat] = { type: 'remote', name: String(msg.name || 'Guest').slice(0, 14), peer, pid };
      net.send(peer, { t: 'welcome', seat });
      sfx.enterBoard();
      renderLobby();
      broadcastLobby();
      if (lobby.match) matchCountdown();
    } else if (msg.t === 'intent' && session) {
      const seat = hostSeatOf(peer);
      const g = session.game;
      if (seat < 0 || seat !== g.current || g.phase !== 'roll') return;
      if (session.busy) session.pendingRoll = seat; else doRoll();
    } else if (msg.t === 'resync' && session) {
      net.send(peer, startMsg());
    } else if (msg.t === 'bye') {
      const seat = hostSeatOf(peer);
      if (seat >= 0) playerGone(seat, true);
      net.kick(peer);
    }
  });
  // link dropped (slow network, reload, app in background): keep the seat
  net.on('leave', (peer) => {
    const seat = hostSeatOf(peer);
    if (seat >= 0) playerGone(seat, false);
  });
  net.on('error', (m) => { $('#lobbyMsg').textContent = m; });
}

function playerGone(seat, forGood) {
  if (session && session.mode === 'host') {
    const pl = session.players[seat];
    pl.peer = null;
    if (forGood) {
      toast(`${pl.name} left — computer takes over`, pcss(seat), 2.5);
      pl.type = 'ai';
      pl.away = false;
      pl.name += ' 🤖';
    } else {
      pl.away = true;
      toast(`${pl.name} lost connection — waiting for them…`, pcss(seat), 2.5);
    }
    session.net?.broadcast({ t: 'players', players: publicPlayers(session.players) });
    buildChips();
    if (!session.busy) afterIdle();
    saveOnline();
  } else if (lobby?.role === 'host') {
    const free = () => { lobby.players[seat] = openSeat(); renderLobby(); broadcastLobby(); if (lobby.match) matchCountdown(); };
    if (forGood || lobby.match) { free(); return; }
    lobby.players[seat].peer = null;
    lobby.players[seat].away = true;
    clearTimeout(awayTimers.get(seat));
    // hold the seat for a minute in case they're just reloading
    awayTimers.set(seat, setTimeout(() => { if (lobby?.players[seat]?.away) free(); }, 60000));
    renderLobby();
    broadcastLobby();
  }
}

function broadcastLobby() {
  if (lobby?.role !== 'host') return;
  lobby.net.broadcast({ t: 'lobby', players: publicPlayers(lobby.players), board: lobby.board });
  saveOnline();
}

const remoteCount = () => (lobby ? lobby.players.filter((p) => p.type === 'remote').length : 0);

function renderLobby() {
  const wrap = $('#lobbySeats');
  wrap.innerHTML = '';
  const host = lobby.role === 'host';
  lobby.players.forEach((cfg, p) => {
    const row = document.createElement('div');
    row.className = 'seat' + (cfg.type === 'off' ? ' off' : '');
    row.style.setProperty('--c', pcss(p));
    let label = cfg.name;
    if (cfg.type === 'open') label = 'Waiting for player…';
    if (cfg.type === 'off') label = '—';
    if (cfg.type === 'ai') label = 'Computer';
    if (cfg.away) label += ' (reconnecting…)';
    if (p === lobby.mySeat) label += ' (you)';
    row.innerHTML = '<span class="dot"></span><span class="who"></span>';
    row.querySelector('.who').textContent = label;
    if (host && !lobby.match && p !== 0 && cfg.type !== 'remote') {
      const seg = document.createElement('div');
      seg.className = 'seg';
      for (const [o, txt] of [['open', 'Open'], ['ai', 'CPU'], ['off', 'Off']]) {
        const b = document.createElement('button');
        b.textContent = txt;
        b.classList.toggle('on', cfg.type === o);
        b.addEventListener('click', () => {
          sfx.click();
          lobby.players[p] = { type: o, name: o === 'ai' ? `CPU ${COLOR_NAME[COLORS[p]]}` : '', peer: null };
          renderLobby();
          broadcastLobby();
        });
        seg.appendChild(b);
      }
      row.appendChild(seg);
    }
    if (host && !lobby.match && cfg.type === 'remote') {
      const kick = document.createElement('button');
      kick.className = 'btn btn-ghost small';
      kick.style.width = 'auto';
      kick.textContent = 'Kick';
      kick.onclick = () => {
        if (cfg.pid) kickedPids.add(cfg.pid);
        if (cfg.peer) { lobby.net.send(cfg.peer, { t: 'kicked' }); const id = cfg.peer; setTimeout(() => lobby?.net.kick(id), 300); }
        lobby.players[p] = openSeat();
        renderLobby();
        broadcastLobby();
      };
      row.appendChild(kick);
    }
    wrap.appendChild(row);
  });
  $$('#segLobbyBoard button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === lobby.board);
    b.disabled = !host;
  });
  $('#lobbyBoardField').classList.toggle('hidden', !!lobby.match);
  $('#btnLobbyStart').classList.toggle('hidden', !host);
  $('#lobbyTitle').textContent = lobby.match ? 'Online match' : 'Room';
  $('.code-box').classList.toggle('hidden', !!lobby.match);
  if (lobby.match) {
    const n = remoteCount();
    $('#btnLobbyStart').textContent = n ? 'Start now' : 'Play with computers';
    $('#lobbyNote').textContent = !host ? 'Match found! The game starts in a moment…'
      : n ? `Match found! Starting in ${lobby.countdownLeft ?? 15}s… (more players can still join)` : 'Waiting for other players to join… (or start now against computers)';
  } else {
    $('#btnLobbyStart').textContent = 'Start game';
    $('#lobbyNote').textContent = host ? 'Share the code. Friends join from “Play with Friends”. Open seats left empty are removed.' : 'Waiting for the host to start…';
  }
}

$$('#segLobbyBoard button').forEach((b) => b.addEventListener('click', () => {
  if (lobby?.role !== 'host') return;
  sfx.click();
  lobby.board = b.dataset.v;
  renderLobby();
  broadcastLobby();
}));

$('#btnShare').addEventListener('click', async () => {
  sfx.click();
  const code = $('#lobbyCode').textContent;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Snakes & Ladders 3D', text: `Join my Snakes & Ladders game! Room code ${code}`, url });
    else { await navigator.clipboard.writeText(url); $('#lobbyMsg').textContent = 'Link copied!'; setTimeout(() => { $('#lobbyMsg').textContent = ''; }, 2000); }
  } catch { /* cancelled */ }
});

$('#btnLobbyStart').addEventListener('click', () => { sfx.click(); startLobbyGame(); });
function startLobbyGame() {
  if (!lobby || lobby.role !== 'host') return;
  stopMatchTimers();
  // a match nobody else joined: fill the table with computers
  const fill = lobby.match && remoteCount() === 0 ? 'ai' : 'off';
  const players = lobby.players.map((p, i) => {
    const type = p.type === 'open' ? fill : p.type;
    return { ...p, type, name: type === 'off' ? '' : type === 'ai' && !p.name ? `CPU ${COLOR_NAME[COLORS[i]]}` : p.name || COLOR_NAME[COLORS[i]] };
  });
  if (players.filter((p) => p.type !== 'off').length < 2) { $('#lobbyMsg').textContent = 'Need at least 2 players (add a Computer or wait for friends).'; sfx.error(); return; }
  const { net, board } = lobby;
  const state = newGameState(players, board);
  net.broadcast({ t: 'start', players: publicPlayers(players), board, state, seq: 0 });
  lobby = null;
  settings.lastBoard = board;
  applySettings();
  startSession({ mode: 'host', players, board, net, mySeat: 0, state, seq: 0 });
}

$('#btnLobbyLeave').addEventListener('click', () => {
  sfx.click();
  stopMatchTimers();
  if (matchSearch) matchSearch.cancelled = true;
  leaveOnline();
  lobby?.net.close();
  lobby = null;
  show('#scrMenu');
});

// ----- player side
function wireClient(net) {
  let mySeat = -1;
  const bail = (why) => {
    if (net.matching && !session) {
      // that match filled up or started: quietly look for another
      net.close();
      drop(ONLINE_KEY);
      lobby = null;
      show('#scrMatch');
      findMatch();
      return;
    }
    net.close();
    drop(ONLINE_KEY);
    setNetBanner(null);
    const inGame = !!session || !!lobby;
    lobby = null;
    if (session) { session.net = null; endSession(); }
    show('#scrMenu');
    refreshMenu();
    if (inGame) alert(why); else { show('#scrOnline', true); $('#onlineMsg').textContent = why; }
  };
  net.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        mySeat = msg.seat;
        setNetBanner(null);
        if (!session) {
          lobby = { role: 'client', net, mySeat, match: isMatchCode(net.code), board: lobby?.board || 'medium', players: lobby?.players || [0, 1, 2, 3].map(() => openSeat()) };
          $('#lobbyCode').textContent = net.code;
          renderLobby();
          show('#scrLobby', true);
        }
        break;
      case 'lobby':
        if (lobby) { lobby.players = msg.players; lobby.board = msg.board || lobby.board; renderLobby(); }
        break;
      case 'full': bail(msg.why || 'Room is full.'); break;
      case 'kicked': bail('You were removed from the room.'); break;
      case 'ended': bail('The host ended the game.'); break;
      case 'start': {
        lobby = null;
        const players = msg.players.map((p) => ({ ...p }));
        if (session) session.net = null; // keep the connection while replacing the session
        startSession({ mode: 'client', players, board: msg.board, state: msg.state, net, mySeat, seq: msg.seq || 0 });
        if (msg.resync) toast('Back in sync with the host', null, 1.2);
        break;
      }
      case 'act':
        if (session?.mode !== 'client') break;
        if (msg.seq <= session.rx) break; // already have it
        if (msg.seq > session.rx + 1) { net.send({ t: 'resync' }); break; } // missed some
        session.rx = msg.seq;
        session.queue.push(msg.v);
        pumpClient();
        break;
      case 'players':
        if (session) { msg.players.forEach((p, i) => Object.assign(session.players[i], p)); buildChips(); afterIdle(); }
        break;
      default:
    }
  });
  // link lost: stay in the game and keep retrying quietly
  net.on('down', () => setNetBanner('Connection lost — reconnecting…'));
  net.on('up', () => {
    const sv = load(ONLINE_KEY);
    if (sv?.role === 'client') store(ONLINE_KEY, { ...sv, epoch: net.epoch, roomId: net.roomId });
    setNetBanner('Reconnected — syncing…');
    net.send({ t: 'hello', pid: PID, name: net.myName });
  });
}

// ----- find online match (see Ludo: fixed public match rooms, merge when alone)
let matchSearch = null;
const slotOf = (code) => Number(code.split('-')[1]);
const matchCodes = () => [...Array(MATCH_SLOTS).keys()].map(matchCode);

function stopMatchTimers() {
  if (!lobby) return;
  clearInterval(lobby.countdownTimer);
  clearInterval(lobby.mergeTimer);
  lobby.countdownTimer = lobby.mergeTimer = null;
  lobby.countdownLeft = null;
}

function matchCountdown() {
  if (!lobby?.match || lobby.role !== 'host') return;
  const n = remoteCount();
  if (n >= 3) { startLobbyGame(); return; }
  if (!n) { clearInterval(lobby.countdownTimer); lobby.countdownTimer = null; lobby.countdownLeft = null; renderLobby(); return; }
  if (lobby.countdownTimer) return;
  lobby.countdownLeft = 15;
  lobby.countdownTimer = setInterval(() => {
    if (!lobby) return;
    lobby.countdownLeft--;
    if (lobby.countdownLeft <= 0) { startLobbyGame(); return; }
    renderLobby();
  }, 1000);
  renderLobby();
}

async function findMatch() {
  const name = myName('#inpMatchName');
  if (matchSearch) matchSearch.cancelled = true;
  const me = { cancelled: false };
  matchSearch = me;
  const msg = (t) => { if (!me.cancelled) $('#matchMsg').textContent = t; };
  $('#btnMatchGo').disabled = true;
  msg('Looking for players…');
  try {
    while (!me.cancelled) {
      const rooms = await scanRooms(matchCodes());
      if (me.cancelled) return;
      const waiting = rooms.filter((r) => r.match && !r.started && r.open > 0)
        .sort((a, b) => b.players - a.players || slotOf(a.code) - slotOf(b.code));
      for (const r of waiting) {
        msg(`Joining ${r.name}'s match…`);
        if (await connectAsPlayer(r.code, name, { matching: true })) return;
        if (me.cancelled) return;
      }
      const taken = new Set(rooms.map((r) => r.code));
      for (const code of matchCodes()) {
        if (taken.has(code)) continue;
        try { await hostMatch(code, name); return; } catch (e) {
          if (e.type !== 'unavailable-id') throw e;
        }
      }
      msg('All match rooms are busy, retrying…');
      await sleep(3000);
    }
  } catch (e) {
    msg(e.message || 'Could not reach the matchmaking server.');
    sfx.error();
  } finally {
    if (matchSearch === me) matchSearch = null;
    $('#btnMatchGo').disabled = false;
  }
}

async function hostMatch(code, name) {
  const net = new HostNet();
  await net.startAt(code);
  openHostLobby(net, name, true);
  // alone in our room? keep an eye out for a better one to merge into
  lobby.mergeTimer = setInterval(async () => {
    const L = lobby;
    if (!L || L.net !== net || L.busyMerge || remoteCount() > 0) return;
    L.busyMerge = true;
    try {
      const rooms = (await scanRooms(matchCodes())).filter((r) => r.code !== code && r.match && !r.started && r.open > 0);
      const better = rooms.find((r) => r.players > 1 || slotOf(r.code) < slotOf(code));
      if (better && lobby === L && remoteCount() === 0) {
        stopMatchTimers();
        net.close();
        lobby = null;
        drop(ONLINE_KEY);
        $('#matchMsg').textContent = `Joining ${better.name}'s match…`;
        show('#scrMatch');
        if (!(await connectAsPlayer(better.code, name, { matching: true }))) findMatch();
      }
    } catch { /* try again next tick */ }
    L.busyMerge = false;
  }, 7000);
}

$('#btnMatch').addEventListener('click', () => {
  sfx.click();
  $('#inpMatchName').value = load(NAME_KEY) || '';
  $('#matchMsg').textContent = '';
  show('#scrMatch', true);
});
$('#btnMatchGo').addEventListener('click', () => { sfx.click(); findMatch(); });
$('#btnMatchCancel').addEventListener('click', () => {
  sfx.click();
  if (matchSearch) matchSearch.cancelled = true;
  matchSearch = null;
  $('#matchMsg').textContent = '';
  $('#btnMatchGo').disabled = false;
  back();
});

// ----- put an online game back after a reload (host or player)
async function resumeOnline(sv) {
  $('#inpName').value = load(NAME_KEY) || '';
  show('#scrOnline', true);
  $('#onlineMsg').textContent = `Reconnecting to room…`;
  if (sv.role === 'client') {
    if (await connectAsPlayer(sv.code, sv.name, { patient: true, epoch: sv.epoch || 0, roomId: sv.roomId || null })) $('#onlineMsg').textContent = 'Rejoined! Syncing with host…';
    else { drop(ONLINE_KEY); $('#onlineMsg').textContent = 'Could not rejoin the room. It may have ended.'; }
    return;
  }
  const net = new HostNet();
  try {
    await net.start(sv.code, sv.epoch || 0, sv.roomId || null);
  } catch (e) {
    net.close();
    drop(ONLINE_KEY);
    $('#onlineMsg').textContent = e.message;
    return;
  }
  wireHost(net);
  // everyone else is "away" until their device reconnects
  const players = sv.players.map((p) => ({ ...p, peer: null, away: p.type === 'remote' }));
  if (sv.state && sv.state.phase !== 'over') {
    startSession({ mode: 'host', players, board: sv.board, net, mySeat: 0, state: sv.state, seq: sv.seq || 0 });
    toast('Room restored — players are reconnecting', null, 2.2);
  } else {
    lobby = { role: 'host', net, mySeat: 0, match: !!sv.match, board: sv.board || 'medium', players: players.map((p) => (sv.state && p.type === 'off' ? openSeat() : p)) };
    lobby.players.forEach((p, seat) => {
      if (p.away) awayTimers.set(seat, setTimeout(() => { if (lobby?.players[seat]?.away) { lobby.players[seat] = openSeat(); renderLobby(); broadcastLobby(); } }, 60000));
    });
    $('#lobbyCode').textContent = sv.code;
    renderLobby();
    show('#scrLobby', true);
    saveOnline();
  }
}

// ---------------------------------------------------------------- menu & attract mode
function refreshMenu() {
  const sv = load(SAVE_KEY);
  $('#btnContinue').classList.toggle('hidden', !sv || sv.state?.phase === 'over');
}
function setTurnGlow(css) { $('#bg').style.setProperty('--turn', css || 'rgba(255,255,255,0)'); }

let attractTimer = null;
function attract() {
  clearInterval(attractTimer);
  const demo = new SnakesGame([0, 1, 2, 3], LAYOUTS[load(SETTINGS_KEY)?.lastBoard] || LAYOUTS.medium);
  view.setLayout(demo.s.layout);
  view.setPlayers(demo.s.seats);
  view.layout(demo, 0);
  view.setView(false);
  view.controls.autoRotate = true;
  view.controls.autoRotateSpeed = 0.6;
  bgfx.ambient(null);
  let i = 0;
  const cycle = () => {
    if (session) { clearInterval(attractTimer); return; }
    view.setTurn(i % 4);
    setTurnGlow(COLOR_CSS[COLORS[i % 4]]);
    view.ripple(1 + Math.floor(Math.random() * 100), parseInt(COLOR_CSS[COLORS[i % 4]].slice(1), 16), 0.8);
    i++;
  };
  cycle();
  attractTimer = setInterval(cycle, 2600);
}

// ---------------------------------------------------------------- random background
// A fresh colour scheme on every load, every new game, and every few seconds.
let lastHue = Math.random() * 360;
function randomBackdrop() {
  const el = $('#bg');
  const H = (lastHue + 70 + Math.random() * 220) % 360; // always a clearly different hue
  lastHue = H;
  const schemes = [[0, 30, -30, 60, -60], [0, 120, 240, 60, 180], [0, 180, 30, 210, -30], [0, 90, 180, 270, 45]];
  const off = schemes[Math.floor(Math.random() * schemes.length)];
  const hue = (i) => Math.round((H + off[i % off.length] + 360) % 360);
  const sat = 55 + Math.random() * 25;
  [14, 22, 26, 12].forEach((l, i) => el.style.setProperty(`--g${i + 1}`, `hsl(${hue(i)} ${sat}% ${l + Math.random() * 8}%)`));
  for (let i = 0; i < 5; i++) el.style.setProperty(`--c${i + 1}`, `hsl(${hue(i + 1)} 90% ${52 + Math.random() * 12}% / ${i === 4 ? 0.6 : 0.8})`);
}
randomBackdrop();
setInterval(() => { if (!document.hidden) randomBackdrop(); }, 12000);

// ---------------------------------------------------------------- PWA bits
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
let wakeLock = null;
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } }
function releaseWakeLock() { wakeLock?.release?.().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushTweens();
    if (view.dice.playing) view.dice._finish();
  } else if (session) requestWakeLock();
});

// ---------------------------------------------------------------- boot
attract();
refreshMenu();
show('#scrMenu');
const roomParam = new URLSearchParams(location.search).get('room');
const savedOnline = load(ONLINE_KEY);
if (savedOnline?.code && !roomParam) resumeOnline(savedOnline);
else if (roomParam) {
  $('#inpName').value = load(NAME_KEY) || '';
  $('#inpCode').value = roomParam.toUpperCase().slice(0, 5);
  show('#scrOnline', true);
  history.replaceState(null, '', location.pathname);
}
requestAnimationFrame(() => $('#loading').classList.add('gone'));
setTimeout(() => $('#loading').remove(), 800);

// debug hook (console): __snakes.roll(4) forces the next roll
window.__snakes = { get session() { return session; }, view, roll: (v) => { if (session && !session.busy) { clearTimeout(session.timer); doRoll(v); } } };
