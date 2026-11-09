// Online play over WebRTC using PeerJS (public broker for signalling only;
// game data flows peer-to-peer). The host is authoritative.

const PREFIX = 'ludo3d-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

export function makeCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
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
  constructor() { this.conns = new Map(); this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  async start() {
    await loadPeer();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeCode();
      try {
        await new Promise((res, rej) => {
          const peer = new window.Peer(PREFIX + code, { debug: 0 });
          this.peer = peer;
          peer.on('open', () => res());
          peer.on('error', (e) => {
            if (!this.code) rej(e);
            else if (e.type !== 'peer-unavailable') this._emit('error', friendlyError(e));
          });
          peer.on('connection', (conn) => this._accept(conn));
          peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        });
        this.code = code;
        return code;
      } catch (e) {
        this.peer?.destroy();
        if (e.type !== 'unavailable-id') throw new Error(friendlyError(e));
      }
    }
    throw new Error('Could not create room');
  }

  _accept(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', (msg) => this._emit('message', conn.peer, msg));
      conn.on('close', () => { this.conns.delete(conn.peer); this._emit('leave', conn.peer); });
      conn.on('error', () => {});
    });
  }

  send(id, msg) { const c = this.conns.get(id); if (c?.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  kick(id) { this.conns.get(id)?.close(); this.conns.delete(id); }
  close() { for (const c of this.conns.values()) c.close(); this.peer?.destroy(); this.conns.clear(); }
}

export class ClientNet {
  constructor() { this.handlers = {}; }
  on(ev, fn) { this.handlers[ev] = fn; return this; }
  _emit(ev, ...a) { this.handlers[ev]?.(...a); }

  async join(code) {
    await loadPeer();
    code = code.trim().toUpperCase();
    await new Promise((res, rej) => {
      const peer = new window.Peer({ debug: 0 });
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => { if (!opened) rej(new Error('Timed out connecting to room.')); }, 15000);
      peer.on('error', (e) => { if (!opened) { clearTimeout(timer); rej(new Error(friendlyError(e))); } else this._emit('error', friendlyError(e)); });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => { opened = true; clearTimeout(timer); res(); });
        conn.on('data', (msg) => this._emit('message', msg));
        conn.on('close', () => this._emit('close'));
        conn.on('error', () => {});
      });
    });
    this.code = code;
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }
  close() { this.conn?.close(); this.peer?.destroy(); }
}
