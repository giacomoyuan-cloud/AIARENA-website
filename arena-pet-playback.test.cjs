const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPlayer,createController}=require('./arena-pet.js');

function fixture({formats={webm:true},hevc=false,rejectPlay=false}={}){
  let now=0,serial=0,visible=true,ended=0;
  const queue=new Map(),document={hidden:false},reduced={matches:false};
  const attrs=new Map(),element={isConnected:true,getClientRects:()=>visible?[{}]:[],getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v)};
  const image={hidden:false,complete:false,naturalWidth:0,src:'',getAttribute(k){return this[k];}};
  const video={paused:true,ended:false,loop:false,currentTime:0,hidden:true,src:'',loads:0,plays:0,
    canPlayType:()=>hevc?'probably':'',
    play(){this.plays++;if(rejectPlay)return Promise.reject(new Error('Autoplay denied'));this.paused=false;this.onplaying?.();return Promise.resolve();},
    pause(){this.paused=true;},load(){this.loads++;this.currentTime=0;this.ended=false;},removeAttribute(k){this[k]='';}};
  const clock={setTimeout(fn,delay){queue.set(++serial,{fn,at:now+delay});return serial;},clearTimeout(id){queue.delete(id);}};
  const player=createPlayer({window:clock,document,element,video,image,reducedMotion:reduced,formatSupport:formats,now:()=>now,onEnded(){ended++;}});
  function advance(ms){const end=now+ms;while(true){const next=[...queue].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;queue.delete(next[0]);now=next[1].at;next[1].fn();}now=end;}
  function ready(){video.onloadeddata?.();}
  function end(){video.ended=true;video.paused=true;video.onended?.();}
  return {player,video,image,element,document,reduced,advance,ready,end,queue,attrs,get ended(){return ended;},hide(){visible=false;player.refresh();},show(){visible=true;player.refresh();}};
}
const loop={id:'knead',playback:'loop',durationSeconds:2.333,poster:'knead.png',webm:'knead.webm',webp:'knead.webp',hevc:'knead.mov'};
const once={id:'wave',playback:'once',durationSeconds:5.04,poster:'wave.png',webm:'wave.webm',webp:'wave.webp',hevc:'wave.mov'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('repeated focus/layout/input refreshes neither reload nor prematurely finish the idle action',async()=>{
  const f=fixture();f.player.set(loop,'idle');f.ready();await settle();f.video.currentTime=.75;
  for(let i=0;i<100;i++){f.player.set(loop,'idle');f.player.refresh();}
  f.advance(2000);assert.equal(f.ended,0);assert.equal(f.video.loads,1);assert.equal(f.video.currentTime,.75);assert.equal(f.video.paused,false);assert.equal(f.video.loop,true);
});
test('an idle native action repeats the same source instead of advancing a playlist',()=>{
  const f=fixture();f.player.set(loop,'idle');f.ready();f.end();f.player.watchdog();assert.equal(f.ended,0);assert.equal(f.video.src,loop.webm);assert.equal(f.video.loads,1);assert.equal(f.video.paused,false);
});
test('hidden or background playback resumes the same decoded video without resetting its time',async()=>{
  const f=fixture();f.player.set(loop,'rest');f.ready();await settle();f.video.currentTime=1.25;
  f.document.hidden=true;f.player.refresh();assert.equal(f.video.paused,true);assert.equal(f.image.src,loop.poster);
  f.document.hidden=false;f.player.refresh();await settle();assert.equal(f.video.paused,false);assert.equal(f.video.currentTime,1.25);assert.equal(f.video.loads,1);assert.equal(f.image.hidden,true);
});
test('a pet mounted while hidden loads as soon as its container appears',()=>{
  const f=fixture();f.hide();f.player.set(loop,'idle');assert.equal(f.video.loads,0);f.show();assert.equal(f.video.loads,1);f.ready();assert.equal(f.video.paused,false);
});
test('reduced-motion keeps a poster and resumes on preference change',()=>{
  const f=fixture();f.reduced.matches=true;f.player.set(loop,'working');assert.equal(f.video.loads,0);
  f.reduced.matches=false;f.player.refresh();f.ready();assert.equal(f.video.paused,false);
});
test('background label changes and repeated greetings keep the same clip and playback position',()=>{
  const f=fixture();f.player.set(loop,'idle');f.ready();f.video.currentTime=1.25;
  for(const state of ['rest','welcome','welcome','idle'])f.player.set(loop,state);
  assert.equal(f.video.loop,true);assert.equal(f.video.currentTime,1.25);assert.equal(f.video.paused,false);assert.equal(f.video.loads,1);
});
test('browser-paused playback and a missed ended event recover through the foreground watchdog',async()=>{
  const f=fixture();f.player.set(once,'welcome');f.ready();await settle();f.video.paused=true;f.player.watchdog();assert.equal(f.video.paused,false);await settle();
  f.video.ended=true;f.video.paused=true;f.player.watchdog();assert.equal(f.ended,1);
});
test('a decoded video that stops advancing changes to animated WebP rather than holding forever',()=>{
  const f=fixture();f.player.set(loop,'working');f.ready();f.player.watchdog();f.advance(6100);f.player.watchdog();assert.equal(f.image.src,loop.webp);assert.equal(f.video.hidden,true);
});
test('load timeouts and codec errors fall back to an animated format with a working end timer',()=>{
  const f=fixture();f.player.set(once,'idle');f.advance(5000);assert.equal(f.image.src,once.webp);
  f.image.onload();f.advance(5040);assert.equal(f.ended,1);
});
test('autoplay rejection uses animated WebP without waiting for another user click',async()=>{
  const f=fixture({rejectPlay:true});f.player.set(loop,'idle');f.ready();await settle();assert.equal(f.image.src,loop.webp);assert.equal(f.video.hidden,true);
});
test('WebP playback re-arms after returning from a hidden tab',()=>{
  const f=fixture({formats:{webm:false,hevc:false}});f.player.set(once,'idle');f.image.onload();f.advance(2000);
  f.document.hidden=true;f.player.refresh();f.advance(10000);assert.equal(f.ended,0);
  f.document.hidden=false;f.player.refresh();f.image.onload();f.advance(5040);assert.equal(f.ended,1);
});
test('the animated WebP loop stays on one source without a completion/rotation timer',()=>{
  const f=fixture({formats:{webm:false,hevc:false}});f.player.set(loop,'idle');f.image.onload();f.advance(120000);
  assert.equal(f.ended,0);assert.equal(f.image.src,loop.webp);assert.equal(f.queue.size,0);
});
test('an old decode or rejected play cannot replace a newer action',async()=>{
  const f=fixture();f.player.set(loop,'idle');const stale=f.video.onloadeddata;f.player.set(once,'welcome');stale();assert.equal(f.attrs.get('data-motion-status'),'loading');assert.equal(f.video.src,once.webm);
  f.ready();await settle();assert.equal(f.attrs.get('data-motion-status'),'playing');assert.equal(f.attrs.get('data-motion-id'),'wave');
});
test('a queued ended event from the previous source cannot end a newly playing action',()=>{
  const f=fixture();f.player.set(loop,'idle');f.ready();f.player.set(once,'welcome');f.ready();
  f.video.ended=false;f.video.onended();assert.equal(f.ended,0);assert.equal(f.video.src,once.webm);
});
test('timeupdate progress prevents short loops sampled at the same phase being mistaken for a stall',()=>{
  const f=fixture();f.player.set(loop,'rest');f.ready();
  for(let i=0;i<5;i++){f.advance(1500);f.video.currentTime=.7;f.video.ontimeupdate();f.advance(500);f.video.currentTime=0;f.video.ontimeupdate();f.player.watchdog();}
  assert.notEqual(f.image.src,loop.webp);assert.equal(f.video.paused,false);
});
test('destroy disconnects decoders, handlers and timers, and stale events cannot revive them',()=>{
  const f=fixture();f.player.set(loop,'idle');const stale=f.video.onloadeddata;f.player.destroy();stale();f.advance(10000);assert.equal(f.video.src,'');assert.equal(f.video.paused,true);assert.equal(f.ended,0);assert.equal(f.queue.size,0);
});
test('streaming chunks in the same phase do not repaint the pet on every token',()=>{
  let paints=0;const c=createController({setTimeout:()=>1,clearTimeout(){},onChange(){paints++;}});
  c.sync({running:true,hasMessages:true});c.progress('a','responding');const before=paints;
  for(let i=0;i<1000;i++)c.progress('a','responding');assert.equal(paints,before);c.destroy();
});
test('single-shot completion returns to play without changing the real running task',()=>{
  const c=createController({setTimeout:()=>1,clearTimeout(){}});c.motionEnded('welcome');assert.equal(c.snapshot().state,'idle');
  c.sync({running:true,hasMessages:true});c.motionEnded('welcome');assert.equal(c.snapshot().state,'thinking');assert.equal(c.snapshot().running,true);c.destroy();
});
