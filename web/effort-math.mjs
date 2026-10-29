export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function effortGeometry(width, thumbSize = 32) {
  const inset = Math.min(Math.max(0, width), Math.max(0, thumbSize)) / 2;
  return { inset, travel: Math.max(0, width - inset * 2) };
}
export function positionAt(clientX, left, width, grabOffset = 0, thumbSize = 32) {
  const { inset, travel } = effortGeometry(width, thumbSize);
  const raw = clientX - left - inset - grabOffset;
  const bounded = clamp(raw, 0, travel);
  return { travel, fraction: travel ? bounded / travel : 0, x: bounded };
}
export function stopAt(fraction, max) { return clamp(Math.round(fraction * max), 0, max); }
