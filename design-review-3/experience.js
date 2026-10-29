import {createBlocks} from './blocks.js';
import {createImageControls} from './image-controls.js';
import {layouts} from './layouts.js';

export function createExperience(c){
  const {state:s,themes,icon,ib,button,esc,updateSend}=c;
  const blocks=createBlocks(c),imageControls=createImageControls(c);
  s.comparePage='debate';
  s.compareOverview=false;
  function themePicker(){
    const d=themes.find(t=>t.id===s.theme)||themes[0],index=themes.indexOf(d);
    document.querySelector('#themes').innerHTML=`${ib('right','previous-theme','上一套设计','data-previous')}<button class="direction-button" data-action="theme-list"><small>${String(index+1).padStart(2,'0')} / 10</small><strong>${d.name}</strong>${icon('down')}</button>${ib('right','next-theme','下一套设计')}`;
    document.querySelector('#direction').textContent=d.desc;
    Object.assign(document.body.dataset,{theme:s.theme,page:s.page,layout:d.layout,preview:s.previewState||'normal'});
    document.querySelector('meta[name="theme-color"]').content=['focus','cinema'].includes(s.theme)?'#121318':'#f5f5f7';
    document.querySelector('[data-action="monochrome"]').setAttribute('aria-pressed',document.body.classList.contains('monochrome'));
  }
  function comparison(){
    const p=s.comparePage||'debate';
    const labels={welcome:'首页',debate:'多 AI 辩论',images:'图像创作',chat:'对话'};
    const ordered=['apple','split','studio','folio','cinema','messenger','bento','focus','outline','notebook'].map(id=>themes.find(d=>d.id===id));
    return `<main id="page-scroll" class="comparison-page ${s.compareOverview?'compact-overview':''}"><header><span class="eyebrow">10 STRUCTURES. ONE SIMPLE GOAL.</span><h1>十种布局，一眼看懂。</h1><p>同一页内容，重新编排导航、阅读与操作方式。点进任意一套，浏览完整网站。</p><div class="comparison-tabs">${Object.entries(labels).map(([v,n])=>button(n,'comparison-page','',`data-value="${v}" aria-pressed="${p===v}"`)).join('')}${button(s.compareOverview?'放大查看':'一屏总览','comparison-overview','overview-toggle',`aria-pressed="${s.compareOverview}"`)}</div></header><div class="comparison-grid">${ordered.map(d=>`<button class="comparison-card" data-action="inspect-layout" data-theme="${d.id}" data-page="${p}" aria-label="浏览${d.name}的${labels[p]}页面"><div class="comparison-shot"><img src="./previews/${d.id}-${p}.jpg" alt="${d.name}的实际${labels[p]}页面截图" loading="lazy"></div><div class="comparison-card-copy"><small>${String(themes.indexOf(d)+1).padStart(2,'0')}</small><span><strong>${d.name}</strong><span>${d.idea}</span></span><span class="comparison-enter">${icon('right')}</span></div><div class="comparison-facts"><span>${d.nav}</span><span>${d.reading}</span><span>${d.controls}</span></div></button>`).join('')}</div><footer>11 类完整页面 · 手机与桌面布局 · 本地交互示例 · 不消耗 API 余额</footer></main>`;
  }
  function fitPanels(){
    const panel=document.querySelector('.model-panel');
    if(panel){const bottom=panel.getBoundingClientRect().bottom;panel.style.maxHeight=Math.max(110,Math.floor(bottom-92))+'px';}
  }
  window.addEventListener('resize',fitPanels);
  function render(){
    s.focusSeat=Math.min(s.focusSeat||0,s.seatModels.length-1);
    document.body.classList.toggle('compact-reading',s.compact);
    themePicker();
    document.querySelector('#app').innerHTML=s.page==='compare'?comparison():layouts[s.theme](blocks);
    if(s.previewState!=='normal'&&s.page!=='compare'){
      const label={loading:'生成中',error:'失败与重试',empty:'空项目',incognito:'无痕模式',multi:'多图编辑'}[s.previewState];
      if(label)document.querySelector('#app').insertAdjacentHTML('beforeend',`<button class="state-reset" data-action="reset-status">${label}示例 ${icon('close')}</button>`);
    }
    document.title=`${themes.find(d=>d.id===s.theme)?.name} · ${s.page==='compare'?'十套布局对照':blocks.names[s.page]} · AI 助手设计`;
    updateSend();fitPanels();
  }
  // Compatibility with the existing, isolated local interaction controller.
  const page=p=>()=>layouts[s.theme](Object.assign({},blocks,{s:{...s,page:p}}));
  return {...imageControls,render,themePicker,heading:(tag,title,desc)=>blocks.pageTitle(tag,title,desc),welcome:page('welcome'),chat:page('chat'),images:page('images'),projectList:page('projects'),debate:page('debate'),skillsPage:page('skills'),login:page('login'),install:page('install'),tuner:page('tuner')};
}
