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
  const context=vm.createContext({Date:{now:()=>now},String,Number,Math,window:{},userScrolledUp:false,thinkingClock:1,lastChatConnectionState:null,
    arenaNotice:()=>{},SUBS:{model:{name:'Test'}},syncKitten(){throw new Error('same generation must retain its existing progress');},hideThink(){removed++;},
    esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),activeProjectId:null,
    clearInterval(){},$:id=>id==='aaMessages'?messages:{querySelector:()=>row},
    document:{querySelector:()=>row,querySelectorAll:()=>[row],createElement(){const body={textContent:'',scrollTop:0,scrollHeight:100,clientHeight:100};return {open:false,querySelector:()=>body};}}
  });
  vm.runInContext(['paintThinkStatus','tickThinkingClock','showThink','updateThinkStatus','appendThinkSummary','chatRunConnectionState','renderMessageActivity'].map(fn).join('\n'),context);
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

test('running and restored replies expose the public summary while completed replies remain collapsible',()=>{
  const f=fixture(),message={reasoning:'公开摘要 <script>unsafe</script>',run:{status:'running'}};
  const html=f.context.renderMessageActivity(message);
  assert.match(html,/arena-operation-details" open/);assert.match(html,/arena-operation-row" open/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);
  message.run.status='completed';assert.equal(f.context.renderMessageActivity(message).includes('" open'),false);
  delete message.run;message.debateStatus='running';assert.match(f.context.renderMessageActivity(message),/arena-operation-details" open/);
});
