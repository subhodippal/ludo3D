// Three.js scene: board, pawns, camera, picking and effects

import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import {
  COLORS, COLOR_HEX, COLOR_CSS, TRACK, HOME_COLUMN, START_INDEX, STAR_INDICES, YARD_ORIGIN,
  HOME_SPOT, PROGRESS_HOME, cellFor, yardSpot,
} from './constants.js';
import { Dice } from './dice.js';
import { tween, ease, updateTweens } from './anim.js';
import { sfx } from './audio.js';
import { Fx3D } from './fx3d.js';
import { BgDice } from './bgdice.js';

const toWorld = ([c, r], y = 0) => new THREE.Vector3(c - 7, y, r - 7);

// ---------- textures
function drawStar(g, cx, cy, R, r, fill, stroke) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 4; g.stroke(); }
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function boardTexture(renderer, size) {
  const N = size;
  const C = N / 15;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const line = '#2b2b2b';
  const lw = Math.max(2, N / 520);
  // printed ink: a touch deeper than the token colours so the lit board stays saturated
  const ink = Object.fromEntries(COLORS.map((c) => [c, shade(COLOR_HEX[c], 0.86)]));

  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);

  const cellRect = ([c, r], fill) => {
    g.fillStyle = fill;
    g.fillRect(c * C, r * C, C, C);
  };

  // home columns + start squares in solid colour
  COLORS.forEach((col, p) => {
    const css = ink[col];
    HOME_COLUMN[p].forEach((cell) => cellRect(cell, css));
    cellRect(TRACK[START_INDEX[p]], css);
  });

  // grid lines on track
  g.strokeStyle = line;
  g.lineWidth = lw;
  [...TRACK, ...HOME_COLUMN.flat()].forEach(([c, r]) => g.strokeRect(c * C, r * C, C, C));

  // stars on safe squares
  STAR_INDICES.forEach((i) => {
    const [c, r] = TRACK[i];
    drawStar(g, (c + 0.5) * C, (r + 0.5) * C, C * 0.34, C * 0.15, '#ffffff', '#6b6b6b');
  });
  COLORS.forEach((col, p) => {
    const [c, r] = TRACK[START_INDEX[p]];
    drawStar(g, (c + 0.5) * C, (r + 0.5) * C, C * 0.34, C * 0.15, '#ffffff', null);
  });
  // entry arrows into home column
  COLORS.forEach((col, p) => {
    const [c, r] = TRACK[(START_INDEX[p] + 50) % 52];
    const [hc, hr] = HOME_COLUMN[p][0];
    const ang = Math.atan2(hr - r, hc - c);
    g.save();
    g.translate((c + 0.5) * C, (r + 0.5) * C);
    g.rotate(ang);
    g.fillStyle = ink[col];
    g.beginPath();
    g.moveTo(C * 0.32, 0);
    g.lineTo(-C * 0.1, -C * 0.28);
    g.lineTo(-C * 0.1, -C * 0.1);
    g.lineTo(-C * 0.32, -C * 0.1);
    g.lineTo(-C * 0.32, C * 0.1);
    g.lineTo(-C * 0.1, C * 0.1);
    g.lineTo(-C * 0.1, C * 0.28);
    g.closePath();
    g.fill();
    g.restore();
  });

  // yards: solid colour, white inner square, four coloured circles
  COLORS.forEach((col, p) => {
    const [ox, oy] = YARD_ORIGIN[p];
    const css = ink[col];
    g.fillStyle = css;
    g.fillRect(ox * C, oy * C, 6 * C, 6 * C);
    const pad = 0.75 * C;
    const x = ox * C + pad, y = oy * C + pad, w = 6 * C - 2 * pad;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(x, y, w, w, C * 0.3);
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = line;
    g.stroke();
    for (let t = 0; t < 4; t++) {
      const [sc, sr] = yardSpot(p, t);
      const cx = (sc + 0.5) * C, cy = (sr + 0.5) * C, R = C * 0.44;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.fillStyle = css;
      g.fill();
      g.beginPath();
      g.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fill();
    }
    g.strokeStyle = line;
    g.lineWidth = lw;
    g.strokeRect(ox * C, oy * C, 6 * C, 6 * C);
  });

  // centre triangles
  const m = 7.5 * C;
  const tri = (pts, col) => {
    g.beginPath();
    g.moveTo(pts[0][0] * C, pts[0][1] * C);
    g.lineTo(pts[1][0] * C, pts[1][1] * C);
    g.lineTo(m, m);
    g.closePath();
    g.fillStyle = ink[col];
    g.fill();
    g.strokeStyle = line;
    g.lineWidth = lw;
    g.stroke();
  };
  tri([[6, 6], [6, 9]], 'red');
  tri([[6, 6], [9, 6]], 'green');
  tri([[9, 6], [9, 9]], 'yellow');
  tri([[6, 9], [9, 9]], 'blue');

  g.lineWidth = N / 300;
  g.strokeStyle = line;
  g.strokeRect(0, 0, N, N);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---------- token: round "button" coin
// Profile (radius, height) revolved around Y: rounded outer edge, raised rim,
// recessed top face.
function tokenGeometry() {
  const pts = [
    [0, 0], [0.31, 0], [0.345, 0.012], [0.365, 0.04], [0.37, 0.08], [0.365, 0.12],
    [0.35, 0.15], [0.325, 0.168], [0.295, 0.17], [0.275, 0.16], [0.265, 0.14], [0.2, 0.135], [0, 0.135],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(pts, 48);
  body.computeVertexNormals();
  // white inlay ring on the top face
  const inlay = new THREE.TorusGeometry(0.2, 0.026, 12, 48).rotateX(Math.PI / 2).translate(0, 0.14, 0);
  // glossy dome in the centre
  const dome = new THREE.SphereGeometry(0.13, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.133, 0);
  return { body, inlay, dome };
}

export class Scene3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 20, 12);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false,
      minPolarAngle: 0.05, maxPolarAngle: 1.12, rotateSpeed: 0.6, zoomSpeed: 0.8,
    });

    // lights
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x40384a, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-6, 16, 9);
    sun.castShadow = true;
    const ms = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    scene.add(sun);

    this._buildBoard(quality);
    this._buildParty(quality);
    this.bgDice = new BgDice(scene, this.camera);
    this.dice = new Dice(scene, renderer, { halfX: 7.45, halfZ: 7.45, floorY: 0 });
    this.tokens = [];
    this.selectable = new Map(); // mesh group -> {player, token}
    this.fx = new Fx3D(scene, { confettiColors: Object.values(COLOR_HEX).concat([0xffffff, 0xff7ad9]) });
    this.turnPlayer = -1;
    this.view = { player: 0 };
    this.mode = '3d';
    this.onTokenPick = null;
    this.onDicePick = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._down = null;
    canvas.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', (e) => this._onUp(e));

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());

    this._loop = this._loop.bind(this);
    renderer.setAnimationLoop(this._loop);
  }

  _buildBoard(quality) {
    const { scene, renderer } = this;
    // laminated board: white edges, satin printed top
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.55 });
    const boardMat = new THREE.MeshStandardMaterial({
      map: boardTexture(renderer, quality === 'high' ? 2048 : 1024), roughness: 0.7, envMapIntensity: 0.4,
    });

    const base = new THREE.Mesh(new THREE.BoxGeometry(15, 0.4, 15), [edgeMat, edgeMat, boardMat, edgeMat, edgeMat, edgeMat]);
    base.position.y = -0.2;
    base.receiveShadow = true;
    base.castShadow = true;
    scene.add(base);
    this.boardBase = base;

    // shadow-catching table
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.41;
    ground.receiveShadow = true;
    scene.add(ground);

    // yard turn-highlight overlays
    this.yardGlow = COLORS.map((col, p) => {
      const [ox, oy] = YARD_ORIGIN[p];
      const geo = new THREE.PlaneGeometry(6, 6);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.position.set(ox + 3 - 7.5, 0.004, oy + 3 - 7.5);
      scene.add(m);
      return m;
    });


    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tokenGeo = tokenGeometry();
    this._inlayMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    this._ringGeo = new THREE.RingGeometry(0.42, 0.54, 48).rotateX(-Math.PI / 2);
    this._hitGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.8, 16).translate(0, 0.35, 0);
  }

  // Coloured orbiting lights, a sweeping spotlight and floating sparkles
  _buildParty(quality) {
    const { scene } = this;
    this.partyLights = COLORS.map((col, p) => {
      const l = new THREE.PointLight(COLOR_HEX[col], 0, 0, 2);
      const [ox, oy] = YARD_ORIGIN[p];
      l.userData = { ang: Math.atan2(oy + 3 - 7.5, ox + 3 - 7.5), phase: p * 1.7, level: 0 };
      scene.add(l);
      return l;
    });

    const spot = new THREE.SpotLight(0xfff4e0, 90, 0, 0.32, 0.85, 2);
    spot.position.set(0, 13, 0);
    scene.add(spot, spot.target);
    this.spot = spot;

    // sparkles (soft round sprite, additive)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(cv);

    const palette = [...Object.values(COLOR_HEX), 0xffffff, 0xff7ad9, 0xffe082].map((h) => new THREE.Color(h));
    this.sparkles = [0, 1].map((layer) => {
      const n = quality === 'high' ? 110 : 60;
      const pos = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const speed = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 9.5 + Math.random() * 9;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = -1 + Math.random() * 9;
        pos[i * 3 + 2] = Math.sin(a) * r;
        const c = palette[i % palette.length];
        colors.set([c.r, c.g, c.b], i * 3);
        speed.push(0.3 + Math.random() * 0.7);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: layer ? 0.32 : 0.5, map: sprite, vertexColors: true, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
      });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      return { pts, speed, phase: layer * Math.PI };
    });
  }

  _updateParty(t, dt) {
    for (const [p, l] of this.partyLights.entries()) {
      const d = l.userData;
      const active = p === this.turnPlayer;
      const target = active ? 34 + Math.sin(t * 4) * 10 : 9 + Math.sin(t * 1.3 + d.phase) * 3;
      d.level += (target - d.level) * Math.min(1, dt * 3);
      l.intensity = d.level;
      const a = d.ang + Math.sin(t * 0.6 + d.phase) * 0.45;
      const r = 6.5 + Math.sin(t * 0.9 + d.phase) * 1.2;
      l.position.set(Math.cos(a) * r, 3.6 + Math.sin(t * 1.1 + d.phase) * 0.8, Math.sin(a) * r);
    }
    // spotlight sweeps a lazy figure-eight over the board
    this.spot.target.position.set(Math.sin(t * 0.35) * 5, 0, Math.sin(t * 0.7) * 4);
    this.spot.intensity = 70 + Math.sin(t * 0.8) * 25;

    for (const sp of this.sparkles) {
      const pos = sp.pts.geometry.attributes.position;
      for (let i = 0; i < sp.speed.length; i++) {
        let y = pos.array[i * 3 + 1] + sp.speed[i] * dt * 0.6;
        if (y > 8) y = -1;
        pos.array[i * 3 + 1] = y;
      }
      pos.needsUpdate = true;
      sp.pts.rotation.y += dt * 0.04;
      sp.pts.material.opacity = 0.55 + Math.sin(t * 2.2 + sp.phase) * 0.3;
    }
  }

  setPlayers(seats) {
    // remove every token from the previous game / menu demo
    for (const row of this.tokens) {
      for (const g of row || []) {
        if (!g) continue;
        this.scene.remove(g);
        g.traverse((o) => { if (o.material && o.material !== this._inlayMat) o.material.dispose(); });
      }
    }
    this.clearSelectable();
    this.tokens = [[], [], [], []];
    for (const p of seats) {
      const col = COLORS[p];
      const mat = new THREE.MeshPhysicalMaterial({
        color: COLOR_HEX[col], roughness: 0.25, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.12,
      });
      const domeMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(COLOR_HEX[col]).offsetHSL(0, 0, 0.08), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05,
      });
      for (let t = 0; t < 4; t++) {
        const group = new THREE.Group();
        const inner = new THREE.Group();
        const b = new THREE.Mesh(this._tokenGeo.body, mat);
        const ring2 = new THREE.Mesh(this._tokenGeo.inlay, this._inlayMat);
        const d = new THREE.Mesh(this._tokenGeo.dome, domeMat);
        b.castShadow = true;
        b.receiveShadow = ring2.receiveShadow = d.receiveShadow = true;
        inner.add(b, ring2, d);
        const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        ring.position.y = 0.015;
        const hit = new THREE.Mesh(this._hitGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
        group.add(inner, ring, hit);
        group.userData = { player: p, token: t, inner, ring, hit, sel: false, base: new THREE.Vector3(), scale: 1 };
        hit.userData.owner = group;
        this.scene.add(group);
        this.tokens[p][t] = group;
      }
    }
  }

  // Compute target position & scale for each token
  _targets(game) {
    const groups = new Map();
    for (const p of game.s.seats) {
      game.s.tokens[p].forEach((prog, t) => {
        let key;
        if (prog < 0) key = `y${p}${t}`;
        else if (prog === PROGRESS_HOME) key = `h${p}`;
        else { const [c, r] = cellFor(p, t, prog); key = `${c},${r}`; }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ p, t, prog });
      });
    }
    const OFF = {
      1: [[0, 0]],
      2: [[-0.2, -0.12], [0.2, 0.12]],
      3: [[-0.22, -0.16], [0.22, -0.16], [0, 0.22]],
      4: [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]],
    };
    const out = [];
    for (const [key, list] of groups) {
      const n = list.length;
      const home = key[0] === 'h';
      list.forEach((it, i) => {
        const base = toWorld(cellFor(it.p, it.t, it.prog));
        let off, scale;
        if (n <= 4) { off = OFF[n][i]; scale = n === 1 ? 1 : n === 2 ? 0.68 : 0.56; } else {
          const a = (i / n) * Math.PI * 2; off = [Math.cos(a) * 0.3, Math.sin(a) * 0.3]; scale = 0.42;
        }
        if (home) scale *= 0.72;
        base.x += off[0] * (home ? 0.9 : 1);
        base.z += off[1] * (home ? 0.9 : 1);
        out.push({ group: this.tokens[it.p][it.t], pos: base, scale });
      });
    }
    return out;
  }

  layout(game, duration = 0) {
    const targets = this._targets(game);
    const proms = targets.map(({ group, pos, scale }) => {
      const from = group.position.clone();
      const s0 = group.userData.scale;
      group.userData.base.copy(pos);
      if (!duration) { group.position.copy(pos); group.userData.scale = scale; group.scale.setScalar(scale); return null; }
      return tween(duration, (k) => {
        group.position.lerpVectors(from, pos, k);
        group.userData.scale = s0 + (scale - s0) * k;
        group.scale.setScalar(group.userData.scale);
      }, ease.out);
    });
    this.dice.setObstacles(targets.map((t) => t.pos));
    return Promise.all(proms.filter(Boolean));
  }

  _hop(group, to, dur, height, spin = 0) {
    const from = group.position.clone();
    const r0 = group.userData.inner.rotation.y;
    return tween(dur, (k) => {
      group.position.lerpVectors(from, to, k);
      group.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * height;
      const sq = 1 - Math.sin(Math.PI * k) * 0.12;
      group.userData.inner.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      if (spin) group.userData.inner.rotation.y = r0 + spin * k;
    }, ease.inOut);
  }

  async animateMove(game, res) {
    const group = this.tokens[res.player][res.token];
    group.userData.scale = 1;
    group.scale.setScalar(1);
    if (res.from < 0) {
      sfx.enterBoard();
      await this._hop(group, toWorld(cellFor(res.player, res.token, 0)), 0.45, 1.3, Math.PI * 2);
      this._squash(group);
      sfx.land();
      this.shockwave(group.position, COLOR_HEX[COLORS[res.player]], 1.6);
      this.burst(group.position, COLOR_HEX[COLORS[res.player]], 24);
    } else {
      for (let i = 0; i < res.path.length; i++) {
        const prog = res.path[i];
        sfx.hop(i);
        await this._hop(group, toWorld(cellFor(res.player, res.token, prog)), prog === PROGRESS_HOME ? 0.32 : 0.17, prog === PROGRESS_HOME ? 0.9 : 0.42);
      }
      this._squash(group);
      sfx.land();
    }

    if (res.captures.length) {
      sfx.capture();
      this.burst(group.position, 0xffffff, 40);
      this.shockwave(group.position, 0xff5533, 3);
      await Promise.all(res.captures.map(async (c) => {
        const g = this.tokens[c.player][c.token];
        this.burst(g.position, COLOR_HEX[COLORS[c.player]], 30);
        g.userData.scale = 1;
        g.scale.setScalar(1);
        await this._hop(g, toWorld(yardSpot(c.player, c.token)), 0.8, 3, Math.PI * 4);
      }));
    }
    if (res.home) {
      sfx.home();
      this.burst(group.position, COLOR_HEX[COLORS[res.player]], 60);
      this.shockwave(new THREE.Vector3(0, 0, 0), COLOR_HEX[COLORS[res.player]], 3);
      this.fireworks(new THREE.Vector3(0, 0, 0), this.shades(COLOR_HEX[COLORS[res.player]]));
    }
    await this.layout(game, 0.22);
  }

  _squash(group) {
    const inner = group.userData.inner;
    tween(0.22, (k) => {
      const s = 1 - Math.sin(Math.PI * k) * 0.22;
      inner.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
    }, ease.linear);
  }

  setSelectable(player, list) {
    this.clearSelectable();
    for (const t of list) {
      const g = this.tokens[player][t];
      g.userData.sel = true;
      g.userData.ring.material.color.setHex(0xffffff);
      this.selectable.set(g, { player, token: t });
    }
  }

  clearSelectable() {
    for (const g of this.selectable.keys()) g.userData.sel = false;
    this.selectable.clear();
  }

  setTurn(player) { this.turnPlayer = player; }

  // Throw origin direction (from board centre to the player's yard)
  yardDir(p) {
    const [ox, oy] = YARD_ORIGIN[p];
    return new THREE.Vector3(ox + 3 - 7.5, 0, oy + 3 - 7.5);
  }

  rollDice(value, player) { return this.dice.roll(value, this.yardDir(player)); }

  // ---------- camera
  _fit() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    const portrait = aspect < 1;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    if (this.mode === '2d') {
      // straight down: fit the 15x15 board (plus a hair of margin) to the short side
      const R = portrait ? 7.75 : 8.1;
      const dW = R / Math.tan(hf / 2), dV = (R + (portrait ? 0 : 0.9)) / Math.tan(vf / 2);
      return { dist: Math.max(dW, dV) + 0.2, polar: 0.001 };
    }
    const polar = portrait ? 0.5 : 0.62;
    // phones in portrait are width-bound: let the board run nearly edge to edge
    const R = portrait ? 7.95 : 8.3;
    const dW = (R / Math.tan(hf / 2)) + R * Math.sin(polar) * (portrait ? 0.3 : 0.5);
    const dV = ((R * Math.cos(polar) + 1.0) / Math.tan(vf / 2)) * (portrait ? 1.0 : 1.12);
    return { dist: Math.max(dW, dV), polar };
  }

  // '3d' = tilted, orbitable view; '2d' = flat top-down view with rotation locked
  setMode(mode, animate = true) {
    this.mode = mode === '2d' ? '2d' : '3d';
    const flat = this.mode === '2d';
    Object.assign(this.controls, {
      enableRotate: !flat, minPolarAngle: flat ? 0 : 0.05, maxPolarAngle: flat ? 0.002 : 1.12,
    });
    return this.setView(this.view.player, animate);
  }

  setView(player, animate = true) {
    this.view.player = player;
    const { dist, polar } = this._fit();
    const az = ((3 - player) * Math.PI) / 2;
    this.controls.minDistance = dist * 0.55;
    this.controls.maxDistance = dist * 1.5;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const from = { r: sph.radius, phi: sph.phi, theta: sph.theta };
    let dTheta = az - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const apply = (k) => {
      const s = new THREE.Spherical(from.r + (dist - from.r) * k, from.phi + (polar - from.phi) * k, from.theta + dTheta * k);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
    };
    if (!animate) { apply(1); this.controls.update(); return Promise.resolve(); }
    return tween(0.9, apply, ease.inOut).then(() => this.controls.update());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.setView(this.view.player, false), 60);
  }

  // Which screen corner a player's yard is in, given current view
  cornerOf(p) {
    const rel = (p - this.view.player + 4) % 4;
    return ['bl', 'tl', 'tr', 'br'][rel];
  }

  // ---------- picking
  _onUp(e) {
    if (!this._down) return;
    const dx = e.clientX - this._down.x, dy = e.clientY - this._down.y;
    const dt = performance.now() - this._down.t;
    this._down = null;
    if (dx * dx + dy * dy > 144 || dt > 600) return;
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(this._pointer, this.camera);

    if (this._raycaster.intersectObject(this.dice.mesh, false).length) { this.onDicePick?.(); return; }

    // background dice: tap to knock them about (the board occludes ones behind it)
    const bg = this._raycaster.intersectObjects([this.boardBase, ...this.bgDice.meshes], false)[0];
    if (bg && bg.object !== this.boardBase && this.bgDice.poke(bg.object)) return;

    if (this.selectable.size) {
      const hits = this._raycaster.intersectObjects([...this.selectable.keys()].map((g) => g.userData.hit), false);
      if (hits.length) { const g = hits[0].object.userData.owner; this.onTokenPick?.(this.selectable.get(g)); return; }
      const pt = new THREE.Vector3();
      if (this._raycaster.ray.intersectPlane(this.boardPlane, pt)) {
        let best = null, bd = 0.95;
        for (const [g, info] of this.selectable) {
          const d = Math.hypot(g.position.x - pt.x, g.position.z - pt.z);
          if (d < bd) { bd = d; best = info; }
        }
        if (best) { this.onTokenPick?.(best); return; }
      }
    }
    this.onBoardTap?.();
  }

  // ---------- effects (shared implementation in fx3d.js)
  burst(pos, color, n = 40, sphere = false) { this.fx.burst(pos, color, n, sphere); }
  shockwave(pos, color = 0xffffff, size = 3.2) { this.fx.shockwave(pos, color, size); }
  fireworks(pos, colors) { this.fx.fireworks(pos, colors); }
  shades(hex) { return this.fx.shades(hex); }
  shake(strength = 0.4) { this._shake = { t: 0, life: 0.45, s: strength }; }
  confetti() { this.fx.confetti(); }

  _loop(now) {
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    updateTweens(now);
    this.dice.update(now);
    this.controls.update();
    const t = now * 0.001;

    // selectable pawns bob and glow
    for (const row of this.tokens) for (const g of row || []) {
      if (!g) continue;
      const d = g.userData;
      const target = d.sel ? 0.7 + Math.sin(t * 6) * 0.25 : 0;
      d.ring.material.opacity += (target - d.ring.material.opacity) * 0.2;
      d.ring.scale.setScalar(1 + (d.sel ? Math.sin(t * 6) * 0.1 : 0));
      d.inner.position.y = d.sel ? Math.abs(Math.sin(t * 5)) * 0.18 : d.inner.position.y * 0.8;
    }
    this._updateParty(t, dt);
    this.bgDice.update(dt);
    this.yardGlow.forEach((m, p) => {
      const target = p === this.turnPlayer ? 0.16 + Math.sin(t * 3) * 0.08 : 0;
      m.material.opacity += (target - m.material.opacity) * 0.1;
    });
    this.fx.update(dt);
    let off = null;
    if (this._shake) {
      const sh = this._shake;
      sh.t += dt;
      if (sh.t >= sh.life) this._shake = null;
      else {
        const a = sh.s * (1 - sh.t / sh.life);
        off = new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
        this.camera.position.add(off);
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (off) this.camera.position.sub(off);
  }
}
