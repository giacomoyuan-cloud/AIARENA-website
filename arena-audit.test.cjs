const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){const found=html.match(new RegExp('  (?:async )?function '+name+'\\([^]*?\\n  }'));assert.ok(found,name);return found[0];}
function element(){return {value:'',dataset:{},style:{},textContent:'',hidden:false,scrollTop:0,focus(){},setAttribute(){},classList:{add(){},remove(){},toggle(){},contains(){return false;}}};}
function navigation(){
  const elements=new Map(),writes=[],notices=[];let sequence=0,c;
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  $('aaUsername').value='tester';$('aaTopic').value='unsent draft';
  c=vm.createContext({$,console,loginName:v=>v.trim(),getPass:()=> 'synthetic-hash',
    aaRunning:false,skillSubmitPending:false,scopeSwitchPending:false,chatNavigationPending:false,privacySwitchPending:false,
    _bizMode:false,_incognitoMode:false,_saveTimer:1,scopeEpoch:1,chatLoadEpoch:0,activeProjectId:null,currentChatId:'original-chat',workspaceController:null,
    msgs:[{uid:1,isUser:true,text:'original message'}],sentImgs:[],sentTexts:[],activeQuote:null,imageMaskState:null,
    imageMode:false,imageComposerTask:'generation',imageEditParentUid:null,debatePriorRunId:null,
    brandSelection:{xai:'grok-4.7'},_memoryLoaded:true,_cachedMemory:'memory',scopeSaveInFlight:null,
    clearTimeout(){},syncArenaLayout(){},syncArenaNavigation(){},clearDebateView(){},clearQuote(){c.activeQuote=null;},
    genChatId:()=> 'new-chat-'+(++sequence),debateRunKey:()=> 'fixture',sessionStorage:{removeItem(){}},loadChatList(){},getLastAssistantReplyAt:()=>0,
    clearPreview(){c.sentImgs=[];c.sentTexts=[];},render(){},hideThink(){},setImageError(){},syncImageComposer(){},
    renderImgPreviews(){},renderTextPreviews(){},closeHistory(){},syncKitten(){},loadMemory(){},updateSkillsBtn(){},
    debateOwnsChat:()=>false,serializeMsgs:()=>plain(c.msgs),getChatTitle:()=> 'test',arenaNotice:message=>notices.push(message),
    saveCurrentChat(){c._saveTimer=2;},chatApiCall:async(action,extra)=>{writes.push({action,...plain(extra)});return {ok:true};}
  });
  vm.runInContext(['scopeViewKey','saveChatSnapshot','flushScopeChat','beginNewChat','toggleIncognito'].map(fn).join('\n'),c);
  return {c,$,writes,notices};
}
test('leaving incognito clears its messages, draft and chat ID before saving can resume',async()=>{
  const {c,$,writes}=navigation();await c.toggleIncognito();
  assert.equal(c._incognitoMode,true);assert.equal(c.msgs.length,0);assert.equal($('aaTopic').value,'unsent draft');
  assert.equal(writes[0].messages[0].text,'original message');
  const privateId=c.currentChatId;c.msgs=[{uid:2,isUser:true,text:'PRIVATE_CANARY'}];$('aaTopic').value='PRIVATE_DRAFT';
  await c.toggleIncognito();
  assert.equal(c._incognitoMode,false);assert.notEqual(c.currentChatId,privateId);assert.equal(c.msgs.length,0);assert.equal($('aaTopic').value,'');
  await c.flushScopeChat(true);assert.ok(!JSON.stringify(writes).includes('PRIVATE'));
  assert.equal(c.privacySwitchPending,false);assert.equal(c.chatNavigationPending,false);
});
test('failed ordinary-chat save prevents both new-chat and privacy navigation without losing data',async()=>{
  for(const action of ['beginNewChat','toggleIncognito']){
    const {c,$,notices}=navigation();c.chatApiCall=async()=>null;
    await c[action]();assert.equal(c.currentChatId,'original-chat');assert.equal(c.msgs[0].text,'original message');
    assert.equal($('aaTopic').value,'unsent draft');assert.equal(c._incognitoMode,false);assert.match(notices.at(-1),/保存失败/);
    assert.equal(c.chatNavigationPending,false);assert.equal(c.privacySwitchPending,false);
  }
});
test('generation and pending submission cannot change privacy mode',async()=>{
  for(const flag of ['aaRunning','skillSubmitPending','scopeSwitchPending','chatNavigationPending']){
    const {c,writes}=navigation();c[flag]=true;await c.toggleIncognito();assert.equal(c._incognitoMode,false);assert.equal(writes.length,0);
  }
});
test('a cancelled new-chat transition never releases private messages into ordinary mode',async()=>{
  for(const privateMode of [true,false]){
    const {c}=navigation();c._incognitoMode=privateMode;c.beginNewChat=async()=>false;
    await c.toggleIncognito();assert.equal(c._incognitoMode,privateMode);assert.equal(c.msgs[0].text,'original message');
  }
});
test('ordinary and incognito project view caches cannot restore one another',()=>{
  const {c}=navigation(),ordinary=c.scopeViewKey('project-1');c._incognitoMode=true;
  assert.notEqual(c.scopeViewKey('project-1'),ordinary);assert.notEqual(c.scopeViewKey(null),c.scopeViewKey('project-1'));
});
test('opening another chat waits for its outgoing save and preserves data when that save fails',async()=>{
  const {c,notices}=navigation(),actions=[];c.chatApiCall=async action=>{actions.push(action);return null;};
  vm.runInContext(fn('loadChat'),c);assert.equal(await c.loadChat('another-chat'),false);
  assert.deepEqual(actions,['save']);assert.equal(c.currentChatId,'original-chat');assert.equal(c.msgs[0].text,'original message');assert.match(notices.at(-1),/保存失败/);
});
test('new chat waits for an autosave already on the network and refuses to discard an unsaved conversation',async()=>{
  const {c,notices}=navigation();let timer,finish;
  c.setTimeout=callback=>(timer=callback,42);c.chatApiCall=()=>new Promise(resolve=>finish=resolve);
  vm.runInContext(fn('saveCurrentChat'),c);c.saveCurrentChat();timer();assert.equal(c._saveTimer,null);
  const moving=c.beginNewChat();assert.equal(c.currentChatId,'original-chat');finish(null);
  assert.equal(await moving,false);assert.equal(c.currentChatId,'original-chat');assert.match(notices.at(-1),/保存失败/);
});
test('edits queued behind an older autosave are written in order before navigation commits',async()=>{
  const {c}=navigation(),snapshots=[],finished=[];let timer;
  c.setTimeout=callback=>(timer=callback,42);
  c.chatApiCall=(action,payload)=>{snapshots.push(plain(payload));return new Promise(resolve=>finished.push(resolve));};
  vm.runInContext(fn('saveCurrentChat'),c);c.saveCurrentChat();timer();
  c.msgs[0].text='newest edit';c.saveCurrentChat();const moving=c.beginNewChat();
  assert.equal(snapshots.length,1);finished[0]({ok:true});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(snapshots.length,2);assert.equal(snapshots[1].messages[0].text,'newest edit');
  assert.equal(c.currentChatId,'original-chat');finished[1]({ok:true});assert.equal(await moving,true);assert.equal(c.msgs.length,0);
});
test('incognito never reads saved memory',async()=>{
  const c=vm.createContext({_incognitoMode:true,_cachedMemory:'SAVED_MEMORY',fetch(){throw Error('must not read memory');}});
  vm.runInContext(fn('loadMemory'),c);assert.equal(await c.loadMemory(),'');assert.equal(c._cachedMemory,null);
});
test('serializing ordinary user image attachments retains their previews without duplicating generated images',()=>{
  const src='data:image/png;base64,aGVsbG8=',c=vm.createContext({msgs:[{uid:1,isUser:true,imgSrcs:[src]},{uid:2,isUser:true,imgSrc:src},{uid:3,imgItems:[{data:'aGVsbG8=',mime:'image/png'}],imgData:'aGVsbG8='}]});
  vm.runInContext(fn('serializeMsgs'),c);const saved=plain(c.serializeMsgs());
  assert.deepEqual(saved[0].imgSrcs,[src]);assert.deepEqual(saved[1].imgSrcs,[src]);assert.equal(saved[2].imgData,undefined);
});
test('a stale visible model or effort prevents a paid request and retains the draft',async()=>{
  for(const [actual,effort] of [['claude-sonnet-5-5','high'],['gpt-6.1-sol','medium']]){
    const nodes=new Map(),notices=[],$=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
    $('aaTopic').value='do not lose this draft';$('aaUsername').value='tester';
    $('aaChatModelBtn').dataset={selectedModel:'gpt-6.1-sol',selectedEffort:'low'};
    const c=vm.createContext({$,scopeSwitchPending:false,chatNavigationPending:false,privacySwitchPending:false,aaRunning:false,skillSubmitPending:false,
      debate:false,imageMode:false,videoMode:false,activeProjectId:null,currentChatId:'chat-1',msgs:[],sentImgs:[],sentTexts:[],activeQuote:null,
      skillsRuntime:{settings:()=>({mode:'off',ids:[]}),ready:async()=>{}},flushScopeChat:async()=>({ok:true}),getPass:()=> 'synthetic',getActiveSubmodels:()=>[actual],effortFor:()=>effort,
      syncBrandUI(){},updateSkillsBtn(){},arenaNotice:message=>notices.push(message),fetch(){throw Error('must not call provider');}});
    const start=html.indexOf('  async function aaStart(){'),end=html.indexOf("    if(debate&&debateMode==='free'",start);
    vm.runInContext(html.slice(start,end)+'\n  }',c);await c.aaStart();
    assert.match(notices.at(-1),/模型或思考深度已变化/);assert.equal($('aaTopic').value,'do not lose this draft');assert.equal(c.msgs.length,0);assert.equal(c.aaRunning,false);
  }
});
function skills(){
  const data=new Map(),nodes=new Map();let user='alias';
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id);};
  const c=vm.createContext({btoa:s=>Buffer.from(s,'binary').toString('base64'),Uint8Array,
    document:{getElementById:node},localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),key:i=>[...data.keys()][i],get length(){return data.size;}}});c.window=c;
  vm.runInContext(fs.readFileSync(__dirname+'/arena-skills.js','utf8'),c);
  const runtime=c.ArenaSkills.install({auth:()=>({username:user}),scope:()=> 'general',mode:()=> 'chat',notice(){}});
  return {runtime,data,user(value){user=value;}};
}
test('resolving a login alias preserves the current explicit Skill choice instead of reviving stale canonical settings',()=>{
  const f=skills();f.data.set('aa-skills-v2:alias:general:chat',JSON.stringify({mode:'off',ids:[]}));
  f.data.set('aa-skills-v2:stable:general:chat',JSON.stringify({mode:'manual',ids:['pptx']}));
  f.runtime.migrateAccount('alias','stable');f.user('stable');assert.equal(f.runtime.settings().mode,'off');
});
test('another tab cannot silently replace the current composer Skill choice through shared storage',()=>{
  const f=skills(),key='aa-skills-v2:alias:general:chat';f.data.set(key,JSON.stringify({mode:'off',ids:[]}));
  assert.equal(f.runtime.settings().mode,'off');f.data.set(key,JSON.stringify({mode:'manual',ids:['pptx']}));
  assert.equal(f.runtime.settings().mode,'off');
  f.runtime.migrateAccount('alias','stable');f.user('stable');assert.equal(f.runtime.settings().mode,'off');
});
test('an attachment still being read during account canonicalization remains available and can still be cleared',async()=>{
  for(const clear of [false,true]){
    const f=skills();let done;const bytes=new Promise(resolve=>done=resolve);
    f.runtime.capture({name:'input.txt',type:'text/plain',arrayBuffer:()=>bytes});
    const waiting=f.runtime.ready();f.runtime.migrateAccount('alias','stable');f.user('stable');if(clear)f.runtime.clear();
    done(new TextEncoder().encode('hello').buffer);await waiting;
    assert.equal(f.runtime.filesForTexts(['[文件: input.txt] hello']).length,clear?0:1);
  }
});
test('legacy PPT export rejects JavaScript expressions instead of evaluating model output',async()=>{
  const alerts=[],c=vm.createContext({window:{},fromB64Utf8:()=>'{"title": (window.EXECUTED=true),"slides":[]}',alert:message=>alerts.push(message)});
  const start=html.indexOf('  window._aaGeneratePPT = async function'),end=html.indexOf('\n  };',start)+5;
  vm.runInContext(html.slice(start,end),c);await c.window._aaGeneratePPT(null,'synthetic');
  assert.equal(c.window.EXECUTED,undefined);assert.match(alerts[0],/PPT 数据格式有误/);
});
test('editing a reloaded image message restores every attachment and its original quote',()=>{
  const images=['data:image/png;base64,aGVsbG8=','data:image/webp;base64,d29ybGQ='],nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'edited question',style:{},scrollHeight:20});return nodes.get(id);};
  let sent,quote;
  const c=vm.createContext({window:{},document:{getElementById:$},$,aaRunning:false,msgs:[{uid:1,isUser:true,imgSrcs:images,_quote:{author:'Source',text:'original quote'}}],
    setQuote:(author,text)=>quote={author,text},clearQuote(){quote=null;},renderImgPreviews(){},renderTextPreviews(){},render(){},aaStart(){sent=plain(c.sentImgs);}});
  const start=html.indexOf('  window._aaConfirmEditMsg = function'),end=html.indexOf('\n  };',start)+5;
  vm.runInContext(html.slice(start,end),c);c.window._aaConfirmEditMsg(1);
  assert.equal(sent.length,2);assert.deepEqual(sent.map(x=>x.preview),images);assert.deepEqual(quote,{author:'Source',text:'original quote'});
});
test('the installed app and its update endpoint identify the same release',()=>{
  const version=JSON.parse(fs.readFileSync(__dirname+'/app-version.json','utf8')).version;
  assert.equal(html.match(/<meta name="app-version" content="([^"]+)"/)[1],version);
});
test('login makes the app behind its modal inaccessible until authentication succeeds',()=>{
  const overlay=element(),main=element(),sidebar=element(),nodes={'aaLoginOverlay':overlay,'ai-arena-app':{children:[overlay,main,sidebar]},aaLoginUser:element()};
  const c=vm.createContext({$:id=>nodes[id],setTimeout:fn=>fn(),updateGearBtn(){},syncArenaNavigation(){}});
  vm.runInContext(fn('showLoginOverlay')+'\n'+fn('showMainUI'),c);c.showLoginOverlay();
  assert.equal(main.inert,true);assert.equal(sidebar.inert,true);assert.notEqual(overlay.inert,true);
  c.showMainUI();assert.equal(main.inert,false);assert.equal(sidebar.inert,false);assert.equal(overlay.style.display,'none');
  assert.match(html,/<div id="aaLoginOverlay" role="dialog" aria-modal="true"/);
});
