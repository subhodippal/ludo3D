// Zero-dependency static server for local development / LAN testing.
// Usage: node server.js            (port 8080)
//        PORT=3000 node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8081;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  // Resolve inside ROOT only (blocks ../ traversal)
  let file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, 'index.html');
      return send(file, req, res);
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    send(file, req, res);
  });
});

function send(file, req, res) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache', // always revalidate during development
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
    log(req, 200);
  });
}

function log(req, code) {
  if (process.env.QUIET) return;
  console.log(`${new Date().toLocaleTimeString()}  ${code}  ${req.url}`);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is in use. Try: PORT=${PORT + 1} node server.js`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('\n  Ludo 3D is running:\n');
  console.log(`    Local:    http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`    Network:  http://${a.address}:${PORT}   (open on your phone, same Wi-Fi)`);
    }
  }
  console.log('\n  Note: the service worker / install prompt only work on localhost or HTTPS.\n');
});
