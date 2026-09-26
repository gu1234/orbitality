// Minimal static file server for local development: `npm start`.
// ES modules don't load from file://, so the game needs to be served over http.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** The commit being served, for the version line in the menu (GitHub Pages has no such file). */
function sendVersion(res) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let v = {};
  try {
    v = {
      commit: git('rev-parse', '--short', 'HEAD'),
      full: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    };
  } catch { /* not a git checkout */ }
  res.writeHead(200, { 'content-type': types['.json'], 'cache-control': 'no-cache' });
  res.end(JSON.stringify(v));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path === 'version.json') return sendVersion(res);
    if (path.startsWith('..')) throw new Error('bad path');
    let file = join(root, path);
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Orbitality running at http://localhost:${port}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on your phone (same Wi-Fi): http://${a.address}:${port}`);
    }
  }
});
