export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function positionAt(clientX, left, width, grabOffset = 0) {
  const travel = Math.max(1, width - 32);
  const raw = clientX - left - 16 - grabOffset;
  const bounded = clamp(raw, 0, travel);
  // Resistance at each end follows the finger without changing the selected level.
  return { travel, fraction: bounded / travel, x: bounded + (raw - bounded) / (1 + Math.abs(raw - bounded) / 12) * .24 };
}
export function stopAt(fraction, max) { return clamp(Math.round(fraction * max), 0, max); }
