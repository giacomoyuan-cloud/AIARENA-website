const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const match=source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));assert.ok(match,name+' exists');return match[0];}
function inputFixture(){
  const events=new Map(),input={value:'token',style:{},scrollHeight:30,addEventListener(name,handler){events.set(name,handler);}};
  let sends=0,prevented=0,error='';const sendButton={disabled:false};
  const context=vm.createContext({$:id=>id==='aaTopic'?input:sendButton,window:{innerWidth:1280},sentImgs:[],sentTexts:[],aaRunning:false,imageMode:false,aaStart:()=>sends++,setImageError:message=>error=message});
  const a=source.indexOf('  // === Input handling ==='),b=source.indexOf('  function _aaScrollToCaret',a);
  vm.runInContext(source.slice(a,b),context);
  return {input,events,context,sendButton,get error(){return error;},get sends(){return sends;},get prevented(){return prevented;},fire(type,props={}){events.get(type).call(input,{key:'Enter',keyCode:13,isComposing:false,preventDefault(){prevented++;},...props});}};
}
test('an IME confirmation Enter never submits or cancels candidate selection',()=>{
  const f=inputFixture();f.fire('compositionstart');f.fire('keydown');assert.equal(f.sends,0);assert.equal(f.prevented,0);
  f.fire('compositionend');f.fire('keydown');assert.equal(f.sends,1);assert.equal(f.prevented,1);
});
test('Safari compositionend-before-keydown with isComposing=false and keyCode 229 does not submit',()=>{
  const f=inputFixture();f.fire('compositionstart');f.fire('compositionend');f.fire('keydown',{keyCode:229});
  assert.equal(f.sends,0);assert.equal(f.prevented,0);f.fire('keydown');assert.equal(f.sends,1);
});
for(const event of [{isComposing:true},{which:229},{key:'Process'}])test('native composition marker blocks submit: '+JSON.stringify(event),()=>{
  const f=inputFixture();f.fire('keydown',event);assert.equal(f.sends,0);assert.equal(f.prevented,0);
});
test('Shift+Enter and mobile Enter keep their newline behavior',()=>{
  const f=inputFixture();f.fire('keydown',{shiftKey:true});f.context.window.innerWidth=390;f.fire('keydown');assert.equal(f.sends,0);assert.equal(f.prevented,0);
});
test('plain desktop Enter submits once and blur clears a cancelled composition',()=>{
  const f=inputFixture();f.fire('compositionstart');f.fire('blur');f.fire('keydown');assert.equal(f.sends,1);assert.equal(f.prevented,1);
});
test('empty drafts and an ongoing response do not submit',()=>{
  const f=inputFixture();f.input.value='';f.fire('keydown');assert.equal(f.sends,0);
  f.input.value='token';f.context.aaRunning=true;f.fire('keydown');assert.equal(f.sends,0);
});
test('an image draft typed during generation stays unsent and explains why',()=>{
  const f=inputFixture();f.context.imageMode=true;f.context.aaRunning=true;
  f.fire('input');assert.equal(f.sendButton.disabled,false,'stop control stays available');
  f.fire('keydown');assert.equal(f.sends,0);assert.equal(f.prevented,1);assert.match(f.error,/仍在生成/);assert.equal(f.input.value,'token');
});
test('only explicit Skills or coding modes supplement the saved system prompt',()=>{
  const c=vm.createContext({activeSkill:null,_pptTemplateInfo:null,SYS_CHAT:'DEFAULT',activeProjectId:null,activeProject:null,getActiveSubmodels:()=>['claude-sonnet-5-5']});
  vm.runInContext(fn('currentChatSystemPrompt')+'\n'+fn('chatSystemMode'),c);
  assert.equal(c.currentChatSystemPrompt('claude-sonnet-5-5'),'DEFAULT');
  assert.equal(c.chatSystemMode('claude-sonnet-5-5'),'default');
  c.activeSkill={type:'prompt',id:'ppt-maker',prompt:'SKILL'};c._pptTemplateInfo={name:'template.pptx',colors:{accent:'123456'},fonts:[]};
  assert.equal(c.chatSystemMode('claude-sonnet-5-5'),'skill');
  assert.match(c.currentChatSystemPrompt('claude-sonnet-5-5'),/SKILL/);assert.match(c.currentChatSystemPrompt('claude-sonnet-5-5'),/123456/);
  assert.equal(c.chatSystemMode('codex-official'),'coding');
});
test('project requests never carry the general prompt or selected Skill',()=>{
  const c=vm.createContext({activeSkill:{type:'prompt',prompt:'GENERAL_SKILL'},activeProjectId:null,currentChatId:'test-chat-123',msgs:[{uid:1,isUser:true,text:'question'}],_incognitoMode:false,getActiveSubmodels:()=>['claude-sonnet-5-5'],ArenaContext:{selectRecent:()=>({messages:[],earlier:[]})}});
  vm.runInContext(fn('chatSystemMode')+'\n'+fn('scopedChatInput'),c);
  assert.equal(c.scopedChatInput('question','GENERAL_SKILL').systemMode,'skill');
  c.activeProjectId='project-123';
  const request=c.scopedChatInput('question','GENERAL_SKILL');
  assert.equal(request.system,'');assert.equal(request.systemMode,'project');assert.equal(request.scope,'project-123');
});
