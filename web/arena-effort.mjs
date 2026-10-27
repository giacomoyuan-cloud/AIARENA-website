import { animate } from 'motion';
import { positionAt, stopAt } from './effort-math.mjs';

let active;
function mount(root) {
  active?.destroy();
  if (!root || !window.PointerEvent) return;
  const input = root.querySelector('input[type="range"]');
  if (!input) return;
  const thumb = root.querySelector('.arena-effort-thumb');
  const face = thumb.firstElementChild;
  const halo = root.querySelector('.arena-effort-halo');
  const fill = root.querySelector('.arena-effort-fill');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const max = Number(input.max);
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let pointer = null, rect, grabOffset = 0, x = 0, width = 0, lastX = 0;
  let animations = [];
  function stop() { animations.forEach(a => a.stop()); animations = []; }
  function draw(nextX, spring = false) {
    x = nextX;
    const targets = [[thumb, `translateX(${x}px)`], [fill, `scaleX(${(x + 16) / Math.max(32, width)})`]];
    if (spring && !reduced.matches) targets.forEach(([el, transform]) => animations.push(animate(el, { transform }, { type: 'spring', duration: .5, bounce: .2 })));
    else targets.forEach(([el, transform]) => { el.style.transform = transform; });
  }
  function sync() {
    root.classList.toggle('is-disabled', input.disabled);
    if (pointer !== null) return;
    width = root.getBoundingClientRect().width;
    if (width > 32) { stop(); draw(Number(input.value) / max * (width - 32)); }
  }
  function feedback(dragging, delta = 0) {
    const transform = dragging && !reduced.matches ? `translateY(-4px) scale(${1.12 + Math.min(Math.abs(delta), 20) / 400},1.12)` : 'translateY(0px) scale(1,1)';
    animations.push(animate(face, { transform }, { duration: .16, ease: [.23, 1, .32, 1] }));
    animations.push(animate(halo, { opacity: dragging ? .8 : 0, transform: dragging && !reduced.matches ? 'scale(1.4)' : 'scale(1)' }, { duration: .16, ease: [.23, 1, .32, 1] }));
  }
  function move(event) {
    if (pointer !== event.pointerId || input.disabled) return;
    const next = positionAt(event.clientX, rect.left, width, grabOffset);
    stop(); draw(next.x);
    feedback(true, next.x - lastX); lastX = next.x;
    const index = stopAt(next.fraction, max);
    if (index !== Number(input.value)) {
      input.value = String(index);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.ArenaNative?.haptic();
    }
  }
  function finish(event) {
    if (pointer !== event.pointerId) return;
    if (event.type === 'pointerup') move(event);
    pointer = null;
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    root.classList.remove('is-dragging'); stop();
    draw(Number(input.value) / max * (width - 32), true); feedback(false);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  input.addEventListener('pointerdown', event => {
    if (input.disabled || pointer !== null || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); stop();
    rect = root.getBoundingClientRect(); width = rect.width;
    const center = thumb.getBoundingClientRect().left + 16;
    grabOffset = Math.abs(event.clientX - center) <= 22 ? event.clientX - center : 0;
    pointer = event.pointerId; input.setPointerCapture(pointer);
    input.focus({ preventScroll: true }); root.classList.add('is-dragging');
    lastX = x; move(event);
  }, options);
  input.addEventListener('pointermove', move, options);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) input.addEventListener(type, finish, options);
  input.addEventListener('input', sync, options);
  const observer = new ResizeObserver(sync); observer.observe(root);
  root.classList.add('is-enhanced'); sync();
  active = { sync, destroy() { abort.abort(); observer.disconnect(); stop(); active = null; } };
}
window.ArenaEffort = { mount, sync() { active?.sync(); } };
