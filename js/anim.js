// Tiny promise-based tween system driven by the render loop

const tweens = new Set();

export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

export function tween(duration, onUpdate, easing = ease.inOut) {
  return new Promise((resolve) => {
    if (document.hidden || duration <= 0) { onUpdate(1, 1); resolve(); return; }
    tweens.add({ start: null, duration, onUpdate, easing, resolve });
  });
}

export function updateTweens(now) {
  for (const tw of tweens) {
    if (tw.start === null) tw.start = now;
    const raw = Math.min(1, (now - tw.start) / 1000 / tw.duration); // duration in seconds
    tw.onUpdate(tw.easing(raw), raw);
    if (raw >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

// Complete everything immediately (used when the tab gets hidden)
export function flushTweens() {
  for (const tw of tweens) { tw.onUpdate(1, 1); tw.resolve(); }
  tweens.clear();
}

export const wait = (ms) => new Promise((r) => setTimeout(r, document.hidden ? 0 : ms));
