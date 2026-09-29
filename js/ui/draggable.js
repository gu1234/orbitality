// Floating windows (the burn planner, the hint strip) that can be dragged
// around by a handle. The offset from the window's CSS spot is kept on screen
// and remembered; double-tap the handle to put the window back.

function loadPos(key) {
  try {
    const o = JSON.parse(localStorage.getItem(key));
    if (Number.isFinite(o?.x) && Number.isFinite(o?.y)) return { x: o.x, y: o.y };
  } catch { /* ignore */ }
  return { x: 0, y: 0 };
}

function savePos(key, off) {
  try { localStorage.setItem(key, JSON.stringify(off)); } catch { /* ignore */ }
}

// presses on these start their own action instead of a drag
const NO_DRAG = 'button, a, input, select, textarea, .term';

export class Draggable {
  /** el: the window; handle: where to grab it; key: localStorage key for its offset. */
  constructor(el, handle, key) {
    this.el = el;
    this.key = key;
    this.off = loadPos(key);
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX - this.off.x, y: e.clientY - this.off.y };
      el.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.off = { x: e.clientX - drag.x, y: e.clientY - drag.y };
      this.place();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      el.classList.remove('dragging');
      savePos(key, this.off);
      this.onMove?.();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest(NO_DRAG)) return;
      this.off = { x: 0, y: 0 };
      this.place();
      savePos(key, this.off);
      this.onMove?.();
    });
    addEventListener('resize', () => this.place());
  }

  /** True while the window sits in its CSS spot (never dragged, or reset). */
  get home() { return !this.off.x && !this.off.y; }

  /** Apply the drag offset, clamped so the whole window stays on screen. */
  place() {
    const el = this.el;
    if (el.classList.contains('hidden') || !el.offsetParent) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    const x = Math.min(Math.max(this.off.x, -r.left), W - r.right);
    const y = Math.min(Math.max(this.off.y, -r.top), H - r.bottom);
    this.off = { x, y };
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
  }
}
