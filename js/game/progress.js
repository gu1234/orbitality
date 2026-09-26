// Level progress, stored per browser. Storage can be unavailable (private mode,
// blocked site data), so every access is guarded and the game works without it.

const KEY = 'orbitality.progress.v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && typeof data === 'object' && data.stars) return { stars: data.stars };
  } catch { /* ignore */ }
  return { stars: {} };
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

let state = read();

export const progress = {
  stars(id) { return state.stars[id] || 0; },
  record(id, stars) {
    if (stars > (state.stars[id] || 0)) {
      state.stars[id] = stars;
      write(state);
    }
  },
  completed(id) { return (state.stars[id] || 0) > 0; },
};

/** Stars for a catch: 3 within par, 2 within 1.5x par, else 1. */
export function starsFor(level, dvUsed) {
  if (!level.par) return 3;
  if (dvUsed <= level.par) return 3;
  if (dvUsed <= level.par * 1.5) return 2;
  return 1;
}
