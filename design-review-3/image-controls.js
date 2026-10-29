export function createImageControls(c) {
 const {state:s,showModal,icon,button,esc}=c;
  function imageCaps() {
    return s.imageModel.includes('Grok')
      ? {ratios:['1:1','16:9','9:16','4:3','3:4','3:2','2:3','2:1','1:2','21:9','5:2','19.5:9','9:19.5','20:9','9:20','auto'],sizes:['1K','2K'],references:5}
      : {ratios:['1:1','16:9','9:16','3:2','2:3','4:3','3:4','4:5','5:4','21:9','4:1','1:4','8:1','1:8'],sizes:['1K','2K','4K'],references:14};
  }
  function imageResult(prompt) {
    const grok=s.imageModel.includes('Grok'),count=grok&&s.imageMode==='generate'?s.imageCount:1;
    const art=['orb','chrome','prism','bronze'];
    const choices=grok?`${s.imageQuality} · ${count} 张`:`${s.imageThinking} · ${s.imageGrounding} · ${s.imageText?'图片 + 说明':'仅图片'}`;
    showModal('创作结果 · 本地示例',`<p class="subtle">此处展示结果、连续编辑与下载操作的界面，不请求模型。</p><div class="demo-output-grid" data-count="${count}">${Array.from({length:count},(_,i)=>`<img class="preview-image" src="./${art[i]}.svg" alt="内置设计素材 ${i+1}，不是模型生成结果">`).join('')}</div>${!grok&&s.imageText?`<div class="project-note"><strong>示例说明</strong>以「${esc(prompt)}」作为创作方向。此处使用内置设计素材，帮助预览输出形式与后续操作。</div>`:''}<p class="form-help">当前预览选择：${s.imageModel} · ${esc(s.ratio)} · ${s.resolution} · ${choices}${!grok?' · '+esc(s.style):''}</p><div class="modal-footer">${button('继续修改','edit-demo-image','secondary')}${button('完成','close-modal','primary')}</div>`);
  }
  function imageSettings() {
    const cap=imageCaps(),grok=s.imageModel.includes('Grok');
    const segments=(label,action,values,current)=>`<section class="field-section"><div class="field-label">${label}</div><div class="segmented">${values.map(([v,n])=>button(n,action,'',`data-value="${v}" aria-pressed="${String(current)===String(v)}"`)).join('')}</div></section>`;
    const choiceCards=(label,action,values,current,hint)=>`<section class="field-section"><div class="field-label">${label}</div><div class="setting-cards">${values.map(([v,n,i])=>button(icon(i)+`<span>${n}</span>`,action,'setting-card',`data-value="${v}" aria-pressed="${String(current)===String(v)}"`)).join('')}</div><p class="form-help">${hint}</p></section>`;
    showModal('图像设置',`<p class="subtle">${esc(s.imageModel)} · 完整参数界面预览</p><section class="field-section"><div class="field-label">画面比例 <small>横幅、竖幅与方形，一眼可见</small></div><div class="ratio-grid">${cap.ratios.map(r=>{const [w,h]=r==='auto'?[4,3]:r.split(':').map(Number),scale=26/Math.max(w,h),orientation=r==='auto'?'随内容':w===h?'方形':w>h?'横幅':'竖幅';return button(`<span class="ratio-figure"><span class="ratio-shape" style="width:${Math.max(3,Math.round(w*scale))}px;height:${Math.max(3,Math.round(h*scale))}px"></span></span><span>${r==='auto'?'自动':r}</span><small>${orientation}</small>`,'ratio','ratio-option',`data-value="${r}" aria-pressed="${s.ratio===r}"`)}).join('')}</div></section>${grok&&s.imageMode==='generate'?segments('生成数量','image-count',[[1,'1 张'],[2,'2 张'],[3,'3 张'],[4,'4 张']],s.imageCount):''}${segments('分辨率','resolution',cap.sizes.map(n=>[n,n]),s.resolution)}${grok?segments('生成质量','image-quality',[['auto','自动'],['low','标准'],['medium','精细']],s.imageQuality):`${segments('思考强度','image-thinking',[['minimal','快速'],['medium','均衡'],['high','深度']],s.imageThinking)}<section class="field-section"><div class="field-label">风格预设 <small>加入提示词，不切换模型</small></div><div class="style-grid">${['无预设','写实摄影','人像摄影','产品摄影','贴纸插画','数字插画','极简留白','梵高风格','漫画风格','动漫风格','素描风格'].map(n=>button(n,'image-style','style-option',`data-value="${n}" aria-pressed="${n===s.style}"`)).join('')}</div></section>${choiceCards('Google 搜索参考','image-grounding',[['off','不搜索','shield'],['web','网页资料','globe'],['image','图片参考','image'],['web-image','网页 + 图片','search']],s.imageGrounding,'选择需要的参考方式。这里仅展示参数选择，不进行实际搜索。')}${choiceCards('回复形式','image-output',[[false,'仅图片','image'],[true,'图片 + 说明','file']],s.imageText,'控制图片外是否附说明；画面内的文字仍由描述决定。')}` }<div class="modal-footer"><span>最多 ${cap.references} 张参考图 · 零 API 调用</span>${button('完成','image-settings-done','primary')}</div>`,'image-settings-dialog');
  }

return {imageCaps,imageSettings,imageResult};
}
