import test from 'node:test';
import assert from 'node:assert/strict';
import { effortGeometry, positionAt, stopAt } from './effort-math.mjs';
test('drag follows fractional coordinates while provider levels remain discrete', () => {
  const p = positionAt(131, 15, 300);
  assert.equal(p.x, 100);
  assert.equal(stopAt(p.fraction, 4), 1);
  assert.equal(stopAt(p.fraction, 2), 1);
});
test('grabbing the thumb off-center does not make it jump', () => {
  assert.equal(positionAt(141, 15, 300, 10).x, 100);
});
test('both pointer extremes stop exactly at the visible rail endpoints', () => {
  for (const max of [2, 3, 4]) {
    const left = positionAt(-100, 0, 300), right = positionAt(800, 0, 300);
    assert.equal(stopAt(left.fraction, max), 0); assert.equal(stopAt(right.fraction, max), max);
    assert.equal(left.x,0);assert.equal(right.x,268);
    assert.equal(left.fraction,0);assert.equal(right.fraction,1);
  }
});
test('rail, ticks and thumb centers use one inset across widths and hit sizes',()=>{
  for(const width of [218,266,300,412])for(const thumbSize of [32,40,44]){
    const g=effortGeometry(width,thumbSize),left=29;
    const first=positionAt(left+g.inset,left,width,0,thumbSize);
    const last=positionAt(left+width-g.inset,left,width,0,thumbSize);
    assert.equal(first.x+g.inset,g.inset);
    assert.equal(last.x+g.inset,width-g.inset);
    assert.equal(first.fraction,0);assert.equal(last.fraction,1);
  }
});
test('off-center grabs retain their position and reach either endpoint without overshoot',()=>{
  const width=266,left=29;
  for(const offset of [-12,0,12]){
    const center=16+117;
    assert.equal(positionAt(left+center+offset,left,width,offset).x,117);
    assert.equal(positionAt(left-100,left,width,offset).x,0);
    assert.equal(positionAt(left+width+100,left,width,offset).x,234);
  }
  assert.deepEqual(effortGeometry(20,32),{inset:10,travel:0});
  assert.equal(positionAt(20,0,20).fraction,0);
});
