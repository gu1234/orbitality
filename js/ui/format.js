// Human-friendly number formatting for the HUD and canvas labels.

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Distance in km -> "850 m", "12.3 km", "1,234 km", "12.3 M km". */
export function fmtDist(km) {
  if (!Number.isFinite(km)) return '∞';
  const a = Math.abs(km);
  if (a < 1) return `${nf0.format(km * 1000)} m`;
  if (a < 100) return `${nf1.format(km)} km`;
  if (a < 1e7) return `${nf0.format(km)} km`;
  if (a < 1e9) return `${nf1.format(km / 1e6)} M km`;
  return `${nf2.format(km / 1.495978707e8)} AU`;
}

/** Speed in km/s -> "8.4 m/s", "850 m/s", "7.67 km/s". */
export function fmtSpeed(kms) {
  const ms = kms * 1000;
  const a = Math.abs(ms);
  if (a < 10) return `${nf1.format(ms)} m/s`;
  if (a < 1000) return `${nf0.format(ms)} m/s`;
  return `${nf2.format(kms)} km/s`;
}

/** Δv in m/s -> "1,234 m/s". */
export function fmtDv(ms) {
  if (!Number.isFinite(ms)) return '∞';
  if (Math.abs(ms) < 10) return `${nf1.format(ms)} m/s`;
  return `${nf0.format(ms)} m/s`;
}

/** Duration in seconds -> "43 s", "12 min", "1 h 32 min", "4 d 23 h", "1.4 yr". */
export function fmtDur(s) {
  if (!Number.isFinite(s)) return '∞';
  s = Math.max(0, s);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return m < 10 && r ? `${m} min ${r} s` : `${Math.round(s / 60)} min`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s - h * 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (s < 365.25 * 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.round((s - d * 86400) / 3600);
    return h ? `${d} d ${h} h` : `${d} d`;
  }
  return `${nf1.format(s / (365.25 * 86400))} yr`;
}

/** Mission clock: "T+ 01:32:10" or "T+ 4 d 03:12". */
export function fmtClock(s) {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (d > 0) return `T+ ${nf0.format(d)} d ${p(h)}:${p(m)}`;
  return `T+ ${p(h)}:${p(m)}:${p(sec)}`;
}

export function fmtWarp(w) {
  if (w >= 1e6) return `${nf0.format(w / 1e6)}M×`;
  if (w >= 1e4) return `${nf0.format(w / 1e3)}k×`;
  if (w >= 10) return `${nf0.format(w)}×`;
  return `${nf1.format(w).replace(/\.0$/, '')}×`;
}
