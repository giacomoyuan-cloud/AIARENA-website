const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const projectPage=fs.readFileSync('arena-project-page.js','utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function fn(name,source=html){
  const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));
  assert.notEqual(start,-1,name);
  let depth=0,end=source.indexOf('{',start);
  for(;end<source.length;end++){
    if(source[end]==='{')depth++;
    if(source[end]==='}'&&!--depth)break;
  }
  return source.slice(start,end+1);
}
function element(){
  const classes=new Set(),attributes=new Map();
  return {value:'',hidden:true,textContent:'',style:{},scrollTop:0,focus(){},setAttribute:(name,value)=>attributes.set(name,String(value)),getAttribute:name=>attributes.get(name)||null,hasAttribute:name=>attributes.has(name),
    classList:{contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);},add:name=>classes.add(name),remove:name=>classes.delete(name)}};
}
function fixture(){
  const nodes=new Map(),notices=[],requests=[],storage=new Map();let c;
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  get('aaUsername').value='qa-reader';get('aaTopic').value='general draft';
  c=vm.createContext({
    $:get,loginName:value=>value.trim(),getPass:()=> 'synthetic-password',WORKER:'/fixture',
    document:{querySelector:get},window:{matchMedia:()=>({matches:false})},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage:{setItem(){}},clearTimeout(){},
    activeProjectId:null,activeProject:null,scopeEpoch:0,chatLoadEpoch:0,chatListEpoch:0,
    currentChatId:'general-chat',msgs:[{uid:1,isUser:true,text:'general message'}],
    chatList:[{id:'general-chat'}],chatGroups:[{id:'general-group'}],chatListPinVersion:1,
    sentImgs:[{name:'general.png'}],sentTexts:[{name:'general.txt',text:'general material'}],
    activeQuote:{author:'reader',text:'general quote',color:'blue'},activeSkill:{id:'general-skill'},
    imageMaskState:{data:'general-mask'},imageEditParentUid:null,debate:false,imageMode:false,videoMode:false,debateMode:'free',
    activeBrands:{xai:true},brandSelection:{xai:'grok-4.7'},aaRunning:false,_saveTimer:null,
    _incognitoMode:false,_cachedMemory:'general memory',_memoryLoaded:true,_skipNextChatSave:false,
    chatPins:{version:()=>1},debateOwnsChat:()=>false,serializeMsgs:()=>plain(c.msgs),getChatTitle:()=> 'synthetic title',
    arenaNotice:text=>notices.push(text),clearDebateView(){},clearQuote:()=>{c.activeQuote=null;},
    setQuote:(author,text,color)=>{c.activeQuote={author,text,color};},hideSelectionMenu(){},
    closeHistorySearch(){get('aaHistorySearch').value='';},renderHistoryList(){},
    render(){},renderImgPreviews(){},renderTextPreviews(){},syncImageCards(){},syncBrandUI(){},
    sync2v2UI(){},updateModeBadge(){},updateSkillsBtn(){},syncArenaLayout(){},closeHistory(){},
    loadChatList:async()=>{},loadMemory:async()=>{},
    saveCurrentChat:()=>{c._saveTimer=2;},
    chatApiCall:async(action,extra)=>{requests.push({action,extra});return {ok:true};},
    projectApi:async(action,extra)=>({project:{id:extra.projectId,name:extra.projectId}}),
    getStoredReplyTimes:()=>({}),linkedChat:null
  });
  const start=html.indexOf('  var workspaceViews=new Map()');
  vm.runInContext(html.slice(start,html.indexOf('  var noticeTimer=',start)),c);
  vm.runInContext(fn('syncArenaNavigation')+'\n'+fn('updateProjectBar')+'\n'+fn('switchProject'),c);
  return {c,get,notices,requests,storage};
}
const A={id:'project-a',name:'Project A'},B={id:'project-b',name:'Project B'};

test('scope round trips restore only that scope draft, messages, attachments, quote and skill',async()=>{
  const {c,get}=fixture();
  await c.switchProject(A);
  assert.equal(c.activeProjectId,A.id);assert.equal(get('aaTopic').value,'');
  for(const field of ['msgs','sentImgs','sentTexts','chatList','chatGroups'])assert.equal(c[field].length,0,field);
  assert.equal(c.activeQuote,null);assert.equal(c.activeSkill,null);assert.equal(c._cachedMemory,null);
  assert.equal(c.imageMaskState,null);
  c.msgs=[{uid:3,text:'project message'}];c.sentTexts=[{name:'project.txt',text:'project material'}];
  c.imageMaskState={data:'project-mask'};
  get('aaTopic').value='project draft';c.currentChatId='project-chat';c.chatList=[{id:'project-chat'}];
  await c.switchProject(null);
  assert.equal(c.activeProjectId,null);assert.equal(get('aaTopic').value,'general draft');
  assert.equal(c.msgs[0].text,'general message');assert.equal(c.sentTexts[0].name,'general.txt');
  assert.equal(c.sentImgs[0].name,'general.png');assert.equal(c.activeQuote.text,'general quote');
  assert.equal(c.imageMaskState.data,'general-mask');
  assert.equal(c.activeSkill.id,'general-skill');assert.equal(c.chatList[0].id,'general-chat');
  assert.equal(get('aaProjectBar').hidden,true);assert.equal(get('aaProjectsBtn').classList.contains('active'),false);
  assert.equal(get('aaBarChatBtn').classList.contains('active'),true);
  await c.switchProject(A);
  assert.equal(get('aaTopic').value,'project draft');assert.equal(c.msgs[0].text,'project message');
  assert.equal(c.sentTexts[0].name,'project.txt');assert.equal(c.chatList[0].id,'project-chat');
  assert.equal(c.imageMaskState.data,'project-mask');
  assert.equal(get('aaBarChatBtn').classList.contains('active'),false);
});

test('new scope sidebars are empty immediately and late list responses cannot reappear after a round trip',async()=>{
  const {c}=fixture(),oldList=deferred();
  c.chatApiCall=action=>action==='list'?oldList.promise:Promise.resolve({groups:[]});
  vm.runInContext(fn('loadChatList'),c);
  const oldRequest=c.loadChatList();
  // Keep subsequent list reads pending independently from the request under test.
  c.loadChatList=async()=>{};
  await c.switchProject(A);assert.equal(c.chatList.length,0);
  await c.switchProject(null);assert.equal(c.chatList[0].id,'general-chat');
  oldList.resolve({chats:[{id:'stale-general'}]});await oldRequest;
  assert.equal(c.chatList[0].id,'general-chat');
});

test('opening a project home keeps its unsent draft while starting an independent conversation',async()=>{
  const {c,get}=fixture();let clearedFiles=0;
  Object.assign(c,{genChatId:()=> 'new-project-chat',hideThink(){},setImageError(){},syncKitten(){},skillsRuntime:{clear(){clearedFiles++;}}});
  c.activeProjectId=A.id;c.sentImgs.push({autoFollowup:true,name:'automatic.png'});
  vm.runInContext(fn('clearPreview')+'\n'+fn('beginNewChat'),c);c.beginNewChat({preserveDraft:true});
  assert.equal(c.activeProjectId,A.id);assert.equal(c.currentChatId,'new-project-chat');assert.equal(c.msgs.length,0);
  assert.equal(get('aaTopic').value,'general draft');assert.equal(c.sentTexts[0].name,'general.txt');
  assert.equal(c.sentImgs.length,1);assert.equal(c.sentImgs[0].name,'general.png');assert.equal(c.activeQuote.text,'general quote');
  assert.equal(c.imageMaskState.data,'general-mask');
  assert.equal(clearedFiles,0,'original Skill upload bytes must survive a project-home draft round trip');
  c.beginNewChat();assert.equal(get('aaTopic').value,'');assert.equal(c.sentTexts.length,0);
  assert.equal(c.sentImgs.length,0);assert.equal(c.activeQuote,null);
  assert.equal(c.imageMaskState,null);assert.equal(clearedFiles,1);
});

test('late project metadata cannot undo a newer return to general chat',async()=>{
  const {c,get}=fixture(),metadata=deferred();c.projectApi=()=>metadata.promise;
  const first=c.switchProject(A.id);assert.equal(c.scopeSwitchPending,true);
  assert.equal(await c.switchProject(null),true);
  metadata.resolve({project:A});assert.equal(await first,false);
  assert.equal(c.activeProjectId,null);assert.equal(get('aaTopic').value,'general draft');
  assert.equal(c.scopeSwitchPending,false);assert.equal(get('.aa-main').inert,false);
});

test('rapid destination changes share the outgoing save and only the latest destination commits',async()=>{
  const {c,requests}=fixture(),save=deferred();c._saveTimer=1;
  c.chatApiCall=(action,extra)=>{requests.push({action,extra});return save.promise;};
  const first=c.switchProject(A),second=c.switchProject(B);
  assert.equal(requests.length,1);assert.equal(requests[0].extra.projectId,null);
  assert.equal(c.activeProjectId,null);assert.equal(getScopeMessages(c),'general message');
  save.resolve({ok:true});assert.deepEqual(await Promise.all([first,second]),[false,true]);
  assert.equal(c.activeProjectId,B.id);assert.equal(c.scopeSwitchPending,false);
});
function getScopeMessages(c){return c.msgs.map(m=>m.text).join('');}

test('failed saves keep the original scope and data and remain retryable',async()=>{
  const {c,get,notices}=fixture();c._saveTimer=1;c.chatApiCall=async()=>null;
  assert.equal(await c.switchProject(A),false);
  assert.equal(c.activeProjectId,null);assert.equal(getScopeMessages(c),'general message');
  assert.equal(get('aaTopic').value,'general draft');assert.ok(c._saveTimer);
  assert.match(notices.at(-1),/保存失败/);assert.equal(c.scopeSwitchPending,false);
  c.chatApiCall=async()=>({ok:true});assert.equal(await c.switchProject(A),true);
});

test('failed project metadata leaves the old scope intact and releases the input lock',async()=>{
  const {c,get}=fixture();c.projectApi=async()=>{throw Error('synthetic offline');};
  assert.equal(await c.switchProject(A.id),false);assert.equal(c.activeProjectId,null);
  assert.equal(get('aaTopic').value,'general draft');assert.equal(c.scopeSwitchPending,false);
  assert.equal(get('.aa-main').inert,false);
});

test('switching while generating is rejected without touching the current scope',async()=>{
  const {c,get}=fixture();c.aaRunning=true;
  assert.equal(await c.switchProject(A),false);assert.equal(c.scopeEpoch,0);
  assert.equal(get('aaTopic').value,'general draft');assert.equal(c.workspaceViews.size,0);
});

test('per-scope caches do not restore another account data or share mutable model selections',async()=>{
  const {c,get}=fixture();await c.switchProject(A);
  c.brandSelection.xai='project-model';await c.switchProject(null);
  assert.equal(c.brandSelection.xai,'grok-4.7');
  c.brandSelection.xai='general-model';
  assert.equal(c.workspaceViews.get('qa-reader:general').mode.selection.xai,'grok-4.7');
  await c.switchProject(A);
  get('aaUsername').value='second-account';c.msgs=[];c.currentChatId=null;get('aaTopic').value='';
  await c.switchProject(null);
  assert.equal(get('aaTopic').value,'');assert.equal(c.msgs.length,0);assert.equal(c.sentTexts.length,0);
});

test('old memory responses are rejected even when returning to the same scope',async()=>{
  const {c}=fixture(),reads=[];c._memoryLoaded=false;
  c.fetch=async(url,options)=>{const result=deferred();reads.push({scope:JSON.parse(options.body).projectId,result});return {json:()=>result.promise};};
  vm.runInContext(fn('loadMemory'),c);
  const stale=c.loadMemory();await c.switchProject(A);await c.switchProject(null);
  reads[0].result.resolve({memory:'stale general'});assert.equal(await stale,'');
  reads[1].result.resolve({memory:'project secret'});await settle();
  assert.equal(c._cachedMemory,null);
  reads[2].result.resolve({memory:'fresh general'});await settle();
  assert.equal(c._cachedMemory,'fresh general');
});

test('pinned project current-page markers clear on exit and follow the actual scope',()=>{
  const pins=[A,B].map(p=>({dataset:{shortcut:p.id},current:false,setAttribute(){this.current=true;},removeAttribute(){this.current=false;}}));
  let scope=A.id;const c=vm.createContext({app:{currentScope:()=>scope},shortcuts:{querySelectorAll:()=>pins}});
  vm.runInContext(fn('syncScope',projectPage),c);c.syncScope();assert.deepEqual(pins.map(p=>p.current),[true,false]);
  scope=null;c.syncScope();assert.deepEqual(pins.map(p=>p.current),[false,false]);
  scope=B.id;c.syncScope();assert.deepEqual(pins.map(p=>p.current),[false,true]);
});

function navigation(){
  const nodes=new Map(),pending=[],seen=[],notices=[];let c;
  for(const id of ['aaNewBtn','aaBarChatBtn','aaBarDebateBtn','aaBarImageBtn','aaProjectExit']){
    const callbacks=[];
    nodes.set('#'+id,{addEventListener(type,fn,capture){callbacks.push({fn,capture});},click(){
      const ev={stopped:false,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};
      for(const entry of callbacks.filter(c=>c.capture).concat(callbacks.filter(c=>!c.capture))){entry.fn(ev);if(ev.stopped)break;}
    }});
    nodes.get('#'+id).addEventListener('click',()=>seen.push(id),false);
  }
  c=vm.createContext({epoch:0,owner:'one',running:false,scope:'project-a',hidden:false,
    host:{querySelector:id=>nodes.get(id)},key:()=>c.owner,notice:text=>notices.push(text),
    hide(){c.epoch++;c.hidden=true;},
    app:{busy:()=>c.running,currentScope:()=>c.scope,switchScope:scope=>{const result=deferred();pending.push({scope,result});return result.promise;}}
  });
  const start=projectPage.indexOf('    var replayingNavigation=false;');
  vm.runInContext(projectPage.slice(start,projectPage.indexOf('    return Object.assign',start)),c);
  return {c,nodes,pending,seen,notices};
}

test('every global sidebar destination exits project scope before the original handler runs',async()=>{
  for(const id of ['aaNewBtn','aaBarChatBtn','aaBarDebateBtn','aaBarImageBtn','aaProjectExit']){
    const {c,nodes,pending,seen}=navigation();nodes.get('#'+id).click();
    assert.equal(seen.length,0);assert.equal(pending[0].scope,null);assert.equal(c.hidden,true);
    c.scope=null;pending[0].result.resolve(true);await settle();
    assert.deepEqual(seen,id==='aaProjectExit'?[]:[id]);
  }
});

test('busy, failed, superseded and account-changed navigation never replays a stale action',async()=>{
  const busy=navigation();busy.c.running=true;busy.nodes.get('#aaBarChatBtn').click();
  assert.equal(busy.c.hidden,false);assert.equal(busy.pending.length,0);
  const failed=navigation();failed.nodes.get('#aaBarChatBtn').click();failed.pending[0].result.resolve(false);await settle();assert.equal(failed.seen.length,0);
  const latest=navigation();latest.nodes.get('#aaNewBtn').click();latest.nodes.get('#aaBarChatBtn').click();
  latest.c.scope=null;latest.pending[0].result.resolve(true);latest.pending[1].result.resolve(true);await settle();
  assert.deepEqual(latest.seen,['aaBarChatBtn']);
  const account=navigation();account.nodes.get('#aaBarChatBtn').click();account.c.owner='two';account.c.scope=null;
  account.pending[0].result.resolve(true);await settle();assert.equal(account.seen.length,0);
});
