const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Modes=require('./arena-chat-mode.js'),Image=require('./arena-image.js');
const source=fs.readFileSync(__dirname+'/index.html','utf8');
const fn=name=>source.match(new RegExp('  (?:async )?function '+name+'\\([^]*?\\n  }'))?.[0]||'';
const imageMessages=[{uid:1,isUser:true,text:'小狗'},{uid:2,submodel:'gpt-image-2.5-flare',imgItems:[{data:'synthetic',mime:'image/png'}],imageTurn:{prompt:'小狗'}}];

test('history classification uses recorded message types, including old images and debate checkpoints',()=>{
  assert.deepEqual(Modes.infer(imageMessages),{mode:'image',model:'gpt-image-2.5-flare'});
  for(const message of [{imageTurn:{}},{imageResponse:[]},{imgData:'synthetic'},{submodel:'grok-imagine-image-2.0',isError:true},{submodel:'nanbanana2-official'}])assert.equal(Modes.infer([message]).mode,'image');
  assert.equal(Modes.infer([{submodel:'nanbanana2-official'}]).model,Image.GOOGLE_MODEL);
  for(const message of [{isUser:true,debateRun:{id:'run'}},{debateSessionId:'session'},{participantId:'seat-1'},{_team:'pro'},{brand:'judge'}])assert.equal(Modes.infer([message]).mode,'debate');
  assert.deepEqual(Modes.infer([{isUser:true,chatMode:'image',submodel:'gpt-image-2.5-flare'}]),{mode:'image',model:'gpt-image-2.5-flare'});
});
test('ordinary attachments and round zero do not turn a text conversation into image or debate mode',()=>{
  assert.equal(Modes.infer([{isUser:true,imgSrc:'reference'},{submodel:'gpt-6.1-sol',text:'回答',round:0}]).mode,'chat');
  assert.equal(Modes.infer([...imageMessages,{submodel:'claude-sonnet-5-5',text:'后来的普通回答'}]).mode,'chat');
  assert.equal(Modes.infer([{chatMode:'toString'}]).mode,'chat');
  assert.equal(Modes.infer([null,false]).mode,'chat');
});
function fixture(overrides={}){
  const elements=new Map(),events=new Map(),calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},classList:{add(){},remove(){},toggle(){}},addEventListener:(event,handler)=>events.set(id+':'+event,handler)});return elements.get(id);};
  const noop=()=>{};
  const c=vm.createContext({ArenaChatMode:Modes,ArenaImage:Image,window:{},document:{querySelectorAll:()=>[]},$:element,
    aaRunning:false,scopeSwitchPending:false,activeProjectId:null,scopeEpoch:1,chatLoadEpoch:0,_saveTimer:null,currentChatId:'previous',msgs:[],chatList:[],
    debate:true,imageMode:false,videoMode:false,debateMode:'free',imageComposerModel:'grok-imagine-image-2.0',imageComposerTask:'generation',imageEditParentUid:null,imageMaskState:null,
    sentImgs:[],sentTexts:[],brandSelection:{},activeBrands:{xai:true},AVAILABLE_CHAT_MODELS:['gpt-6.1-sol','claude-sonnet-5-5'],SUBS:{'gpt-6.1-sol':{brand:'openai'},'claude-sonnet-5-5':{brand:'anthropic'}},
    chatApiCall:async()=>({messages:imageMessages}),getLastAssistantReplyAt:()=>0,rememberChatReplyTime:noop,clearDebateView:noop,render:noop,
    renderImgPreviews:noop,syncImageComposer:noop,setImageError:noop,closeHistory:noop,forgetPendingChatRun:noop,
    syncImageCards:noop,syncBrandUI:noop,sync2v2UI:noop,syncNbOptions:noop,updateModeBadge:noop,saveState:noop,normalizeAvailableModels:noop,defaultTopicPlaceholder:()=>'',
    arenaNotice:message=>calls.push(['notice',message]),setGeneratedImageReference:(image,parent)=>{c.sentImgs=[{...image,autoFollowup:true}];c.imageEditParentUid=parent.uid;},
    flushScopeChat:async()=>{calls.push(['save']);return {ok:true};},beginNewChat:()=>{calls.push(['new']);c.currentChatId='new-chat';c.msgs=[];c.sentImgs=[];c.sentTexts=[];c.chatLoadEpoch++;},...overrides});
  vm.runInContext(fn('restoreChatMode')+'\n'+fn('prepareModeNavigation')+'\n'+fn('loadChat'),c);
  return {c,calls,events,element};
}
test('opening an image history from debate restores the image composer and original image model',async()=>{
  const {c}=fixture();assert.equal(await c.loadChat('image-chat'),true);
  assert.equal(c.imageMode,true);assert.equal(c.debate,false);assert.equal(c.imageComposerModel,'gpt-image-2.5-flare');
  assert.equal(c.sentImgs[0].autoFollowup,true);assert.equal(c.imageEditParentUid,2);
});
test('reopening the active image history repairs an already mismatched composer',async()=>{
  const {c}=fixture({currentChatId:'image-chat'});await c.loadChat('image-chat');assert.equal(c.imageMode,true);assert.equal(c.debate,false);
  assert.equal(c.imageEditParentUid,2);assert.equal(c.sentImgs[0].autoFollowup,true);
});
test('opening normal or debate history restores its mode and removes references from another image chat',async()=>{
  for(const [messages,expected] of [[[{uid:1,submodel:'gpt-6.1-sol',text:'普通回答'}],'chat'],[[{uid:1,isUser:true,debateRun:{id:'debate-run'}}],'debate']]){
    const {c}=fixture({imageMode:true,debate:false,sentImgs:[{generatedReference:true,data:'old-image'}],imageEditParentUid:99,imageComposerTask:'edit',chatApiCall:async()=>({messages})});
    await c.loadChat('target-chat');assert.equal(c.imageMode,false);assert.equal(c.debate,expected==='debate');assert.equal(c.sentImgs.length,0);assert.equal(c.imageEditParentUid,null);
  }
});
test('a stale history load cannot change the active conversation mode',async()=>{
  let finish;const {c}=fixture({chatApiCall:()=>new Promise(resolve=>finish=resolve)}),pending=c.loadChat('image-chat');c.scopeEpoch++;
  finish({messages:imageMessages});assert.equal(await pending,false);assert.equal(c.debate,true);assert.equal(c.imageMode,false);
});
for(const [button,target] of [['Debate','debate'],['Image','image'],['Chat','chat'],['Video','video']])test('sidebar '+target+' navigation starts a separate conversation after saving existing messages',async()=>{
  const {c,calls,events}=fixture({debate:target!=='debate',imageMode:target==='debate',msgs:imageMessages});
  const start=source.indexOf("$('aaBar"+button+"Btn').addEventListener('click',"),end=source.indexOf('\n  });',start)+6;
  vm.runInContext(source.slice(start,end),c);await events.get('aaBar'+button+'Btn:click')();
  assert.deepEqual(calls.map(call=>call[0]),['save','new']);assert.equal(c.msgs.length,0);assert.equal(c.currentChatId,'new-chat');
});
test('failed save or navigation during generation keeps the original conversation intact',async()=>{
  const {c,calls}=fixture({msgs:imageMessages,flushScopeChat:async()=>({ok:false})});
  assert.equal(typeof c.prepareModeNavigation,'function');assert.equal(await c.prepareModeNavigation('chat'),false);assert.equal(c.msgs,imageMessages);assert.ok(!calls.some(call=>call[0]==='new'));
  c.aaRunning=true;assert.equal(await c.prepareModeNavigation('image'),false);assert.equal(c.msgs,imageMessages);
});
test('switching scope while a mode-navigation save is pending cancels the stale navigation',async()=>{
  let finish;const {c,calls}=fixture({msgs:imageMessages,flushScopeChat:()=>new Promise(resolve=>finish=resolve)});
  assert.equal(typeof c.prepareModeNavigation,'function');const pending=c.prepareModeNavigation('chat');c.activeProjectId='another-project';finish({ok:true});
  assert.equal(await pending,false);assert.ok(!calls.some(call=>call[0]==='new'));
});
test('legacy history classification stays bounded, caches by account/scope/revision and ignores stale results',async()=>{
  const batchSizes=[],chats=Array.from({length:19},(_,i)=>({id:'history-'+i,updatedAt:123}));
  const {c}=fixture({chatList:chats,chatListEpoch:1,historyModeCache:new Map(),scopeViewKey:scope=>'tester:'+(scope||'general'),renderHistoryList(){},
    chatApiCall:async(action,{chatIds})=>{batchSizes.push(chatIds.length);return {modes:chatIds.map(id=>({id,mode:'image'}))};}});
  vm.runInContext(fn('hydrateHistoryModes'),c);await c.hydrateHistoryModes(null,1,1);assert.deepEqual(batchSizes,[8,8,3]);assert.ok(chats.every(chat=>chat.mode==='image'));
  c.chatList=chats.map(({mode,...chat})=>chat);await c.hydrateHistoryModes(null,1,1);assert.deepEqual(batchSizes,[8,8,3]);assert.ok(c.chatList.every(chat=>chat.mode==='image'));
  let finish;c.chatList=[{id:'other-chat',updatedAt:456}];c.chatApiCall=()=>new Promise(resolve=>finish=resolve);
  const pending=c.hydrateHistoryModes(null,1,1);c.scopeEpoch++;finish({modes:[{id:'other-chat',mode:'image'}]});await pending;assert.equal(c.chatList[0].mode,undefined);
});
test('history type cache survives reload, isolates account and project keys and never stores content',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const cache=Modes.createCache(storage);cache.set('alice:general:shared',{mode:'image',updatedAt:123,text:'PRIVATE_PROMPT',password:'PRIVATE_CREDENTIAL'});
  cache.set('bob:general:shared',{mode:'chat',updatedAt:456});cache.set('alice:project-1:shared',{mode:'debate',updatedAt:789});
  const reloaded=Modes.createCache(storage);assert.deepEqual(reloaded.get('alice:general:shared'),{mode:'image',updatedAt:123});
  assert.equal(reloaded.get('bob:general:shared').mode,'chat');assert.equal(reloaded.get('alice:project-1:shared').mode,'debate');assert.equal(reloaded.get('alice:project-2:shared'),undefined);
  assert.ok(!values.get('aa-history-modes-v1').includes('PRIVATE_'));
  for(let i=0;i<605;i++)cache.set('alice:general:bounded-'+i,{mode:'image',updatedAt:i});
  assert.equal(JSON.parse(values.get('aa-history-modes-v1')).length,600);
  const blocked=Modes.createCache({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});blocked.set('test',{mode:'chat',updatedAt:1});assert.equal(blocked.get('test').mode,'chat');
});
test('failed or unsupported classification ends the loading state instead of leaving ellipses forever',async()=>{
  const chats=Array.from({length:19},(_,i)=>({id:'history-'+i,updatedAt:123}));let requests=0;
  const {c}=fixture({chatList:chats,chatListEpoch:1,historyModeCache:new Map(),scopeViewKey:()=> 'tester:general',renderHistoryList(){},chatApiCall:async()=>{requests++;return {error:'Unknown action'};}});
  vm.runInContext(fn('hydrateHistoryModes'),c);await c.hydrateHistoryModes(null,1,1);
  assert.equal(requests,1);assert.ok(chats.every(chat=>Modes.badge(chat).label==='待识别'));assert.match(Modes.badge(chats[0]).title,/打开会话后/);
  assert.equal(Modes.badge({}).label,'识别中');assert.equal(Modes.badge({mode:'image'}).label,'图像');
});
test('history search accepts the visible conversation type as well as the title',()=>{
  assert.equal(Modes.matches({mode:'debate',title:'一个具体话题'},'辩论'),true);assert.equal(Modes.matches({mode:'image',title:'边牧'},'图像'),true);
  assert.equal(Modes.matches({mode:'chat',title:'Hello WORLD'},'world'),true);assert.equal(Modes.matches({title:'未识别记录'},'图像'),false);
});
test('repeated image/chat/debate history round trips restore mode, model and references without sending messages',async()=>{
  const records={image:imageMessages,chat:[{uid:10,submodel:'gpt-6.1-sol',text:'普通回复'}],debate:[{uid:20,isUser:true,debateRun:{id:'existing-run'}}]};
  const requests=[],{c}=fixture({chatApiCall:async(action,{chatId})=>{requests.push(action);return {messages:records[chatId]};}});
  for(const mode of ['image','chat','debate','image','debate','chat','image','chat','debate']){
    await c.loadChat(mode);assert.equal(c.imageMode,mode==='image');assert.equal(c.debate,mode==='debate');
    if(mode==='image'){assert.equal(c.imageComposerModel,'gpt-image-2.5-flare');assert.equal(c.imageEditParentUid,2);}
    else{assert.equal(c.sentImgs.length,0);assert.equal(c.imageEditParentUid,null);}
    if(mode==='chat')assert.equal(c.brandSelection.openai,'gpt-6.1-sol');
  }
  assert.deepEqual(requests,Array(9).fill('load'));
});
test('sidebar current-page marker and active class select exactly the restored mode',()=>{
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{classList:{contains:()=>false,toggle(name,value){this[name]=value;}},attrs:{},setAttribute(name,value){this.attrs[name]=value;}});return nodes.get(id);};
  const c=vm.createContext({$:get,window:{matchMedia:()=>({matches:false})},document:{querySelector:()=>({})},activeProjectId:null,scopeSwitchPending:false,debate:false,imageMode:false,videoMode:false});
  vm.runInContext(fn('syncArenaNavigation'),c);
  for(const mode of ['Image','Chat','Debate','Image','Debate','Chat']){
    c.imageMode=mode==='Image';c.debate=mode==='Debate';c.syncArenaNavigation();
    for(const name of ['Chat','Debate','Image','Video']){assert.equal(get('aaBar'+name+'Btn').classList.active,name===mode);assert.equal(get('aaBar'+name+'Btn').attrs['aria-current'],name===mode?'page':'false');}
  }
});
test('restoring a saved debate rehydrates its own seats, efforts and summary instead of the previous draft',()=>{
  const plan={mode:'free',rounds:1,members:[{id:'seat-1',model:'gpt-6.1-sol',effort:'low'},{id:'seat-2',model:'claude-sonnet-5-5',effort:'high'}],turns:[{summary:true,member:{model:'gpt-6-astra',effort:'medium'}}]};
  const view={ref:{id:'saved-debate'}},noop=()=>{};let current=true;
  const c=vm.createContext({debateCurrent:v=>current&&v===view,debate:false,imageMode:true,videoMode:false,debateMode:'persona',rounds:3,debateModels:['grok-4.7','grok-4.7'],debateSeatEfforts:{summary:'max'},judgeModel:'none',
    AVAILABLE_CHAT_MODELS:['gpt-6.1-sol','claude-sonnet-5-5','gpt-6-astra'],msgs:[],syncBrandUI:noop,sync2v2UI:noop,syncArenaLayout:noop,hideThink:noop,forgetDebate:noop,syncDebateRecovery:noop});
  vm.runInContext(fn('applyDebatePlan')+'\n'+fn('applyDebateSnapshot'),c);
  c.applyDebateSnapshot(view,{revision:1,status:'completed',plan,turns:[]},true);
  assert.equal(c.debate,true);assert.equal(c.imageMode,false);assert.equal(c.rounds,1);assert.deepEqual(Array.from(c.debateModels),['gpt-6.1-sol','claude-sonnet-5-5']);
  assert.equal(c.debateSeatEfforts['seat-1'],'low');assert.equal(c.debateSeatEfforts['seat-2'],'high');assert.equal(c.judgeModel,'gpt-6-astra');assert.equal(c.debateSeatEfforts.summary,'medium');
  c.debateModels=['grok-4.7','grok-4.7'];c.applyDebateSnapshot(view,{revision:2,status:'completed',turns:[]},false);assert.equal(c.debateModels[0],'grok-4.7');
  current=false;c.applyDebateSnapshot(view,{revision:3,status:'completed',plan,turns:[]},true);assert.equal(c.debateModels[0],'grok-4.7','a detached history response never changes the active composer');
});
