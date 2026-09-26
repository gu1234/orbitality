// Flight School coach panel: the current step's explanation, its goal with a
// live readout, off-track notes, and pulsing highlights on the controls it names.

const $ = (id) => document.getElementById(id);

// on cramped screens the explanation folds away while the player is acting
const compact = typeof matchMedia === 'function'
  ? matchMedia('(max-width: 560px), (max-height: 520px) and (orientation: landscape)')
  : null;

export class Coach {
  constructor() {
    this.el = $('coach');
    this.lit = [];
    this.collapsed = false;
  }

  show(step, i, n) {
    const el = this.el;
    el.classList.remove('hidden', 'met');
    $('coach-count').textContent = `${i + 1} / ${n}`;
    $('coach-title').textContent = step.title;
    $('coach-text').innerHTML = step.text;
    $('coach-goal-text').innerHTML = step.goal;
    $('coach-next').textContent = i + 1 < n ? 'Next' : 'Finish';
    $('coach-next').disabled = true;
    this.update({ progress: null, note: null });
    this.setCollapsed(false);
    this.highlight(step.highlight || []);
    el.scrollTop = 0;
  }

  /** The goal is met: show what it taught and enable Next. */
  met(html) {
    this.el.classList.add('met');
    $('coach-text').innerHTML = html;
    $('coach-next').disabled = false;
    this.update({ note: null });
    this.setCollapsed(false);
    this.highlight([]);
    this.el.scrollTop = 0;
    if (!compact?.matches) $('coach-next').focus({ preventScroll: true });
  }

  update({ progress, note }) {
    if (progress !== undefined) {
      const p = $('coach-progress');
      const text = progress || '';
      if (p.textContent !== text) p.textContent = text;
    }
    if (note !== undefined) {
      const n = $('coach-note');
      const html = note || '';
      if (n.innerHTML !== html) n.innerHTML = html;
      n.classList.toggle('hidden', !note);
    }
  }

  /** A burn started: fold the explanation away on small screens. */
  acting() {
    if (compact?.matches && !this.el.classList.contains('met')) this.setCollapsed(true);
  }

  toggle() { this.setCollapsed(!this.collapsed); }

  setCollapsed(c) {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    const b = $('coach-min');
    b.setAttribute('aria-expanded', String(!c));
    b.setAttribute('aria-label', c ? 'Show explanation' : 'Hide explanation');
    b.textContent = c ? '+' : '−';
  }

  highlight(selectors) {
    for (const e of this.lit) e.classList.remove('coach-hl');
    this.lit = selectors.flatMap((s) => [...document.querySelectorAll(s)]);
    for (const e of this.lit) e.classList.add('coach-hl');
  }

  hide() {
    this.el.classList.add('hidden');
    this.highlight([]);
  }
}
