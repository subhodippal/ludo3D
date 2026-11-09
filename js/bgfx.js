// Background celebrations drawn on a 2D canvas behind the 3D board:
// firework rockets (several burst styles), corner fountains, confetti rain,
// colour flashes and light beams. The loop only runs while something is alive.

import { sfx } from './audio.js';

const cv = document.getElementById('bgfx');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const rockets = [];
const sparks = [];
const fountains = [];
const confetti = [];
let running = false;
let last = 0;
const MAX_SPARKS = 1500;
const MAX_CONFETTI = 260;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth;
  H = window.innerHeight;
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const rnd = (a, b) => a + Math.random() * (b - a);
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// lighter variant of the base colour, with occasional white / gold sparks
function variant([r, g, b], glitter = 0.12) {
  const k = Math.random();
  if (k < glitter) return [255, 255, 255];
  if (k < glitter + 0.08) return [255, 220, 120];
  const w = rnd(0, 0.45);
  return [r + (255 - r) * w, g + (255 - g) * w, b + (255 - b) * w].map(Math.round);
}

function start() {
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function addSpark(o) {
  if (sparks.length >= MAX_SPARKS) sparks.shift();
  sparks.push({ px: o.x, py: o.y, age: 0, size: 2, drag: 0.18, grav: 140, crackle: false, trail: 0.03, ...o });
}

// ---------------------------------------------------------------- rockets
const TYPES = ['peony', 'peony', 'ring', 'willow', 'crossette', 'palm', 'double', 'glitter'];

// Launch n rockets in the given colour. power scales burst size.
export function launch(color, n = 3, power = 1, quiet = false) {
  if (document.hidden) return;
  const base = hexToRgb(color);
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const x = rnd(0.06, 0.94) * W;
      const ty = rnd(0.08, 0.45) * H;
      rockets.push({
        x, y: H + 10,
        vx: (W / 2 - x) * rnd(0, 0.15) + rnd(-30, 30), vy: -Math.sqrt(2 * 900 * (H - ty)) * rnd(0.96, 1.04),
        color: base, power: power * rnd(0.85, 1.15), type: pickOne(TYPES), quiet,
      });
      start();
    }, i * rnd(90, 200) + (i > 6 ? rnd(0, 300) : 0));
  }
}

function explode(r) {
  const { x, y, color: c } = r;
  const P = r.power;
  const speed = rnd(170, 260) * Math.sqrt(P);
  const count = Math.round(75 * P);
  switch (r.type) {
    case 'ring':
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        addSpark({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: rnd(1, 1.4), c: variant(c, 0.05), size: 2.2 });
      }
      break;
    case 'double': {
      const c2 = variant(c, 0);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        addSpark({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1.3, c: variant(c, 0.05), size: 2.2 });
        addSpark({ x, y, vx: Math.cos(a) * speed * 0.55, vy: Math.sin(a) * speed * 0.55, life: 1.1, c: c2, size: 1.8 });
      }
      break;
    }
    case 'willow': // long golden-tinted drooping trails
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * Math.sqrt(Math.random()) * 0.9;
        addSpark({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(2, 2.8), c: Math.random() < 0.5 ? [255, 210, 120] : variant(c, 0), size: 1.6, drag: 0.35, grav: 90, trail: 0.09 });
      }
      break;
    case 'palm': // a few thick fronds
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rnd(-0.1, 0.1);
        for (let j = 0; j < 6; j++) {
          const s = speed * (0.75 + j * 0.05);
          addSpark({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(1.4, 1.8), c: variant(c, 0.05), size: 3, trail: 0.06 });
        }
      }
      break;
    case 'crossette': // sparks that split into four
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        addSpark({ x, y, vx: Math.cos(a) * speed * 0.8, vy: Math.sin(a) * speed * 0.8, life: 0.6, c: variant(c, 0.1), size: 2.6, split: true });
      }
      break;
    case 'glitter': // white-gold twinkles around a coloured core
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * Math.sqrt(Math.random());
        addSpark({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(1.2, 2), c: i % 3 ? [255, 240, 200] : variant(c, 0), size: 1.5, crackle: true });
      }
      break;
    default: // peony
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rnd(-0.05, 0.05);
        const s = speed * Math.sqrt(Math.random());
        addSpark({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.9, 1.6), c: variant(c), crackle: Math.random() < 0.3, size: rnd(1.4, 2.6) });
      }
  }
  if (!r.quiet) sfx.firework(Math.min(P, 1.3));
}

// ---------------------------------------------------------------- fountains
// Sparks spraying up from both bottom corners
export function fountain(color, duration = 1.4, strength = 1) {
  if (document.hidden) return;
  const c = hexToRgb(color);
  fountains.push({ x: W * 0.04, dir: 1, c, t: 0, life: duration, s: strength });
  fountains.push({ x: W * 0.96, dir: -1, c, t: 0, life: duration, s: strength });
  start();
}

// ---------------------------------------------------------------- confetti
export function confettiRain(color, count = 120) {
  if (document.hidden) return;
  const base = hexToRgb(color);
  const extra = [[255, 255, 255], [255, 214, 64], [255, 110, 200]];
  for (let i = 0; i < count; i++) {
    if (confetti.length >= MAX_CONFETTI) confetti.shift();
    confetti.push({
      x: rnd(0, W), y: rnd(-H * 0.6, -10), vx: rnd(-30, 30), vy: rnd(70, 150),
      w: rnd(6, 11), h: rnd(9, 16), a: rnd(0, 6.28), va: rnd(-6, 6), flip: rnd(0, 6.28), vf: rnd(4, 9),
      c: Math.random() < 0.6 ? variant(base, 0) : pickOne(extra), sway: rnd(0, 6.28),
    });
  }
  start();
}

// ---------------------------------------------------------------- DOM layers
export function flash(color) {
  const el = document.querySelector('#bg .flash');
  if (!el) return;
  el.style.setProperty('--flash', color);
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

export function beams(color, seconds = 2.2) {
  const el = document.querySelector('#bg .beams');
  if (!el) return;
  el.style.setProperty('--beam', color);
  el.style.setProperty('--beam-t', seconds + 's');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
}

// ---------------------------------------------------------------- party presets
// level 1 = small (six, star), 2 = medium (double, out), 3 = big (capture, home), 4 = huge (finish / win)
export function party(color, level = 1) {
  const L = [null,
    { rockets: 5, power: 0.85 },
    { rockets: 7, power: 0.95, fountain: 1 },
    { rockets: 12, power: 1.15, fountain: 1.6, confetti: 90, flash: true, beams: true },
    { rockets: 24, power: 1.35, fountain: 2.6, confetti: 220, flash: true, beams: true },
  ][Math.max(1, Math.min(4, level))];
  launch(color, L.rockets, L.power);
  if (L.fountain) fountain(color, L.fountain);
  if (L.confetti) setTimeout(() => confettiRain(color, L.confetti), 250);
  if (L.flash) flash(color);
  if (L.beams) beams(color, level >= 4 ? 4 : 2.4);
  if (level >= 4) setTimeout(() => { launch(color, 16, 1.2); fountain(color, 2); }, 2200);
}

// ---------------------------------------------------------------- ambient
// Occasional gentle fireworks so the background always feels festive.
let ambientTimer = null;
export function ambient(colorFn) {
  clearTimeout(ambientTimer);
  if (!colorFn) return;
  const tick = () => {
    if (!document.hidden) launch(colorFn(), Math.random() < 0.3 ? 2 : 1, rnd(0.45, 0.65), true);
    ambientTimer = setTimeout(tick, rnd(4500, 9000));
  };
  ambientTimer = setTimeout(tick, rnd(1500, 3500));
}

// ---------------------------------------------------------------- loop
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    const px = r.x, py = r.y;
    r.vy += 900 * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    const [cr, cg, cb] = r.color;
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px, py + 16);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r.x, r.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // little trailing embers
    if (Math.random() < 0.6) addSpark({ x: r.x, y: r.y + 6, vx: rnd(-20, 20), vy: rnd(20, 60), life: 0.4, c: [255, 200, 120], size: 1.2 });
    if (r.vy >= -30) { rockets.splice(i, 1); explode(r); }
  }

  for (const f of fountains) {
    f.t += dt;
    const n = Math.round(10 * f.s);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + f.dir * rnd(0.12, 0.55);
      const s = rnd(380, 620) * Math.sqrt(H / 800);
      addSpark({ x: f.x, y: H + 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.9, 1.5), c: variant(f.c, 0.2), size: rnd(1.5, 2.6), drag: 0.6, grav: 520, crackle: Math.random() < 0.2 });
    }
  }
  for (let i = fountains.length - 1; i >= 0; i--) if (fountains[i].t >= fountains[i].life) fountains.splice(i, 1);

  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.age += dt;
    if (p.age >= p.life) {
      if (p.split) {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + rnd(0, 0.8);
          addSpark({ x: p.x, y: p.y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, life: rnd(0.6, 0.9), c: p.c, size: 1.8, crackle: true });
        }
        sfx._noiseHit?.({ dur: 0.03, vol: 0.05, freq: 4000, q: 4 });
      }
      sparks.splice(i, 1);
      continue;
    }
    p.px = p.x; p.py = p.y;
    const drag = Math.pow(p.drag, dt);
    p.vx *= drag; p.vy = p.vy * drag + p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    let a = 1 - p.age / p.life;
    if (p.crackle && p.age > p.life * 0.45) a *= Math.random() < 0.5 ? 0.12 : 1;
    const [cr, cg, cb] = p.c;
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`;
    ctx.lineWidth = p.size;
    ctx.beginPath();
    ctx.moveTo(p.x - p.vx * p.trail, p.y - p.vy * p.trail);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
  for (let i = confetti.length - 1; i >= 0; i--) {
    const q = confetti[i];
    q.sway += dt * 3;
    q.x += (q.vx + Math.sin(q.sway) * 40) * dt;
    q.y += q.vy * dt;
    q.a += q.va * dt;
    q.flip += q.vf * dt;
    if (q.y > H + 20) { confetti.splice(i, 1); continue; }
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(q.a);
    ctx.scale(1, Math.cos(q.flip));
    ctx.fillStyle = `rgb(${q.c[0]},${q.c[1]},${q.c[2]})`;
    ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
    ctx.restore();
  }

  if (rockets.length || sparks.length || fountains.length || confetti.length) requestAnimationFrame(frame);
  else { running = false; ctx.clearRect(0, 0, W, H); }
}
