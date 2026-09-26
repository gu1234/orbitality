// Hover tooltips for mouse users: what a control does, plus its keyboard shortcut.
// Opt in with data-tip="..." (and data-key="W"); buttons with only an aria-label
// fall back to it. Touch and pen never see them, and pressing a control hides its
// tooltip until the pointer leaves it, so holding a burn stays uncluttered.

const DELAY = 350;
const SELECTOR = '[data-tip], button[aria-label]';

export function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  let el = null;    // control under the mouse
  let muted = null; // control pressed while hovered: no tooltip until the mouse leaves it
  let timer = 0;

  const textFor = (b) => b.dataset.tip || b.getAttribute('aria-label');

  function hide() {
    clearTimeout(timer);
    tip.hidden = true;
  }

  function show(b) {
    if (!b.isConnected || !b.getClientRects().length) return; // gone or display:none
    tip.textContent = textFor(b);
    if (b.dataset.key) {
      const k = document.createElement('kbd');
      k.textContent = b.dataset.key;
      tip.append(k);
    }
    tip.hidden = false;
    const r = b.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let y = r.top - t.height - 8;
    if (y < 6) y = r.bottom + 8; // no room above: drop below
    const x = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest(SELECTOR);
    if (b === el) return;
    hide();
    el = b && textFor(b) ? b : null;
    if (el && el !== muted) timer = setTimeout(() => show(el), DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (!el || el.contains(e.relatedTarget)) return;
    if (el === muted) muted = null;
    el = null;
    hide();
  });
  addEventListener('pointerdown', () => { muted = el; hide(); }, true);
  addEventListener('keydown', hide, true);
  addEventListener('blur', hide);
  addEventListener('wheel', hide, { passive: true });
}
