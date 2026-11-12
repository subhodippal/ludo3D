// Shared top-bar view controls for both games:
//  - a 2D / 3D switch (flat top-down view vs tilted orbit view), remembered
//  - a rotate button (touch devices) that flips between portrait and landscape

const KEY = 'boardgames.viewMode';

function load() {
  try { return localStorage.getItem(KEY) === '2d' ? '2d' : '3d'; } catch { return '3d'; }
}
function save(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage unavailable */ }
}

const ORIENT_KEY = 'boardgames.orientation';

async function lockTo(target) {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  await screen.orientation.lock(target);
}

// Browsers only allow locking orientation in fullscreen (Android Chrome and
// most Android browsers). Elsewhere, e.g. iPhone Safari, tell the player to
// turn the phone instead.
async function flipOrientation(toast) {
  const landscape = window.innerWidth > window.innerHeight;
  const target = landscape ? 'portrait' : 'landscape';
  try {
    await lockTo(target);
  } catch {
    toast?.(landscape ? 'Turn your phone upright for portrait' : 'Turn your phone sideways for landscape', null, 2.2);
  }
}

export function initViewControls(scene, { toast, onClick } = {}) {
  const right = document.querySelector('.topbar-right');
  const seg = document.createElement('div');
  seg.className = 'view-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Board view');
  seg.innerHTML = '<button data-mode="2d">2D</button><button data-mode="3d">3D</button>';
  right.prepend(seg);

  const mark = (mode) => seg.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });

  let mode = load();
  mark(mode);
  scene.setMode(mode, false);

  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    save(mode);
    mark(mode);
    onClick?.();
    scene.setMode(mode, true);
  });

  if (window.matchMedia('(pointer: coarse)').matches) {
    const rot = document.createElement('button');
    rot.className = 'icon-btn';
    rot.id = 'btnRotate';
    rot.setAttribute('aria-label', 'Switch portrait / landscape');
    rot.innerHTML = '<svg viewBox="0 0 24 24"><rect x="8" y="4" width="8" height="13" rx="1.5"/><path d="M11 14.5h2"/><path d="M3 14a8 8 0 0 0 7 7l-1.5-1.5M21 10a8 8 0 0 0-7-7l1.5 1.5"/></svg>';
    seg.after(rot);
    rot.addEventListener('click', () => { onClick?.(); flipOrientation(toast); });
  }
}

// Settings: Auto / Portrait / Landscape. The choice is remembered; because
// browsers only lock orientation in response to a tap, a saved lock is
// re-applied on the first tap after the page loads.
export function initOrientationSetting({ toast, onClick } = {}) {
  const seg = document.getElementById('segOrient');
  if (!seg) return;
  let pref = 'auto';
  try { pref = localStorage.getItem(ORIENT_KEY) || 'auto'; } catch { /* storage unavailable */ }
  const mark = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === pref));
  const apply = async (announce) => {
    try {
      if (pref === 'auto') {
        screen.orientation?.unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen();
      } else await lockTo(pref);
    } catch {
      if (announce) toast?.(pref === 'landscape' ? 'Turn your phone sideways for landscape' : 'Turn your phone upright for portrait', null, 2.2);
    }
  };
  mark();
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pref = b.dataset.v;
    try { localStorage.setItem(ORIENT_KEY, pref); } catch { /* storage unavailable */ }
    mark();
    onClick?.();
    apply(true);
  });
  if (pref !== 'auto') document.addEventListener('click', () => apply(false), { once: true, capture: true });
}
