// Snakes & Ladders game controller: menus, turns, HUD, celebrations, saving.

import { SnakesScene, SNAKE_CSS } from './scene.js';
import { SnakesGame, LAYOUTS, layoutFor, randomLayout, cellGrid, LAST } from './rules.js';
import { sfx } from '../audio.js';
import { wait, flushTweens } from '../anim.js';
import { COLORS, COLOR_CSS, COLOR_NAME } from '../constants.js';
import * as bgfx from '../bgfx.js';
import { fairDie } from '../luck.js';

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

// ---------------------------------------------------------------- session
/** @type {null | {players:any[], board:string, game:SnakesGame, mySeats:Set<number>, busy:boolean, paused?:boolean, over?:boolean, timer?:any}} */
let session = null;
const pname = (p) => session.players[p]?.name || COLOR_NAME[COLORS[p]];
const pcss = (p) => COLOR_CSS[COLORS[p]];

function startSession({ players, board, layout = null, state = null }) {
  clearTimeout(session?.timer);
  const seats = players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0);
  const game = state ? SnakesGame.from(state) : new SnakesGame(seats, layout || layoutFor(board), { bounce: settings.bounce, needSix: settings.needSix });
  session = { players, board, game, mySeats: new Set(seats.filter((p) => players[p].type === 'human')), busy: false, over: false };
  view.controls.autoRotate = false;
  view.setLayout(game.s.layout);
  view.setPlayers(game.s.seats);
  view.layout(game, 0);
  view.setView(true);
  buildChips();
  $('#boardTag').textContent = `${game.s.layout.name.toUpperCase()} BOARD`;
  $('#hud').classList.remove('hidden');
  show(null);
  bgfx.ambient(() => (session ? pcss(session.game.current) : '#ffffff'));
  randomBackdrop();
  view.ripple(1, 0x7c4dff, 1.2);
  requestWakeLock();
  save();
  setTimeout(() => afterIdle(), 900);
}

function save() {
  if (!session) return;
  if (session.game.phase === 'over') { drop(SAVE_KEY); return; }
  store(SAVE_KEY, { players: session.players, board: session.board, state: session.game.toJSON() });
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session = null;
  view.setTurn(-1);
  view.dice.setInvite(false);
  $('#hud').classList.add('hidden');
  releaseWakeLock();
  attract();
}

// ---------------------------------------------------------------- turns
async function doRoll(forced) {
  const s = session;
  if (!s || s.busy || s.over || s.game.phase !== 'roll') return;
  s.busy = true;
  clearTimeout(s.timer);
  hideControls();
  try {
    await playTurn(forced >= 1 && forced <= 6 ? forced : fairDie());
  } catch (err) {
    console.error(err);
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
  const fast = settings.fast && s.players[p].type === 'ai';
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
      view.fx.shockwave(view.dice.mesh.position, parseInt(css.slice(1), 16));
      view.fx.burst(view.dice.mesh.position, 0xfff3a0, 30);
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
  if (pl.type === 'human' && !s.paused) {
    setChipDie(p, 'ready');
    view.dice.setInvite(true, parseInt(pcss(p).slice(1), 16));
    $('#hint').textContent = s.mySeats.size > 1 ? `${pname(p)}: tap to roll 🎲` : 'Tap your dice 🎲';
  } else {
    hideControls();
    setChipDie(p, 'idle');
    $('#hint').textContent = `${pname(p)} is rolling…`;
    if (!s.paused) s.timer = setTimeout(() => doRoll(), settings.fast ? 300 : 750);
  }
}

function humanRoll() {
  const s = session;
  if (!s || s.busy || s.paused || s.over) return;
  const p = s.game.current;
  if (s.players[p].type !== 'human' || s.game.phase !== 'roll') return;
  sfx.click();
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
    const icon = pl.type === 'ai' ? '🤖' : '🙂';
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
  for (let i = 0; i < c.n; i++) {
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
    bgfx.flash(css);
    bgfx.launch(css, 3, 0.7, true);
    view.shake(0.5);
  } else {
    bgfx.party(pcss(p), level || 1);
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
  view.fx.confetti(240, 12);
  await view.winDance(p);
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
  setTimeout(() => bgfx.confettiRain(wcss, 200), 1500);
  setTimeout(() => { bgfx.launch(wcss, 14, 1.2); bgfx.fountain(wcss, 2); }, 2600);
  setTimeout(() => { if (session === s) show('#scrOver'); }, 900);
}

$('#btnAgain').addEventListener('click', () => {
  sfx.click();
  if (!session) return;
  const { players, board, game } = session;
  // same board again (a random board keeps its layout); "New random board" shuffles
  startSession({ players, board, layout: game.s.layout });
});
$('#btnNewBoard').addEventListener('click', () => {
  sfx.click();
  if (!session) return;
  startSession({ players: session.players, board: 'random', layout: randomLayout() });
});
$('#btnOverMenu').addEventListener('click', () => { sfx.click(); endSession(); show('#scrMenu'); refreshMenu(); });

// ---------------------------------------------------------------- pause
function pause() {
  if (!session) return;
  sfx.click();
  session.paused = true;
  clearTimeout(session.timer);
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
  startSession({ players: session.players, board: session.board, layout: session.game.s.layout });
});
$('#btnQuit').addEventListener('click', () => { sfx.click(); endSession(); show('#scrMenu'); refreshMenu(); });
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
    $('#setupTitle').textContent = 'Play vs Computer';
    setup = { players: COLORS.map((c, p) => (p === 0 ? { type: 'human', name: myName || 'You' } : p < 2 ? { type: 'ai', name: `CPU ${COLOR_NAME[c]}` } : { type: 'off', name: COLOR_NAME[c] })) };
  } else {
    $('#setupTitle').textContent = 'Pass & Play';
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
  bgfx.ambient(() => COLOR_CSS[COLORS[Math.floor(Math.random() * 4)]]);
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
requestAnimationFrame(() => $('#loading').classList.add('gone'));
setTimeout(() => $('#loading').remove(), 800);

// debug hook (console): __snakes.roll(4) forces the next roll
window.__snakes = { get session() { return session; }, view, roll: (v) => { if (session && !session.busy) { clearTimeout(session.timer); doRoll(v); } } };
