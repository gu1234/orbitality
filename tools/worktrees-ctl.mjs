// Run the worktree dashboard (tools/worktrees.mjs) in the background:
// `npm run worktrees:start` and `npm run worktrees:stop`.
// The server's pid and output are kept in tools/.cache/, which git ignores.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cache = fileURLToPath(new URL('.cache/', import.meta.url));
const pidFile = `${cache}worktrees.pid`;
const logFile = `${cache}worktrees.log`;
const server = fileURLToPath(new URL('worktrees.mjs', import.meta.url));
const port = Number(process.env.PORT) || 8070;

/** The pid of the server this script started, if it is still running. */
function running() {
  let pid;
  try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { return null; }
  try { process.kill(pid, 0); return pid; } catch { rmSync(pidFile, { force: true }); return null; }
}

async function start() {
  const pid = running();
  if (pid) return console.log(`Already running (pid ${pid}). Stop it with npm run worktrees:stop`);
  mkdirSync(cache, { recursive: true });
  const log = openSync(logFile, 'w');
  const child = spawn(process.execPath, [server], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: String(port) } });
  child.unref();
  // Wait until it answers, so a port clash or crash is reported here, not silently.
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode !== null) break;
    const up = await fetch(`http://localhost:${port}/api/worktrees`).then((r) => r.ok, () => false);
    if (up && child.exitCode === null) {
      writeFileSync(pidFile, String(child.pid));
      return console.log(`${readFileSync(logFile, 'utf8').trim()}\nRunning in the background (pid ${child.pid}). Log: ${logFile}`);
    }
  }
  try { process.kill(child.pid); } catch { /* already gone */ }
  console.error(`The server didn't start:\n${readFileSync(logFile, 'utf8').trim()}`);
  process.exitCode = 1;
}

function stop() {
  const pid = running();
  if (!pid) return console.log('Not running.');
  process.kill(pid);
  rmSync(pidFile, { force: true });
  console.log(`Stopped (pid ${pid}).`);
}

const command = process.argv[2];
if (command === 'start') await start();
else if (command === 'stop') stop();
else {
  console.error('Usage: node tools/worktrees-ctl.mjs start|stop');
  process.exitCode = 1;
}
