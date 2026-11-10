// Snakes & Ladders three.js scene: animated tile board, wriggling snakes,
// glowing ladders, pawns, dice, camera, picking and effects.

import * as THREE from '../../vendor/three.module.min.js';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { COLORS, COLOR_HEX } from '../constants.js';
import { Dice } from '../dice.js';
import { Fx3D, softSprite } from '../fx3d.js';
import { tween, ease, updateTweens, wait } from '../anim.js';
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
function tileAtlas(renderer, N) {
  const C = N / 10;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  for (let n = 1; n <= LAST; n++) {
    const { col, row } = cellGrid(n);
    const ax = (n - 1) % 10, ay = Math.floor((n - 1) / 10);
    const x = ax * C, y = ay * C;
    // soft light-pink / light-peach checkerboard
    const pink = (col + row) % 2 === 0;
    g.fillStyle = pink ? '#ffe3ec' : '#ffe7d1';
    g.fillRect(x, y, C, C);
    g.strokeStyle = pink ? '#f8c6d6' : '#f9cfa8';
    g.lineWidth = C * 0.035;
    g.beginPath();
    g.roundRect(x + C * 0.07, y + C * 0.07, C * 0.86, C * 0.86, C * 0.12);
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = n === 1 || n === LAST;
    g.font = `800 ${C * (big ? 0.32 : 0.38)}px ui-rounded, "Nunito", "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#6b2f45';
    g.fillText(String(n), x + C / 2, y + C * (big ? 0.62 : 0.53));
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
    const ms = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    this.fx = new Fx3D(scene, { confettiColors: [...Object.values(COLOR_HEX), 0xffffff, 0xff7ad9, 0x8e24aa] });
    this._buildBoard();
    this._buildParty();
    this.dice = new Dice(scene, renderer, { halfX: 5.03, halfZ: 5.03, floorY: 0, size: 0.72 });

    this.layoutGroup = null;
    this.snakes = [];
    this.ladders = [];
    this.decals = [];
    this.tokens = [];
    this.turnPlayer = -1;
    this.ripples = [];
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
    const atlas = tileAtlas(renderer, this.quality === 'high' ? 2048 : 1024);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xf6c3cf, roughness: 0.5 });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x140f2e });
    this.tiles = [null];
    for (let n = 1; n <= LAST; n++) {
      const { col, row } = cellGrid(n);
      const geo = new THREE.BoxGeometry(0.94, TILE_H, 0.94);
      // remap the top face (+y, vertices 8..11) into this tile's atlas cell
      const uv = geo.attributes.uv;
      const ax = (n - 1) % 10, ay = Math.floor((n - 1) / 10);
      for (let i = 8; i < 12; i++) uv.setXY(i, (ax + uv.getX(i)) / 10, (9 - ay + uv.getY(i)) / 10);
      const top = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, metalness: 0.0 });
      const side = sideMat;
      const mesh = new THREE.Mesh(geo, [side, side, top, bottomMat, side, side]);
      const { x, z } = cellXZ(n);
      mesh.position.set(x, -TILE_H / 2, z);
      mesh.receiveShadow = true;
      mesh.castShadow = this.quality === 'high';
      scene.add(mesh);
      this.tiles.push({ mesh, top, col, row, x, z, lift: 0, glow: 0, glowColor: new THREE.Color(1, 1, 1), press: 0 });
    }

    // base slab under the tiles (shows as soft lines in the gaps)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0xe9a3b3, roughness: 0.6 }));
    slab.position.y = -0.36;
    slab.receiveShadow = true;
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
    cup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const p100 = cellPos(LAST);
    cup.position.set(p100.x, 1.05, p100.z);
    cup.scale.setScalar(0.85);
    scene.add(cup);
    this.trophy = cup;
    this.trophyLight = new THREE.PointLight(0xffd36b, 6, 4, 2);
    this.trophyLight.position.set(p100.x, 1.6, p100.z);
    scene.add(this.trophyLight);

    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._pawnGeo = pawnGeometry();
    this._ringGeo = new THREE.RingGeometry(0.3, 0.4, 40).rotateX(-Math.PI / 2);
    this._arrowGeo = new THREE.ConeGeometry(0.13, 0.28, 4).rotateX(Math.PI);
    this._bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  }

  // coloured roaming lights + floating sparkles
  _buildParty() {
    const { scene } = this;
    const hues = [0xff3d7f, 0x3dd1ff, 0xffd23d, 0x9b5cff];
    this.partyLights = hues.map((c, i) => {
      const l = new THREE.PointLight(c, 10, 0, 2);
      l.userData = { phase: i * (Math.PI / 2) };
      scene.add(l);
      return l;
    });
    this.turnLight = new THREE.PointLight(0xffffff, 0, 5, 2);
    scene.add(this.turnLight);

    const palette = [...Object.values(COLOR_HEX), 0xffffff, 0xff7ad9, 0xffe082, 0x9b5cff].map((h) => new THREE.Color(h));
    this.sparkles = [0, 1].map((layer) => {
      const n = this.quality === 'high' ? 110 : 60;
      const pos = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const speed = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 7.2 + Math.random() * 8;
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
        size: layer ? 0.3 : 0.48, map: softSprite(), vertexColors: true, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
      });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      return { pts, speed, phase: layer * Math.PI };
    });
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
    this.decals = [];
    this.ladders = layout.ladders.map(([b, t], i) => this._buildLadder(b, t, i));
    this.snakes = layout.snakes.map(([h, t], i) => this._buildSnake(h, t, i));
  }

  _decal(cell, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.layoutGroup.add(m);
    this.decals.push({ mesh: m, cell, phase: Math.random() * 6 });
  }

  _buildLadder(bottom, top, idx) {
    const A = cellPos(bottom), B = cellPos(top);
    const flat = B.clone().sub(A).setY(0);
    const len = flat.length();
    const dir = flat.clone().normalize();
    const perp = V(-dir.z, 0, dir.x);
    const height = 0.25 + Math.min(0.75, len * 0.08);
    const center = (t) => A.clone().lerp(B, t).setY(0.12 + Math.sin(Math.PI * t) * height);
    const rail = (s) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) pts.push(center(i / 20).addScaledVector(perp, s * 0.21));
      return new THREE.CatmullRomCurve3(pts);
    };
    const g = new THREE.Group();
    const railMat = new THREE.MeshStandardMaterial({ color: 0xffb300, metalness: 0.55, roughness: 0.28, emissive: 0x5a3200, emissiveIntensity: 0.5 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.TubeGeometry(rail(s), 64, 0.05, 8), railMat);
      m.castShadow = true;
      g.add(m);
      // little feet at both ends
      for (const end of [A, B]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 12), railMat);
        foot.position.copy(end).addScaledVector(perp, s * 0.21).setY(0.06);
        g.add(foot);
      }
    }
    const arc = len + height * 1.2;
    const n = Math.max(3, Math.round(arc / 0.4));
    const rungGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8).rotateZ(Math.PI / 2);
    const inst = new THREE.InstancedMesh(rungGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3 }), n);
    const ts = [];
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.atan2(-perp.z, perp.x));
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      ts.push(t);
      m4.compose(center(t), q, V(1, 1, 1));
      inst.setMatrixAt(k, m4);
      inst.setColorAt(k, new THREE.Color(1, 0.75, 0.3));
    }
    inst.castShadow = true;
    g.add(inst);
    this.layoutGroup.add(g);
    this._decal(bottom, 0x66ff99);
    // sparkles that keep drifting up the ladder
    const K = Math.max(6, Math.round(arc * 1.6));
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K * 3), 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(K * 3), 3));
    const sPts = new THREE.Points(sGeo, new THREE.PointsMaterial({
      size: 0.3, map: softSprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sPts.frustumCulled = false;
    g.add(sPts);
    const stream = { pts: sPts, t: [...Array(K)].map(() => Math.random()), off: [...Array(K)].map(() => (Math.random() - 0.5) * 0.3), speed: 1.4 / arc };
    return {
      bottom, top, center, ts, inst, flash: new Float32Array(n), n, len, phase: idx * 0.9, base: new THREE.Color(1, 0.72, 0.28),
      railMat, perp, stream, invite: 0, hot: 0,
    };
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
    const seg = 120, rad = 10;
    const geo = new THREE.TubeGeometry(curve, seg, 0.16, rad);
    // taper towards the tail, slight neck behind the head
    const pos = geo.attributes.position;
    const aT = new Float32Array(pos.count);
    const aSide = new Float32Array(pos.count * 3);
    const P = new THREE.Vector3(), T = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      curve.getPointAt(t, P);
      curve.getTangentAt(t, T);
      const side = V(-T.z, 0, T.x).normalize();
      const neck = 0.78 + 0.22 * THREE.MathUtils.smoothstep(t, 0, 0.1);
      const taper = neck * (1 - 0.8 * Math.pow(t, 1.3));
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j;
        v.fromBufferAttribute(pos, k).sub(P).multiplyScalar(taper).add(P);
        pos.setXYZ(k, v.x, v.y, v.z);
        aT[k] = t;
        aSide.set([side.x, 0, side.z], k * 3);
      }
    }
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += 0.5;

    const skin = snakeSkin(color);
    skin.repeat.set(Math.max(2, Math.round(curve.getLength() * 2.2)), 1);
    const mat = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.32, metalness: 0.08, emissive: color, emissiveIntensity: 0.08 });
    const uni = {
      uTime: { value: 0 }, uPhase: { value: idx * 1.7 }, uAmp: { value: 0.07 + Math.min(0.06, len * 0.008) },
      uBulge: { value: -1 }, uBulgeAmp: { value: 0 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = 'attribute float aT;\nattribute vec3 aSide;\nuniform float uTime, uPhase, uAmp, uBulge, uBulgeAmp;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float env = sin(3.14159265 * aT);
        transformed += aSide * sin(uTime * 2.4 - aT * 15.0 + uPhase) * uAmp * env;
        transformed.y += sin(uTime * 3.1 - aT * 11.0 + uPhase) * 0.022 * env;
        float bd = (aT - uBulge) / 0.06;
        transformed += normal * uBulgeAmp * exp(-bd * bd) * 0.15;`,
      );
    };
    const body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    const g = new THREE.Group();
    g.add(body);

    // head
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.08 });
    const headG = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), headMat);
    skull.scale.set(1.15, 0.62, 1.45);
    skull.position.set(0, 0.035, 0.08);
    skull.castShadow = true;
    const jaw = new THREE.Group();
    jaw.position.set(0, 0, -0.06);
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), headMat);
    jawMesh.scale.set(1.05, 0.5, 1.4);
    jawMesh.position.set(0, -0.005, 0.14);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb0123a }));
    mouth.scale.set(1, 1.35, 1);
    mouth.position.set(0, 0.0, 0.14);
    jaw.add(jawMesh, mouth);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0xff1100, emissiveIntensity: 0 });
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
    this._decal(head, 0xff4466);
    return {
      head, tail, curve, uni, headG, jaw, tongue, baseQ: headG.quaternion.clone(), basePos: hp.clone(), out,
      color, len: curve.getLength(), phase: idx * 1.3, nextFlick: 1 + Math.random() * 3, flick: -1, bite: 0,
      eyes, eyeMat: white, skin, amp0: uni.uAmp.value, clock: Math.random() * 10, agit: 0, danger: false,
      blink: -1, nextBlink: 1 + Math.random() * 4, yawn: -1, nextYawn: 4 + Math.random() * 10,
    };
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
      const mat = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
      const group = new THREE.Group();
      const inner = new THREE.Group();
      const body = new THREE.Mesh(this._pawnGeo.body, mat);
      const head = new THREE.Mesh(this._pawnGeo.head, mat);
      const band = new THREE.Mesh(this._pawnGeo.band, this._bandMat);
      body.castShadow = head.castShadow = true;
      inner.add(body, head, band);
      const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.position.y = 0.012;
      const arrow = new THREE.Mesh(this._arrowGeo, new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.7 }));
      arrow.position.y = 1.05;
      arrow.visible = false;
      group.add(inner, ring, arrow);
      group.userData = { player: p, inner, ring, arrow, cell: 0, moving: false, scale: 1 };
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

  liftOf(cell) { return cell > 0 ? this.tiles[cell].lift : 0; }

  _hop(group, to, dur, height, spin = 0) {
    const from = group.position.clone();
    const inner = group.userData.inner;
    const r0 = inner.rotation.y;
    return tween(dur, (k) => {
      group.position.lerpVectors(from, to, k);
      group.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * height;
      const sq = 1 - Math.sin(Math.PI * k) * 0.16;
      inner.scale.set(1 / Math.sqrt(sq), 1 / sq * 0.92 + 0.08, 1 / Math.sqrt(sq));
      if (spin) inner.rotation.y = r0 + spin * k;
    }, ease.inOut);
  }

  _squash(group, amount = 0.25) {
    const inner = group.userData.inner;
    return tween(0.24, (k) => {
      const s = 1 - Math.sin(Math.PI * k) * amount;
      inner.scale.set(1 + (1 - s) * 0.7, s, 1 + (1 - s) * 0.7);
    }, ease.linear);
  }

  _tileHit(cell, hex, strength = 1) {
    const t = this.tiles[cell];
    if (!t) return;
    t.glow = Math.max(t.glow, strength);
    t.glowColor.setHex(hex);
    t.press = 0.07 * strength;
  }

  ripple(cell, hex, strength = 1) {
    const { x, z } = cell > 0 ? cellXZ(cell) : { x: 0, z: 0 };
    this.ripples.push({ x, z, t0: this._t ?? 0, color: new THREE.Color(hex), s: strength });
    if (this.ripples.length > 4) this.ripples.shift();
  }

  // Play one whole turn: hop along the path, then ride a ladder / snake.
  async animateMove(game, res, { fast = false } = {}) {
    const p = res.player;
    const group = this.tokens[p];
    const d = group.userData;
    const hex = COLOR_HEX[COLORS[p]];
    d.moving = true;
    d.scale = 1;
    group.scale.setScalar(1);
    const hopDur = fast ? 0.15 : 0.2;
    for (let i = 0; i < res.path.length; i++) {
      const n = res.path[i];
      const to = cellPos(n, this.liftOf(n));
      const first = i === 0 && res.from === 0;
      if (first) sfx.enterBoard(); else sfx.hop(i);
      await this._hop(group, to, first ? 0.38 : hopDur, first ? 1.1 : 0.5, first ? Math.PI * 2 : 0);
      d.cell = n;
      this._tileHit(n, hex, 0.8);
      this.fx.burst(to, hex, 6, false, { speed: 0.25, up: 0.25, life: 0.6, soft: true, size: 0.3, lift: 0.1 });
      if (n === LAST && res.bounced) { sfx.boing(); this.fx.shockwave(to, 0xffffff, 1.4); }
    }
    if (res.path.length) {
      this._squash(group);
      sfx.land();
      this.fx.shockwave(group.position, hex, 1.4);
    }
    if (res.jump?.kind === 'ladder') await this.climbLadder(group, this.ladders[res.jump.index], hex);
    else if (res.jump?.kind === 'snake') await this.snakeBite(group, this.snakes[res.jump.index]);
    d.cell = res.to;
    await this.layout(game, 0.22);
    d.moving = false;
  }

  async climbLadder(group, L, hex) {
    L.hot = 1.5;
    await wait(120);
    const d = group.userData;
    d.moving = true;
    for (let k = 0; k < L.n; k++) {
      const p = L.center(L.ts[k]).add(V(0, 0.03, 0));
      sfx.climb(k);
      L.flash[k] = 1.6;
      await this._hop(group, p, 0.1, 0.12);
      if (k % 2 === 0) this.fx.burst(p, 0xffe27a, 5, false, { speed: 0.3, up: 0.3, life: 0.7, soft: true, size: 0.28, lift: 0.05 });
    }
    const top = cellPos(L.top, this.liftOf(L.top));
    await this._hop(group, top, 0.32, 0.8, Math.PI * 2);
    d.cell = L.top;
    this._squash(group, 0.3);
    sfx.ladderTop();
    this._tileHit(L.top, 0xffe27a, 1.4);
    this.fx.shockwave(top, 0xffe27a, 2.6);
    this.fx.burst(top, 0xffe27a, 40, false, { soft: true, size: 0.32 });
    this.fx.fireworks(top, this.fx.shades(hex), 3, 2);
    this.ripple(L.top, 0xffd54f, 1);
  }

  async snakeBite(group, S) {
    const d = group.userData;
    d.moving = true;
    S.bite = 1;
    S.agit = 1;
    sfx.hiss(1.1);
    // head rears up and opens wide
    const hp = S.basePos.clone();
    await tween(0.28, (k) => {
      S.headG.position.copy(hp).add(V(0, Math.sin(k * Math.PI / 2) * 0.45, 0)).addScaledVector(S.out, -0.1 * k);
      S.jaw.rotation.x = 0.9 * k;
    }, ease.out);
    // lunge and swallow
    const mouth = S.headG.position.clone();
    const from = group.position.clone();
    sfx.chomp();
    this.shake(0.3);
    await tween(0.22, (k) => {
      group.position.lerpVectors(from, mouth, k);
      group.scale.setScalar(1 - k * 0.85);
      S.headG.position.copy(hp).add(V(0, 0.45 * (1 - k), 0));
      S.jaw.rotation.x = 0.9 * (1 - k);
    }, ease.in);
    group.visible = false;
    this.fx.burst(hp, S.color, 30, false, { speed: 0.6 });
    this.fx.shockwave(hp, 0xff2244, 2);
    // bulge slides down the body
    const dur = THREE.MathUtils.clamp(S.len * 0.12, 0.9, 2.2);
    sfx.slide(dur);
    const P = new THREE.Vector3();
    let lastPuff = 0;
    await tween(dur, (k) => {
      S.uni.uBulge.value = k;
      S.uni.uBulgeAmp.value = Math.min(1, k * 8, (1 - k) * 8);
      if (k - lastPuff > 0.12) {
        lastPuff = k;
        S.curve.getPointAt(k, P);
        this.fx.burst(P, S.color, 4, false, { speed: 0.2, up: 0.2, life: 0.5, soft: true, size: 0.25, lift: 0.1 });
      }
    }, ease.inOut);
    S.uni.uBulgeAmp.value = 0;
    S.uni.uBulge.value = -1;
    S.headG.position.copy(hp);
    S.jaw.rotation.x = 0;
    S.bite = 0;
    // spat out at the tail
    const tail = cellPos(S.tail, this.liftOf(S.tail));
    group.position.copy(tail);
    group.visible = true;
    d.cell = S.tail;
    sfx.boing();
    this.fx.burst(tail, S.color, 26);
    this.fx.shockwave(tail, S.color, 1.8);
    this._tileHit(S.tail, 0xff2244, 1.2);
    this.ripple(S.tail, 0xff1744, 0.8);
    await tween(0.4, (k) => {
      group.scale.setScalar(0.15 + 0.85 * k);
      group.position.y = tail.y + Math.sin(Math.PI * k) * 0.7;
      group.userData.inner.rotation.y = k * Math.PI * 3;
    }, ease.outBack);
  }

  // "can't move" wobble
  async nope(p) {
    const g = this.tokens[p];
    if (!g) return;
    const inner = g.userData.inner;
    await tween(0.45, (k) => { inner.rotation.z = Math.sin(k * Math.PI * 4) * 0.35 * (1 - k); }, ease.linear);
    inner.rotation.z = 0;
  }

  async winDance(p) {
    const g = this.tokens[p];
    const hex = COLOR_HEX[COLORS[p]];
    this.ripple(LAST, hex, 1.6);
    const base = g.position.clone();
    this.fx.fireworks(V(0, 0, 0), this.fx.shades(hex), 8, 3);
    for (let i = 0; i < 3; i++) {
      await this._hop(g, base, 0.42, 1.2, Math.PI * 2);
      this._squash(g, 0.3);
      this.fx.shockwave(base, hex, 2.4);
      this.fx.burst(base, i % 2 ? 0xffffff : hex, 30);
    }
  }

  setTurn(player) {
    this.turnPlayer = player;
  }

  rollDice(value, player) {
    // throw from the player's side of the table
    const dirs = [V(-1, 0, 1), V(1, 0, 1), V(1, 0, -1), V(-1, 0, -1)];
    return this.dice.roll(value, dirs[player] || V(0, 0, 1));
  }

  shake(strength = 0.4) { this._shake = { t: 0, life: 0.45, s: strength }; }

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
  _animateBoard(t, dt) {
    // tiles: gentle travelling wave + event ripples + per-tile glow
    this.ripples = this.ripples.filter((r) => t - r.t0 < 3.5);
    for (let n = 1; n <= LAST; n++) {
      const tile = this.tiles[n];
      let y = 0.022 * Math.sin(t * 1.8 - (tile.col + tile.row) * 0.55);
      let w = 0, cr = 0, cg = 0, cb = 0;
      for (const r of this.ripples) {
        const dist = Math.hypot(tile.x - r.x, tile.z - r.z);
        const ph = (t - r.t0) * 7 - dist * 1.4;
        if (ph > 0 && ph < Math.PI) {
          const k = Math.sin(ph) * r.s * Math.exp(-dist * 0.1);
          y += 0.13 * k;
          w += k * 0.7; cr += r.color.r * k * 0.7; cg += r.color.g * k * 0.7; cb += r.color.b * k * 0.7;
        }
      }
      tile.glow = Math.max(0, tile.glow - dt * 1.6);
      tile.press = Math.max(0, tile.press - dt * 0.35);
      if (tile.glow > 0) {
        const k = tile.glow * 0.8;
        w += k; cr += tile.glowColor.r * k; cg += tile.glowColor.g * k; cb += tile.glowColor.b * k;
      }
      tile.lift = y - tile.press;
      tile.mesh.position.y = -TILE_H / 2 + tile.lift;
      if (w > 0.001) {
        const m = Math.min(0.75, w);
        tile.top.color.setRGB(1 + (cr / w - 1) * m, 1 + (cg / w - 1) * m, 1 + (cb / w - 1) * m);
      } else tile.top.color.setRGB(1, 1, 1);
    }

    const c = new THREE.Color();

    // decals under snake heads / ladder feet
    for (const dc of this.decals) {
      dc.mesh.position.set(this.tiles[dc.cell].x, this.liftOf(dc.cell) + 0.006, this.tiles[dc.cell].z);
      dc.mesh.material.opacity = 0.35 + Math.sin(t * 3 + dc.phase) * 0.25;
      dc.mesh.scale.setScalar(1 + Math.sin(t * 3 + dc.phase) * 0.06);
    }

    // which cells currently hold a pawn (for "danger" / "invite" reactions)
    const cells = [];
    for (const g of this.tokens) if (g) cells.push(g.userData.cell);
    const within = (target) => cells.some((c) => c < target && c >= target - 6);

    // ladders: golden pulse up the rungs, shimmering rails, rising sparkles.
    // They light up even more when a pawn is within one roll of the foot.
    for (const L of this.ladders) {
      L.invite += ((within(L.bottom) ? 1 : 0) - L.invite) * Math.min(1, dt * 3);
      L.hot = Math.max(0, L.hot - dt * 0.8);
      const inv = L.invite;
      for (let k = 0; k < L.n; k++) {
        L.flash[k] = Math.max(0, L.flash[k] - dt * 2.5);
        const wave = Math.pow(Math.max(0, Math.sin(t * (2.6 + inv * 3) - k * 0.5 + L.phase)), 10) * (0.9 + inv * 0.9);
        const gl = 1 + (wave + L.flash[k] + L.hot * 0.5) * 1.4;
        c.copy(L.base).multiplyScalar(gl);
        L.inst.setColorAt(k, c);
      }
      L.inst.instanceColor.needsUpdate = true;
      L.railMat.emissiveIntensity = 0.45 + Math.sin(t * 3 + L.phase) * 0.25 + inv * (0.6 + Math.sin(t * 8) * 0.3) + L.hot;

      const st = L.stream;
      const pos = st.pts.geometry.attributes.position;
      const col = st.pts.geometry.attributes.color;
      const P = new THREE.Vector3();
      for (let i = 0; i < st.t.length; i++) {
        st.t[i] += dt * st.speed * (1 + inv * 1.5 + L.hot * 2);
        if (st.t[i] > 1) { st.t[i] -= 1; st.off[i] = (Math.random() - 0.5) * 0.3; }
        const tt = st.t[i];
        P.copy(L.center(tt)).addScaledVector(L.perp, st.off[i] + Math.sin(t * 5 + i) * 0.03);
        pos.setXYZ(i, P.x, P.y + 0.07 + Math.sin(t * 6 + i * 1.7) * 0.03, P.z);
        const b = Math.sin(Math.PI * tt) * (0.45 + inv * 0.7 + L.hot * 0.5) * (0.75 + 0.25 * Math.sin(t * 12 + i * 3));
        col.setXYZ(i, b, b * 0.82, b * 0.35);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    // snakes: wriggle + slither (shader), sliding skin, head bob/sway, blinking,
    // yawns and tongue flicks. With a pawn within one roll of the head the snake
    // gets agitated: it rears up, wriggles faster, eyes glow red, jaw chatters.
    for (const S of this.snakes) {
      const danger = within(S.head);
      if (danger && !S.danger && this.turnPlayer >= 0) sfx.hiss(0.45);
      S.danger = danger;
      S.agit += ((danger ? 1 : 0) - S.agit) * Math.min(1, dt * 3);
      const ag = S.agit;
      S.clock += dt * (1 + 1.6 * ag);
      S.uni.uTime.value = S.clock;
      S.uni.uAmp.value = S.amp0 * (1 + 0.9 * ag);
      S.skin.offset.x -= dt * (0.2 + 0.7 * ag);
      S.eyeMat.emissiveIntensity = ag * (0.8 + Math.sin(t * 10) * 0.2);

      // blink
      S.nextBlink -= dt;
      if (S.nextBlink <= 0 && S.blink < 0) { S.blink = 0; S.nextBlink = 2 + Math.random() * 4; }
      let lid = 1;
      if (S.blink >= 0) {
        S.blink += dt / 0.18;
        lid = S.blink >= 1 ? 1 : 1 - Math.sin(Math.PI * S.blink) * 0.92;
        if (S.blink >= 1) S.blink = -1;
      }
      for (const e of S.eyes) e.scale.y = lid * (1 + ag * 0.25);

      // occasional big yawn
      S.nextYawn -= dt;
      if (S.nextYawn <= 0 && S.yawn < 0 && ag < 0.3) { S.yawn = 0; S.nextYawn = 7 + Math.random() * 10; }
      let yawn = 0;
      if (S.yawn >= 0) {
        S.yawn += dt / 1.3;
        yawn = S.yawn >= 1 ? 0 : Math.sin(Math.PI * S.yawn);
        if (S.yawn >= 1) S.yawn = -1;
      }

      if (!S.bite) {
        const rear = 0.25 * ag + 0.1 * yawn;
        S.headG.position.copy(S.basePos).add(V(0, Math.sin(t * (2.2 + ag * 3) + S.phase) * (0.035 + ag * 0.03) + rear, 0));
        const sway = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.sin(t * (1.3 + ag * 3.5) + S.phase) * (0.25 + 0.15 * ag));
        const tilt = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.35 * yawn - 0.15 * ag);
        S.headG.quaternion.copy(S.baseQ).multiply(sway).multiply(tilt);
        S.jaw.rotation.x = Math.max(0.75 * yawn, ag * (0.12 + 0.12 * Math.sin(t * 22)));
      }

      // tongue flicks (much more often when agitated)
      S.nextFlick -= dt * (1 + ag * 3);
      if (S.nextFlick <= 0 && S.flick < 0) { S.flick = 0; S.nextFlick = 1.5 + Math.random() * 3; }
      if (S.flick >= 0) {
        S.flick += dt / 0.45;
        const k = S.flick >= 1 ? 0 : Math.sin(Math.PI * S.flick) * (0.8 + 0.2 * Math.sin(S.flick * 40));
        S.tongue.scale.z = Math.max(0.01, k);
        if (S.flick >= 1) S.flick = -1;
      }
    }

    // trophy
    this.trophy.rotation.y = t * 0.9;
    this.trophy.position.y = 1.05 + Math.sin(t * 2) * 0.08 + this.liftOf(LAST);
    this.trophyLight.intensity = 5 + Math.sin(t * 3) * 2;

    // roaming party lights
    this.partyLights.forEach((l, i) => {
      const a = t * 0.35 + l.userData.phase;
      l.position.set(Math.cos(a) * 6.2, 3 + Math.sin(t * 1.1 + i) * 0.7, Math.sin(a) * 6.2);
      l.intensity = 9 + Math.sin(t * 2 + i) * 3;
    });
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

  _animateTokens(t, dt) {
    let turnTok = null;
    for (const g of this.tokens) {
      if (!g) continue;
      const d = g.userData;
      if (!d.moving) g.position.y = this.liftOf(d.cell);
      const active = d.player === this.turnPlayer;
      if (active) turnTok = g;
      const target = active ? 0.75 + Math.sin(t * 6) * 0.2 : 0;
      d.ring.material.opacity += (target - d.ring.material.opacity) * 0.15;
      d.ring.scale.setScalar(1 + (active ? Math.sin(t * 6) * 0.12 : 0));
      d.arrow.visible = active && !d.moving;
      d.arrow.position.y = 1.0 + Math.abs(Math.sin(t * 4)) * 0.18;
      d.arrow.rotation.y = t * 3;
      if (!d.moving) d.inner.rotation.y += ((active ? Math.sin(t * 1.5) * 0.4 : 0) - d.inner.rotation.y) * 0.05;
    }
    if (turnTok) {
      this.turnLight.color.setHex(COLOR_HEX[COLORS[turnTok.userData.player]]);
      this.turnLight.position.set(turnTok.position.x, turnTok.position.y + 1.6, turnTok.position.z);
      this.turnLight.intensity += (5 - this.turnLight.intensity) * 0.1;
    } else this.turnLight.intensity *= 0.9;
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    const t = now * 0.001;
    this._t = t;
    updateTweens(now);
    this.dice.update(now);
    this.controls.update();
    this._animateBoard(t, dt);
    this._animateTokens(t, dt);
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
