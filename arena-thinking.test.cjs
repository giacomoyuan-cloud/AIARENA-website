const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
function fn(name){return source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0];}
function fixture(){
  let now=1000,content=null,details=null,removed=0;
  const label={textContent:''},clock={textContent:''},messages={scrollHeight:900,scrollTop:0};
  const row={dataset:{think:'model',phase:'waiting',startedAt:'1000',lastContentAt:'1000',generationKey:''},
    querySelector:q=>q==='.arena-progress-label'?label:q==='.arena-progress-time'?clock:q==='.aa-reasoning-block'?details:content,
    appendChild(value){details=value;content=value.querySelector('.aa-reasoning-content');}};
  const context=vm.createContext({Date:{now:()=>now},String,Number,Math,URL,window:{},msgs:[],userScrolledUp:false,thinkingClock:1,lastChatConnectionState:null,
    arenaNotice:()=>{},SUBS:{model:{name:'Test'}},syncKitten(){throw new Error('same generation must retain its existing progress');},hideThink(){removed++;},
    esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),activeProjectId:null,
    clearInterval(){},$:id=>id==='aaMessages'?messages:{querySelector:()=>row},
    document:{querySelector:()=>row,querySelectorAll:()=>[row],createElement(){const body={textContent:'',scrollTop:0,scrollHeight:100,clientHeight:100},toggle={textContent:'思考摘要'};return {open:false,querySelector:selector=>selector==='summary'?toggle:body};}}
  });
  vm.runInContext(source.match(/var AVAILABLE_CHAT_MODELS = \[[^\]]+\];/)[0],context);
  vm.runInContext(['paintThinkStatus','tickThinkingClock','showThink','updateThinkStatus','appendThinkSummary','chatRunConnectionState','syncActivityDisclosure','renderMessageActivity','rememberActivityToggle','updateMessageActivity','beginStreamedReply','cleanThinkTags','serializeMsgs','paintFinalMsg'].map(fn).join('\n'),context);
  return {context,row,label,clock,messages,advance:ms=>{now+=ms;},summary:()=>({details,content}),removed:()=>removed};
}

test('the timer reports total elapsed time and no content is described as a reasoning summary',()=>{
  const f=fixture();f.context.tickThinkingClock();assert.equal(f.label.textContent,'正在等待模型响应');assert.equal(f.summary().details,null);
  f.advance(243000);f.context.tickThinkingClock();assert.equal(f.clock.textContent,'总用时 243秒');assert.equal(f.label.textContent,'仍在等待模型响应');
  f.context.updateThinkStatus('model','thinking');assert.equal(f.label.textContent,'正在思考');
  f.advance(45000);f.context.tickThinkingClock();assert.equal(f.label.textContent,'等待模型继续返回内容');
  f.context.appendThinkSummary('model','服务商刚返回的摘要。');assert.equal(f.label.textContent,'正在思考');
});

test('a real summary opens immediately, appends incrementally and respects manual collapse',()=>{
  const f=fixture();f.context.appendThinkSummary('model','第一段');
  assert.equal(f.summary().details.open,true);assert.equal(f.summary().content.textContent,'第一段');
  f.summary().details.open=false;f.context.appendThinkSummary('model','，第二段');
  assert.equal(f.summary().details.open,false);assert.equal(f.summary().content.textContent,'第一段，第二段');
  f.summary().details.open=true;f.context.updateThinkStatus('model','responding');
  assert.equal(f.summary().details.open,false);assert.equal(f.summary().content.textContent,'第一段，第二段');
  assert.equal(f.summary().details.querySelector('summary').textContent,'已思考');
  const g=fixture();g.context.appendThinkSummary('model','');assert.equal(g.summary().details,null);
});

test('reading an earlier summary fragment is not pulled back to the bottom by new text',()=>{
  const f=fixture();f.context.appendThinkSummary('model','前文');const body=f.summary().content;
  body.scrollHeight=500;body.clientHeight=100;body.scrollTop=70;f.context.userScrolledUp=true;f.messages.scrollTop=20;
  f.context.appendThinkSummary('model','后文');assert.equal(body.scrollTop,70);assert.equal(f.messages.scrollTop,20);
});

test('reconnect status overrides the last model phase until connected again',()=>{
  const f=fixture();f.context.updateThinkStatus('model','searching');f.context.chatRunConnectionState('reconnecting');
  assert.equal(f.label.textContent,'连接恢复中');f.advance(46000);f.context.tickThinkingClock();assert.equal(f.label.textContent,'连接恢复中');
  f.context.chatRunConnectionState('connected');assert.equal(f.label.textContent,'等待模型继续返回内容');
  f.context.updateThinkStatus('model','responding');assert.equal(f.label.textContent,'正在生成回答');
});

test('repeated snapshots of the same generation retain its clock and expanded summary',()=>{
  const f=fixture();f.context.appendThinkSummary('model','摘要');f.advance(5000);f.context.showThink('model');
  assert.equal(f.removed(),0);assert.equal(f.row.dataset.startedAt,'1000');assert.equal(f.summary().content.textContent,'摘要');
});

test('summaries open during thinking and collapse into a completed label when answering starts',()=>{
  const f=fixture(),message={reasoning:'公开摘要 <script>unsafe</script>',run:{status:'running'}};
  const html=f.context.renderMessageActivity(message);
  assert.match(html,/arena-operation-details" open/);assert.equal((html.match(/<details/g)||[]).length,1);assert.match(html,/<summary>思考摘要<\/summary>/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);
  message.text='正文开始';
  const answering=f.context.renderMessageActivity(message);
  assert.equal(answering.includes('" open'),false);assert.match(answering,/<summary>已思考<\/summary>/);assert.match(answering,/公开摘要/);
  message.run.status='completed';message.completedAt=10000;assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
  const restored={reasoning:'恢复的摘要',text:'已经完成的正文',completedAt:10000};
  assert.equal(f.context.renderMessageActivity(restored).includes('" open'),false);
});

test('phase notifications and blank summaries never create empty thinking records',()=>{
  const f=fixture();
  for(const reasoning of [undefined,'','  \n\t']){
    assert.equal(f.context.renderMessageActivity({reasoning,activity:[{kind:'thinking',label:'模型思考'},{kind:'searching',label:'搜索网页'}]}),'');
  }
  const html=f.context.renderMessageActivity({activity:[{kind:'thinking',label:'模型思考'},{kind:'search',label:'搜索网页',query:'example'}]});
  assert.equal(html.includes('模型思考'),false);assert.match(html,/<summary>搜索记录<\/summary>/);assert.match(html,/<p>example<\/p>/);
});

test('the automatic fold runs once and later manual reopening survives answer updates and completion',()=>{
  const f=fixture(),message={uid:7,reasoning:'公开摘要',run:{status:'running'}};
  f.context.msgs=[message];
  f.context.renderMessageActivity(message);
  const details={open:true},row={dataset:{uid:'7'}},summary={parentElement:details,closest:()=>row};
  f.context.rememberActivityToggle({target:{closest:()=>summary}});
  message.reasoning+='后续片段';
  assert.equal(message._activityOpen,false);assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
  message.text='开始回答';assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
  details.open=false;f.context.rememberActivityToggle({target:{closest:()=>summary}});
  assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
  message.text+='，后续文字';message.run.status='completed';message.completedAt=20000;
  assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
});

test('streaming summary updates reuse their DOM node without replacing the disclosure',()=>{
  const f=fixture();let writes=0,text='第一段';
  const body={get textContent(){return text;},set textContent(value){writes++;text=value;},scrollTop:50,scrollHeight:500,clientHeight:100};
  const details={open:false,querySelector:()=>body,replaceWith(){throw Error('summary disclosure must remain mounted');}};
  const el={querySelector:()=>details};
  const message={reasoning:text,run:{status:'running'}};f.context.renderMessageActivity(message);message._activityOpen=false;
  f.context.document.createElement=()=>{throw Error('summary text updates must not rebuild markup');};
  f.context.updateMessageActivity(el,message,text);assert.equal(writes,0);
  message.reasoning='第一段，第二段';f.context.updateMessageActivity(el,message,message.reasoning);
  assert.equal(writes,1);assert.equal(body.textContent,'第一段，第二段');assert.equal(body.scrollTop,50);assert.equal(details.open,false);
});

test('a stale empty status panel is removed instead of left visible',()=>{
  const f=fixture();let removed=0;
  const existing={querySelector:()=>null,remove(){removed++;}};
  f.context.document.createElement=()=>({firstElementChild:null});
  f.context.updateMessageActivity({querySelector:()=>existing},{activity:[{kind:'thinking'}]},undefined);
  assert.equal(removed,1);
});

test('structural activity updates restore the summary scroll only after mounting its new node',()=>{
  const f=fixture();let mounted=false,scroll=0;
  const previous={scrollTop:70,scrollHeight:600,clientHeight:100};
  const next={scrollHeight:700,get scrollTop(){return scroll;},set scrollTop(value){assert.equal(mounted,true);scroll=value;}};
  const replacement={open:true};
  const existing={open:true,querySelector:()=>previous,replaceWith(node){assert.equal(node,replacement);mounted=true;previous.scrollTop=0;previous.scrollHeight=0;previous.clientHeight=0;}};
  const message={reasoning:'新摘要',run:{status:'running'},_activityDirty:true};f.context.renderMessageActivity(message);
  f.context.document.createElement=()=>({firstElementChild:replacement,querySelector:()=>next});
  f.context.updateMessageActivity({querySelector:()=>existing},message,'新摘要');
  assert.equal(scroll,70);
});

test('official chat finalization preserves both provider summaries and the exact answer text',()=>{
  const f=fixture(),answer='<think>literal example</think>\n正文。\n🎉'.repeat(25)+"\nLet's go. flow is ready. This is quoted text.";
  for(const submodel of f.context.AVAILABLE_CHAT_MODELS){
    const message={submodel,text:answer,reasoning:'来自服务商独立字段的公开摘要'};
    f.context.cleanThinkTags(message);
    assert.equal(message.text,answer,submodel);assert.equal(message.reasoning,'来自服务商独立字段的公开摘要',submodel);
  }
});

test('the first answer and summary-only completions retain the pending summary collapse choice',()=>{
  const f=fixture(),message={uid:9,text:'',reasoning:'已收到的公开摘要'};let renders=0,hidden=0;
  f.context.document.querySelector=()=>({open:false});
  f.context.hideThink=()=>{hidden++;};f.context.render=()=>{renders++;};
  f.context.beginStreamedReply('model',message);
  assert.equal(f.context.msgs[0],message);assert.equal(message._activityOpen,false);assert.equal(message.reasoning,'已收到的公开摘要');
  message.text='正文开始';f.context.beginStreamedReply('model',message);
  assert.equal(f.context.msgs.length,1);assert.equal(hidden,2);assert.equal(renders,2);
  assert.match(source,/if\(firstChunk\)\{\s*if\(typeof msgObj\.reasoning==='string'&&msgObj\.reasoning\.trim\(\)\)\{firstChunk=false;beginStreamedReply\(sub,msgObj\);\}/);
});

test('all chat providers auto-fold once, preserve the summary, and can reopen for another thinking phase',()=>{
  const f=fixture();
  for(const submodel of ['claude-sonnet-5-5','gemini-4-argon','grok-4.7','gpt-6.1-sol']){
    const message={submodel,reasoning:'真实摘要',_activityPhase:'thinking'};
    assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
    message._activityPhase='responding';message.text='回答';
    assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
    message._activityOpen=true;message.text+='下一段';
    assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
    message._activityPhase='searching';assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
    message._activityPhase='done';message.completedAt=10000;
    assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);assert.equal(message.reasoning,'真实摘要');
  }
});

test('thinking and search completion collapse to the exact requested label without deleting content',()=>{
  const f=fixture(),message={reasoning:'查询后的真实摘要',activity:[{kind:'search_results',label:'已搜索网页',sources:[{url:'https://example.com',title:'合成来源'}]}],run:{status:'running'}};
  assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
  message.text='正文';const html=f.context.renderMessageActivity(message);
  assert.equal(html.includes('" open'),false);assert.match(html,/<summary>已思考，已搜索网页<\/summary>/);assert.match(html,/查询后的真实摘要/);assert.match(html,/https:\/\/example.com/);
});

test('a completed reply without a public summary has an honest non-expandable status for each provider',()=>{
  const f=fixture();
  for(const submodel of ['claude-sonnet-5-5','gemini-4-argon','grok-4.7','gpt-6.1-sol']){
    const message={submodel,text:'直接回答',completedAt:1000,activity:[{kind:'thinking',label:'模型思考'}]};
    const html=f.context.renderMessageActivity(message);
    assert.match(html,/本轮未提供思考摘要/);assert.doesNotMatch(html,/<details\b|<summary\b|已思考/);
    message.reasoning='本轮确实收到的摘要';
    const actual=f.context.renderMessageActivity(message);
    assert.match(actual,/<summary>已思考<\/summary>/);assert.match(actual,/本轮确实收到的摘要/);assert.doesNotMatch(actual,/未提供思考摘要/);
  }
});

test('waiting, failed, cancelled, user and image messages do not claim a missing chat summary',()=>{
  const f=fixture(),base={submodel:'claude-sonnet-5-5',text:'回答'};
  for(const extra of [{},{completedAt:1000,isError:true},{completedAt:1000,isUser:true},{completedAt:1000,run:{status:'cancelled'}},{completedAt:1000,submodel:'gemini-nano-banana-2.1'}]){
    assert.equal(f.context.renderMessageActivity({...base,...extra}),'');
  }
});

test('a second turn without a summary preserves the first turn through saving and reloading',()=>{
  const f=fixture();
  f.context.msgs=[{uid:1,isUser:true,text:'第一问'},{uid:2,submodel:'claude-sonnet-5-5',text:'第一答',reasoning:'第一轮真实摘要',completedAt:1000},{uid:3,isUser:true,text:'第二问'},{uid:4,submodel:'claude-sonnet-5-5',text:'第二答',reasoning:'',completedAt:2000,activity:[{kind:'thinking'}]}];
  f.context.msgs[1]._activityOpen=true;
  const saved=JSON.parse(JSON.stringify(f.context.serializeMsgs()));
  assert.equal(saved[1].reasoning,'第一轮真实摘要');assert.equal(saved[3].reasoning,'');
  const first=f.context.renderMessageActivity(saved[1]),second=f.context.renderMessageActivity(saved[3]);
  assert.match(first,/第一轮真实摘要/);assert.match(first,/<summary>已思考<\/summary>/);
  assert.match(second,/本轮未提供思考摘要/);assert.doesNotMatch(second,/第一轮真实摘要|<details\b/);
});

test('a streamed direct answer paints its no-summary status at completion without waiting for a reload',()=>{
  const f=fixture(),body={dataset:{}},el={querySelector:q=>q==='.aa-msg-body'?body:null};
  const message={uid:4,submodel:'claude-sonnet-5-5',text:'第二答',reasoning:'',activity:[]};let status='';
  f.context.msgs=[message];f.context.currentChatId=null;f.messages.querySelector=()=>el;
  f.context.renderMd=value=>value;f.context.highlightCodeBlocks=()=>{};
  f.context.updateMessageActivity=(element,msg)=>{assert.equal(element,el);status=f.context.renderMessageActivity(msg);};
  f.context.paintFinalMsg(4,message.text,false,'');
  assert.match(status,/本轮未提供思考摘要/);assert.equal(body.innerHTML,'第二答');assert.equal(body.dataset.streaming,'false');
});
