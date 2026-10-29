export function installExplorer(c){
  const {state:s,themes,setTheme,navigate,render,showModal,button,icon,esc,toast}=c;
  const select=b=>{for(const v of b.parentElement.querySelectorAll('[aria-pressed]'))v.setAttribute('aria-pressed',String(v===b))};
  const cycle=delta=>setTheme(themes[(themes.findIndex(t=>t.id===s.theme)+delta+10)%10].id);
  function themeList(){showModal('十种不同的使用方式',`<p class="subtle">同一套能力，重新编排成十种界面。切换方案时保留当前页面。</p><div class="layout-directory">${themes.map((d,i)=>button(`<small>${String(i+1).padStart(2,'0')}</small><span><strong>${d.name}</strong><small>${d.desc}</small></span>${s.theme===d.id?icon('check'):icon('right')}`,'theme','',`data-theme="${d.id}" aria-pressed="${s.theme===d.id}"`)).join('')}</div>`,'theme-catalog')}
  function debateSettings(){showModal('讨论设置',`<div class="debate-controls"><section class="field-section"><span class="field-label">讨论方式</span><div class="segmented">${[['free','自由讨论'],['persona','角色讨论'],['teams','2v2 辩论']].map(([v,n])=>button(n,'debate-mode','',`data-value="${v}" aria-pressed="${s.debateMode===v}"`)).join('')}</div></section><section class="field-section"><span class="field-label">讨论轮数</span><div class="segmented">${[1,2,3].map(n=>button(n+' 轮','rounds','',`data-value="${n}" aria-pressed="${s.rounds===n}"`)).join('')}</div></section><section class="field-section"><span class="field-label">参与席位 · ${s.seatModels.length} 个模型</span><div class="setup-seats">${s.seatModels.map((m,i)=>`<div><button data-action="seat-model" data-index="${i}">${i+1}. ${esc(m)} ${icon('down')}</button>${s.seatModels.length>2?button(icon('close'),'setup-remove','icon',`data-index="${i}" aria-label="移除第${i+1}席"`):''}</div>`).join('')}</div>${s.seatModels.length<4?button(icon('plus')+'添加席位','setup-add','secondary'):''}</section><div class="modal-footer">${button('完成','close-modal','primary')}</div></div>`)}
  function states(){showModal('界面状态',`<p class="subtle">界面示例，不调用模型或真实搜索。</p><div class="page-directory">${[['normal','正常状态','chat'],['loading','生成中','spark'],['error','失败与重试','refresh'],['empty','空项目','folder'],['incognito','无痕模式','shield'],['multi','多图编辑','image']].map(([v,n,i])=>button(icon(i)+n,'show-status','',`data-state="${v}"`)).join('')}</div>`)}
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');if(!b)return;
    switch(b.dataset.action){
      case 'previous-theme':cycle(-1);break;
      case 'next-theme':cycle(1);break;
      case 'theme-list':themeList();break;
      case 'theme':if(document.querySelector('#modal').open)document.querySelector('#modal').close();break;
      case 'compare':navigate('compare');break;
      case 'comparison-page':s.comparePage=b.dataset.value;render();break;
      case 'comparison-overview':s.compareOverview=!s.compareOverview;render();break;
      case 'inspect-layout':setTheme(b.dataset.theme);navigate(b.dataset.page);break;
      case 'monochrome':document.body.classList.toggle('monochrome');b.setAttribute('aria-pressed',document.body.classList.contains('monochrome'));break;
      case 'debate-settings':debateSettings();break;
      case 'focus-perspective':s.focusSeat=Number(b.dataset.index);render();break;
      case 'setup-add':if(s.seatModels.length<4)s.seatModels.push('Grok 4.7');render();debateSettings();break;
      case 'setup-remove':if(s.seatModels.length>2)s.seatModels.splice(Number(b.dataset.index),1);render();debateSettings();break;
      case 'debate-mode':case 'rounds':debateSettings();break;
      case 'run-debate':s.debateDone=true;render();toast('已展示讨论共识示例，没有调用模型');break;
      case 'state-picker':states();break;
      case 'show-status':if(s.previewState==='multi'&&b.dataset.state!=='multi'){s.attached=[];s.imageMode='generate'}s.previewState=b.dataset.state;s.incognito=s.previewState==='incognito';document.querySelector('#modal').close();if(s.previewState==='multi'){s.imageMode='multi';s.attached=[{name:'金属参考',url:'./chrome.svg'},{name:'棱镜参考',url:'./prism.svg'}]}navigate(s.previewState==='empty'?'projects':s.previewState==='multi'?'images':'chat');break;
      case 'reset-status':if(s.previewState==='multi'){s.attached=[];s.imageMode='generate'}s.previewState='normal';s.incognito=false;render();break;
      case 'image-thinking':s.imageThinking=b.dataset.value;select(b);break;
      case 'image-quality':s.imageQuality=b.dataset.value;select(b);break;
      case 'image-count':s.imageCount=Number(b.dataset.value);select(b);break;
      case 'image-grounding':s.imageGrounding=b.dataset.value;s.imageSearch=s.imageGrounding!=='off';select(b);break;
      case 'image-output':s.imageText=b.dataset.value==='true';select(b);break;
      case 'preview-about':showModal('关于整站设计预览',`<p class="subtle">这次从导航、页面结构、内容编排和使用方式重新设计，十套方案覆盖同一组完整功能。</p><div class="project-note"><strong>清楚，简单，容易开始。</strong><p>主要操作直接可见，进阶参数按需展开。顶部「去色」可以去掉配色，比较结构本身。</p></div><div class="project-note"><strong>示例数据，零 API 调用。</strong><p>全部交互只保存在当前页面内存。浏览器网络策略禁止 API 请求，不读取真实聊天、密码或密钥。</p></div><p class="form-help">苹果官网版参考 <a href="https://www.apple.com/" target="_blank" rel="noopener">apple.com</a> 的产品展示构成。其余九种拥有各自的页面结构。手机检查为浏览器模拟，尚未实体设备验收。</p><div class="modal-footer">${button('继续浏览','close-modal','primary')}</div>`);break;
    }
  });
}
