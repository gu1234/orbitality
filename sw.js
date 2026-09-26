// Service worker: always run the latest deployed code, all from the same deploy.
//
// GitHub Pages lets browsers cache every file for 10 minutes, and the game is many
// separate modules, so after a deploy a browser could run some new files and some
// old ones. A reload doesn't help either: the tab reuses the modules it already has.
//
// So once this worker is running, index.html loads the game through a path unique
// to each page load (v/<n>/js/main.js), which no cache has seen. Here that path is
// mapped back to the real file, and every request for one of the game's own files
// goes to the server first. The request is conditional, so an unchanged file costs a
// short "not modified" reply. What comes back is also kept, so the game still loads
// offline from the last copy that worked.

const CACHE = 'orbitality';
const SCOPE = new URL(self.registration.scope).pathname;
const VERSIONED = /^v\/[^/]+\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
  const rest = url.pathname.slice(SCOPE.length);
  const versioned = VERSIONED.test(rest);
  if (versioned) url.pathname = SCOPE + rest.replace(VERSIONED, '');
  e.respondWith(fresh(req, url.href).then((res) => (versioned ? unaddressed(res) : res)));
});

async function fresh(req, href) {
  try {
    const res = await fetch(href, { cache: 'no-cache', credentials: 'same-origin', headers: req.headers });
    if (res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(href, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(href);
    if (hit) return hit;
    throw err;
  }
}

/**
 * The same response without its URL. A module's imports resolve against the URL of
 * the response it came from, so a response carrying the real file's URL would send
 * them back out of v/<n>/; without one, the browser uses the versioned request URL.
 */
function unaddressed(res) {
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
