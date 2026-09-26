// Pointer, touch and keyboard input: canvas pan/pinch/zoom/tap, hold-to-burn
// buttons and keyboard shortcuts. Burns are released on every way a touch can end
// (pointerup, pointercancel, lost capture, blur, tab hidden) so they never stick.

const BURN_KEYS = {
  KeyW: 'prograde', ArrowUp: 'prograde',
  KeyS: 'retrograde', ArrowDown: 'retrograde',
  KeyA: 'radialIn', ArrowLeft: 'radialIn',
  KeyD: 'radialOut', ArrowRight: 'radialOut',
  KeyT: 'toward',
  KeyM: 'match',
};

export class Input {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.pointers = new Map(); // canvas pointers only
    this.burnPointers = new Map(); // pointerId -> burn dir
    this.keyBurn = null;
    this.shift = false;
    this.fineLatch = false; // on-screen Fine toggle, for players without a Shift key
    this.lastTap = 0;
    this.bindCanvas();
    this.bindKeys();
    const releaseAll = () => this.releaseAllBurns();
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- canvas

  bindCanvas() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
      if (this.pointers.size === 2) this.pinch = this.pinchState();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
        if (p.moved) this.h.pan(dx, dy);
      } else if (this.pointers.size === 2) {
        const now = this.pinchState();
        if (this.pinch && this.pinch.d > 0) {
          this.h.zoomAt(now.d / this.pinch.d, now.x, now.y);
          this.h.pan(now.x - this.pinch.x, now.y - this.pinch.y);
        }
        this.pinch = now;
        for (const q of this.pointers.values()) q.moved = true;
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 < 350) {
        const now = performance.now();
        if (now - this.lastTap < 320) {
          this.lastTap = 0;
          this.h.doubleTap(e.clientX, e.clientY);
        } else {
          this.lastTap = now;
          this.h.tap(e.clientX, e.clientY);
        }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0018;
      const f = Math.exp(-e.deltaY * k);
      this.h.zoomAt(f, e.clientX, e.clientY);
    }, { passive: false });
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  // ---------------------------------------------------------------- burn buttons

  bindBurnButton(el) {
    const dir = el.dataset.burn;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.burnPointers.set(e.pointerId, dir);
      this.h.burnStart(dir, e.shiftKey || this.fineOn());
    });
    const release = (e) => {
      if (!this.burnPointers.has(e.pointerId)) return;
      this.burnPointers.delete(e.pointerId);
      this.syncBurn();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.h.hover(dir); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.h.hover(null); });
    // keyboard activation of the on-screen buttons
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); this.h.burnStart(dir, this.fineOn()); }
    });
    el.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.h.burnStop();
    });
  }

  /** The on-screen Fine toggle latches fine control, like holding Shift. */
  bindFineToggle(el) {
    el.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus off it
    el.addEventListener('click', () => {
      this.fineLatch = !this.fineLatch;
      el.setAttribute('aria-pressed', String(this.fineLatch));
      this.h.fine(this.fineOn());
    });
  }

  fineOn() { return this.shift || this.fineLatch; }

  /** After a release, continue with any other held burn, else stop. */
  syncBurn() {
    const held = [...this.burnPointers.values()];
    if (held.length) this.h.burnStart(held[held.length - 1], this.fineOn());
    else if (this.keyBurn) this.h.burnStart(this.keyBurn, this.fineOn());
    else this.h.burnStop();
  }

  releaseAllBurns() {
    this.burnPointers.clear();
    this.keyBurn = null;
    this.h.burnStop();
  }

  // ---------------------------------------------------------------- keyboard

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') { this.shift = true; if (!e.repeat) this.h.fine(true); }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // typing in a text box (the glossary search) is not a shortcut, except Escape
      if (e.target.closest?.('input, textarea') && e.key !== 'Escape') return;
      if (!this.h.keysActive()) {
        if (e.key === 'Escape') this.h.escape();
        else if ((e.key === 'n' || e.key === 'N') && !e.repeat) this.h.toggleMusic();
        return;
      }
      const dir = BURN_KEYS[e.code];
      if (dir) {
        e.preventDefault();
        if (!e.repeat) {
          this.keyBurn = dir;
          this.h.burnStart(dir, e.shiftKey || this.fineLatch);
        }
        return;
      }
      if (e.repeat) return;
      switch (e.key) {
        case ',': case '<': case '-': case '_': this.h.warpStep(-1); break;
        case '.': case '>': case '=': case '+': this.h.warpStep(1); break;
        case 'f': case 'F': this.h.cycleFocus(); break;
        case 'z': case 'Z': this.h.frame(); break;
        case 'l': case 'L': this.h.toggleLock(); break;
        case 'h': case 'H': case '?': this.h.toggleTip(); break;
        case 'n': case 'N': this.h.toggleMusic(); break;
        case 'Escape': case 'p': case 'P': this.h.escape(); break;
        case 'Backspace': this.h.warpStop(); break;
        default: return;
      }
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') { this.shift = false; this.h.fine(this.fineLatch); }
      const dir = BURN_KEYS[e.code];
      if (dir && this.keyBurn === dir) {
        this.keyBurn = null;
        this.syncBurn();
      }
    });
  }
}
