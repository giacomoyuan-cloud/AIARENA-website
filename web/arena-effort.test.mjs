import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clamp, effortGeometry, positionAt, stopAt } from './effort-math.mjs';

const source=readFileSync(new URL('./arena-effort.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
function fixture({min=0,max=4,step=1,width=266,thumbSize=32,value=1,disabled=false}={}){
  const frames=new Map();let frameId=0,resize;
  class Element extends EventTarget {
    constructor(){super();this.dataset={};this.classes=new Set();this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.classList={add:(...c)=>c.forEach(v=>this.classes.add(v)),remove:(...c)=>c.forEach(v=>this.classes.delete(v)),toggle:(c,v)=>v?this.classes.add(c):this.classes.delete(c)};this.children=[];}
    setAttribute(){} focus(){} appendChild(e){this.children.push(e);e.parent=this;} remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}
    setPointerCapture(id){this.captured=id;} hasPointerCapture(id){return this.captured===id;} releasePointerCapture(){this.captured=null;}
  }
  const root=new Element(),input=new Element(),thumb=new Element(),fill=new Element();
  input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.disabled=disabled;thumb.offsetWidth=thumbSize;
  root.getBoundingClientRect=()=>({left:29,width});
  const thumbX=()=>Number(/translateX\(([-.\d]+)px\)/.exec(thumb.style.transform)?.[1]||0);
  thumb.getBoundingClientRect=()=>({left:29+thumbX(),width:thumbSize});
  root.querySelector=s=>s.startsWith('input')?input:s==='.arena-effort-thumb'?thumb:fill;
  const context=vm.createContext({window:{PointerEvent:Event},document:{createElement:()=>new Element()},Event,AbortController,
    matchMedia:()=>({matches:true}),ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}},
    requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),clamp,effortGeometry,positionAt,stopAt});
  vm.runInContext(source,context);const controller=context.window.ArenaEffort.mount(root);
  let inputs=0,changes=0;input.addEventListener('input',()=>inputs++);input.addEventListener('change',()=>changes++);
  function pointer(type,x,id=1){const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,pointerId:id,isPrimary:true,button:0});root.children[0].dispatchEvent(event);}
  function flush(){for(const [id,fn] of [...frames]){frames.delete(id);fn();}}
  return {root,input,thumb,fill,controller,pointer,flush,thumbX,center:()=>29+thumbX()+thumbSize/2,
    counts:()=>({inputs,changes}),resize:next=>{width=next;resize();},remount:()=>context.window.ArenaEffort.mount(root),mountGroup:roots=>context.window.ArenaEffort.mountGroup({querySelectorAll:()=>roots})};
}
for(const max of [2,3,4])test('pointer capture reaches both ends and fills the complete rail with '+(max+1)+' levels',()=>{
  for(const width of [218,266,412])for(const thumbSize of [32,44]){
    const f=fixture({max,width,thumbSize});
    f.pointer('pointerdown',f.center()+7);f.pointer('pointermove',-200);f.flush();f.pointer('pointerup',-200);
    assert.equal(f.input.value,'0');assert.equal(f.thumbX(),0);assert.equal(f.fill.style.transform,'scaleX(0)');
    f.pointer('pointerdown',f.center()-7);f.pointer('pointermove',1000);f.flush();f.pointer('pointerup',1000);
    assert.equal(f.input.value,String(max));assert.equal(f.thumbX(),width-thumbSize);assert.equal(f.fill.style.transform,'scaleX(1)');
    assert.equal(f.root.style['--effort-inset'],thumbSize/2+'px');assert.equal(f.counts().changes,2);
    f.controller.destroy();
  }
});
test('release uses the last pointer coordinate even before the animation frame runs',()=>{
  const f=fixture();f.pointer('pointerdown',f.center());f.pointer('pointermove',30);f.pointer('pointerup',1000);
  assert.equal(f.input.value,'4');assert.equal(f.fill.style.transform,'scaleX(1)');
  f.pointer('lostpointercapture',1000);assert.equal(f.counts().changes,1);f.controller.destroy();
});
test('keyboard input and resizing keep the thumb and fill at the selected endpoint',()=>{
  const f=fixture();f.input.value='4';f.input.dispatchEvent(new Event('input'));
  assert.equal(f.thumbX(),234);assert.equal(f.fill.style.transform,'scaleX(1)');f.resize(412);
  assert.equal(f.thumbX(),380);assert.equal(f.fill.style.transform,'scaleX(1)');
  f.input.value='0';f.input.dispatchEvent(new Event('input'));assert.equal(f.thumbX(),0);f.controller.destroy();
});
test('disabled controls ignore dragging and replacing a controller removes old listeners',()=>{
  const f=fixture({disabled:true});f.pointer('pointerdown',f.center());f.pointer('pointerup',1000);
  assert.equal(f.input.value,'1');assert.equal(f.counts().changes,0);
  f.input.disabled=false;const next=f.remount();f.controller.destroy();assert.equal(f.root.children.length,1);
  f.pointer('pointerdown',f.center());f.pointer('pointerup',1000);assert.equal(f.input.value,'4');assert.equal(f.counts().changes,1);
  next.destroy();assert.equal(f.root.children.length,0);
});
test('numeric sliders preserve their real minimum, maximum and step',()=>{
  for(const config of [{min:1,max:10,step:1,value:4},{min:0,max:100,step:1,value:80},{min:0,max:3,step:1,value:2}]){
    const f=fixture(config);f.pointer('pointerdown',f.center());f.pointer('pointerup',1000);
    assert.equal(Number(f.input.value),config.max);assert.equal(f.fill.style.transform,'scaleX(1)');
    f.pointer('pointerdown',f.center());f.pointer('pointerup',-100);
    assert.equal(Number(f.input.value),config.min);assert.equal(f.fill.style.transform,'scaleX(0)');f.controller.destroy();
  }
});
test('multiple settings sliders stay independent and group cleanup removes every gesture',()=>{
  const a=fixture({min:1,max:10,value:1}),b=fixture({max:100,value:80});b.controller.destroy();
  const group=a.mountGroup([a.root,b.root]);
  a.pointer('pointerdown',a.center());a.pointer('pointerup',1000);
  assert.equal(a.input.value,'10');assert.equal(b.input.value,'80');
  b.pointer('pointerdown',b.center());b.pointer('pointerup',-100);
  assert.equal(b.input.value,'0');assert.equal(a.input.value,'10');
  group.destroy();assert.equal(a.root.children.length,0);assert.equal(b.root.children.length,0);
});
test('touching an automatic setting selects a manual value even at the same position',()=>{
  const f=fixture();f.root.dataset.sliderAuto='true';
  f.input.addEventListener('input',()=>{f.root.dataset.sliderAuto='false';});
  f.pointer('pointerdown',f.center());f.pointer('pointerup',f.center());
  assert.equal(f.counts().inputs,1);assert.equal(f.root.dataset.sliderAuto,'false');f.controller.destroy();
});
