// Version line in the main menu: package.json version plus the commit being served.
// `npm start` serves version.json from git (see server.mjs); GitHub Pages has no build
// step, so there the hash comes from the latest commit on main via the GitHub API.

const REPO = 'gu1234/orbitality';

async function json(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function commit() {
  try {
    const v = await json('version.json');
    if (v.commit) return v;
  } catch { /* not served by server.mjs */ }
  if (!location.hostname.endsWith('github.io')) return null;
  const c = await json(`https://api.github.com/repos/${REPO}/commits/main`);
  return { commit: c.sha.slice(0, 7), full: c.sha };
}

/** Fill `el` with "v0.1.0 · abc1234"; the hash links to the commit on GitHub. */
export async function showVersion(el) {
  if (!el) return;
  try {
    const { version } = await json('package.json');
    el.textContent = `v${version}`;
    const c = await commit().catch(() => null);
    if (!c) return;
    el.append(' · ');
    const a = document.createElement('a');
    a.href = `https://github.com/${REPO}/commit/${c.full || c.commit}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = c.commit + (c.dirty ? '-dirty' : '');
    if (c.dirty) a.title = 'Uncommitted local changes on top of this commit';
    el.append(a);
  } catch { /* leave the line empty rather than break the menu */ }
}
