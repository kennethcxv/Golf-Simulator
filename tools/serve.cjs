// Zero-dependency static dev server for browser-based testing.
// The shipped game runs in Electron; this exists so the same files can be
// driven by browser tooling (Playwright / Chrome DevTools MCP) during development.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8457); // 8437 GlassWater, 8447 FAIRWAY STATE, 8457 GOLF EMPIRE

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  // The Basis transcoder is instantiated with WebAssembly.instantiateStreaming,
  // which rejects any response not served as application/wasm.
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found: ' + rel);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        // Playwright may run beside another worktree. A bare HTTP 200 is not proof
        // that the requested port belongs to this checkout, so expose the canonical
        // root for tools/qa/run-playwright.cjs to verify before it records evidence.
        'X-Golf-Root': encodeURIComponent(ROOT),
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`golf-empire dev server: http://localhost:${PORT}/`);
});
