// Burn planner panel: where the burn happens, its prograde and radial parts,
// what orbit it gives, and Approve. Once approved it shrinks to a one-line
// countdown with Cancel while the ship warps to the burn.

import { fmtDist, fmtDv, fmtDur } from './format.js';

const AT_NAMES = { now: 'Now', ap: 'At Ap', pe: 'At Pe' };

const HTML = `
  <div class="planner-head">
    <h3 id="planner-title">Plan a burn</h3>
    <span class="planner-paused">Time paused</span>
    <button class="planner-close" id="plan-close" aria-label="Close planner">×</button>
  </div>
  <div class="planner-at" role="radiogroup" aria-label="When to burn">
    <button role="radio" data-at="now">Now</button>
    <button role="radio" data-at="ap">At Ap<small></small></button>
    <button role="radio" data-at="pe">At Pe<small></small></button>
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
    this.armedEl.querySelector('#plan-cancel').addEventListener('click', () => handlers.cancel());
    this.last = '';
  }

  /** Refresh from the planner; cheap when nothing changed. */
  render(force = false) {
    const p = this.p;
    const w = p.world;
    const open = p.open && !!w;
    const armed = !p.open && !!p.armed && !!w;
    this.el.classList.toggle('hidden', !open);
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
    const key = [p.pro, p.rad, p.at, r?.nodeT, p.capped].join();
    if (!force && key === this.last) return;
    this.last = key;

    for (const b of this.atBtns) {
      const n = p.nodes().find((o) => o.id === b.dataset.at);
      b.disabled = !n.ok;
      b.setAttribute('aria-checked', String(p.at === b.dataset.at));
      const small = b.querySelector('small');
      if (small) small.textContent = n.ok ? fmtDur(n.t - w.t) : '';
    }
    this.el.querySelector('#plan-pro').textContent = signed(p.pro);
    this.el.querySelector('#plan-rad').textContent = signed(p.rad);
    this.el.querySelector('#plan-dv').textContent = fmtDv(p.dv);
    this.el.querySelector('#plan-approve').disabled = !r || r.empty;
    this.el.querySelector('#plan-result').innerHTML = this.describe(r);
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
