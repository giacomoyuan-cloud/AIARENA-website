(function(root,factory){
  var api=factory(typeof module==='object'&&module.exports?require('./arena-billing.js'):root.ArenaBilling);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ArenaBillingUI=api;
})(typeof window!=='undefined'?window:this,function(B){
  'use strict';
  function e(value){return String(value===null||value===undefined?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  var names={uncachedInput:'普通输入',cachedInput:'缓存命中输入',cacheWriteShort:'短期缓存写入',cacheWriteLong:'长期缓存写入',outputText:'输出（含思考）',outputImage:'图片输出',inputText:'文字输入',inputImage:'图片输入',webSearch:'网页搜索',googleSearch:'Google 搜索',providerAmount:'官方返回金额（已含工具费用）',generatedImages:'已返回图片'};
  var notes={google_search_free_allowance_unknown:'Google 搜索的免费额度由 Google 在项目内共享结算，本条搜索费用待结算。',
    image_modality_usage_missing:'官方未提供图片与文字输出 token 的完整拆分，图片费用暂不猜算。',
    image_input_usage_missing:'官方未提供图片与文字输入 token 的完整拆分。',
    cache_details_missing:'官方未返回完整缓存明细，输入费用暂未完整核算。',
    cache_write_usage_missing:'官方未返回缓存写入用量，输入费用待核实。',
    cache_write_lifetime_missing:'缓存写入的保留时长未返回，写入费用待核实。',
    usage_missing:'官方接口未提供用量，无法计算本次费用。',
    token_totals_missing:'官方未提供完整输入、输出 token 数。',
    final_usage_missing:'请求中断或失败，尚未收到最终计费用量。',
    reported_total_mismatch:'官方返回的 token 计数不一致，费用需要核实。',
    cache_write_total_mismatch:'官方返回的缓存写入计数不一致。',
    model_price_unverified:'此模型的官方单价尚未核实。',
    context_tier_unknown:'输入计数缺失，无法确定本次请求的上下文价格档位。',
    service_tier_unpriced:'本次服务档位的单价尚未核实。'};
  function row(label,value){return '<div><dt>'+e(label)+'</dt><dd>'+e(value)+'</dd></div>';}
  function render(value,legacy){
    if(!value&&!legacy)return '';
    var current=B.isReceipt(value),h='<div class="aa-usage-tag"><details class="arena-usage-details"'+(current&&value.id?' data-billing-id="'+e(value.id)+'"':'')+'><summary>'+e(B.label(value,legacy))+'</summary><div class="arena-billing-breakdown">';
    if(!current){
      h+='<p>这条历史记录缺少官方原始计费明细，无法可靠复算。原记录仍然保留。</p>';
      if(legacy)h+='<p class="arena-billing-muted">原显示：'+e(legacy)+'</p>';
    }else{
      var d=value.details||{};
      h+='<dl>'+row('输入 token（含缓存）',value.input===null?'官方未提供':value.input)+row('输出 token（含思考）',value.output===null?'官方未提供':value.output);
      if(d.cachedInput)h+=row('其中缓存命中',d.cachedInput);
      if(d.cacheWriteShort)h+=row(value.provider==='anthropic'?'缓存写入 · 5 分钟':'缓存写入 · 30 分钟',d.cacheWriteShort);
      if(d.cacheWriteLong)h+=row(value.provider==='anthropic'?'缓存写入 · 1 小时':'缓存写入 · 12 小时',d.cacheWriteLong);
      if(d.outputReasoning)h+=row('其中思考 token（不重复加算）',d.outputReasoning);
      if(d.outputImage)h+=row('其中图片输出 token',d.outputImage);
      if(d.toolInput)h+=row('其中工具输入 token',d.toolInput);
      if(value.billingComplete)h+=row('完整核算金额 · USD',value.costUsd);
      else h+=row('已核算部分 · USD',value.knownCostUsd);
      h+='</dl>';
      if((value.items||[]).length){
        h+='<div class="arena-billing-items">';
        value.items.filter(function(item){return item.count===null||item.count>0||item.amountUsd&&Number(item.amountUsd)>0;}).forEach(function(item){
          var title=names[item.kind]||item.kind;
          if(item.rate!==null&&item.rate!==undefined)title+=' · $'+item.rate+(String(item.unit||'').indexOf('1000')!==-1?' / 千次':' / 百万 token');
          h+='<div><span>'+e(title)+(item.count===null?'':e(' × '+item.count))+'</span><span>'+e(item.amountUsd===null?'待结算':'$'+item.amountUsd)+'</span></div>';
        });h+='</div>';
      }
      var primaryAmount=(value.items||[]).some(function(item){return item.kind==='providerAmount';}),shownNotes=new Set();
      (value.notes||[]).filter(function(note){return notes[note];}).forEach(function(note){var text=primaryAmount&&['cache_details_missing','cache_write_usage_missing','cache_write_lifetime_missing','image_modality_usage_missing','image_input_usage_missing','usage_missing'].indexOf(note)!==-1?'部分 token 明细未返回；本次金额以官方返回值为准。':notes[note];if(!shownNotes.has(text)){shownNotes.add(text);h+='<p class="arena-billing-note">'+e(text)+'</p>';}});
      if(value.ledgerStatus&&value.ledgerStatus!=='recorded')h+='<p class="arena-billing-note">累计统计'+(value.ledgerStatus==='pending'?'正在同步；本条费用明细已保留。':'暂未同步成功；请稍后查看累计用量。')+'</p>';
      if(value.auxiliary&&value.auxiliary.length){
        h+='<div class="arena-billing-aux"><strong>本条其他调用</strong>';
        value.auxiliary.forEach(function(a){var purpose={context:'上下文摘要','context-summary':'上下文摘要',memory:'记忆整理',retry:'重试前一次调用'}[a.purpose]||'其他调用';h+='<p>'+e(purpose)+' · '+e((B.MODELS[a.model]||{}).name||a.model)+'：'+e(B.label(a))+'</p>';});h+='</div>';
      }
      var card=B.MODELS[value.model];
      if(card)h+='<p class="arena-billing-muted">'+e(value.rateCard&&value.rateCard.checkedAt||B.CHECKED)+' 核对 · '+(value.costBasis==='provider'?'金额来自官方响应。':'按公开 API 单价核算，不含账号折扣、税费或汇率调整。')+' <a href="'+e(value.costBasis==='provider'?B.SOURCES.xaiCost:card.source)+'" target="_blank" rel="noopener noreferrer">官方说明</a></p>';
    }
    return h+'<button type="button" data-billing-summary>累计用量与官方价格</button></div></details></div>';
  }
  function catalog(ids){
    var nano=B.publicCard('gemini-nano-banana-2.1'),grok=B.publicCard('grok-imagine-image-2.0'),g4=B.MODELS['gemini-4-argon'];
    function imageCost(size){return B.usd(BigInt(nano.imageTokens[size])*BigInt(Math.round(Number(nano.imageOutput)*1000000)));}
    var h='<h3>官方价格</h3><p class="arena-billing-muted">USD / 百万 token · 标准服务 · '+B.CHECKED+' 核对</p><div class="arena-billing-table-wrap"><table><thead><tr><th>对话模型</th><th>输入</th><th>缓存命中</th><th>输出</th></tr></thead><tbody>';
    (ids||[]).forEach(function(id){var c=B.publicCard(id);if(!c||c.image)return;h+='<tr><th><a href="'+e(c.source)+'" target="_blank" rel="noopener noreferrer">'+e(c.name)+'</a></th><td>$'+e(c.input)+'</td><td>$'+e(c.cached)+'</td><td>$'+e(c.output)+'</td></tr>';});
    h+='</tbody></table></div><p class="arena-billing-muted">GPT 超过 272,000 输入 token、Grok 达到 200,000 输入 token 后按整次请求的长上下文单价核算。缓存写入另按实际时长计费，输出已包含思考 token。</p>';
    h+='<div class="arena-billing-rate-note"><strong>Nano Banana 2.1</strong><p>输入 $'+e(nano.input)+' / 百万 token，文字与思考输出 $'+e(nano.output)+' / 百万 token，图片输出 $'+e(nano.imageOutput)+' / 百万 token。1K / 2K / 4K 方图的图片输出分别约 $'+imageCost('1K')+' / $'+imageCost('2K')+' / $'+imageCost('4K')+'，另计实际输入、文字与思考用量。</p><a href="'+B.SOURCES.google+'" target="_blank" rel="noopener noreferrer">Google 官方价格</a></div>';
    h+='<div class="arena-billing-rate-note"><strong>Grok Image 2.0</strong><p>参考图 $'+e(grok.inputImage)+' / 张。1K：Low $'+e(grok.outputImages['1k-low'])+'、Medium $'+e(grok.outputImages['1k-medium'])+'；2K：Low $'+e(grok.outputImages['2k-low'])+'、Medium $'+e(grok.outputImages['2k-medium'])+' / 张。每次优先显示官方响应金额。</p><a href="'+B.SOURCES.xai+'" target="_blank" rel="noopener noreferrer">xAI 官方价格</a></div>';
    h+='<p class="arena-billing-muted">Google 搜索：共享每月 5,000 次免费额度，之后 $14 / 千次；免费额度和最终搜索费以 Google 结算为准。Gemini 4 在 '+e(g4.effectiveUntil)+' 起调整为输入 $'+e(g4.next.input)+'、缓存命中 $'+e(g4.next.cached)+'、输出 $'+e(g4.next.output)+' / 百万 token。</p>';
    return h;
  }
  function summary(data){
    if(!data||!data.total)return '<p class="arena-billing-note">累计用量暂时不可用。</p>';
    var t=data.total,h='<h3>新版累计用量</h3><p class="arena-billing-muted">'+(t.firstAt?'从 '+e(new Date(t.firstAt).toLocaleString('zh-CN'))+' 起':'新版暂无计费记录')+' · 旧记录保留，未并入本表。</p>';
    h+='<p class="arena-billing-muted">累计以已入账收据为准；待同步请求会在账本恢复后补入。</p>';
    h+='<div class="arena-billing-totals"><div><span>已返回输入 token</span><strong>'+e(t.input)+'</strong></div><div><span>已返回输出 token</span><strong>'+e(t.output)+'</strong></div><div><span>已核算费用</span><strong>'+e(B.money(t.knownCostUsd))+'</strong></div></div>';
    if(t.unsettled||t.missingInput||t.missingOutput)h+='<p class="arena-billing-note">'+e(t.unsettled)+' 次请求含待结算项目；'+e(t.missingInput)+' 次未提供输入用量，'+e(t.missingOutput)+' 次未提供输出用量。未知部分未计成 0。</p>';
    var models=Object.entries(data.models||{}).sort(function(a,b){return b[1].calls-a[1].calls;});
    if(models.length){h+='<div class="arena-billing-table-wrap"><table><thead><tr><th>模型</th><th>次数</th><th>输入</th><th>输出</th><th>已核算费用</th></tr></thead><tbody>';
      models.forEach(function(pair){var id=pair[0],v=pair[1];h+='<tr><th>'+e((B.MODELS[id]||{}).name||id)+'</th><td>'+e(v.calls)+'</td><td>'+e(v.input)+(v.missingInput?' + 未提供':'')+'</td><td>'+e(v.output)+(v.missingOutput?' + 未提供':'')+'</td><td>'+e(B.money(v.knownCostUsd))+(v.unsettled?' + 待结算':'')+'</td></tr>';});h+='</tbody></table></div>';}
    return h;
  }
  return Object.freeze({render:render,catalog:catalog,summary:summary});
});
