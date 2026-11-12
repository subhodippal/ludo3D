// Snakes & Ladders three.js scene, kept deliberately light for phones:
// one flat printed board, plain ladders, still snakes (only a tongue flick in
// 3D), pawns, a scripted dice drop, camera and picking.

import * as THREE from '../../vendor/three.module.min.js';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { COLORS, COLOR_HEX } from '../constants.js';
import { Dice } from '../dice.js';
import { Fx3D } from '../fx3d.js';
import { tween, ease, updateTweens } from '../anim.js';
import { sfx } from '../audio.js';
import { cellGrid, cellXZ, LAST } from './rules.js';

const TILE_H = 0.3;
const SNAKE_COLORS = [0x43a047, 0x8e24aa, 0xfb8c00, 0xe53935, 0x00897b, 0xd81b60, 0x3949ab, 0x7cb342, 0x6d4c41, 0xfdd835, 0x039be5, 0xf4511e];
export const SNAKE_CSS = SNAKE_COLORS.map((c) => '#' + c.toString(16).padStart(6, '0'));
const PAD_Z = 5.9;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cellPos = (n, y = 0) => { const { x, z } = cellXZ(n); return V(x, y, z); };
export const startSpot = (p) => V(-4.55 + p * 0.62, 0, PAD_Z);

// ---------------------------------------------------------------- textures
function boardTexture(renderer, N) {
  const C = N / 10;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#c98a9b';
  g.fillRect(0, 0, N, N);
  for (let n = 1; n <= LAST; n++) {
    const { col, row } = cellGrid(n);
    const { x: wx, z: wz } = cellXZ(n);
    // plane is laid flat: canvas x -> world x, canvas y -> world z
    const x = (wx + 4.5) * C, y = (wz + 4.5) * C;
    const pink = (col + row) % 2 === 0;
    g.fillStyle = pink ? '#ffe3ec' : '#ffe9d4';
    g.fillRect(x + C * 0.025, y + C * 0.025, C * 0.95, C * 0.95);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = n === 1 || n === LAST;
    g.font = `800 ${C * (big ? 0.3 : 0.36)}px ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#6b2f45';
    g.fillText(String(n), x + C / 2, y + C * (big ? 0.62 : 0.52));
    if (big) {
      g.font = `900 ${C * 0.16}px ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif`;
      g.fillStyle = n === 1 ? '#2fae4f' : '#d49a00';
      g.fillText(n === 1 ? 'START' : 'HOME', x + C / 2, y + C * 0.27);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function snakeSkin(hex) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  const base = new THREE.Color(hex);
  const css = (c) => '#' + c.getHexString();
  g.fillStyle = css(base);
  g.fillRect(0, 0, 128, 64);
  // dark chevron bands
  g.fillStyle = css(base.clone().multiplyScalar(0.55));
  g.beginPath();
  g.moveTo(30, 0); g.lineTo(54, 32); g.lineTo(30, 64); g.lineTo(46, 64); g.lineTo(70, 32); g.lineTo(46, 0);
  g.fill();
  // light diamonds
  g.fillStyle = css(base.clone().lerp(new THREE.Color(0xfff3b0), 0.6));
  for (const [x, y] of [[96, 16], [96, 48], [10, 32]]) {
    g.beginPath();
    g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function labelTexture(text, w = 512, h = 128) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.font = `900 ${h * 0.62}px ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = h * 0.1;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(30,10,60,.9)';
  g.strokeText(text, w / 2, h / 2 + 4);
  g.fillStyle = '#fff6c8';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- pawn
function pawnGeometry() {
  const pts = [
    [0, 0], [0.27, 0], [0.29, 0.025], [0.28, 0.06], [0.24, 0.09], [0.17, 0.12], [0.13, 0.2],
    [0.105, 0.34], [0.1, 0.4], [0.15, 0.43], [0.155, 0.46], [0.12, 0.48], [0, 0.48],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(pts, 40);
  body.computeVertexNormals();
  const head = new THREE.SphereGeometry(0.135, 28, 20).translate(0, 0.6, 0);
  const band = new THREE.TorusGeometry(0.15, 0.018, 10, 40).rotateX(Math.PI / 2).translate(0, 0.445, 0);
  return { body, head, band };
}

export class SnakesScene {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
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
    this.camera.position.set(0, 16, 10);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, enablePan: false,
      minPolarAngle: 0.05, maxPolarAngle: 1.15, rotateSpeed: 0.6, zoomSpeed: 0.8,
    });
    this.controls.target.set(0, 0, 0.45);
    this.mode = '3d';

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x40384a, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(-5, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    this.fx = new Fx3D(scene, { confettiColors: [...Object.values(COLOR_HEX), 0xffffff, 0xff7ad9, 0x8e24aa] });
    this._buildBoard();
    this.dice = new Dice(scene, renderer, { halfX: 5.03, halfZ: 5.03, floorY: 0, size: 0.72, simple: true });

    this.layoutGroup = null;
    this.snakes = [];
    this.ladders = [];
    this.tokens = [];
    this.turnPlayer = -1;
    this.onDicePick = null;
    this.onBoardTap = null;

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

  // ---------------------------------------------------------------- board
  _buildBoard() {
    const { scene, renderer } = this;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: boardTexture(renderer, this.quality === 'high' ? 2048 : 1024), roughness: 0.6 }));
    top.receiveShadow = true;
    scene.add(top);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xf6c3cf, roughness: 0.6 }));
    slab.position.y = -0.151;
    scene.add(slab);

    // start pad in front of the board
    const pad = new THREE.Mesh(new RoundedBoxGeometry(4.2, 0.18, 0.9, 3, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xf07da0, roughness: 0.4, metalness: 0.1, emissive: 0x7a1f3d, emissiveIntensity: 0.25 }));
    pad.position.set(-2.95, -0.09, PAD_Z);
    pad.receiveShadow = true;
    scene.add(pad);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshBasicMaterial({ map: labelTexture('START ▶'), transparent: true, depthWrite: false }));
    lbl.rotation.x = -Math.PI / 2;
    lbl.position.set(-1.65, 0.005, PAD_Z);
    scene.add(lbl);

    // trophy floating above cell 100
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.22, clearcoat: 1, emissive: 0x4a2a00, emissiveIntensity: 0.6 });
    const cupPts = [[0, 0], [0.22, 0], [0.22, 0.05], [0.07, 0.09], [0.05, 0.22], [0.08, 0.27], [0.2, 0.33], [0.26, 0.5], [0.27, 0.62], [0.24, 0.62], [0.22, 0.52], [0.16, 0.38], [0, 0.34]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const cup = new THREE.Group();
    cup.add(new THREE.Mesh(new THREE.LatheGeometry(cupPts, 36), gold));
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20, Math.PI * 1.2), gold);
      h.position.set(s * 0.27, 0.46, 0);
      h.rotation.z = s > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
      cup.add(h);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: 0xfff6b0 }));
    star.position.y = 0.78;
    cup.add(star);
    const p100 = cellPos(LAST);
    cup.position.set(p100.x, 1.05, p100.z);
    cup.scale.setScalar(0.85);
    scene.add(cup);
    this.trophy = cup;

    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._pawnGeo = pawnGeometry();
    this._ringGeo = new THREE.RingGeometry(0.3, 0.4, 40).rotateX(-Math.PI / 2);
    this._bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  }

  // ---------------------------------------------------------------- snakes & ladders
  setLayout(layout) {
    if (this.layoutGroup) {
      this.scene.remove(this.layoutGroup);
      this.layoutGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); });
      });
    }
    this.layoutGroup = new THREE.Group();
    this.scene.add(this.layoutGroup);
    this.ladders = layout.ladders.map(([b, t]) => this._buildLadder(b, t));
    this.snakes = layout.snakes.map(([h, t], i) => this._buildSnake(h, t, i));
  }

  _buildLadder(bottom, top) {
    const A = cellPos(bottom), B = cellPos(top);
    const flat = B.clone().sub(A).setY(0);
    const len = flat.length();
    const dir = flat.clone().normalize();
    const perp = V(-dir.z, 0, dir.x);
    const height = 0.2 + Math.min(0.5, len * 0.05);
    const center = (t) => A.clone().lerp(B, t).setY(0.1 + Math.sin(Math.PI * t) * height);
    const rail = (sd) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) pts.push(center(i / 12).addScaledVector(perp, sd * 0.21));
      return new THREE.CatmullRomCurve3(pts);
    };
    const g = new THREE.Group();
    const mat = this._ladderMat || (this._ladderMat = new THREE.MeshStandardMaterial({ color: 0xc8862e, roughness: 0.55 }));
    for (const sd of [-1, 1]) g.add(new THREE.Mesh(new THREE.TubeGeometry(rail(sd), 32, 0.045, 6), mat));
    const n = Math.max(3, Math.round((len + height) / 0.4));
    const rungGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6).rotateZ(Math.PI / 2);
    const inst = new THREE.InstancedMesh(rungGeo, mat, n);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(-perp.z, perp.x));
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < n; k++) inst.setMatrixAt(k, m4.compose(center((k + 0.5) / n), q, V(1, 1, 1)));
    g.add(inst);
    this.layoutGroup.add(g);
    return { bottom, top, center, len: len + height };
  }

  _buildSnake(head, tail, idx) {
    const color = SNAKE_COLORS[idx % SNAKE_COLORS.length];
    const A = cellPos(head), B = cellPos(tail);
    const flat = B.clone().sub(A).setY(0);
    const len = flat.length();
    const dir = flat.clone().normalize();
    const perp = V(-dir.z, 0, dir.x);
    const waves = Math.max(1.2, len / 2.2);
    const amp = Math.min(0.6, 0.22 + len * 0.045) * (idx % 2 ? 1 : -1);
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const lat = Math.sin(t * Math.PI * 2 * waves) * amp * Math.pow(Math.sin(Math.PI * t), 0.6);
      const y = 0.17 + 0.12 * Math.pow(Math.max(0, 1 - t * 6), 2);
      pts.push(A.clone().lerp(B, t).addScaledVector(perp, lat).setY(y));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const seg = 60, rad = 8;
    const geo = new THREE.TubeGeometry(curve, seg, 0.16, rad);
    // taper towards the tail, slight neck behind the head
    const pos = geo.attributes.position;
    const P = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      curve.getPointAt(t, P);
      const neck = 0.78 + 0.22 * THREE.MathUtils.smoothstep(t, 0, 0.1);
      const taper = neck * (1 - 0.8 * Math.pow(t, 1.3));
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j;
        v.fromBufferAttribute(pos, k).sub(P).multiplyScalar(taper).add(P);
        pos.setXYZ(k, v.x, v.y, v.z);
      }
    }
    geo.computeVertexNormals();

    const skin = snakeSkin(color);
    skin.repeat.set(Math.max(2, Math.round(curve.getLength() * 2.2)), 1);
    const mat = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.45 });
    const body = new THREE.Mesh(geo, mat);
    const g = new THREE.Group();
    g.add(body);

    // head
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.08 });
    const headG = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), headMat);
    skull.scale.set(1.15, 0.62, 1.45);
    skull.position.set(0, 0.035, 0.08);
    const jaw = new THREE.Group();
    jaw.position.set(0, 0, -0.06);
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), headMat);
    jawMesh.scale.set(1.05, 0.5, 1.4);
    jawMesh.position.set(0, -0.005, 0.14);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb0123a }));
    mouth.scale.set(1, 1.35, 1);
    mouth.position.set(0, 0.0, 0.14);
    jaw.add(jawMesh, mouth);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyes = [];
    const black = new THREE.MeshBasicMaterial({ color: 0x0b0b12 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), white);
      eye.position.set(s * 0.13, 0.13, 0.16);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), black);
      pupil.scale.set(0.55, 1, 0.7);
      pupil.position.set(s * 0.15, 0.15, 0.215);
      headG.add(eye, pupil);
      eyes.push(eye, pupil);
      // fangs (hidden by the lower jaw until it opens)
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 6).rotateX(Math.PI), white);
      fang.position.set(s * 0.075, -0.03, 0.27);
      headG.add(fang);
    }
    const tongueMat = new THREE.MeshBasicMaterial({ color: 0xff1744 });
    const tongue = new THREE.Group();
    tongue.position.set(0, 0.0, 0.33);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 0.2).translate(0, 0, 0.1), tongueMat);
    tongue.add(stem);
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.08).translate(0, 0, 0.04), tongueMat);
      tip.position.set(0, 0, 0.19);
      tip.rotation.y = s * 0.45;
      tongue.add(tip);
    }
    tongue.scale.set(1, 1, 0.01);
    headG.add(skull, jaw, tongue);

    const T0 = new THREE.Vector3();
    curve.getTangentAt(0, T0);
    const out = T0.clone().setY(0).normalize().negate();
    const hp = A.clone().setY(0.29);
    headG.position.copy(hp);
    headG.lookAt(hp.clone().add(out));
    g.add(headG);
    this.layoutGroup.add(g);
    return { head, tail, curve, tongue, color, len: curve.getLength(), nextFlick: 1 + Math.random() * 4, flick: -1 };
  }

  // ---------------------------------------------------------------- pawns
  setPlayers(seats) {
    for (const g of this.tokens) {
      if (!g) continue;
      this.scene.remove(g);
      g.traverse((o) => { if (o.material && o.material !== this._bandMat) o.material.dispose(); });
    }
    this.tokens = [];
    for (const p of seats) {
      const hex = COLOR_HEX[COLORS[p]];
      const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.3 });
      const group = new THREE.Group();
      const inner = new THREE.Group();
      const body = new THREE.Mesh(this._pawnGeo.body, mat);
      const head = new THREE.Mesh(this._pawnGeo.head, mat);
      const band = new THREE.Mesh(this._pawnGeo.band, this._bandMat);
      body.castShadow = head.castShadow = true;
      inner.add(body, head, band);
      // static ring under whoever's turn it is
      const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.position.y = 0.012;
      ring.visible = false;
      group.add(inner, ring);
      group.userData = { player: p, inner, ring, cell: 0, moving: false, scale: 1 };
      group.position.copy(startSpot(p));
      this.scene.add(group);
      this.tokens[p] = group;
    }
  }

  // where every pawn should stand, spreading pawns that share a cell
  _targets(game) {
    const groups = new Map();
    for (const p of game.s.seats) {
      const c = game.s.pos[p];
      const key = c === 0 ? `s${p}` : `${c}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const OFF = {
      1: [[0, 0]],
      2: [[-0.2, -0.1], [0.2, 0.1]],
      3: [[-0.21, -0.15], [0.21, -0.15], [0, 0.2]],
      4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]],
    };
    const out = [];
    for (const list of groups.values()) {
      list.forEach((p, i) => {
        const c = game.s.pos[p];
        const base = c === 0 ? startSpot(p) : cellPos(c);
        const n = list.length;
        const [ox, oz] = OFF[n][i];
        base.x += ox; base.z += oz;
        out.push({ group: this.tokens[p], pos: base, scale: n === 1 ? 1 : n === 2 ? 0.8 : 0.66, cell: c });
      });
    }
    return out;
  }

  layout(game, duration = 0) {
    const targets = this._targets(game);
    const proms = targets.map(({ group, pos, scale, cell }) => {
      const d = group.userData;
      d.cell = cell;
      const from = group.position.clone();
      const s0 = d.scale;
      pos.y = this.liftOf(cell);
      if (!duration) { group.position.copy(pos); d.scale = scale; group.scale.setScalar(scale); return null; }
      d.moving = true;
      return tween(duration, (k) => {
        group.position.lerpVectors(from, pos, k);
        group.position.y = this.liftOf(cell);
        d.scale = s0 + (scale - s0) * k;
        group.scale.setScalar(d.scale);
      }, ease.out).then(() => { d.moving = false; });
    });
    this.dice.setObstacles(targets.map((t) => t.pos));
    return Promise.all(proms.filter(Boolean));
  }

  liftOf() { return 0; }

  // kept for callers; the light board has no ripples
  ripple() {}

  // one simple arc from cell to cell
  _hop(group, to, dur, height) {
    const from = group.position.clone();
    return tween(dur, (k) => {
      group.position.lerpVectors(from, to, k);
      group.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * height;
    }, ease.inOut);
  }

  // glide along a curve (ladder / snake body), t from a to b
  _ride(group, pointAt, a, b, dur, lift = 0.05) {
    const P = new THREE.Vector3();
    return tween(dur, (k) => {
      pointAt(a + (b - a) * k, P);
      group.position.set(P.x, P.y + lift, P.z);
    }, ease.inOut);
  }

  // Play one whole turn: hop along the path, then ride a ladder / snake.
  async animateMove(game, res, { fast = false } = {}) {
    const p = res.player;
    const group = this.tokens[p];
    const d = group.userData;
    d.moving = true;
    d.scale = 1;
    group.scale.setScalar(1);
    const hopDur = fast ? 0.14 : 0.19;
    for (let i = 0; i < res.path.length; i++) {
      const n = res.path[i];
      const first = i === 0 && res.from === 0;
      if (first) sfx.enterBoard(); else sfx.hop(i);
      await this._hop(group, cellPos(n), first ? 0.32 : hopDur, first ? 0.7 : 0.3);
      d.cell = n;
      if (n === LAST && res.bounced) sfx.boing();
    }
    if (res.path.length) sfx.land();
    if (res.jump?.kind === 'ladder') await this.climbLadder(group, this.ladders[res.jump.index]);
    else if (res.jump?.kind === 'snake') await this.snakeBite(group, this.snakes[res.jump.index]);
    d.cell = res.to;
    await this.layout(game, 0.2);
    d.moving = false;
  }

  async climbLadder(group, L) {
    sfx.climb(0);
    const dur = THREE.MathUtils.clamp(L.len * 0.12, 0.5, 1.2);
    await this._ride(group, (t, out) => out.copy(L.center(t)), 0, 1, dur);
    group.position.copy(cellPos(L.top));
    sfx.ladderTop();
  }

  async snakeBite(group, S) {
    sfx.hiss(0.6);
    const dur = THREE.MathUtils.clamp(S.len * 0.1, 0.6, 1.4);
    sfx.slide(dur);
    await this._ride(group, (t, out) => S.curve.getPointAt(t, out), 0, 1, dur, 0);
    group.position.copy(cellPos(S.tail));
    sfx.boing();
  }

  // "can't move" wobble
  async nope(p) {
    const g = this.tokens[p];
    if (!g) return;
    const inner = g.userData.inner;
    await tween(0.4, (k) => { inner.rotation.z = Math.sin(k * Math.PI * 4) * 0.3 * (1 - k); }, ease.linear);
    inner.rotation.z = 0;
  }

  async winDance(p) {
    const g = this.tokens[p];
    const base = g.position.clone();
    for (let i = 0; i < 2; i++) await this._hop(g, base, 0.4, 0.8);
  }

  setTurn(player) {
    this.turnPlayer = player;
    for (const g of this.tokens) if (g) g.userData.ring.visible = g.userData.player === player;
  }

  rollDice(value, player) {
    // throw from the player's side of the table
    const dirs = [V(-1, 0, 1), V(1, 0, 1), V(1, 0, -1), V(-1, 0, -1)];
    return this.dice.roll(value, dirs[player] || V(0, 0, 1));
  }

  shake(strength = 0.4) { if (this.mode !== '2d') this._shake = { t: 0, life: 0.45, s: strength }; }

  // ---------------------------------------------------------------- camera
  _fit() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    const portrait = aspect < 1;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    if (this.mode === '2d') {
      // straight down: the 10x10 board plus the START pad below it
      const R = portrait ? 5.3 : 5.6;
      const dW = R / Math.tan(hf / 2), dV = (R + (portrait ? 0.3 : 0.9)) / Math.tan(vf / 2);
      return { dist: Math.max(dW, dV) + 0.2, polar: 0.001 };
    }
    const polar = portrait ? 0.5 : 0.6;
    // phones in portrait are width-bound: let the board run nearly edge to edge
    const R = portrait ? 5.5 : 5.7;
    const dW = (R / Math.tan(hf / 2)) + R * Math.sin(polar) * (portrait ? 0.3 : 0.5);
    const dV = ((R * Math.cos(polar) + 1.2) / Math.tan(vf / 2)) * (portrait ? 1.0 : 1.1);
    return { dist: Math.max(dW, dV), polar };
  }

  // '3d' = tilted, orbitable view; '2d' = flat top-down view with rotation locked
  setMode(mode, animate = true) {
    this.mode = mode === '2d' ? '2d' : '3d';
    const flat = this.mode === '2d';
    Object.assign(this.controls, {
      enableRotate: !flat, minPolarAngle: flat ? 0 : 0.05, maxPolarAngle: flat ? 0.002 : 1.15,
    });
    // freeze the animated page backdrop too in the flat view
    document.body.classList.toggle('flat-view', flat);
    if (this.controls.autoRotate) return Promise.resolve();
    return this.setView(animate);
  }

  setView(animate = true) {
    const { dist, polar } = this._fit();
    this.controls.minDistance = dist * 0.5;
    this.controls.maxDistance = dist * 1.6;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const from = { r: sph.radius, phi: sph.phi, theta: sph.theta };
    let dTheta = 0 - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const apply = (k) => {
      const s = new THREE.Spherical(from.r + (dist - from.r) * k, from.phi + (polar - from.phi) * k, from.theta + dTheta * k);
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
    };
    if (!animate) { apply(1); this.controls.update(); return Promise.resolve(); }
    return tween(1.1, apply, ease.inOut).then(() => this.controls.update());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => { if (!this.controls.autoRotate) this.setView(false); }, 60);
  }

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
    this.onBoardTap?.();
  }

  // ---------------------------------------------------------------- frame loop
  // The only idle animation: an occasional snake tongue flick (3D only).
  _animateSnakes(dt) {
    const flat = this.mode === '2d';
    for (const S of this.snakes) {
      if (flat) { S.tongue.scale.z = 0.01; S.flick = -1; continue; }
      S.nextFlick -= dt;
      if (S.nextFlick <= 0 && S.flick < 0) { S.flick = 0; S.nextFlick = 2.5 + Math.random() * 4; }
      if (S.flick >= 0) {
        S.flick += dt / 0.4;
        S.tongue.scale.z = S.flick >= 1 ? 0.01 : Math.max(0.01, Math.sin(Math.PI * S.flick));
        if (S.flick >= 1) S.flick = -1;
      }
    }
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    updateTweens(now);
    this.dice.update(now);
    this.controls.update();
    this._animateSnakes(dt);
    this.fx.update(dt);
    let off = null;
    if (this._shake) {
      const sh = this._shake;
      sh.t += dt;
      if (sh.t >= sh.life) this._shake = null;
      else {
        const a = sh.s * (1 - sh.t / sh.life);
        off = V((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
        this.camera.position.add(off);
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (off) this.camera.position.sub(off);
  }
}
