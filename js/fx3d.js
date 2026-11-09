// Shared 3D particle effects: bursts, shockwave rings, fireworks, confetti.
import * as THREE from '../vendor/three.module.min.js';

let _sprite = null;
function sprite() {
  if (_sprite) return _sprite;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _sprite = new THREE.CanvasTexture(cv);
  return _sprite;
}
export { sprite as softSprite };

export class Fx3D {
  constructor(scene, { floorY = 0, confettiColors = [0xe53935, 0x2fae4f, 0xf9c623, 0x1e88e5, 0xffffff, 0xff7ad9] } = {}) {
    this.scene = scene;
    this.floorY = floorY;
    this.confettiColors = confettiColors;
    this.effects = [];
  }

  // particles flying out of pos. sphere = spherical firework burst.
  // opts: { speed, up, life, size, gravity, soft }
  burst(pos, color, n = 40, sphere = false, opts = {}) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const v = [];
    const sp = opts.speed ?? 1;
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y + (opts.lift ?? 0.4); p[i * 3 + 2] = pos.z;
      if (sphere) {
        v.push(new THREE.Vector3().randomDirection().multiplyScalar((2.5 + Math.random() * 1.5) * sp));
      } else {
        const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 3) * sp;
        v.push(new THREE.Vector3(Math.cos(a) * s, (opts.up ?? 1) * (3 + Math.random() * 4), Math.sin(a) * s));
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({
      color, size: opts.size ?? (sphere ? 0.2 : 0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      map: opts.soft ? sprite() : null,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.effects.push({ obj: pts, v, life: opts.life ?? (sphere ? 1.4 : 1.1), age: 0, kind: 'burst', g: opts.gravity ?? (sphere ? 3 : 12) });
  }

  // expanding ring on the floor
  shockwave(pos, color = 0xffffff, size = 3.2) {
    const geo = new THREE.RingGeometry(0.42, 0.55, 48).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, this.floorY + 0.03, pos.z);
    this.scene.add(m);
    this.effects.push({ obj: m, life: 0.75, age: 0, kind: 'ring', size });
  }

  fireworks(pos, colors, count = 4, height = 2.5) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const p = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 3, height + Math.random() * 2, pos.z + (Math.random() - 0.5) * 3);
        this.burst(p, colors[i % colors.length], 60, true);
      }, i * 220);
    }
  }

  // colour plus lighter tints, for colour-matched fireworks
  shades(hex) {
    const c = new THREE.Color(hex);
    return [hex, c.clone().lerp(new THREE.Color(0xffffff), 0.35).getHex(), hex, c.clone().lerp(new THREE.Color(0xffffff), 0.6).getHex()];
  }

  confetti(n = 260, spread = 16) {
    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const palette = this.confettiColors;
    const items = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(palette[i % palette.length]);
      mesh.setColorAt(i, c);
      items.push({
        p: new THREE.Vector3((Math.random() - 0.5) * spread, 8 + Math.random() * 10, (Math.random() - 0.5) * spread),
        v: new THREE.Vector3((Math.random() - 0.5) * 1.5, -1.5 - Math.random() * 2, (Math.random() - 0.5) * 1.5),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      });
    }
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, items, life: 7, age: 0, kind: 'confetti' });
  }

  update(dt) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const floor = this.floorY + 0.02;
    this.effects = this.effects.filter((e) => {
      e.age += dt;
      if (e.age >= e.life) { this.scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); return false; }
      if (e.kind === 'ring') {
        const k = e.age / e.life;
        e.obj.scale.setScalar(1 + k * e.size * 2);
        e.obj.material.opacity = 1 - k;
      } else if (e.kind === 'burst') {
        const pos = e.obj.geometry.attributes.position;
        e.v.forEach((v, i) => {
          v.y -= e.g * dt;
          pos.array[i * 3] += v.x * dt; pos.array[i * 3 + 1] += v.y * dt; pos.array[i * 3 + 2] += v.z * dt;
          if (pos.array[i * 3 + 1] < floor) { pos.array[i * 3 + 1] = floor; v.y *= -0.3; v.x *= 0.7; v.z *= 0.7; }
        });
        pos.needsUpdate = true;
        e.obj.material.opacity = 1 - e.age / e.life;
      } else {
        e.items.forEach((it, i) => {
          it.p.addScaledVector(it.v, dt);
          it.p.x += Math.sin(e.age * 3 + i) * dt * 0.8;
          if (it.p.y < floor) { it.p.y = floor; it.v.set(0, 0, 0); it.w.set(0, 0, 0); }
          it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
          q.setFromEuler(it.r);
          m4.compose(it.p, q, one);
          e.obj.setMatrixAt(i, m4);
        });
        e.obj.instanceMatrix.needsUpdate = true;
        if (e.age > e.life - 1) e.obj.material.opacity = e.life - e.age;
      }
      return true;
    });
  }
}
