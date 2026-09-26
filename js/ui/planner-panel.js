// Burn planner panel: where the burn happens (and how long to wait after it),
// its prograde and radial parts, what orbit it gives, and Approve. Once approved
// it shrinks to a one-line countdown with Cancel while the ship warps to the
// burn. The panel can be dragged around by its header; double-tap the header to
// put it back.

import { fmtDist, fmtDv, fmtDur } from './format.js';

const AT_NAMES = { now: 'Now', ap: 'At Ap', pe: 'At Pe' };
const POS_KEY = 'orbitality.plannerPos';

const HTML = `
  <div class="planner-head" title="Drag to move · double-tap to reset">
    <span class="planner-grip" aria-hidden="true"></span>
    <h3 id="planner-title">Plan a burn</h3>
    <span class="planner-paused">Time paused</span>
    <button class="planner-close" id="plan-close" aria-label="Close planner">×</button>
  </div>
  <div class="planner-at" role="radiogroup" aria-label="When to burn">
    <button role="radio" data-at="now">Now</button>
    <button role="radio" data-at="ap">At Ap<small></small></button>
    <button role="radio" data-at="pe">At Pe<small></small></button>
  </div>
  <div class="planner-wait">
    <span class="k">Wait</span>
    <button class="planner-wait-btn" id="plan-wait-less" aria-label="Burn sooner" data-tip="Burn sooner. Hold to go faster" data-key="[">−</button>
    <span class="planner-wait-v"><span class="v" id="plan-wait"></span><small id="plan-when"></small></span>
    <button class="planner-wait-btn" id="plan-wait-more" aria-label="Burn later" data-tip="Burn later. Hold to go faster" data-key="]">+</button>
  </div>
  <div class="planner-dv">
    <div><span class="k">Prograde</span><span class="v" id="plan-pro"></span></div>
    <div><span class="k">Radial</span><span class="v" id="plan-rad"></span></div>
    <div><span class="k">Total</span><span class="v" id="plan-dv"></span></div>
  </div>
  <p class="planner-result" id="plan-result" aria-live="polite"></p>
  <div class="planner-actions">
    <button class="btn ghost" id="plan-clear">Clear</button>
    <button class="btn primary" id="plan-approve">Approve burn</button>
  </div>`;

/** Wait in units of an orbit (or hours on a path with no period): "0", "0.35 orbit", "12.4 orbits". */
function fmtWait(s, unit) {
  const n = s / unit.s;
  if (n < 0.0005) return '0';
  const txt = n < 10 ? n.toFixed(n < 1 ? 3 : 2) : n < 1000 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US');
  if (!unit.orbits) return `${txt} h`;
  return `${txt} ${n > 1.0005 ? 'orbits' : 'orbit'}`;
}

function loadPos() {
  try {
    const o = JSON.parse(localStorage.getItem(POS_KEY));
    if (Number.isFinite(o?.x) && Number.isFinite(o?.y)) return { x: o.x, y: o.y };
  } catch { /* ignore */ }
  return { x: 0, y: 0 };
}

function savePos(off) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(off)); } catch { /* ignore */ }
}

function signed(v) {
  if (Math.abs(v) < 0.05) return '0 m/s';
  return `${v > 0 ? '+' : '−'}${fmtDv(Math.abs(v))}`;
}

export class PlannerPanel {
  /** handlers: { approve(), cancel(), close() } */
  constructor(planner, parent, handlers) {
    this.p = planner;
    this.h = handlers;
    this.el = document.createElement('section');
    this.el.className = 'planner hidden';
    this.el.id = 'planner';
    this.el.setAttribute('aria-labelledby', 'planner-title');
    this.el.innerHTML = HTML;
    this.armedEl = document.createElement('div');
    this.armedEl.className = 'planner-armed hidden';
    this.armedEl.innerHTML = '<span class="planner-armed-text" id="plan-armed-text"></span><button class="btn" id="plan-cancel">Cancel</button>';
    parent.append(this.el, this.armedEl);
    const q = (s) => this.el.querySelector(s);
    this.atBtns = [...this.el.querySelectorAll('[data-at]')];
    for (const b of this.atBtns) b.addEventListener('click', () => { planner.setAt(b.dataset.at); this.render(true); });
    q('#plan-close').addEventListener('click', () => handlers.close());
    q('#plan-clear').addEventListener('click', () => { planner.clear(); planner.tick(0); this.render(true); });
    q('#plan-approve').addEventListener('click', () => handlers.approve());
    // the wait buttons ramp up while held, like the burn buttons
    for (const [id, sign] of [['#plan-wait-less', -1], ['#plan-wait-more', 1]]) {
      const b = q(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        planner.pressWait(sign, e.shiftKey || !!handlers.fine?.());
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => planner.releaseWait());
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // keyboard activation (Enter / Space) arrives as a click with no pointer
      b.addEventListener('click', (e) => { if (e.detail === 0) { planner.nudgeWait(sign * 0.01); planner.tick(0); } });
    }
    this.armedEl.querySelector('#plan-cancel').addEventListener('click', () => handlers.cancel());
    this.last = '';
    this.off = loadPos();
    this.initDrag(q('.planner-head'));
    addEventListener('resize', () => this.place());
  }

  /** Drag the panel by its header; the offset is kept within the screen and remembered. */
  initDrag(head) {
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      head.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX - this.off.x, y: e.clientY - this.off.y };
      this.el.classList.add('dragging');
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.off = { x: e.clientX - drag.x, y: e.clientY - drag.y };
      this.place();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      this.el.classList.remove('dragging');
      savePos(this.off);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      this.off = { x: 0, y: 0 };
      this.place();
      savePos(this.off);
    });
  }

  /** Apply the drag offset, clamped so the whole panel stays on screen. */
  place() {
    const el = this.el;
    if (el.classList.contains('hidden')) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    const x = Math.min(Math.max(this.off.x, -r.left), W - r.right);
    const y = Math.min(Math.max(this.off.y, -r.top), H - r.bottom);
    this.off = { x, y };
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
  }

  /** Refresh from the planner; cheap when nothing changed. */
  render(force = false) {
    const p = this.p;
    const w = p.world;
    const open = p.open && !!w;
    const armed = !p.open && !!p.armed && !!w;
    const wasHidden = this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !open);
    if (open && wasHidden) this.place();
    this.armedEl.classList.toggle('hidden', !armed);
    if (armed) {
      const a = p.armed;
      const when = a.startT - w.t > 1 ? `in ${fmtDur(a.nodeT - w.t)}` : 'now';
      const txt = `<b>${fmtDv(a.dv)}</b> burn ${a.at === 'now' ? '' : `${AT_NAMES[a.at].replace('At', 'at')} `}${when}`;
      const el = this.armedEl.firstElementChild;
      if (el.innerHTML !== txt) el.innerHTML = txt;
      return;
    }
    if (!open) return;
    const r = p.result;
    const key = [p.pro, p.rad, p.at, p.wait, r?.nodeT, p.capped].join();
    if (!force && key === this.last) return;
    this.last = key;

    for (const b of this.atBtns) {
      const n = p.nodes().find((o) => o.id === b.dataset.at);
      b.disabled = !n.ok;
      b.setAttribute('aria-checked', String(p.at === b.dataset.at));
      const small = b.querySelector('small');
      if (small) small.textContent = n.ok ? fmtDur(n.t - w.t) : '';
    }
    const unit = p.waitUnit();
    this.el.querySelector('#plan-wait').textContent = fmtWait(Math.min(p.wait, p.maxWait()), unit);
    this.el.querySelector('#plan-when').innerHTML = this.when(r);
    this.el.querySelector('#plan-wait-less').disabled = p.wait <= 0;
    this.el.querySelector('#plan-wait-more').disabled = p.wait >= p.maxWait();
    this.el.querySelector('#plan-pro').textContent = signed(p.pro);
    this.el.querySelector('#plan-rad').textContent = signed(p.rad);
    this.el.querySelector('#plan-dv').textContent = fmtDv(p.dv);
    this.el.querySelector('#plan-approve').disabled = !r || r.empty;
    this.el.querySelector('#plan-result').innerHTML = this.describe(r);
  }

  /** When the burn happens and where the target is then: "burn in 2 h 5 min · target 25° ahead". */
  when(r) {
    const w = this.p.world;
    if (!r) return '';
    const dt = r.nodeT - w.t;
    const parts = [dt > 1 ? `burn in ${fmtDur(dt)}` : 'burn now'];
    const ph = r.phase;
    if (ph) {
      const who = ph.ownBody && w.target.body === w.ship.body ? 'target' : w.target.body.name;
      const d = Math.round(ph.deg);
      parts.push(d === 0 ? `${who} lined up` : `${who} <b>${Math.abs(d)}°</b> ${d > 0 ? 'ahead' : 'behind'}`);
    }
    return parts.join(' · ');
  }

  describe(r) {
    const w = this.p.world;
    if (!r || r.empty) {
      return 'Hold the burn buttons to shape the burn. The <b class="plan">green line</b> shows where it takes you.';
    }
    const parts = [];
    const B = w.ship.body;
    if (r.crash || !r.pred) {
      parts.push('<span class="bad">Hits the surface during the burn</span>');
    } else {
      const p0 = r.pred[0];
      const el = p0.el;
      const R = p0.body.radius;
      if (p0.end === 'impact') parts.push(`<span class="bad">Impact on ${p0.body.name} in ${fmtDur(p0.t1 - w.t)}</span>`);
      else if (el.e < 1 && el.ra < p0.body.soi) parts.push(`Ap ${fmtDist(el.ra - R)} · Pe ${fmtDist(el.rp - R)}`);
      else if (p0.end === 'exit') parts.push(`Escapes ${p0.body.name}`);
      else parts.push(`Pe ${fmtDist(el.rp - R)}`);
      const enc = r.pred.find((q) => q.body !== B && q.body.parent === B);
      if (enc && enc.body !== w.target?.body) {
        parts.push(enc.el.rp < enc.body.radius ? `<span class="bad">${enc.body.name} impact</span>` : `${enc.body.name} Pe ${fmtDist(enc.el.rp - enc.body.radius)}`);
      }
      const ca = r.approach;
      if (ca && ca.kind === 'target') parts.push(`<span class="plan">closest ${fmtDist(ca.dist)}</span> in ${fmtDur(ca.t - w.t)}`);
      else if (ca && ca.kind === 'body') parts.push(`${fmtDist(ca.dist)} from ${ca.bodyRef.name}`);
    }
    let fuel = `${fmtDur(r.dur)} burn`;
    if (!w.ship.unlimited) fuel += ` · <span class="${r.dvLeft < 1 ? 'bad' : ''}">${fmtDv(Math.max(0, r.dvLeft))} left after</span>`;
    if (this.p.capped) fuel += ' · <span class="bad">that is all your fuel</span>';
    return `${parts.join(' · ')}<br><small>${fuel}</small>`;
  }
}
