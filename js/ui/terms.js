// Glossary links and cards. linkTerms() turns every term in a piece of game text
// (js/game/terms.js) into a dotted-underlined button; clicking one opens a card with
// the definition and an animation (js/render/term-anims.js). Links inside a card open
// the next card, with Back to return. The card also lists every term.

import { TERMS, termById, findTerms } from '../game/terms.js';
import { termAnim, setWallClock, W, H } from '../render/term-anims.js';

// text inside these is never linked
const SKIP = 'button, a, kbd, summary, .term, [data-term], script, style';

/**
 * Link the first mention of each term inside `root`. Terms whose ids are in `seen`
 * are left alone, and the ids linked are added to it, so several blocks can share one set.
 */
export function linkTerms(root, seen = new Set()) {
  if (!root) return seen;
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data.trim() && !n.parentElement.closest(SKIP)) nodes.push(n);
  }
  for (const node of nodes) {
    const text = node.data;
    const hits = findTerms(text, seen);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const h of hits) {
      if (h.start > at) frag.append(text.slice(at, h.start));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'term';
      b.dataset.term = h.id;
      b.textContent = text.slice(h.start, h.end);
      frag.append(b);
      at = h.end;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
  return seen;
}

/** Set an element's HTML and link the terms in it. */
export function setLinkedHtml(el, html, seen) {
  el.innerHTML = html;
  return linkTerms(el, seen);
}

/** Point a label (a HUD row name) at a term, or make it plain text again. */
export function setLabelTerm(el, id) {
  if ((el.dataset.term || null) === (id || null)) return;
  if (id) {
    el.dataset.term = id;
    el.classList.add('term');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
  } else {
    delete el.dataset.term;
    el.classList.remove('term');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const HTML = `
  <div class="card term-card" role="document">
    <div class="term-top">
      <button class="term-back hidden" id="term-back" aria-label="Back to the previous term">‹ Back</button>
      <span class="card-kicker" id="term-kicker">Glossary</span>
      <button class="term-close" id="term-close" aria-label="Close">×</button>
    </div>
    <div id="term-one">
      <h2 id="term-title"></h2>
      <p class="term-short" id="term-short"></p>
      <figure class="term-anim">
        <canvas id="term-canvas" width="${W}" height="${H}" role="img"></canvas>
        <figcaption>
          <span class="term-cap" id="term-cap"></span>
          <span class="term-anim-btns">
            <button class="term-play" id="term-replay" aria-label="Play from the start">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>
            </button>
            <button class="term-play" id="term-play" aria-label="Pause">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M8 5v14M16 5v14"/><path class="i-play" d="M7 5l12 7-12 7z"/></svg>
            </button>
          </span>
        </figcaption>
      </figure>
      <div class="term-body" id="term-body"></div>
      <div class="term-related" id="term-related"></div>
    </div>
    <div id="term-index" class="hidden">
      <h2 id="term-index-title">Glossary</h2>
      <p class="term-short">Every word of orbital flight the game uses. Watch any of them in motion.</p>
      <input class="term-search" id="term-search" type="search" placeholder="Search terms" aria-label="Search terms" autocomplete="off">
      <ul class="term-list" id="term-list"></ul>
      <p class="term-none hidden" id="term-none">No term matches that.</p>
    </div>
    <div class="actions">
      <button class="btn ghost" id="term-all">All terms</button>
      <button class="btn primary" id="term-ok">Got it</button>
    </div>
  </div>`;

export class TermCard {
  /** handlers: { open(), close() } so the game can pause while a card is up. */
  constructor(handlers = {}) {
    this.h = handlers;
    this.el = document.createElement('div');
    this.el.id = 'term';
    this.el.className = 'screen modal term-modal hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'term-title');
    this.el.innerHTML = HTML;
    document.body.append(this.el);
    const q = (id) => this.el.querySelector(`#${id}`);
    this.canvas = q('term-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.cap = q('term-cap');
    this.playBtn = q('term-play');
    this.history = [];
    this.current = null; // term id, or 'index'
    this.anim = null;
    this.t = 0;
    this.playing = false;
    this.raf = 0;
    this.returnFocus = null;
    setWallClock(() => performance.now());

    q('term-close').addEventListener('click', () => this.close());
    q('term-ok').addEventListener('click', () => this.close());
    q('term-back').addEventListener('click', () => this.back());
    q('term-all').addEventListener('click', () => this.show('index', true));
    this.playBtn.addEventListener('click', () => this.setPlaying(!this.playing));
    q('term-replay').addEventListener('click', () => { this.t = 0; this.setPlaying(true); });
    // a press on the dimmed backdrop closes the card
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('keydown', (e) => this.trapFocus(e));

    // every term link on the page, including the ones inside this card
    document.addEventListener('click', (e) => {
      const t = e.target.closest?.('[data-term]');
      if (!t) return;
      e.preventDefault();
      this.open(t.dataset.term);
    });
    document.addEventListener('keydown', (e) => {
      const t = e.target.closest?.('[data-term]');
      if (!t || t.tagName === 'BUTTON' || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      this.open(t.dataset.term);
    }, true);
    addEventListener('resize', () => { if (this.isOpen) this.fit(); });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  /** Open a term's card (or the list of terms, with id 'index'). */
  open(id) {
    if (id !== 'index' && !termById(id)) return;
    if (!this.isOpen) {
      this.history = [];
      this.current = null;
      this.returnFocus = document.activeElement;
      this.el.classList.remove('hidden');
      this.h.open?.();
    }
    this.show(id, true);
  }

  openIndex() { this.open('index'); }

  show(id, push) {
    if (id === this.current) return;
    if (this.current === 'index') this.indexScroll = this.el.scrollTop;
    if (push && this.current) this.history.push(this.current);
    this.current = id;
    const q = (s) => this.el.querySelector(`#${s}`);
    const index = id === 'index';
    q('term-one').classList.toggle('hidden', index);
    q('term-index').classList.toggle('hidden', !index);
    q('term-all').classList.toggle('hidden', index);
    q('term-back').classList.toggle('hidden', !this.history.length);
    q('term-kicker').classList.toggle('hidden', index || this.history.length > 0);
    this.el.setAttribute('aria-labelledby', index ? 'term-index-title' : 'term-title');
    if (index) {
      this.stop();
      this.renderIndex();
    } else this.renderTerm(termById(id));
    this.el.scrollTop = index && !push ? this.indexScroll || 0 : 0;
    q('term-close').focus({ preventScroll: true });
  }

  back() {
    const id = this.history.pop();
    if (id) this.show(id, false);
  }

  close() {
    if (!this.isOpen) return;
    this.stop();
    this.el.classList.add('hidden');
    this.current = null;
    this.history = [];
    this.h.close?.();
    const f = this.returnFocus;
    this.returnFocus = null;
    if (f?.isConnected && f !== document.body) f.focus({ preventScroll: true });
  }

  renderTerm(term) {
    const q = (s) => this.el.querySelector(`#${s}`);
    q('term-title').textContent = term.name;
    q('term-short').textContent = term.short;
    const seen = new Set([term.id]);
    const body = q('term-body');
    body.innerHTML = term.body.map((p) => `<p>${p}</p>`).join('');
    linkTerms(body, seen);
    const rel = q('term-related');
    rel.innerHTML = '';
    if (term.related?.length) {
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = 'See also';
      rel.append(k);
      for (const id of term.related) {
        const r = termById(id);
        if (!r) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'term-chip';
        b.dataset.term = id;
        b.textContent = r.name;
        rel.append(b);
      }
    }
    this.canvas.setAttribute('aria-label', `Animation: ${term.name}`);
    this.anim = termAnim(term.anim);
    this.t = 0;
    this.fit();
    if (reducedMotion()) {
      // hold a telling frame; the play button still runs it
      this.t = this.anim.still;
      this.setPlaying(false);
    } else this.setPlaying(true);
  }

  /** The glossary page: every term with its full explanation, and a search box. */
  renderIndex() {
    const list = this.el.querySelector('#term-list');
    if (list.childElementCount) return;
    for (const t of TERMS) {
      const li = document.createElement('li');
      li.id = `gl-${t.id}`;
      li.innerHTML = `
        <div class="term-entry-head">
          <h3></h3>
          <button type="button" class="term-watch" data-term="${t.id}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>Watch
          </button>
        </div>
        <p class="def"></p>
        <div class="more">${t.body.map((p) => `<p>${p}</p>`).join('')}</div>`;
      li.querySelector('h3').textContent = t.name;
      li.querySelector('.def').textContent = t.short;
      li.querySelector('.term-watch').setAttribute('aria-label', `Watch the animation for ${t.name}`);
      linkTerms(li.querySelector('.more'), new Set([t.id]));
      li.dataset.search = `${t.name} ${t.short} ${li.querySelector('.more').textContent}`.toLowerCase();
      list.append(li);
    }
    const search = this.el.querySelector('#term-search');
    search.addEventListener('input', () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const li of list.children) {
        const hit = words.every((w) => li.dataset.search.includes(w));
        li.classList.toggle('hidden', !hit);
        shown += hit;
      }
      this.el.querySelector('#term-none').classList.toggle('hidden', shown > 0);
    });
  }

  /** Size the canvas backing store to its box and the screen's pixel ratio. */
  fit() {
    const c = this.canvas;
    const w = c.clientWidth || W;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round((w * H / W) * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    this.scale = pw / W;
    this.frame();
  }

  frame() {
    if (!this.anim) return;
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const cap = this.anim.draw(ctx, this.t);
    if (this.cap.textContent !== cap) this.cap.textContent = cap;
  }

  setPlaying(on) {
    this.playing = on;
    this.playBtn.classList.toggle('paused', !on);
    this.playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    cancelAnimationFrame(this.raf);
    this.frame();
    if (!on) return;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing || !this.isOpen) return;
      this.t += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.t > this.anim.dur) this.t = 0;
      this.frame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  /** Keep Tab inside the card while it is open. */
  trapFocus(e) {
    if (e.key !== 'Tab') return;
    const f = [...this.el.querySelectorAll('button, [tabindex="0"]')].filter((b) => b.getClientRects().length && !b.disabled);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}
