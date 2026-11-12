// Online play over WebRTC using PeerJS (public broker for signalling only;
// game data flows peer-to-peer). The host is authoritative.
//
// Built to survive flaky connections and page reloads:
//  - both sides exchange a small ping every few seconds; a link is only
//    declared dead after a long silence, so a slow phone isn't dropped
//  - a client whose link drops keeps retrying in the background ("down" /
//    "up" events) until it reconnects or the player leaves
//  - a host that reloads reclaims the same room code, and clients find it again
//  - every room has a secret id checked on each (re)connect, so a returning
//    player can never land in a different room that reused the same slot
//
// Both games use this module; setGame() keeps their rooms apart.

let PREFIX = 'ludo3d-v1-';
export function setGame(prefix) { PREFIX = prefix; }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_EPOCH_PROBE = 6; // how many room-id variants a client tries
const PING_MS = 4000;      // keep-alive interval
const DEAD_MS = 30000;     // silence before a link is treated as lost
const CONNECT_MS = 12000;  // one connection attempt
const PROBE_MS = 6000;     // waiting for a room's info reply

// public matchmaking: a fixed set of well-known match rooms per game
export const MATCH_SLOTS = 10;
export const matchCode = (slot) => `MATCH-${slot}`;
export const isMatchCode = (code) => typeof code === 'string' && code.startsWith('MATCH-');

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve();
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './vendor/peerjs.min.js';
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error('Could not load networking library')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// On reload/close, hang up cleanly. The broker then frees the host's room id
// straight away (otherwise it holds it ~60s), and the other side notices the
// drop immediately instead of waiting for the keep-alive to time out.
const live = new Set();
window.addEventListener('pagehide', () => { for (const n of live) { try { n.peer?.destroy(); } catch { /* gone */ } } });
// coming back from the back/forward cache with dead connections: start fresh
window.addEventListener('pageshow', (e) => { if (e.persisted && live.size) location.reload(); });

// The broker keeps a closed peer id reserved for up to a minute, so a host
// that reloads can't reuse its old id quickly. Instead it re-opens the same
// room under the next "epoch" id (CODE, CODE-1, CODE-2, ...); clients probe
// those in order. The room code people see never changes.
const idFor = (code, epoch) => PREFIX + code + (epoch ? '-' + epoch : '');
const newRoomId = () => makeCode() + makeCode();

export function makeCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

// Ask a set of rooms what they are (players, open seats, started?) without
// joining them. Resolves to the rooms that answered: [{ code, ...info }].
export async function scanRooms(codes) {
  await loadPeer();
  const peer = new window.Peer({ debug: 0 });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Timed out reaching the matchmaking server.')), CONNECT_MS);
      peer.on('open', () => { clearTimeout(t); res(); });
      peer.on('error', (e) => { if (e.type !== 'peer-unavailable') { clearTimeout(t); rej(new Error(friendlyError(e))); } });
    });
    const probe = (code) => new Promise((res) => {
      const conn = peer.connect(idFor(code, 0), { reliable: true });
      const t = setTimeout(() => { try { conn.close(); } catch { /* never opened */ } res(null); }, PROBE_MS);
      conn.on('open', () => conn.send({ t: 'info' }));
      conn.on('data', (m) => {
        if (m?.t !== 'info') return;
        clearTimeout(t);
        conn.close();
        res({ ...m.info, code });
      });
      conn.on('error', () => {});
    });
    return (await Promise.all(codes.map(probe))).filter(Boolean);
  } finally {
    peer.destroy();
  }
}

function friendlyError(err) {
  const t = err?.type || '';
  if (t === 'peer-unavailable') return 'Room not found. Check the code.';
  if (t === 'unavailable-id') return 'Room code clash, try again.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Network problem: cannot reach the matchmaking server.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return err?.message || 'Connection error';
}

export class HostNet {
  constructor() {
    this.conns = new Map(); this.seen = new Map(); this.handlers = {};
    this.describe = () => ({}); // what an 'info' probe is told about this room
    live.add(this);
  }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  _open(id) {
    return new Promise((res, rej) => {
      const peer = new window.Peer(id, { debug: 0 });
      this.peer = peer;
      peer.on('open', () => res());
      peer.on('error', (e) => {
        if (!this.code) rej(e);
        else if (e.type !== 'peer-unavailable') this._emit('error', friendlyError(e));
      });
      peer.on('connection', (conn) => this._accept(conn));
      // lost the broker (not the players): quietly re-register
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000); });
    });
  }

  // New room, or (with `code`) re-open a room after a reload under the next
  // epoch id, so it's back within seconds.
  async start(code = null, epoch = 0, roomId = null) {
    await loadPeer();
    const reclaim = !!code;
    this.roomId = roomId || newRoomId();
    for (let attempt = 0; attempt < (reclaim ? MAX_EPOCH_PROBE : 3); attempt++) {
      const c = code || makeCode();
      const e = reclaim ? epoch + 1 + attempt : 0;
      try {
        await this._open(idFor(c, e));
        this.code = c;
        this.epoch = e;
        this._beat();
        return c;
      } catch (err) {
        this.peer?.destroy();
        if (err.type !== 'unavailable-id') throw new Error(friendlyError(err));
      }
    }
    throw new Error(reclaim ? 'Could not reopen the room. Create a new one.' : 'Could not create room');
  }

  // Open exactly this room code (a matchmaking slot). Rejects with
  // type 'unavailable-id' when someone already holds it.
  async startAt(code) {
    await loadPeer();
    this.roomId = newRoomId();
    try {
      await this._open(idFor(code, 0));
    } catch (err) {
      this.peer?.destroy();
      throw Object.assign(new Error(friendlyError(err)), { type: err.type });
    }
    this.code = code;
    this.epoch = 0;
    this._beat();
    return code;
  }

  _accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.seen.set(conn.peer, Date.now());
      conn.on('data', (msg) => {
        this.seen.set(conn.peer, Date.now());
        if (msg?.t === 'ping') return;
        if (msg?.t === 'hi') {
          // (re)connect handshake: a client that knew another room is turned away
          conn.send({ t: 'hi', ok: !msg.room || msg.room === this.roomId, room: this.roomId });
          return;
        }
        if (msg?.t === 'info') {
          // a lobby scan, not a player: answer and hang up quietly
          conn.send({ t: 'info', info: this.describe() });
          this.conns.delete(conn.peer);
          this.seen.delete(conn.peer);
          setTimeout(() => conn.close(), 200);
          return;
        }
        this._emit('message', conn.peer, msg);
      });
      conn.on('close', () => this._drop(conn.peer, conn));
      conn.on('error', () => {});
    });
  }

  _drop(id, conn) {
    // ignore a stale connection closing after the player already reconnected
    if (conn && this.conns.get(id) !== conn) return;
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.seen.delete(id);
    this._emit('leave', id);
  }

  _beat() {
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of this.conns) {
        if (now - (this.seen.get(id) || now) > DEAD_MS) { try { c.close(); } catch { /* already gone */ } this._drop(id); continue; }
        if (c.open) c.send({ t: 'ping' });
      }
    }, PING_MS);
  }

  send(id, msg) { const c = this.conns.get(id); if (c?.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  kick(id) { const c = this.conns.get(id); this.conns.delete(id); this.seen.delete(id); c?.close(); }
  close() {
    live.delete(this);
    clearInterval(this._timer);
    for (const c of this.conns.values()) c.close();
    this.peer?.destroy();
    this.conns.clear();
  }
}

export class ClientNet {
  constructor() { this.handlers = {}; this.closed = false; this.up = false; this.epoch = 0; this.roomId = null; live.add(this); }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  async _ensurePeer() {
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) this.peer.reconnect();
      if (this.peer.open) return;
    } else {
      const peer = new window.Peer({ debug: 0 });
      this.peer = peer;
      peer.on('error', (e) => { if (this._pending) this._pending(e); });
      peer.on('disconnected', () => { if (!peer.destroyed && !this.closed) setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1000); });
    }
    const peer = this.peer;
    await new Promise((res, rej) => {
      if (peer.open) { res(); return; }
      const t = setTimeout(() => { peer.off?.('open', ok); rej(new Error('Timed out reaching the matchmaking server.')); }, CONNECT_MS);
      const ok = () => { clearTimeout(t); res(); };
      peer.once('open', ok);
    });
  }

  // try the room's current id and the next few epochs (host may have reloaded)
  async _connectAny() {
    let last;
    for (let e = this.epoch; e < this.epoch + MAX_EPOCH_PROBE; e++) {
      try { await this._connect(e); this.epoch = e; return; } catch (err) {
        last = err;
        if (err.type !== 'peer-unavailable') throw err;
      }
    }
    throw last;
  }

  // one attempt at opening a data connection to the room
  async _connect(epoch) {
    await this._ensurePeer();
    await new Promise((res, rej) => {
      const conn = this.peer.connect(idFor(this.code, epoch), { reliable: true });
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        this._pending = null;
        clearTimeout(t);
        try { conn.close(); } catch { /* not open */ }
        rej(e instanceof Error ? e : Object.assign(new Error(friendlyError(e)), { type: e.type }));
      };
      const t = setTimeout(() => fail(new Error('Timed out connecting to room.')), CONNECT_MS);
      this._pending = (e) => { if (e.type === 'peer-unavailable' || e.type === 'network' || e.type === 'socket-error' || e.type === 'server-error') fail(e); };
      // once open, confirm it's the same room before using it
      const onHi = (m) => {
        if (m?.t !== 'hi' || done) return;
        conn.off?.('data', onHi);
        if (!m.ok) { fail({ type: 'peer-unavailable' }); return; }
        done = true;
        this._pending = null;
        clearTimeout(t);
        this.roomId = this.roomId || m.room;
        this._attach(conn);
        res();
      };
      conn.on('open', () => {
        if (done) { conn.close(); return; }
        conn.on('data', onHi);
        conn.send({ t: 'hi', room: this.roomId });
      });
      conn.on('error', () => {});
    });
  }

  _attach(conn) {
    this.conn = conn;
    this.seen = Date.now();
    this.up = true;
    conn.on('data', (msg) => {
      if (conn !== this.conn) return;
      this.seen = Date.now();
      if (msg?.t === 'ping' || msg?.t === 'hi') return;
      this._emit('message', msg);
    });
    conn.on('close', () => { if (conn === this.conn) this._lost(); });
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (conn !== this.conn) return;
      if (Date.now() - this.seen > DEAD_MS) { this._lost(); return; }
      if (conn.open) conn.send({ t: 'ping' });
    }, PING_MS);
  }

  // Join a room. With `patient`, keep retrying for a while (used when
  // rejoining after a reload, while the host may be reloading too).
  async join(code, { patient = false, epoch = 0, roomId = null } = {}) {
    await loadPeer();
    this.code = code.trim().toUpperCase();
    this.epoch = epoch;
    this.roomId = roomId;
    const deadline = Date.now() + (patient ? 60000 : 0);
    for (;;) {
      try { await this._connectAny(); return; } catch (e) {
        if (this.closed) throw e;
        if (Date.now() > deadline) throw e;
        await sleep(2500);
      }
    }
  }

  _lost() {
    if (this.closed || !this.up) return;
    this.up = false;
    clearInterval(this._timer);
    const old = this.conn;
    this.conn = null;
    try { old?.close(); } catch { /* already closed */ }
    this._emit('down');
    this._retry();
  }

  async _retry() {
    for (let wait = 1000; !this.closed; wait = Math.min(wait * 1.6, 6000)) {
      await sleep(wait);
      if (this.closed) return;
      try { await this._connectAny(); this._emit('up'); return; } catch { /* keep trying */ }
    }
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }
  close() {
    live.delete(this);
    this.closed = true;
    clearInterval(this._timer);
    this.conn?.close();
    this.peer?.destroy();
  }
}
