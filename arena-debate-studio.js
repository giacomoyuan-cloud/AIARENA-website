(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaDebateStudio=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var effortNames={low:'Low · 快速',medium:'Medium · 均衡',high:'High · 深入',xhigh:'XHigh · 更深入',max:'Max · 最大'};
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function effort(member,values,choices,fallback){
    var allowed=choices[member.model]||[],value=values[member.id];
    return allowed.indexOf(value)!==-1?value:allowed.indexOf(fallback)!==-1?fallback:undefined;
  }
  function commonEfforts(members,choices){
    return ['low','medium','high','xhigh','max'].filter(function(level){return members.length&&members.every(function(m){return (choices[m.model]||[]).indexOf(level)!==-1;});});
  }
  function cleanDraft(value,models,choices){
    if(!value||typeof value!=='object')return null;
    function model(id){return models.indexOf(id)!==-1?id:null;}
    var members=Array.isArray(value.models)?value.models.slice(0,6).map(model):[];
    while(members.length<2)members.push(null);
    var roles=(Array.isArray(value.roles)?value.roles:[]).slice(0,6).map(function(r){r=r&&typeof r==='object'?r:{};return {model:model(r.model),role:String(r.role||'').slice(0,120),desc:String(r.desc||'').slice(0,500)};});
    while(roles.length<6)roles.push({model:null,role:'',desc:''});
    var teams={pro:[],con:[]};['pro','con'].forEach(function(t){teams[t]=[0,1].map(function(i){return model(value.teams&&value.teams[t]&&value.teams[t][i]);});});
    var efforts={};Object.keys(value.efforts||{}).slice(0,17).forEach(function(id){if(/^(seat-[1-6]|role-[1-6]|pro-[12]|con-[12]|summary)$/.test(id)&&['low','medium','high','xhigh','max'].indexOf(value.efforts[id])!==-1)efforts[id]=value.efforts[id];});
    return {mode:['free','persona','2v2'].indexOf(value.mode)!==-1?value.mode:'free',rounds:[1,2,3].indexOf(value.rounds)!==-1?value.rounds:2,models:members,roles:roles,
      roleCount:Number.isInteger(value.roleCount)&&value.roleCount>=2&&value.roleCount<=6?value.roleCount:2,teams:teams,efforts:efforts,summary:model(value.summary)||'none',
      objective:['explore','decision','stress-test'].indexOf(value.objective)!==-1?value.objective:'explore',detail:['concise','balanced','detailed'].indexOf(value.detail)!==-1?value.detail:'balanced',
      context:String(value.context||'').slice(0,6000),constraints:String(value.constraints||'').slice(0,2000)};
  }
  function settings(host,options){
    var doc=host.ownerDocument,dialog=host.querySelector('#aaDebateSettingsDialog');
    if(!dialog){dialog=doc.createElement('dialog');dialog.id='aaDebateSettingsDialog';dialog.className='arena-debate-settings-dialog';host.appendChild(dialog);}
    var s=options.state,common=options.common||[];
    function group(key,label,items,current){
      return '<fieldset class="wide"><legend>'+label+'</legend><div class="arena-debate-choice-group" role="radiogroup" aria-label="'+label+'">'+items.map(function(item){return '<button type="button" role="radio" data-debate-setting="'+key+'" value="'+item[0]+'" aria-checked="'+(current===item[0])+'" tabindex="'+(current===item[0]?0:-1)+'">'+item[1]+'</button>';}).join('')+'</div></fieldset>';
    }
    dialog.setAttribute('aria-labelledby','aaDebateSettingsTitle');
    dialog.innerHTML='<form method="dialog"><header><div><h2 id="aaDebateSettingsTitle">讨论设置</h2><p>先明确目标，再让观点充分交锋。</p></div><button type="submit" class="arena-icon-btn" aria-label="关闭讨论设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>'
      +'<div class="arena-debate-settings-grid">'+group('objective','讨论目标',[['explore','多角度探索'],['decision','辅助决策'],['stress-test','方案压力测试']],s.objective)
      +group('detail','回答详略',[['concise','简洁'],['balanced','均衡'],['detailed','深入']],s.detail)
      +(common.length?'<fieldset class="wide"><legend>批量设置席位深度 <small>可选</small></legend><div class="arena-debate-choice-group arena-debate-bulk">'+common.map(function(v){return '<button type="button" data-debate-bulk-effort value="'+v+'" aria-pressed="'+(v===options.bulkEffort)+'">'+effortNames[v].split(' · ')[0]+'</button>';}).join('')+'</div><small>仅应用到参与席位，也可在各席位的模型入口里单独调整。</small></fieldset>':'')
      +'<label class="wide"><span>讨论背景 <small>可选</small></span><textarea data-debate-setting="context" aria-label="讨论背景" maxlength="6000" rows="3" placeholder="相关事实、已有方案，或你希望大家了解的前提…">'+escape(s.context)+'</textarea></label>'
      +'<label class="wide"><span>目标与约束 <small>可选</small></span><textarea data-debate-setting="constraints" aria-label="目标与约束" maxlength="2000" rows="2" placeholder="例如：预算、时间、评价标准，以及这次不讨论的范围">'+escape(s.constraints)+'</textarea></label></div>'
      +'<footer><small>思考深度影响推理投入；回答详略控制表达篇幅。总结设置在「讨论总结」入口。</small><button type="submit" class="arena-debate-settings-done">完成</button></footer></form>';
    dialog.oninput=function(event){if(event.target.tagName==='TEXTAREA')options.onChange(event.target.dataset.debateSetting,event.target.value);};
    dialog.onclick=function(event){
      var button=event.target.closest('button[data-debate-setting],button[data-debate-bulk-effort]');if(!button)return;
      var group=button.parentElement,bulk=button.hasAttribute('data-debate-bulk-effort');
      group.querySelectorAll('button').forEach(function(item){item.setAttribute(bulk?'aria-pressed':'aria-checked',String(item===button));if(!bulk)item.tabIndex=item===button?0:-1;});
      if(bulk)options.onBulk(button.value);else options.onChange(button.dataset.debateSetting,button.value);
    };
    dialog.onkeydown=function(event){
      var button=event.target.closest('[role="radio"]');if(!button)return;
      var buttons=Array.from(button.parentElement.children),index=buttons.indexOf(button),next;
      if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%buttons.length;
      if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index-1+buttons.length)%buttons.length;
      if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;
      if(next!==undefined){event.preventDefault();buttons[next].focus();buttons[next].click();}
    };
    dialog.onclose=function(){options.onClose();};
    dialog.showModal();return dialog;
  }
  function requestConfig(plan){
    var summary=plan.turns.find(function(t){return t.summary;});
    return {contractVersion:'studio-v3',mode:plan.mode,rounds:plan.rounds,members:plan.members,topic:plan.topic,objective:plan.objective,detail:plan.detail,context:plan.context,constraints:plan.constraints,priorRunId:plan.priorRunId,
      summaryModel:summary?summary.member.model:'none',summaryEffort:summary?summary.member.effort:undefined};
  }
  function legacyEfforts(plan){
    var values={},conflicts={};plan.turns.forEach(function(t){var m=t.member;if(m.effort===undefined)return;if(values[m.model]&&values[m.model]!==m.effort)conflicts[m.model]=true;values[m.model]=m.effort;});
    Object.keys(conflicts).forEach(function(id){delete values[id];});return values;
  }
  return {effort:effort,commonEfforts:commonEfforts,cleanDraft:cleanDraft,settings:settings,effortNames:effortNames,requestConfig:requestConfig,legacyEfforts:legacyEfforts};
});
