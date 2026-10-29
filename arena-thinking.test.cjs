const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
function fn(name){return source.match(new RegExp('  function '+name+'\\([^]*?\\n  }'))[0];}
function fixture(){
  let now=1000,content=null,details=null,removed=0;
  const label={textContent:''},clock={textContent:''},messages={scrollHeight:900,scrollTop:0};
  const row={dataset:{think:'model',phase:'waiting',startedAt:'1000',lastContentAt:'1000',generationKey:''},
    querySelector:q=>q==='.arena-progress-label'?label:q==='.arena-progress-time'?clock:content,
    appendChild(value){details=value;content=value.querySelector('.aa-reasoning-content');}};
  const context=vm.createContext({Date:{now:()=>now},String,Number,Math,URL,window:{},msgs:[],userScrolledUp:false,thinkingClock:1,lastChatConnectionState:null,
    arenaNotice:()=>{},SUBS:{model:{name:'Test'}},syncKitten(){throw new Error('same generation must retain its existing progress');},hideThink(){removed++;},
    esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),activeProjectId:null,
    clearInterval(){},$:id=>id==='aaMessages'?messages:{querySelector:()=>row},
    document:{querySelector:()=>row,querySelectorAll:()=>[row],createElement(){const body={textContent:'',scrollTop:0,scrollHeight:100,clientHeight:100};return {open:false,querySelector:()=>body};}}
  });
  vm.runInContext(source.match(/var AVAILABLE_CHAT_MODELS = \[[^\]]+\];/)[0],context);
  vm.runInContext(['paintThinkStatus','tickThinkingClock','showThink','updateThinkStatus','appendThinkSummary','chatRunConnectionState','renderMessageActivity','rememberActivityToggle','updateMessageActivity','beginStreamedReply','cleanThinkTags'].map(fn).join('\n'),context);
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

test('real summaries stay visible through completion and require only one disclosure',()=>{
  const f=fixture(),message={reasoning:'公开摘要 <script>unsafe</script>',run:{status:'running'}};
  const html=f.context.renderMessageActivity(message);
  assert.match(html,/arena-operation-details" open/);assert.equal((html.match(/<details/g)||[]).length,1);assert.match(html,/<summary>思考摘要<\/summary>/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);
  message.run.status='completed';message.completedAt=10000;assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
  delete message.run;message.debateStatus='running';assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
});

test('phase notifications and blank summaries never create empty thinking records',()=>{
  const f=fixture();
  for(const reasoning of [undefined,'','  \n\t']){
    assert.equal(f.context.renderMessageActivity({reasoning,activity:[{kind:'thinking',label:'模型思考'},{kind:'searching',label:'搜索网页'}]}),'');
  }
  const html=f.context.renderMessageActivity({activity:[{kind:'thinking',label:'模型思考'},{kind:'search',label:'搜索网页',query:'example'}]});
  assert.equal(html.includes('模型思考'),false);assert.match(html,/<summary>搜索记录<\/summary>/);assert.match(html,/<p>example<\/p>/);
});

test('manual summary collapse survives new text, completion and full renders',()=>{
  const f=fixture(),message={uid:7,reasoning:'公开摘要',run:{status:'running'}};
  f.context.msgs=[message];
  const details={open:true},row={dataset:{uid:'7'}},summary={parentElement:details,closest:()=>row};
  f.context.rememberActivityToggle({target:{closest:()=>summary}});
  message.reasoning+='后续片段';message.run.status='completed';message.completedAt=20000;
  assert.equal(message._activityOpen,false);assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
  details.open=false;f.context.rememberActivityToggle({target:{closest:()=>summary}});
  assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
});

test('streaming summary updates reuse their DOM node without replacing the disclosure',()=>{
  const f=fixture();let writes=0,text='第一段';
  const body={get textContent(){return text;},set textContent(value){writes++;text=value;},scrollTop:50,scrollHeight:500,clientHeight:100};
  const details={open:false,querySelector:()=>body,replaceWith(){throw Error('summary disclosure must remain mounted');}};
  const el={querySelector:()=>details};
  f.context.document.createElement=()=>{throw Error('summary text updates must not rebuild markup');};
  f.context.updateMessageActivity(el,{reasoning:text},text);assert.equal(writes,0);
  f.context.updateMessageActivity(el,{reasoning:'第一段，第二段'},'第一段，第二段');
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
  f.context.document.createElement=()=>({firstElementChild:replacement,querySelector:()=>next});
  f.context.updateMessageActivity({querySelector:()=>existing},{reasoning:'新摘要',_activityDirty:true},'新摘要');
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
