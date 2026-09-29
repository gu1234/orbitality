// Dashboard for this repo's git worktrees: `npm run worktrees`.
// Lists every worktree, most recently changed first, and serves each one's game at
// /wt/<name>/. An open game reloads itself when files in its worktree change.
//
// It runs on its own port (not server.mjs) because the game registers a service worker
// for the directory it is served from. One registered at / by `npm start` would take
// over /wt/<name>/ pages too, and it only knows the game's paths at its own root.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { basename, extname, join, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8070;
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

/** Files that are not part of the game: no reload when they change. */
const OFFSTAGE = new Set(['node_modules', 'tests', 'tools']);
/** index.html asks for v/<n>/js/main.js once its service worker runs (see sw.js). */
const VERSIONED = /^v\/[^/]+\//;

const git = async (cwd, ...args) => (await run('git', args, { cwd, maxBuffer: 16 << 20 })).stdout;

// ---------------------------------------------------------------- worktrees

/** @type {{ id: string, path: string, branch: string | null, main: boolean }[]} */
let trees = [];

/** Re-read `git worktree list`, and watch any worktree that is new. */
async function refresh() {
  const out = await git(here, 'worktree', 'list', '--porcelain');
  const taken = new Set();
  const next = [];
  for (const block of out.trim().split(/\n\n+/)) {
    const t = {};
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ');
      t[key] = rest.join(' ') || true;
    }
    if (!t.worktree || t.bare || t.prunable) continue;
    const main = next.length === 0;
    let id = main ? 'main' : basename(t.worktree);
    for (let n = 2; taken.has(id); n++) id = `${basename(t.worktree)}-${n}`;
    taken.add(id);
    next.push({ id, path: t.worktree, branch: t.branch?.replace(/^refs\/heads\//, '') ?? null, main });
  }
  trees = next;
  syncWatchers();
  return trees;
}

/** Where a worktree stands: its last commit, uncommitted files, and when it last changed. */
async function describe(tree, base) {
  const [log, status, counts] = await Promise.all([
    git(tree.path, 'log', '-1', '--format=%ct%x00%h%x00%s'),
    git(tree.path, 'status', '--porcelain', '-z', '-uall', '--no-renames'),
    tree.main || !base ? null : git(tree.path, 'rev-list', '--left-right', '--count', `${base}...HEAD`).catch(() => null),
  ]);
  const [time, hash, subject] = log.trim().split('\0');
  const committed = Number(time) * 1000;
  // `XY path` entries; .claude/ holds the worktrees themselves, not game changes.
  const files = status.split('\0').filter(Boolean).map((e) => e.slice(3)).filter((f) => !f.startsWith('.claude/'));
  const mtimes = await Promise.all(files.map((f) => stat(join(tree.path, f)).then((s) => s.mtimeMs, () => 0)));
  const edited = Math.max(0, ...mtimes);
  const [behind, ahead] = counts ? counts.trim().split(/\s+/).map(Number) : [0, 0];
  return {
    id: tree.id,
    path: tree.path,
    branch: tree.branch,
    main: tree.main,
    changed: Math.max(committed, edited),
    source: edited > committed ? 'edited' : 'committed',
    uncommitted: files.length,
    ahead,
    behind,
    base,
    commit: { hash, subject, time: committed },
  };
}

async function sendTrees(res) {
  await refresh();
  const base = trees.find((t) => t.main)?.branch;
  const list = await Promise.all(trees.map((t) => describe(t, base).catch((err) => ({ ...t, error: err.message, changed: 0 }))));
  list.sort((a, b) => b.changed - a.changed);
  res.writeHead(200, { 'content-type': types['.json'], 'cache-control': 'no-cache' });
  res.end(JSON.stringify(list));
}

/** Same shape as server.mjs's version.json, for the version line in the game's menu. */
async function sendVersion(res, tree) {
  let v = {};
  try {
    const [commit, full, dirty] = await Promise.all([
      git(tree.path, 'rev-parse', '--short', 'HEAD'),
      git(tree.path, 'rev-parse', 'HEAD'),
      git(tree.path, 'status', '--porcelain', '--untracked-files=no'),
    ]);
    v = { commit: commit.trim(), full: full.trim(), dirty: dirty.trim() !== '' };
  } catch { /* not a git checkout */ }
  res.writeHead(200, { 'content-type': types['.json'], 'cache-control': 'no-cache' });
  res.end(JSON.stringify(v));
}

// ---------------------------------------------------------------- live reload

/** Open event streams: `id` is a worktree's game, or null for the dashboard (all of them). */
const streams = new Set();
const watchers = new Map();
const pending = new Map();

function syncWatchers() {
  for (const { path } of trees) {
    if (watchers.has(path)) continue;
    try {
      const w = watch(path, { recursive: true }, (_, file) => file && onstage(file) && changed(path, file));
      w.on('error', () => { w.close(); watchers.delete(path); });
      watchers.set(path, w);
    } catch { /* the directory is gone */ }
  }
  for (const [path, w] of watchers) {
    if (!trees.some((t) => t.path === path)) { w.close(); watchers.delete(path); }
  }
}

function onstage(file) {
  const parts = file.split(sep);
  return !OFFSTAGE.has(parts[0]) && !parts.some((p) => p.startsWith('.')) && !file.endsWith('.md');
}

/** Wait for a burst of writes to settle, then tell the game and the dashboard once. */
function changed(path, file) {
  let p = pending.get(path);
  if (!p) pending.set(path, (p = { files: new Set() }));
  p.files.add(file.split(sep).join('/'));
  clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    pending.delete(path);
    const tree = trees.find((t) => t.path === path);
    if (!tree) return;
    const data = JSON.stringify({ id: tree.id, files: [...p.files] });
    for (const s of streams) if (s.id === null || s.id === tree.id) s.res.write(`event: change\ndata: ${data}\n\n`);
  }, 300);
}

function openStream(req, res, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const s = { res, id };
  streams.add(s);
  req.on('close', () => streams.delete(s));
}

// Comments keep idle streams open through anything that times them out.
setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 25_000).unref();

/** The worktree's index.html, plus a script that reloads it when the worktree changes. */
function withLiveReload(html, tree) {
  const id = JSON.stringify(tree.id).replace(/</g, '\\u003c');
  const script = `<script>
    // Added by tools/worktrees.mjs: reload whenever this worktree's files change.
    document.title += ' (' + ${id} + ')';
    new EventSource('/api/live/' + encodeURIComponent(${id})).addEventListener('change', () => location.reload());
  </script>\n`;
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : html + script;
}

// ---------------------------------------------------------------- http

function notFound(res, message = 'Not found') {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function sendFile(res, file, tree) {
  if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
  let body = await readFile(file);
  if (tree && file === join(tree.path, 'index.html')) body = withLiveReload(body.toString(), tree);
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
}

async function serveTree(req, res, url, id, rest) {
  let tree = trees.find((t) => t.id === id);
  if (!tree) tree = (await refresh()).find((t) => t.id === id);
  if (!tree) return notFound(res, `No worktree named "${id}". The list is at /`);
  if (rest === undefined) {
    res.writeHead(302, { location: `/wt/${encodeURIComponent(id)}/${url.search}` });
    return res.end();
  }
  // A service worker registered at / by an earlier server on this port doesn't strip v/<n>/.
  const path = rest.replace(/^\//, '').replace(VERSIONED, '');
  if (path.split('/').some((p) => p.startsWith('.'))) return notFound(res);
  if (path === 'version.json') return sendVersion(res, tree);
  const file = join(tree.path, path);
  if (file !== tree.path && !file.startsWith(tree.path + sep)) return notFound(res);
  return sendFile(res, file, tree);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '/index.html') return await sendFile(res, join(here, 'worktrees.html'));
    if (path === '/api/worktrees') return await sendTrees(res);
    if (path === '/api/events') return openStream(req, res, null);
    const live = path.match(/^\/api\/live\/([^/]+)$/);
    if (live) return openStream(req, res, live[1]);
    const wt = path.match(/^\/wt\/([^/]+)(\/.*)?$/);
    if (wt) return await serveTree(req, res, url, wt[1], wt[2]);
    notFound(res);
  } catch {
    if (!res.headersSent) notFound(res);
    else res.end();
  }
}).on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another with PORT=<n>.` : err.message);
  process.exit(1);
}).listen(port, async () => {
  await refresh().catch((err) => console.error(`Can't list worktrees: ${err.message}`));
  console.log(`Orbitality worktrees at http://localhost:${port}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on your phone (same Wi-Fi): http://${a.address}:${port}`);
    }
  }
});
