// Planet artwork: top-down textured discs (each planet seen from above its
// north pole, as the game camera looks down on the ecliptic), spinning at real
// rotation rates and lit by the Sun: a soft day/night terminator, Earth's
// clouds and city lights, atmospheric rims, and Saturn's rings with the
// planet's shadow across them.
//
// Textures: Solar System Scope (solarsystemscope.com), CC BY 4.0, and public-domain
// spacecraft maps for the moons and small bodies, reprojected by tools/build_planets.py.

const BASE = new URL('../../assets/planets/', import.meta.url).href;
const TWO_PI = Math.PI * 2;
const DAY = 86400;

// rot: sidereal rotation period in seconds (negative = retrograde); phase: radians at t = 0
// atmo: [r, g, b, strength, thickness as a fraction of the radius]
const ART = {
  sun: { tex: 'sun.jpg', rot: 25.38 * DAY, emissive: true },
  mercury: { tex: 'mercury.jpg', rot: 58.646 * DAY },
  venus: { tex: 'venus.jpg', rot: -243.02 * DAY, atmo: [255, 226, 170, 0.55, 0.05] },
  earth: {
    tex: 'earth_day.jpg', night: 'earth_night.jpg', clouds: 'earth_clouds.jpg',
    rot: 86164.1, phase: Math.PI, cloudDrift: 11 * DAY, atmo: [110, 175, 255, 0.85, 0.03],
  },
  moon: { tex: 'moon.jpg', tidal: true },
  mars: { tex: 'mars.jpg', rot: 88642.7, atmo: [240, 165, 135, 0.35, 0.018] },
  jupiter: { tex: 'jupiter.jpg', rot: 35730, atmo: [245, 225, 195, 0.3, 0.02] },
  saturn: {
    tex: 'saturn.jpg', rot: 38018, atmo: [245, 230, 195, 0.3, 0.02],
    rings: { tex: 'saturn_rings.png', inner: 74658, outer: 136775 },
  },
  uranus: { tex: 'uranus.jpg', rot: -62064, atmo: [185, 238, 245, 0.45, 0.025] },
  neptune: { tex: 'neptune.jpg', rot: 57996, atmo: [120, 160, 255, 0.45, 0.025] },

  // moons: all tidally locked. shape: the width seen from above as a fraction of the
  // length, for bodies too small to pull themselves round (long axis toward the parent)
  phobos: { tex: 'phobos.jpg', tidal: true, shape: 0.84 },
  deimos: { tex: 'deimos.jpg', tidal: true, shape: 0.77 },
  io: { tex: 'io.jpg', tidal: true },
  europa: { tex: 'europa.jpg', tidal: true },
  ganymede: { tex: 'ganymede.jpg', tidal: true },
  callisto: { tex: 'callisto.jpg', tidal: true },
  mimas: { tex: 'mimas.jpg', tidal: true },
  enceladus: { tex: 'enceladus.jpg', tidal: true },
  tethys: { tex: 'tethys.jpg', tidal: true },
  dione: { tex: 'dione.jpg', tidal: true },
  rhea: { tex: 'rhea.jpg', tidal: true },
  titan: { tex: 'titan.jpg', tidal: true, atmo: [232, 184, 103, 0.7, 0.06] },
  iapetus: { tex: 'iapetus.jpg', tidal: true },
  miranda: { tex: 'miranda.jpg', tidal: true },
  ariel: { tex: 'ariel.jpg', tidal: true },
  umbriel: { tex: 'umbriel.jpg', tidal: true },
  titania: { tex: 'titania.jpg', tidal: true },
  oberon: { tex: 'oberon.jpg', tidal: true },
  triton: { tex: 'triton.jpg', tidal: true, atmo: [200, 215, 235, 0.15, 0.015] },
  charon: { tex: 'charon.jpg', tidal: true },

  // dwarf planets and asteroids
  ceres: { tex: 'ceres.jpg', rot: 9.074 * 3600 },
  vesta: { tex: 'vesta.jpg', rot: 5.342 * 3600 },
  pallas: { tex: 'pallas.jpg', rot: 7.813 * 3600, shape: 0.94 },
  hygiea: { tex: 'hygiea.jpg', rot: 13.83 * 3600 },
  pluto: { tex: 'pluto.jpg', rot: -6.387 * DAY, lockedTo: 'charon', atmo: [170, 200, 255, 0.2, 0.012] }, // Pluto and Charon face each other
  haumea: { tex: 'haumea.jpg', rot: 3.915 * 3600, shape: 0.73 },
  makemake: { tex: 'makemake.jpg', rot: 22.83 * 3600 },
  eris: { tex: 'eris.jpg', rot: 15.786 * DAY },
};

const NIGHT = [2, 5, 12];
const HUGE_PX = 20000; // beyond this, circles are traced only where they cross the screen

/**
 * Add a circle to the current path. Enormous circles (extreme zoom) are traced as
 * a polygon over the visible stretch of the rim plus the centre, which keeps
 * clipping precise where a plain arc() of that size would not be.
 */
function discPath(ctx, x, y, r, view) {
  if (r <= HUGE_PX) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TWO_PI);
    return;
  }
  const th = Math.atan2(view.cy - y, view.cx - x);
  const half = Math.min(Math.PI, (2 * Math.hypot(view.w, view.h)) / r);
  ctx.moveTo(x, y);
  for (let i = 0; i <= 64; i++) {
    const a = th - half + (2 * half * i) / 64;
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** (x, y) scaled by (a, b) along the axes turned by the spin in `st`, in canvas rotation terms. */
function stretch(st, x, y, a, b) {
  const { c, s } = st;
  const u = a * (c * x - s * y), w = b * (s * x + c * y);
  return [c * u + s * w, -s * u + c * w];
}

const TWILIGHT = 0.32; // how far past the terminator (in radii) light still reaches

/** Brightness 0..1 across the disc; u = -1 anti-sun limb, 0 terminator, +1 sub-solar limb. */
function daylight(u) {
  // twilight: a smooth ease from full night up to the terminator...
  const s = Math.min(1, Math.max(0, (u + TWILIGHT) / (2 * TWILIGHT)));
  const ease = s * s * (3 - 2 * s);
  // ...blended into a softened Lambert falloff on the day side
  const lambert = Math.pow(Math.max(0, (u + TWILIGHT) / (1 + TWILIGHT)), 0.75);
  return Math.min(1, ease * 0.35 + lambert * 0.75);
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** A texture with a mip chain so small discs don't shimmer. */
class Tex {
  constructor(file) {
    this.ready = false;
    this.failed = false;
    this.mips = [];
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        this.mips = [{ size: img.width, src: img }];
        let src = img, size = img.width;
        while (size > 96) {
          size = Math.round(size / 2);
          const c = makeCanvas(size, size);
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          g.drawImage(src, 0, 0, size, size);
          this.mips.push({ size, src: c });
          src = c;
        }
        this.ready = true;
      } catch {
        this.failed = true;
      }
    };
    img.onerror = () => { this.failed = true; };
    img.src = BASE + file;
  }

  /** Smallest mip at least `px` wide. */
  pick(px) {
    let best = this.mips[0];
    for (const m of this.mips) if (m.size >= px) best = m;
    return best.src;
  }
}

export class PlanetArt {
  constructor() {
    this.tex = new Map();
    // Earth and the Moon appear in almost every level: fetch them up front
    for (const id of ['earth', 'moon']) this.load(id);
  }

  load(id) {
    let t = this.tex.get(id);
    if (t) return t;
    const def = ART[id];
    if (!def) return null;
    t = {
      def,
      base: new Tex(def.tex),
      night: def.night ? new Tex(def.night) : null,
      clouds: def.clouds ? new Tex(def.clouds) : null,
      rings: def.rings ? new Tex(def.rings.tex) : null,
    };
    this.tex.set(id, t);
    return t;
  }

  /** Rotation of the body's surface (radians, counter-clockwise) at time t. */
  spin(body, def, t) {
    if (def.tidal) return body.angle(t) + Math.PI; // same face toward the parent
    if (def.lockedTo) {
      // same face toward its moon
      const m = body.children.find((c) => c.id === def.lockedTo);
      if (m) return m.angle(t);
    }
    return (def.phase || 0) + (TWO_PI * t) / def.rot;
  }

  /**
   * Draw `body` as a lit disc of radius r (CSS px) centred at (x, y).
   * Returns false when artwork isn't available yet, so the caller can fall back.
   */
  draw(ctx, body, x, y, r, t, dpr) {
    const a = this.load(body.id);
    if (!a || !a.base.ready) return false;
    const spin = this.spin(body, a.def, t);
    if (!a.def.shape) return this.paint(ctx, a, body, x, y, r, t, dpr, spin, null);
    // an elongated body: stretch the whole drawing along its long axis (the texture's
    // x axis, which turns with it), keeping its area
    const k = a.def.shape;
    const st = { c: Math.cos(spin), s: Math.sin(spin), a: 1 / Math.sqrt(k), b: Math.sqrt(k) };
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-spin);
    ctx.scale(st.a, st.b);
    ctx.rotate(spin);
    ctx.translate(-x, -y);
    this.paint(ctx, a, body, x, y, r * st.a, t, dpr, spin, st, r);
    ctx.restore();
    return true;
  }

  /**
   * The lit disc. With `st` it is drawn in draw()'s stretched frame, so screen-space
   * directions are mapped into that frame first; r is then the long radius (for picking
   * texture detail) and r0 the radius drawn.
   */
  paint(ctx, a, body, x, y, r, t, dpr, spin, st, r0 = r) {
    const def = a.def;
    const px = 2 * r * dpr;
    r = r0;
    // direction to the Sun in screen space (the Sun sits at the origin)
    const p = body.absPos(t);
    const L = Math.hypot(p.x, p.y);
    let sx = L ? -p.x / L : 1, sy = L ? p.y / L : 0;
    const view = { w: ctx.canvas.width / dpr, h: ctx.canvas.height / dpr };
    view.cx = view.w / 2;
    view.cy = view.h / 2;
    if (st) {
      // a gradient along d in the stretched frame runs along M·d on screen (M is symmetric),
      // so pointing it along M·d keeps the terminator square to the Sun
      [sx, sy] = stretch(st, sx, sy, st.a, st.b);
      const n = Math.hypot(sx, sy);
      sx /= n; sy /= n;
      const [cx, cy] = stretch(st, view.cx - x, view.cy - y, 1 / st.a, 1 / st.b);
      view.cx = x + cx;
      view.cy = y + cy;
    }

    if (a.rings && a.rings.ready) this.rings(ctx, a, x, y, r, body, sx, sy, dpr);

    ctx.save();
    ctx.beginPath();
    discPath(ctx, x, y, r, view);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';

    // surface (screen y is flipped, so a counter-clockwise spin is a negative rotation)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-spin);
    ctx.drawImage(a.base.pick(px), -r, -r, 2 * r, 2 * r);
    if (a.clouds && a.clouds.ready && r > 6) {
      ctx.rotate(-(TWO_PI * t) / def.cloudDrift);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.92;
      ctx.drawImage(a.clouds.pick(px), -r, -r, 2 * r, 2 * r);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (def.emissive) {
      // limb darkening
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,240,200,0.12)');
      g.addColorStop(0.7, 'rgba(160,50,0,0)');
      g.addColorStop(1, 'rgba(120,30,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
      return true;
    }

    // atmosphere seen through the limb (darkened on the night side by the shading below)
    if (def.atmo && r > 4) {
      const [cr, cg, cb, strength, thick] = def.atmo;
      const col = [cr, cg, cb];
      const d = Math.max(1.2, r * thick);
      const g = ctx.createRadialGradient(x, y, r - 2 * d, x, y, r);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.6, rgba(col, strength * 0.22));
      g.addColorStop(1, rgba(col, strength * 0.65));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }

    this.terminator(ctx, def, x, y, r, sx, sy);

    // Earth's city lights: they fade in through twilight and are brightest in full night
    if (a.night && a.night.ready && r > 8) {
      const nx = -sy, ny = sx; // along the terminator
      const R = r * 1.5;
      const lights = a.night.pick(px);
      const bands = 8;
      for (let k = 0; k < bands; k++) {
        // band from u0 (closer to the terminator) down to u1
        const u0 = 0.02 - (k / bands) * (TWILIGHT + 0.08);
        const u1 = k === bands - 1 ? -1.5 : 0.02 - ((k + 1) / bands) * (TWILIGHT + 0.08);
        const alpha = 0.95 * (1 - daylight((u0 + u1) / 2) / daylight(0.02));
        if (alpha <= 0.02) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + sx * u0 * r + nx * R, y + sy * u0 * r + ny * R);
        ctx.lineTo(x + sx * u0 * r - nx * R, y + sy * u0 * r - ny * R);
        ctx.lineTo(x + sx * u1 * r - nx * R, y + sy * u1 * r - ny * R);
        ctx.lineTo(x + sx * u1 * r + nx * R, y + sy * u1 * r + ny * R);
        ctx.closePath();
        ctx.clip();
        ctx.translate(x, y);
        ctx.rotate(-spin);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.95, alpha);
        ctx.drawImage(lights, -r, -r, 2 * r, 2 * r);
        ctx.restore();
      }
    }

    ctx.restore();

    // glow outside the limb: a crescent that thins out toward the night side
    if (def.atmo && r > 4) {
      const [cr, cg, cb, strength, thick] = def.atmo;
      const col = [cr, cg, cb];
      const d = Math.max(1.5, r * thick * 0.9);
      ctx.save();
      ctx.beginPath();
      discPath(ctx, x + sx * d, y + sy * d, r + d, view);
      discPath(ctx, x, y, r, view);
      ctx.clip('evenodd');
      const e = d * 0.5;
      const g = ctx.createRadialGradient(x + sx * e, y + sy * e, r, x + sx * d, y + sy * d, r + d);
      g.addColorStop(0, rgba(col, strength * 0.7));
      g.addColorStop(0.35, rgba(col, strength * 0.25));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r - 2 * d, y - r - 2 * d, 2 * (r + 2 * d), 2 * (r + 2 * d));
      ctx.restore();
    }
    return true;
  }

  /** Night-side darkening with a soft terminator (Lambert falloff toward the day limb). */
  terminator(ctx, def, x, y, r, sx, sy) {
    // u runs from -1 (anti-sun limb) to +1 (sub-solar limb). Light fades in over a
    // wide twilight band around the terminator, then follows a softened Lambert curve.
    const g = ctx.createLinearGradient(x - sx * r, y - sy * r, x + sx * r, y + sy * r);
    const night = 0.965;
    for (let i = 0; i <= 40; i++) {
      const u = -1 + (2 * i) / 40;
      g.addColorStop((u + 1) / 2, rgba(NIGHT, night * (1 - daylight(u))));
    }
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  /** Saturn's rings seen from above, with the planet's shadow falling across them. */
  rings(ctx, a, x, y, r, body, sx, sy, dpr) {
    const def = a.def.rings;
    const R = (def.outer / body.radius) * r;
    if (R < 3) return;
    const img = a.rings.pick(2 * R * dpr);
    // shadow: a strip as wide as the planet, pointing away from the Sun
    const nx = -sy, ny = sx;
    const far = R * 1.2;
    const strip = () => {
      ctx.moveTo(x + nx * r, y + ny * r);
      ctx.lineTo(x + nx * r - sx * far, y + ny * r - sy * far);
      ctx.lineTo(x - nx * r - sx * far, y - ny * r - sy * far);
      ctx.lineTo(x - nx * r, y - ny * r);
      ctx.closePath();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - R - 2, y - R - 2, 2 * R + 4, 2 * R + 4);
    strip();
    ctx.clip('evenodd');
    ctx.drawImage(img, x - R, y - R, 2 * R, 2 * R);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    strip();
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(img, x - R, y - R, 2 * R, 2 * R);
    ctx.restore();
  }
}

export { ART };
