import test from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, stopAt } from './effort-math.mjs';
test('drag follows fractional coordinates while provider levels remain discrete', () => {
  const p = positionAt(131, 15, 300);
  assert.equal(p.x, 100);
  assert.equal(stopAt(p.fraction, 4), 1);
  assert.equal(stopAt(p.fraction, 2), 1);
});
test('grabbing the thumb off-center does not make it jump', () => {
  assert.equal(positionAt(141, 15, 300, 10).x, 100);
});
test('elastic overshoot cannot select an unsupported effort', () => {
  for (const max of [2, 3, 4]) {
    const left = positionAt(-100, 0, 300), right = positionAt(800, 0, 300);
    assert.equal(stopAt(left.fraction, max), 0); assert.equal(stopAt(right.fraction, max), max);
    assert.ok(left.x > -3 && left.x < 0); assert.ok(right.x > 268 && right.x < 271);
  }
});
