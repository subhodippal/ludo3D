// Physically simulated die (cannon-es). The throw is simulated up-front, then
// replayed; the visual cube is rotated by a cube symmetry so the face that
// ends up on top shows the value chosen by the (fair) RNG. That keeps the
// physics real while letting the host dictate results in online games.

import * as THREE from '../vendor/three.module.min.js';
import * as CANNON from '../vendor/cannon-es.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { sfx } from './audio.js';

const STEP = 1 / 120;

// local face normals per value (BoxGeometry material order +x,-x,+y,-y,+z,-z)
const FACE_NORMAL = {
  1: new THREE.Vector3(1, 0, 0),
  6: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 1, 0),
  5: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
};
const MATERIAL_ORDER = [1, 6, 2, 5, 3, 4];

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
};

function faceTexture(value, renderer) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s * 0.4, s * 0.35, s * 0.1, s / 2, s / 2, s * 0.75);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#e9e4dc');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  for (const [x, y] of PIPS[value]) {
    const r = value === 1 ? s * 0.13 : s * 0.085;
    const pg = g.createRadialGradient(x * s - r * 0.3, y * s - r * 0.3, r * 0.1, x * s, y * s, r);
    const col = value === 1 ? ['#ff5a5a', '#b3121b'] : ['#3a3a48', '#0d0d14'];
    pg.addColorStop(0, col[0]);
    pg.addColorStop(1, col[1]);
    g.fillStyle = pg;
    g.beginPath();
    g.arc(x * s, y * s, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export class Dice {
  // simple: skip the physics replay and use a short scripted drop-and-bounce
  // (much lighter on phones; used by Snakes & Ladders)
  constructor(scene, renderer, { halfX = 7.45, halfZ = 7.45, floorY = 0, size = 0.9, simple = false } = {}) {
    this.simple = simple;
    const SIZE = size;
    const HALF = size / 2;
    this.half = HALF;
    this.floorY = floorY;
    this.bounds = { halfX, halfZ };

    // --- physics world
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 12;
    const diceMat = new CANNON.Material('dice');
    const floorMat = new CANNON.Material('floor');
    const wallMat = new CANNON.Material('wall');
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.32, restitution: 0.38 }));
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.05, restitution: 0.6 }));

    const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    floor.position.y = floorY;
    world.addBody(floor);

    const wall = (x, z, rotY) => {
      const b = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() });
      b.quaternion.setFromEuler(0, rotY, 0);
      b.position.set(x, 0, z);
      world.addBody(b);
    };
    wall(-halfX, 0, Math.PI / 2);
    wall(halfX, 0, -Math.PI / 2);
    wall(0, -halfZ, 0);
    wall(0, halfZ, Math.PI);

    const body = new CANNON.Body({
      mass: 1,
      material: diceMat,
      shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      linearDamping: 0.12,
      angularDamping: 0.12,
      allowSleep: true,
      sleepSpeedLimit: 0.2,
      sleepTimeLimit: 0.15,
    });
    world.addBody(body);
    this.world = world;
    this.body = body;

    // pawns act as obstacles so the die bounces off them
    this.obstacleMat = floorMat;
    this.obstacles = [];

    this.impacts = [];
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (this._recording && v > 0.6) this.impacts.push({ frame: this._frame, v });
    });

    // --- visual
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, 0.13 * SIZE / 0.9);
    const mats = MATERIAL_ORDER.map((v) => new THREE.MeshStandardMaterial({
      map: faceTexture(v, renderer), roughness: 0.32, metalness: 0.0,
    }));
    this.mesh = new THREE.Mesh(geo, mats);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.position.set(0, floorY + HALF, 0);
    this.mesh.name = 'dice';
    scene.add(this.mesh);
    this.materials = mats;

    // glow ring when it's your turn to roll
    const ringGeo = new THREE.RingGeometry(0.69 * SIZE, 0.87 * SIZE, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.position.set(0, floorY + 0.02, 0);
    scene.add(this.ring);

    this.offset = new THREE.Quaternion();
    this.playing = null;
    this.value = 1;
    this.inviting = false;
  }

  setObstacles(points) {
    // points: array of THREE.Vector3 (pawn base positions)
    for (const b of this.obstacles) this.world.removeBody(b);
    this.obstacles = points.map((p) => {
      const b = new CANNON.Body({ mass: 0, material: this.obstacleMat, shape: new CANNON.Cylinder(0.37, 0.37, 0.18, 14) });
      b.position.set(p.x, this.floorY + 0.09, p.z);
      this.world.addBody(b);
      return b;
    });
  }

  setInvite(on, colorHex = 0xffffff) {
    this.inviting = on;
    this.ring.material.color.setHex(colorHex);
  }

  _simulate(fromDir) {
    const { body } = this;
    const { halfX, halfZ } = this.bounds;
    const dir = fromDir.clone().normalize();
    const start = dir.clone().multiplyScalar(5.2 + Math.random() * 1.2);
    start.x = THREE.MathUtils.clamp(start.x + (Math.random() - 0.5) * 2, -halfX + 1, halfX - 1);
    start.z = THREE.MathUtils.clamp(start.z + (Math.random() - 0.5) * 2, -halfZ + 1, halfZ - 1);
    body.wakeUp();
    body.position.set(start.x, this.floorY + 3.2 + Math.random(), start.z);
    body.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    const speed = 7 + Math.random() * 4;
    const aim = new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3).sub(start).normalize();
    body.velocity.set(aim.x * speed, 2 + Math.random() * 2, aim.z * speed);
    body.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40);

    const frames = [];
    this.impacts = [];
    this._recording = true;
    const maxFrames = 120 * 5;
    for (this._frame = 0; this._frame < maxFrames; this._frame++) {
      this.world.step(STEP);
      frames.push([body.position.x, body.position.y, body.position.z,
        body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]);
      if (body.sleepState === CANNON.Body.SLEEPING) break;
    }
    this._recording = false;

    // which local axis points up?
    const q = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q.clone().invert());
    const ax = [Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)];
    const m = Math.max(...ax);
    const i = ax.indexOf(m);
    const landed = new THREE.Vector3();
    landed.setComponent(i, Math.sign(up.getComponent(i)));
    const last = frames[frames.length - 1];
    const inside = Math.abs(last[0]) < halfX && Math.abs(last[2]) < halfZ;
    return { frames, landed, flat: m > 0.995 && body.sleepState === CANNON.Body.SLEEPING && inside, impacts: this.impacts.slice() };
  }

  // Throw the die so that it shows `value`. fromDir: vector from board centre
  // towards the thrower. Resolves when the die comes to rest.
  roll(value, fromDir = new THREE.Vector3(0, 0, 1)) {
    if (this.simple) return this._dropRoll(value, fromDir);
    let sim;
    for (let tries = 0; tries < 8; tries++) {
      sim = this._simulate(fromDir);
      if (sim.flat) break;
    }
    this.offset.setFromUnitVectors(FACE_NORMAL[value], sim.landed);
    this.value = value;
    sfx.diceShake();
    return new Promise((resolve) => {
      this.playing = { ...sim, start: null, resolve, impactIdx: 0 };
      if (document.hidden) this._finish();
    });
  }

  // Scripted throw: falls from the thrower's side, tumbles, bounces twice and
  // settles showing `value`. No physics stepping, so no hitch before it starts.
  _dropRoll(value, fromDir) {
    const { halfX, halfZ } = this.bounds;
    const dir = fromDir.clone().setY(0).normalize();
    const to = new THREE.Vector3((Math.random() - 0.5) * halfX * 0.7, this.floorY + this.half, (Math.random() - 0.5) * halfZ * 0.7);
    const from = to.clone().addScaledVector(dir, 2.2).setY(this.floorY + 3.2);
    const qEnd = new THREE.Quaternion().setFromUnitVectors(FACE_NORMAL[value], new THREE.Vector3(0, 1, 0));
    qEnd.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.value = value;
    this.offset.identity();
    sfx.diceShake();
    return new Promise((resolve) => {
      this.playing = { simple: true, start: null, dur: 0.85, from, to, qEnd, axis, turns: 2 + Math.random() * 1.5, resolve, hits: 0 };
      if (document.hidden) this._finish();
    });
  }

  _updateDrop(p, now) {
    if (p.start === null) p.start = now;
    const k = Math.min(1, (now - p.start) / 1000 / p.dur);
    if (k >= 1) { this._finish(); return; }
    // horizontal glide eases out; height = fall then two shrinking bounces
    const e = 1 - Math.pow(1 - k, 3);
    this.mesh.position.lerpVectors(p.from, p.to, e);
    const h0 = p.from.y - p.to.y;
    let y;
    if (k < 0.45) { const f = k / 0.45; y = h0 * (1 - f * f); }
    else if (k < 0.75) { const f = (k - 0.45) / 0.3; y = 0.45 * Math.sin(Math.PI * f); }
    else if (k < 0.9) { const f = (k - 0.75) / 0.15; y = 0.12 * Math.sin(Math.PI * f); }
    else y = 0;
    this.mesh.position.y = p.to.y + y;
    const hit = k >= 0.45 ? (k >= 0.75 ? (k >= 0.9 ? 3 : 2) : 1) : 0;
    if (hit > p.hits) { p.hits = hit; sfx.diceHit([0, 0.8, 0.4, 0.15][hit]); if (hit === 1) sfx.buzz(12); }
    // tumble that unwinds exactly onto the final face by ~80% of the throw
    const spin = Math.max(0, 1 - k / 0.8);
    this.mesh.quaternion.setFromAxisAngle(p.axis, spin * spin * p.turns * Math.PI * 2).premultiply(p.qEnd);
  }

  _apply(f) {
    this.mesh.position.set(f[0], f[1], f[2]);
    this.mesh.quaternion.set(f[3], f[4], f[5], f[6]).multiply(this.offset);
  }

  _finish() {
    const p = this.playing;
    if (p.simple) {
      this.mesh.position.copy(p.to);
      this.mesh.quaternion.copy(p.qEnd);
      this.playing = null;
      p.resolve(this.value);
      return;
    }
    this._apply(p.frames[p.frames.length - 1]);
    // snap to perfectly flat
    this.mesh.position.y = this.floorY + this.half;
    this.playing = null;
    p.resolve(this.value);
  }

  update(now) {
    const t = now * 0.001;
    this.ring.position.x = this.mesh.position.x;
    this.ring.position.z = this.mesh.position.z;
    const target = this.inviting && !this.playing ? 0.55 + Math.sin(t * 5) * 0.3 : 0;
    this.ring.material.opacity += (target - this.ring.material.opacity) * 0.15;
    this.ring.scale.setScalar(1 + (this.inviting ? Math.sin(t * 5) * 0.08 : 0));
    for (const m of this.materials) {
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = this.inviting && !this.playing ? 0.06 + Math.sin(t * 5) * 0.04 : 0;
    }

    const p = this.playing;
    if (!p) return;
    if (p.simple) { this._updateDrop(p, now); return; }
    if (p.start === null) p.start = now;
    const fi = (now - p.start) / 1000 / STEP;
    const i = Math.floor(fi);
    if (i >= p.frames.length - 1) { this._finish(); return; }
    while (p.impactIdx < p.impacts.length && p.impacts[p.impactIdx].frame <= i) {
      const v = p.impacts[p.impactIdx].v;
      sfx.diceHit(v / 9);
      if (v > 4) sfx.buzz(12);
      p.impactIdx++;
    }
    const a = p.frames[i];
    const b = p.frames[i + 1];
    const k = fi - i;
    this.mesh.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    const qa = new THREE.Quaternion(a[3], a[4], a[5], a[6]);
    const qb = new THREE.Quaternion(b[3], b[4], b[5], b[6]);
    this.mesh.quaternion.slerpQuaternions(qa, qb, k).multiply(this.offset);
  }
}
