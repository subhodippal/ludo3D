import { Scene3D } from './board.js';
import { LudoGame } from './game.js';
import { chooseMove } from './ai.js';
import { sfx } from './audio.js';
import { wait, flushTweens } from './anim.js';
import { HostNet, ClientNet } from './net.js';
import { COLORS, COLOR_CSS, COLOR_HEX, COLOR_NAME, SEATS_FOR, STAR_INDICES, trackIndexFor } from './constants.js';
import * as bgfx from './bgfx.js';
import { luckyRoll, fairDie } from './luck.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'ludo3d.settings';
const SAVE_KEY = 'ludo3d.save';
const NAME_KEY = 'ludo3d.name';
const settings = Object.assign(
  { sound: true, vibrate: true, autoMove: true, lucky: true, fast: false, hq: !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (window.devicePixelRatio || 1) <= 2 },
  safeJSON(localStorage.getItem(SETTINGS_KEY)) || {},
);
function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
function applySettings() {
  sfx.enabled = settings.sound;
  sfx.vibrate = settings.vibrate;
  $('#btnSound').classList.toggle('muted', !settings.sound);
  store(SETTINGS_KEY, settings);
}

// ---------------------------------------------------------------- scene
const view = new Scene3D($('#c'), { quality: settings.hq ? 'high' : 'low' });
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

// ---------------------------------------------------------------- toasts
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
/** @type {null | {mode:'local'|'host'|'client', players:any[], level:string, game:LudoGame, mySeats:Set<number>, queue:any[], busy:boolean, net?:any, paused?:boolean, over?:boolean, timer?:any}} */
let session = null;
const pname = (p) => session.players[p]?.name || COLOR_NAME[COLORS[p]];
const isAuthority = () => session && session.mode !== 'client';

function rollFor(p) {
  return settings.lucky ? luckyRoll(session.game, p, session.luck) : fairDie();
}

function startSession({ mode, players, level = 'normal', state = null, net = null, mySeat = null }) {
  clearTimeout(session?.timer);
  const seats = players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0);
  const game = state ? LudoGame.from(state) : new LudoGame(seats);
  let mySeats;
  if (mode === 'local') mySeats = new Set(seats.filter((p) => players[p].type === 'human'));
  else mySeats = new Set([mySeat]);
  session = { mode, players, level, game, mySeats, queue: [], busy: false, net, over: false, luck: { dry: [0, 0, 0, 0] } };
  view.controls.autoRotate = false;
  view.setPlayers(game.s.seats);
  view.layout(game, 0);
  // fixed view: never rotates between turns
  view.setView([...mySeats][0] ?? game.s.seats[0], true);
  buildChips();
  $('#hud').classList.remove('hidden');
  $('#roomTag').classList.toggle('hidden', mode === 'local');
  $('#btnEmoji').classList.toggle('hidden', mode === 'local');
  $('#emojiPanel').classList.add('hidden');
  if (net?.code) $('#roomTag').textContent = 'ROOM ' + net.code;
  $('#btnRestart').classList.toggle('hidden', mode === 'client');
  show(null);
  bgfx.ambient(() => (session ? COLOR_CSS[COLORS[session.game.current]] : '#ffffff'));
  requestWakeLock();
  save();
  setTimeout(() => afterIdle(), 700);
}

function save() {
  if (!session || session.mode !== 'local') return;
  if (session.game.phase === 'over') { localStorage.removeItem(SAVE_KEY); return; }
  store(SAVE_KEY, { players: session.players, level: session.level, state: session.game.toJSON() });
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session.net?.close();
  session = null;
  view.clearSelectable();
  view.setTurn(-1);
  view.dice.setInvite(false);
  $('#hud').classList.add('hidden');
  releaseWakeLock();
  attract();
}

// Every action goes through here. Clients forward intents to the host.
function submit(intent, fromSeat) {
  if (!session || session.over) return;
  if (session.mode === 'client') { session.net.send({ t: 'intent', a: intent }); hideControls(); return; }
  session.queue.push({ kind: 'intent', intent, fromSeat });
  pump();
}

function validate({ intent, fromSeat }) {
  const g = session.game;
  if (fromSeat !== g.current) return null;
  if (intent.t === 'roll' && g.phase === 'roll') return { t: 'roll', v: rollFor(fromSeat) };
  if (intent.t === 'move' && g.phase === 'move' && g.s.legal.includes(intent.k)) return { t: 'move', k: intent.k };
  return null;
}

async function pump() {
  if (!session || session.busy) return;
  const s = session;
  s.busy = true;
  try {
    while (s.queue.length && session === s) {
      const item = s.queue.shift();
      let action;
      if (item.kind === 'intent') {
        action = validate(item);
        if (!action) continue;
        if (s.mode === 'host') s.net.broadcast({ t: 'act', a: action, n: s.game.s.moves });
      } else action = item.a;
      hideControls();
      await apply(action);
    }
  } catch (err) {
    console.error(err);
    if (s.mode === 'client') s.net.send({ t: 'resync' });
  }
  s.busy = false;
  if (session === s) afterIdle();
}

async function apply(a) {
  const s = session;
  const g = s.game;
  const p = g.current;
  const css = COLOR_CSS[COLORS[p]];
  if (a.t === 'roll') {
    const res = g.roll(a.v);
    setChipDie(p, 'rolling');
    await view.rollDice(a.v, p);
    setChipDie(p, 'value', a.v);
    if (a.v === 6 && !res.forfeit) {
      sfx.six();
      view.shockwave(view.dice.mesh.position, parseInt(css.slice(1), 16));
      view.burst(view.dice.mesh.position, 0xfff3a0, 36);
      celebrate('six', p, undefined, view.dice.mesh.position);
    }
    if (res.forfeit) { toast(`${pname(p)} rolled three 6s — turn lost!`, css); sfx.error(); await wait(1100); }
    else if (res.again) { toast('No moves — roll again!', css); await wait(700); }
    else if (res.pass) { toast(`${pname(p)}: no moves`, css, 1.2); await wait(800); }
    else await wait(150);
  } else if (a.t === 'move') {
    view.clearSelectable();
    const res = g.move(a.k);
    await view.animateMove(g, res);
    const pos = view.tokens[p][a.k].position;
    const double = res.to < 56 && g.s.tokens[p].filter((x) => x === res.to).length >= 2;
    const star = res.to <= 50 && STAR_INDICES.has(trackIndexFor(p, res.to));
    if (res.won && !res.gameOver) celebrate('finish', p, `${pname(p)} finished #${g.s.finished.length}!`, pos);
    else if (res.captures.length) celebrate('capture', p, `${pname(p)} cut ${res.captures.map((c) => pname(c.player)).join(' & ')}`, pos);
    else if (res.home) celebrate('home', p, undefined, pos);
    else if (double) celebrate('double', p, undefined, pos);
    else if (star) celebrate('star', p, undefined, pos);
    else if (res.from < 0) celebrate('out', p, undefined, pos);
    updateChips();
    if (res.gameOver) { save(); await wait(500); gameOver(); return; }
  }
  updateChips();
  save();
}

function hideControls() {
  $$('.chip .die.ready').forEach((d) => d.classList.remove('ready'));
  $('#hint').textContent = '';
  view.dice.setInvite(false);
  view.clearSelectable();
}

// Called whenever no animation is pending: show controls / schedule computer turns
function afterIdle() {
  const s = session;
  if (!s || s.busy || s.over) return;
  const g = s.game;
  if (g.phase === 'over') { gameOver(); return; }
  const p = g.current;
  const pl = s.players[p];
  view.setTurn(p);
  setTurnGlow(COLOR_CSS[COLORS[p]]);
  updateChips();

  const mine = s.mySeats.has(p) && pl.type !== 'ai';
  const css = COLOR_CSS[COLORS[p]];
  if (mine && !s.paused) {
    if (g.phase === 'roll') {
      setChipDie(p, 'ready');
      view.dice.setInvite(true, parseInt(css.slice(1), 16));
      $('#hint').textContent = s.mySeats.size > 1 ? `${pname(p)}: tap your dice 🎲` : 'Tap your dice 🎲';
    } else if (g.phase === 'move') {
      view.setSelectable(p, g.s.legal);
      $('#hint').textContent = 'Tap a glowing token';
    }
  } else {
    hideControls();
    if (g.phase === 'roll') setChipDie(p, 'idle');
    $('#hint').textContent = pl.type === 'ai' ? `${pname(p)} is thinking…` : `Waiting for ${pname(p)}…`;
  }
  if (isAuthority()) scheduleAuto();
}

function scheduleAuto() {
  const s = session;
  clearTimeout(s.timer);
  if (s.paused || s.over) return;
  const g = s.game;
  const p = g.current;
  const pl = s.players[p];
  const fast = settings.fast ? 0.45 : 1;
  if (pl.type === 'ai') {
    if (g.phase === 'roll') s.timer = setTimeout(() => submit({ t: 'roll' }, p), 650 * fast);
    else if (g.phase === 'move') s.timer = setTimeout(() => submit({ t: 'move', k: chooseMove(g, p, g.s.dice, s.level) }, p), 520 * fast);
  } else if (g.phase === 'move' && settings.autoMove) {
    const legal = g.s.legal;
    const progs = new Set(legal.map((k) => g.s.tokens[p][k]));
    if (legal.length === 1 || progs.size === 1) s.timer = setTimeout(() => submit({ t: 'move', k: legal[0] }, p), 420);
  }
}

function humanRoll() {
  if (!session || session.busy) return;
  const g = session.game;
  const p = g.current;
  if (!session.mySeats.has(p) || g.phase !== 'roll' || session.players[p].type === 'ai') return;
  sfx.click();
  hideControls();
  submit({ t: 'roll' }, p);
}
$('#chips').addEventListener('click', (e) => { if (e.target.closest('.die.ready')) humanRoll(); });
view.onDicePick = humanRoll;
view.onTokenPick = ({ player, token }) => {
  if (!session || session.busy) return;
  const g = session.game;
  if (g.current !== player || g.phase !== 'move' || !session.mySeats.has(player)) return;
  clearTimeout(session.timer);
  hideControls();
  submit({ t: 'move', k: token }, player);
};
document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.code === 'Enter') && session && !e.target.closest('input')) { e.preventDefault(); humanRoll(); }
  if (e.key >= '1' && e.key <= '4' && session) {
    const g = session.game;
    const k = Number(e.key) - 1;
    if (g.phase === 'move' && g.s.legal.includes(k)) view.onTokenPick({ player: g.current, token: k });
  }
  if (e.code === 'Escape' && session) pause();
});

// ---------------------------------------------------------------- chips
function buildChips() {
  const wrap = $('#chips');
  wrap.innerHTML = '';
  if (!session) return;
  for (const p of session.game.s.seats) {
    const pl = session.players[p];
    const el = document.createElement('div');
    el.className = 'chip ' + view.cornerOf(p);
    el.dataset.p = p;
    el.style.setProperty('--c', COLOR_CSS[COLORS[p]]);
    const icon = pl.type === 'ai' ? '🤖' : pl.type === 'remote' ? '🌐' : '🙂';
    const you = session.mode !== 'local' && session.mySeats.has(p) ? 'YOU' : session.mode === 'local' && pl.type === 'human' && session.mySeats.size === 1 ? 'YOU' : '';
    el.innerHTML = `<div class="avatar">${icon}</div><div class="info"><div class="name"></div><div class="pips">${'<i></i>'.repeat(4)}</div>${you ? `<div class="tag">${you}</div>` : ''}</div><button class="die" aria-label="Roll dice"><span class="face">${'<i></i>'.repeat(9)}</span></button>`;
    el.querySelector('.name').textContent = pname(p);
    paintDie(el.querySelector('.die'), session.game.s.dice || 5);
    wrap.appendChild(el);
  }
  updateChips();
}

function updateChips() {
  if (!session) return;
  const g = session.game;
  $$('.chip').forEach((el) => {
    const p = Number(el.dataset.p);
    el.classList.toggle('active', p === g.current && g.phase !== 'over');
    el.classList.toggle('done', g.s.finished.includes(p));
    const n = g.homeCount(p);
    el.querySelectorAll('.pips i').forEach((i, k) => i.classList.toggle('home', k < n));
  });
}

const PIP_LAYOUT = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function paintDie(el, v) {
  el.querySelectorAll('.face i').forEach((i, k) => i.classList.toggle('on', PIP_LAYOUT[v].includes(k)));
}

// state: 'idle' | 'ready' (tap to roll) | 'rolling' | 'value'
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
    if (v === 6) el.classList.add('six'); else el.classList.remove('six');
  }
}

// ---------------------------------------------------------------- celebrations
// rockets = background firecrackers, fw = 3D fireworks over the token
const CELEBRATE = {
  six: { title: 'SIX!', sub: 'Roll again', emoji: ['🎲', '✨', '⭐', '🌟'], n: 10, level: 1 },
  out: { title: "Let's go!", sub: 'Token is out', emoji: ['🚀', '✨', '💨'], n: 7, small: true, level: 1 },
  star: { title: 'SAFE!', sub: 'Star square', emoji: ['⭐', '🛡️', '✨', '🌟'], n: 10, small: true, level: 1, ring: true },
  double: { title: 'DOUBLE!', sub: 'Twin tokens', emoji: ['👯', '🛡️', '💪', '✨'], n: 12, level: 2, ring: true },
  capture: { title: 'GOTCHA!', sub: '', emoji: ['💥', '⚔️', '😈', '💫', '🔥'], n: 16, level: 3, fw: true },
  home: { title: 'HOME!', sub: 'Bonus roll', emoji: ['🏠', '🎉', '🥳', '🌟', '🎊'], n: 16, level: 3 },
  finish: { title: 'FINISHED!', sub: '', emoji: ['🏆', '👑', '🎉', '🎊', '⭐'], n: 22, level: 4, fw: true },
};
function celebrate(kind, p, sub, pos) {
  const c = CELEBRATE[kind];
  const fx = $('#fx');
  const css = COLOR_CSS[COLORS[p]];
  const box = document.createElement('div');
  box.className = `cele cele-${kind}${c.small ? ' small' : ''}`;
  box.style.setProperty('--c', css);
  box.innerHTML = '<div class="title"></div><div class="sub"></div>';
  box.querySelector('.title').textContent = c.title;
  box.querySelector('.sub').textContent = sub ?? c.sub;
  fx.appendChild(box);
  for (let i = 0; i < c.n; i++) {
    const e = document.createElement('span');
    e.className = 'fly';
    e.textContent = c.emoji[i % c.emoji.length];
    const a = (i / c.n) * Math.PI * 2 + Math.random() * 0.5;
    const d = 90 + Math.random() * (c.small ? 60 : 140);
    e.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    e.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
    e.style.setProperty('--r', `${(Math.random() - 0.5) * 120}deg`);
    e.style.setProperty('--s', `${0.8 + Math.random() * 0.8}`);
    e.style.animationDelay = `${Math.random() * 0.12}s`;
    box.appendChild(e);
  }
  // background firecrackers + flash in the player's own colour
  bgfx.party(css, c.level);
  const hex = COLOR_HEX[COLORS[p]];
  if (pos && c.ring) { view.shockwave(pos, hex, kind === 'double' ? 2.4 : 1.8); view.burst(pos, hex, 30); }
  if (pos && c.fw) view.fireworks(pos, view.shades(hex));
  if (kind === 'star' || kind === 'double') sfx.home();
  if (kind === 'capture') { sfx.cheer(); view.shake(0.45); }
  if (kind === 'home' || kind === 'finish') sfx.cheer();
  setTimeout(() => box.remove(), 1900);
  while (fx.children.length > 2) fx.firstChild.remove();
}

// ---------------------------------------------------------------- emoji reactions (online only)
const EMOJIS = ['😂', '😎', '😡', '😭', '👍', '🔥', '🎉', '😈', '🙏', '😱', '🤣', '💪'];
const lastEmoji = {};
function floatEmoji(p, e) {
  if (!EMOJIS.includes(e)) return;
  const chip = $(`.chip[data-p="${p}"]`);
  const r = chip ? chip.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const el = document.createElement('div');
  el.className = 'emoji-float';
  el.textContent = e;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 2}px`;
  if (r.top > innerHeight / 2) el.classList.add('up'); else el.classList.add('down');
  $('#fx').appendChild(el);
  sfx.pop();
  setTimeout(() => el.remove(), 2600);
}
function sendEmoji(e) {
  const s = session;
  if (!s || s.mode === 'local') return;
  const now = Date.now();
  if (now - (lastEmoji.me || 0) < 900) return;
  lastEmoji.me = now;
  const seat = [...s.mySeats][0];
  if (s.mode === 'host') { s.net.broadcast({ t: 'emoji', p: seat, e }); floatEmoji(seat, e); } else s.net.send({ t: 'emoji', e });
}
$('#emojiPanel').innerHTML = EMOJIS.map((e) => `<button>${e}</button>`).join('');
$('#emojiPanel').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  sendEmoji(b.textContent);
  $('#emojiPanel').classList.add('hidden');
});
$('#btnEmoji').addEventListener('click', () => { sfx.click(); $('#emojiPanel').classList.toggle('hidden'); });

// ---------------------------------------------------------------- game over
function gameOver() {
  const s = session;
  if (!s || s.over) return;
  s.over = true;
  clearTimeout(s.timer);
  hideControls();
  view.setTurn(-1);
  setTurnGlow(COLOR_CSS[COLORS[s.game.s.finished[0]]]);
  localStorage.removeItem(SAVE_KEY);
  const order = s.game.s.finished;
  const winner = order[0];
  const iWon = s.mySeats.has(winner);
  const anyHuman = s.mySeats.size > 0;
  $('#overTitle').textContent = s.mySeats.size > 1 || !anyHuman ? `${pname(winner)} wins!` : iWon ? 'You win! 🎉' : `${pname(winner)} wins`;
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  $('#ranking').innerHTML = '';
  order.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="medal">${medals[i]}</span><span class="dot" style="--c:${COLOR_CSS[COLORS[p]]}"></span><span></span>`;
    li.lastChild.textContent = pname(p);
    $('#ranking').appendChild(li);
  });
  $('#btnAgain').textContent = s.mode === 'client' ? 'Waiting for host…' : 'Play again';
  $('#btnAgain').disabled = s.mode === 'client';
  view.confetti();
  sfx.win();
  const wcss = COLOR_CSS[COLORS[winner]];
  bgfx.party(wcss, 4);
  setTimeout(() => bgfx.confettiRain(wcss, 200), 3500);
  setTimeout(() => { if (session === s) show('#scrOver'); }, 1200);
}

$('#btnAgain').addEventListener('click', () => {
  sfx.click();
  if (!session) return;
  const { mode, players, level, net, mySeats } = session;
  if (mode === 'host') {
    const st = new LudoGame(players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0)).toJSON();
    net.broadcast({ t: 'start', players: publicPlayers(players), state: st });
    session.net = null; // keep connection alive while replacing session
    startSession({ mode, players, level, net, mySeat: [...mySeats][0], state: st });
  } else startSession({ mode, players, level });
});
$('#btnOverMenu').addEventListener('click', () => { sfx.click(); endSession(); show('#scrMenu'); refreshMenu(); });

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
  if (!session) return;
  if (!confirm('Restart this game?')) return;
  const { mode, players, level, net, mySeats } = session;
  if (mode === 'host') {
    const st = new LudoGame(players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0)).toJSON();
    net.broadcast({ t: 'start', players: publicPlayers(players), state: st });
    session.net = null;
    startSession({ mode, players, level, net, mySeat: [...mySeats][0], state: st });
  } else if (mode === 'local') startSession({ mode, players, level });
});
$('#btnQuit').addEventListener('click', () => {
  sfx.click();
  if (session && session.mode !== 'local' && !confirm('Leave the online game?')) return;
  endSession();
  show('#scrMenu');
  refreshMenu();
});
$('#btnPauseSettings').addEventListener('click', () => { openSettings(); });
$('#btnSound').addEventListener('click', () => { settings.sound = !settings.sound; applySettings(); sfx.click(); });

// ---------------------------------------------------------------- settings screen
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

// ---------------------------------------------------------------- local setup
let setupState = null;
function seatRow(p, cfg, onChange, { editableName = true, options = ['human', 'ai', 'off'] } = {}) {
  const row = document.createElement('div');
  row.className = 'seat' + (cfg.type === 'off' ? ' off' : '');
  row.style.setProperty('--c', COLOR_CSS[COLORS[p]]);
  const labels = { human: 'Human', ai: 'CPU', off: 'Off', open: 'Open' };
  row.innerHTML = `<span class="dot"></span>`;
  if (editableName) {
    const inp = document.createElement('input');
    inp.maxLength = 14;
    inp.value = cfg.name;
    inp.placeholder = COLOR_NAME[COLORS[p]];
    inp.addEventListener('input', () => { cfg.name = inp.value.trim(); });
    row.appendChild(inp);
  } else {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = cfg.label || cfg.name;
    row.appendChild(who);
  }
  if (options.length) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = labels[o];
      b.classList.toggle('on', cfg.type === o);
      b.addEventListener('click', () => { sfx.click(); onChange(o); });
      seg.appendChild(b);
    }
    row.appendChild(seg);
  }
  return row;
}

function renderSetup() {
  const wrap = $('#seatRows');
  wrap.innerHTML = '';
  setupState.players.forEach((cfg, p) => {
    wrap.appendChild(seatRow(p, cfg, (type) => {
      cfg.type = type;
      if (type === 'ai' && (!cfg.name || cfg.name === 'You')) cfg.name = `CPU ${COLOR_NAME[COLORS[p]]}`;
      if (type === 'human' && cfg.name.startsWith('CPU')) cfg.name = COLOR_NAME[COLORS[p]];
      renderSetup();
    }));
  });
  $$('#segLevel button').forEach((b) => b.classList.toggle('on', b.dataset.v === setupState.level));
  $('#setupErr').textContent = '';
}
$$('#segLevel button').forEach((b) => b.addEventListener('click', () => { sfx.click(); setupState.level = b.dataset.v; renderSetup(); }));

function openSetup(kind) {
  const myName = localStorage.getItem(NAME_KEY) ? safeJSON(localStorage.getItem(NAME_KEY)) : '';
  if (kind === 'cpu') {
    $('#setupTitle').textContent = 'Play vs Computer';
    setupState = { level: 'normal', players: COLORS.map((c, p) => (p === 0
      ? { type: 'human', name: myName || 'You' }
      : { type: 'ai', name: `CPU ${COLOR_NAME[c]}` })) };
  } else {
    $('#setupTitle').textContent = 'Pass & Play';
    const on = SEATS_FOR[2];
    setupState = { level: 'normal', players: COLORS.map((c, p) => ({ type: on.includes(p) ? 'human' : 'off', name: COLOR_NAME[c] })) };
  }
  renderSetup();
  show('#scrSetup', true);
}
$('#btnVsCpu').addEventListener('click', () => { sfx.click(); openSetup('cpu'); });
$('#btnLocal').addEventListener('click', () => { sfx.click(); openSetup('local'); });
$('#btnStart').addEventListener('click', () => {
  sfx.click();
  const players = setupState.players.map((p, i) => ({ type: p.type, name: p.name || COLOR_NAME[COLORS[i]] }));
  const active = players.filter((p) => p.type !== 'off');
  if (active.length < 2) { $('#setupErr').textContent = 'Need at least 2 players.'; sfx.error(); return; }
  const me = players.find((p) => p.type === 'human');
  if (me && me.name !== 'You') store(NAME_KEY, me.name);
  startSession({ mode: 'local', players, level: setupState.level });
});
$('#btnContinue').addEventListener('click', () => {
  sfx.click();
  const sv = safeJSON(localStorage.getItem(SAVE_KEY));
  if (!sv) return refreshMenu();
  startSession({ mode: 'local', players: sv.players, level: sv.level, state: sv.state });
});

// ---------------------------------------------------------------- online
const publicPlayers = (players) => players.map((p) => ({ type: p.type, name: p.name }));
let lobby = null; // { role:'host'|'client', net, players, mySeat }

function myOnlineName() {
  const n = $('#inpName').value.trim() || 'Player';
  store(NAME_KEY, n);
  return n;
}

$('#btnOnline').addEventListener('click', () => {
  sfx.click();
  $('#inpName').value = safeJSON(localStorage.getItem(NAME_KEY)) || '';
  $('#onlineMsg').textContent = '';
  show('#scrOnline', true);
});

$('#btnCreate').addEventListener('click', async () => {
  sfx.click();
  const name = myOnlineName();
  $('#onlineMsg').textContent = 'Creating room…';
  $('#btnCreate').disabled = true;
  const net = new HostNet();
  try {
    const code = await net.start();
    $('#onlineMsg').textContent = '';
    lobby = {
      role: 'host', net, mySeat: 0,
      players: [{ type: 'human', name }, { type: 'open', name: '' }, { type: 'open', name: '' }, { type: 'open', name: '' }],
    };
    lobby.players.forEach((p) => { p.peer = null; });
    wireHost(net);
    $('#lobbyCode').textContent = code;
    renderLobby();
    show('#scrLobby', true);
  } catch (e) {
    $('#onlineMsg').textContent = e.message;
    sfx.error();
  }
  $('#btnCreate').disabled = false;
});

function hostSeatOf(peerId) {
  const list = session ? session.players : lobby?.players;
  return list ? list.findIndex((p) => p.peer === peerId) : -1;
}

function wireHost(net) {
  net.on('message', (peer, msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (session || !lobby) { net.send(peer, { t: 'full', why: 'Game already started.' }); setTimeout(() => net.kick(peer), 300); return; }
      const order = [2, 1, 3];
      const seat = order.find((i) => lobby.players[i].type === 'open');
      if (seat === undefined) { net.send(peer, { t: 'full', why: 'Room is full.' }); setTimeout(() => net.kick(peer), 300); return; }
      lobby.players[seat] = { type: 'remote', name: String(msg.name || 'Guest').slice(0, 14), peer };
      net.send(peer, { t: 'welcome', seat });
      sfx.enterBoard();
      renderLobby();
      broadcastLobby();
    } else if (msg.t === 'intent' && session) {
      const seat = hostSeatOf(peer);
      if (seat < 0 || !msg.a) return;
      const a = msg.a.t === 'roll' ? { t: 'roll' } : { t: 'move', k: Number(msg.a.k) };
      submit(a, seat);
    } else if (msg.t === 'emoji' && session) {
      const seat = hostSeatOf(peer);
      const now = Date.now();
      if (seat < 0 || !EMOJIS.includes(msg.e) || now - (lastEmoji[seat] || 0) < 800) return;
      lastEmoji[seat] = now;
      net.broadcast({ t: 'emoji', p: seat, e: msg.e });
      floatEmoji(seat, msg.e);
    } else if (msg.t === 'resync' && session) {
      net.send(peer, { t: 'start', players: publicPlayers(session.players), state: session.game.toJSON(), resync: true });
    }
  });
  net.on('leave', (peer) => {
    if (session && session.mode === 'host') {
      const seat = hostSeatOf(peer);
      if (seat < 0) return;
      const pl = session.players[seat];
      toast(`${pl.name} left — computer takes over`, COLOR_CSS[COLORS[seat]], 2.5);
      pl.type = 'ai';
      pl.peer = null;
      pl.name += ' 🤖';
      net.broadcast({ t: 'players', players: publicPlayers(session.players) });
      buildChips();
      if (!session.busy) afterIdle();
    } else if (lobby?.role === 'host') {
      const seat = lobby.players.findIndex((p) => p.peer === peer);
      if (seat >= 0) { lobby.players[seat] = { type: 'open', name: '', peer: null }; renderLobby(); broadcastLobby(); }
    }
  });
  net.on('error', (m) => { $('#lobbyMsg').textContent = m; });
}

function broadcastLobby() {
  if (lobby?.role === 'host') lobby.net.broadcast({ t: 'lobby', players: publicPlayers(lobby.players) });
}

function renderLobby() {
  const wrap = $('#lobbySeats');
  wrap.innerHTML = '';
  const host = lobby.role === 'host';
  lobby.players.forEach((cfg, p) => {
    let label = cfg.name;
    if (cfg.type === 'open') label = 'Waiting for player…';
    if (cfg.type === 'off') label = '—';
    if (cfg.type === 'ai') label = `Computer`;
    if (p === lobby.mySeat) label += ' (you)';
    const editable = host && p !== 0 && cfg.type !== 'remote';
    const row = seatRow(p, { ...cfg, label }, (type) => {
      lobby.players[p] = { type, name: type === 'ai' ? `CPU ${COLOR_NAME[COLORS[p]]}` : '', peer: null };
      renderLobby();
      broadcastLobby();
    }, { editableName: false, options: editable ? ['open', 'ai', 'off'] : [] });
    if (host && cfg.type === 'remote') {
      const kick = document.createElement('button');
      kick.className = 'btn btn-ghost small';
      kick.style.width = 'auto';
      kick.textContent = 'Kick';
      kick.onclick = () => { lobby.net.kick(cfg.peer); lobby.players[p] = { type: 'open', name: '', peer: null }; renderLobby(); broadcastLobby(); };
      row.appendChild(kick);
    }
    wrap.appendChild(row);
  });
  $('#btnLobbyStart').classList.toggle('hidden', !host);
  $('#lobbyNote').textContent = host ? 'Share the code. Friends join from “Play Online”. Open seats left empty are removed.' : 'Waiting for the host to start…';
}

$('#btnShare').addEventListener('click', async () => {
  sfx.click();
  const code = $('#lobbyCode').textContent;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Ludo 3D', text: `Join my Ludo game! Room code ${code}`, url });
    else { await navigator.clipboard.writeText(url); toastLobby('Link copied!'); }
  } catch { /* cancelled */ }
});
function toastLobby(m) { $('#lobbyMsg').textContent = m; setTimeout(() => { $('#lobbyMsg').textContent = ''; }, 2000); }

$('#btnLobbyStart').addEventListener('click', () => {
  sfx.click();
  const players = lobby.players.map((p) => ({ ...p, type: p.type === 'open' ? 'off' : p.type }));
  players.forEach((p, i) => { if (p.type === 'off') p.name = ''; else if (!p.name) p.name = COLOR_NAME[COLORS[i]]; });
  if (players.filter((p) => p.type !== 'off').length < 2) { $('#lobbyMsg').textContent = 'Need at least 2 players (add a Computer or wait for friends).'; sfx.error(); return; }
  const net = lobby.net;
  const seats = players.map((p, i) => (p.type !== 'off' ? i : -1)).filter((i) => i >= 0);
  const state = new LudoGame(seats).toJSON();
  net.broadcast({ t: 'start', players: publicPlayers(players), state });
  lobby = null;
  startSession({ mode: 'host', players, level: 'normal', net, mySeat: 0, state });
});

$('#btnLobbyLeave').addEventListener('click', () => {
  sfx.click();
  lobby?.net.close();
  lobby = null;
  show('#scrMenu');
});

$('#btnJoin').addEventListener('click', joinRoom);
$('#inpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
async function joinRoom() {
  sfx.click();
  const code = $('#inpCode').value.trim().toUpperCase();
  if (code.length !== 5) { $('#onlineMsg').textContent = 'Enter the 5-letter room code.'; sfx.error(); return; }
  const name = myOnlineName();
  $('#onlineMsg').textContent = 'Connecting…';
  $('#btnJoin').disabled = true;
  const net = new ClientNet();
  try {
    await net.join(code);
    wireClient(net);
    net.send({ t: 'hello', name });
    $('#onlineMsg').textContent = 'Joined! Waiting for host…';
  } catch (e) {
    $('#onlineMsg').textContent = e.message;
    sfx.error();
    net.close();
  }
  $('#btnJoin').disabled = false;
}

function wireClient(net) {
  let mySeat = -1;
  net.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        mySeat = msg.seat;
        lobby = { role: 'client', net, mySeat, players: [0, 1, 2, 3].map(() => ({ type: 'open', name: '' })) };
        $('#lobbyCode').textContent = net.code;
        renderLobby();
        show('#scrLobby', true);
        break;
      case 'lobby':
        if (lobby) { lobby.players = msg.players; renderLobby(); }
        break;
      case 'full':
        $('#onlineMsg').textContent = msg.why || 'Room is full.';
        break;
      case 'start': {
        lobby = null;
        const players = msg.players.map((p) => ({ ...p }));
        startSession({ mode: 'client', players, net, mySeat, state: msg.state });
        if (msg.resync) toast('Re-synced with host');
        break;
      }
      case 'act':
        if (session?.mode === 'client') { session.queue.push({ kind: 'act', a: msg.a }); pump(); }
        break;
      case 'emoji':
        if (session) floatEmoji(msg.p, msg.e);
        break;
      case 'players':
        if (session) { msg.players.forEach((p, i) => Object.assign(session.players[i], p)); buildChips(); }
        break;
      default:
    }
  });
  net.on('close', () => {
    if (session?.mode === 'client' || lobby?.role === 'client') {
      const wasOver = session?.over;
      lobby = null;
      if (session) { session.net = null; endSession(); }
      show('#scrMenu');
      refreshMenu();
      if (!wasOver) alert('Disconnected from the host.');
    }
  });
}

// ---------------------------------------------------------------- menu & attract mode
function refreshMenu() {
  const sv = safeJSON(localStorage.getItem(SAVE_KEY));
  $('#btnContinue').classList.toggle('hidden', !sv || sv.state?.phase === 'over');
}

let attractTimer = null;
function setTurnGlow(css) { $('#bg').style.setProperty('--turn', css || 'rgba(255,255,255,0)'); }

function attract() {
  clearInterval(attractTimer);
  let i = 0;
  const cycle = () => {
    if (session) { clearInterval(attractTimer); return; }
    view.setTurn(i % 4);
    setTurnGlow(COLOR_CSS[COLORS[i % 4]]);
    i++;
  };
  cycle();
  attractTimer = setInterval(cycle, 2600);
  bgfx.ambient(() => COLOR_CSS[COLORS[Math.floor(Math.random() * 4)]]);
  const g = new LudoGame([0, 1, 2, 3]);
  view.setPlayers(g.s.seats);
  view.layout(g, 0);
  view.setView(0, false);
  view.controls.autoRotate = true;
  view.controls.autoRotateSpeed = 0.5;
}

// ---------------------------------------------------------------- PWA
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('#btnInstall').classList.remove('hidden');
});
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('#btnInstall').classList.add('hidden');
});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
}
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
if (roomParam) {
  $('#inpName').value = safeJSON(localStorage.getItem(NAME_KEY)) || '';
  $('#inpCode').value = roomParam.toUpperCase().slice(0, 5);
  show('#scrMenu');
  show('#scrOnline', true);
  history.replaceState(null, '', location.pathname);
}
requestAnimationFrame(() => $('#loading').classList.add('gone'));
setTimeout(() => $('#loading').remove(), 800);

// debug hook
window.__ludo = { get session() { return session; }, view };
