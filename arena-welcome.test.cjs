const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const Welcome=require('./arena-welcome.js');
class Element extends EventTarget{
  constructor(attributes={}){super();this.attributes={...attributes};this.value='';this.writes=0;}
  getAttribute(key){return this.attributes[key]??null;}
  setAttribute(key,value){this.attributes[key]=value;this.writes++;}
}
function fixture(){
  const image=new Element({src:'poster.png','data-poster':'poster.png','data-animation':'loop.webp'}),input=new Element(),welcome=new Element(),document=new EventTarget(),media=new EventTarget();
  document.hidden=false;media.matches=false;let active=true;
  const controller=Welcome.mount({image,input,welcome,document,media,active:()=>active});
  return {image,input,welcome,document,media,controller,setActive(value){active=value;controller.update();},type(value){input.value=value;input.dispatchEvent(new Event('input'));}};
}
test('the existing empty composer loops immediately, including after focus',()=>{
  const f=fixture();assert.equal(f.image.getAttribute('src'),'loop.webp');assert.equal(f.welcome.getAttribute('data-animation-state'),'playing');
  const writes=f.image.writes;f.input.dispatchEvent(new Event('focus'));f.controller.update();assert.equal(f.image.writes,writes,'repeated layout updates do not restart the loop');
});
test('typing pauses the pet and clearing the draft resumes the original animation',()=>{
  const f=fixture();f.type('正在打字');assert.equal(f.image.getAttribute('src'),'poster.png');assert.equal(f.welcome.getAttribute('data-drafting'),'true');
  f.input.dispatchEvent(new Event('blur'));assert.equal(f.image.getAttribute('src'),'poster.png');
  f.type('');assert.equal(f.image.getAttribute('src'),'loop.webp');assert.equal(f.welcome.getAttribute('data-drafting'),'false');
});
test('sent messages and inactive modes stop the loop; a new empty conversation restores it',()=>{
  const f=fixture();f.setActive(false);assert.equal(f.image.getAttribute('src'),'poster.png');f.input.value='';f.setActive(true);assert.equal(f.image.getAttribute('src'),'loop.webp');
});
test('hidden pages and reduced-motion preferences pause, and restore only when idle',()=>{
  const f=fixture();f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.image.getAttribute('src'),'poster.png');
  f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.image.getAttribute('src'),'loop.webp');
  f.media.matches=true;f.media.dispatchEvent(new Event('change'));assert.equal(f.image.getAttribute('src'),'poster.png');
  f.type('draft');f.media.matches=false;f.media.dispatchEvent(new Event('change'));assert.equal(f.image.getAttribute('src'),'poster.png');
  f.type('');assert.equal(f.image.getAttribute('src'),'loop.webp');
});
test('destroying the controller stops motion and removes event listeners',()=>{
  const f=fixture();f.controller.destroy();f.type('');f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.image.getAttribute('src'),'poster.png');
});
test('Pages staging includes the animation and controller without publishing tests or private files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'welcome-stage-'));
  try{
    for(const name of ['scripts','songs','downloads','welcome-media'])await fs.mkdir(path.join(root,name));
    await fs.copyFile(path.join(__dirname,'scripts/stage-site.mjs'),path.join(root,'scripts/stage-site.mjs'));
    for(const [name,text]of [['index.html','welcome'],['arena-welcome.js','controller'],['arena-welcome.test.cjs','exclude'],['private.env','exclude'],['welcome-media/jiujiu-knead-v1.webp','animation'],['welcome-media/jiujiu-poster-v1.png','poster']])await fs.writeFile(path.join(root,name),text);
    execFileSync(process.execPath,[path.join(root,'scripts/stage-site.mjs')]);
    const output=path.join(root,'dist-site');assert.equal(await fs.readFile(path.join(output,'welcome-media/jiujiu-knead-v1.webp'),'utf8'),'animation');
    assert.equal(await fs.readFile(path.join(output,'arena-welcome.js'),'utf8'),'controller');
    await assert.rejects(fs.access(path.join(output,'arena-welcome.test.cjs')));await assert.rejects(fs.access(path.join(output,'private.env')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
