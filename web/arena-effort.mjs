import { clamp, effortGeometry, positionAt, stopAt } from './effort-math.mjs';

let active;
function mount(root) {
  active?.destroy();
  if (!root || !window.PointerEvent) return;
  const input = root.querySelector('input[type="range"]');
  if (!input) return;
  const thumb = root.querySelector('.arena-effort-thumb');
  const fill = root.querySelector('.arena-effort-fill');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const max = Number(input.max);
  const abort = new AbortController();
  const options = { signal: abort.signal };
  // Keep native range keyboard/AT semantics without competing native pointer updates.
  const gesture = document.createElement('div');
  gesture.className = 'arena-effort-gesture';
  gesture.setAttribute('aria-hidden', 'true');
  root.appendChild(gesture);
  let pointer = null, rect, grabOffset = 0, width = 0, thumbSize = 0, travel = 0, frame = 0, pendingX;
  let drawnIndex = -1, drawnX = 0, animations = [];
  function stop() { animations.forEach(animation => animation.cancel()); animations = []; }
  function draw(x, settle = false) {
    const transformAt = (position) => [
      `translateX(${position}px)`,
      `scaleX(${travel ? clamp(position / travel, 0, 1) : 0})`,
    ];
    const previousX = drawnX, from = transformAt(previousX), to = transformAt(x);
    drawnX = x;
    const elements = [thumb, fill];
    if (settle && !reduced.matches && Math.abs(x - previousX) > .5 && elements.every(element => typeof element.animate === 'function')) {
      // Keep the underlying style current and cancel the actual browser
      // animation on interruption, so an older release cannot reappear.
      elements.forEach((element, i) => {
        element.style.transform = to[i];
        animations.push(element.animate([{ transform: from[i] }, { transform: to[i] }], {
          duration: 140, easing: 'cubic-bezier(.22, 1, .36, 1)',
        }));
      });
    } else elements.forEach((element, i) => { element.style.transform = to[i]; });
  }
  function sync() {
    root.classList.toggle('is-disabled', input.disabled);
    if (pointer !== null) return;
    const nextWidth = root.getBoundingClientRect().width, nextThumbSize = thumb.offsetWidth, index = Number(input.value);
    // Do not truncate a release animation when unrelated app state synchronizes.
    if (nextWidth <= nextThumbSize || (nextWidth === width && nextThumbSize === thumbSize && index === drawnIndex)) return;
    width = nextWidth; thumbSize = nextThumbSize;
    const geometry = effortGeometry(width, thumbSize); travel = geometry.travel;
    root.style.setProperty('--effort-inset', geometry.inset + 'px');
    drawnIndex = index; stop(); draw(index / max * travel);
  }
  function paint() {
    frame = 0;
    if (pendingX === undefined) return;
    if (input.disabled) { pendingX = undefined; return; }
    const next = positionAt(pendingX, rect.left, width, grabOffset, thumbSize);
    pendingX = undefined; draw(next.x);
    const index = stopAt(next.fraction, max); drawnIndex = index;
    if (index !== Number(input.value)) {
      input.value = String(index);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.ArenaNative?.haptic();
    }
  }
  function move(event) {
    if (pointer !== event.pointerId || input.disabled) return;
    pendingX = event.clientX;
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function finish(event) {
    if (pointer !== event.pointerId) return;
    if (event.type === 'pointerup' && !input.disabled) pendingX = event.clientX;
    if (frame) cancelAnimationFrame(frame);
    paint(); pointer = null;
    if (gesture.hasPointerCapture(event.pointerId)) gesture.releasePointerCapture(event.pointerId);
    delete input.dataset.effortDragging;
    root.classList.remove('is-dragging');
    draw(Number(input.value) / max * travel, true);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  gesture.addEventListener('pointerdown', event => {
    if (input.disabled || pointer !== null || !event.isPrimary || event.button !== 0) return;
    const center = thumb.getBoundingClientRect().left + thumb.offsetWidth / 2;
    event.preventDefault(); stop();
    rect = root.getBoundingClientRect(); width = rect.width; thumbSize = thumb.offsetWidth;
    const geometry = effortGeometry(width, thumbSize); travel = geometry.travel;
    root.style.setProperty('--effort-inset', geometry.inset + 'px');
    grabOffset = Math.abs(event.clientX - center) <= thumbSize / 2 + 6 ? event.clientX - center : 0;
    pointer = event.pointerId; gesture.setPointerCapture(pointer);
    input.dataset.effortDragging = 'true';
    input.focus({ preventScroll: true }); root.classList.add('is-dragging');
    pendingX = event.clientX; paint();
  }, options);
  gesture.addEventListener('pointermove', move, options);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) gesture.addEventListener(type, finish, options);
  input.addEventListener('input', sync, options);
  const observer = new ResizeObserver(sync); observer.observe(root);
  root.classList.add('is-enhanced'); sync();
  let destroyed = false;
  active = { sync, destroy() {
    if (destroyed) return;
    destroyed = true;
    abort.abort(); observer.disconnect(); stop();
    if (frame) cancelAnimationFrame(frame);
    gesture.remove(); root.classList.remove('is-enhanced', 'is-dragging');
    delete input.dataset.effortDragging;
    if (active === controller) active = null;
  } };
  const controller = active;
  return controller;
}
window.ArenaEffort = { mount, sync() { active?.sync(); } };
