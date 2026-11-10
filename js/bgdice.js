// Decorative background: a handful of translucent cube dice slowly drifting
// and tumbling behind the board. Tapping one knocks it away with a fast spin,
// after which it eases back to its lazy drift.

import * as THREE from '../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { sfx } from './audio.js';

const DICE = [
  { color: 0xe53935, size: 3.0 },
  { color: 0x1e88e5, size: 2.1 },
  { color: 0xf9c623, size: 3.6 },
  { color: 0x2fae4f, size: 2.6 },
  { color: 0x8e44ad, size: 1.8 },
];

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
};

const pipTex = {};
function pipTexture(n) {
  if (pipTex[n]) return pipTex[n];
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  for (const [x, y] of PIPS[n]) {
    g.beginPath();
    g.arc(x * s, y * s, s * 0.09, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (pipTex[n] = tex);
}

// faces in standard die layout: opposite faces sum to 7
const FACES = [
  [1, new THREE.Vector3(0, 1, 0)], [6, new THREE.Vector3(0, -1, 0)],
  [2, new THREE.Vector3(1, 0, 0)], [5, new THREE.Vector3(-1, 0, 0)],
  [3, new THREE.Vector3(0, 0, 1)], [4, new THREE.Vector3(0, 0, -1)],
];

const geo = new RoundedBoxGeometry(1, 1, 1, 3, 0.14);
const plane = new THREE.PlaneGeometry(0.9, 0.9);
const Z = new THREE.Vector3(0, 0, 1);

function buildDie({ color, size }) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
    color, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08,
    transparent: true, opacity: 0.72, depthWrite: false,
  }));
  body.renderOrder = 1;
  group.add(body);
  for (const [n, normal] of FACES) {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
      map: pipTexture(n), transparent: true, opacity: 0.95, depthWrite: false,
    }));
    m.quaternion.setFromUnitVectors(Z, normal);
    m.position.copy(normal).multiplyScalar(0.502);
    m.renderOrder = 2;
    group.add(m);
  }
  group.scale.setScalar(size);
  group.userData.body = body;
  return group;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const CRUISE = 0.9;  // slow drift speed (units/s)
const SPIN = 0.35;   // slow tumble (rad/s)

// The dice live in a layer that follows the camera and sits a little behind
// the board, so they fill the empty space around it on any screen shape and
// the board always covers them rather than the other way round.
export class BgDice {
  constructor(scene, camera) {
    this.camera = camera;
    this.layer = new THREE.Group();
    scene.add(this.layer);
    this.items = DICE.map((spec, i) => {
      const die = buildDie(spec);
      die.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
      const dir = rnd(0, Math.PI * 2);
      const item = {
        die, size: spec.size, depth: rnd(9, 16), pop: 0,
        // start spread across the view (normalised -1..1), revealed once placed
        u: ((i + 0.5) / DICE.length) * 2 - 1, v: rnd(-0.85, 0.85),
        vel: new THREE.Vector2(Math.cos(dir), Math.sin(dir)).multiplyScalar(CRUISE),
        spin: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(SPIN),
        placed: false,
      };
      this.layer.add(die);
      return item;
    });
    this.meshes = this.items.map((it) => it.die.userData.body);
  }

  // Tap response: fling the die in a random direction with a fast spin.
  poke(mesh) {
    const it = this.items.find((i) => i.die.userData.body === mesh);
    if (!it) return false;
    const dir = rnd(0, Math.PI * 2);
    it.vel.set(Math.cos(dir), Math.sin(dir)).multiplyScalar(rnd(9, 13));
    it.spin.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(9, 14));
    it.pop = 1;
    sfx.diceHit(0.6);
    return true;
  }

  update(dt) {
    const cam = this.camera;
    this.layer.position.copy(cam.position);
    this.layer.quaternion.copy(cam.quaternion);
    const dist = cam.position.length(); // camera orbits the board centre
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const k = 1 - Math.exp(-dt * 1.2); // ease back towards the lazy drift
    for (const it of this.items) {
      const { die, vel, spin } = it;
      const D = dist + it.depth;
      const hh = tanV * D, hw = hh * cam.aspect;
      const m = it.size * 0.6;
      if (!it.placed) {
        die.position.set(it.u * (hw - m), it.v * (hh - m), -D);
        it.placed = true;
      }
      const sp = vel.length();
      vel.multiplyScalar((sp + (CRUISE - sp) * k) / (sp || 1));
      const ss = spin.length();
      spin.multiplyScalar((ss + (SPIN - ss) * k) / (ss || 1));
      it.pop += (0 - it.pop) * Math.min(1, dt * 6);

      die.position.x += vel.x * dt;
      die.position.y += vel.y * dt;
      die.position.z = -D;
      // bounce off the edges of the view
      if (die.position.x > hw - m) { die.position.x = hw - m; vel.x = -Math.abs(vel.x); }
      if (die.position.x < -hw + m) { die.position.x = -hw + m; vel.x = Math.abs(vel.x); }
      if (die.position.y > hh - m) { die.position.y = hh - m; vel.y = -Math.abs(vel.y); }
      if (die.position.y < -hh + m) { die.position.y = -hh + m; vel.y = Math.abs(vel.y); }
      die.rotation.x += spin.x * dt;
      die.rotation.y += spin.y * dt;
      die.rotation.z += spin.z * dt;
      die.scale.setScalar(it.size * (1 + it.pop * 0.15));
    }
  }
}
