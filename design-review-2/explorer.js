export function installExplorer(c) {
  const {state:s,themes,setTheme,navigate,render,showModal,icon,button,esc,toast} = c;
  const palettes={apple:['#000','#000'],orbit:['#0c1424','#1f2b43'],aurora:['#bca9df','#f4effccc'],obsidian:['#0c110c','#142015'],prism:['#e5e4f0','#fbfcff'],titanium:['#b9c3cd','#eef2f5'],noir:['#050506','#16161b'],swiss:['#2454ed','#f7f9f4'],nebula:['#18102f','#2d2345'],dune:['#bdaa90','#eee4d6']};
  function cycle(delta) {
    const i=themes.findIndex(d=>d.id===s.theme);
    setTheme(themes[(i+delta+themes.length)%themes.length].id);
  }
  function themeList() {
    showModal('10 套全新整站设计',`<p class="subtle">每一套都包含 11 类页面，以及模型、图像参数、资料、账号、异常与手机布局。选择后可以继续切换页面比较。</p><div class="theme-grid">${themes.map((d,i)=>`<button type="button" class="direction-card" data-action="theme" data-theme="${d.id}" aria-pressed="${s.theme===d.id}" aria-label="方案 ${i+1}：${d.name} ${d.en}"><span class="direction-preview" style="--mini-back:${palettes[d.id][0]};--mini-surface:${palettes[d.id][1]}"><img src="./${d.asset}.svg" alt=""></span><span class="direction-card-label"><small>DESIGN ${String(i+1).padStart(2,'0')}</small><strong>${d.name}</strong><span>${d.en}</span></span></button>`).join('')}</div><p class="directory-footer">切换风格会保留当前页面。顶部两侧箭头可以快速对比相邻方案。</p>`,'theme-catalog');
  }
  function statePicker() {
    const states=[['normal','正常状态','对话、创作与工作区','chat'],['loading','生成中','思考过程与停止入口','spark'],['error','失败与重试','可见反馈与重试操作','refresh'],['empty','空项目','没有资料时的引导','folder'],['incognito','无痕模式','隐私状态与会话提示','shield'],['multi','多图编辑','参考图与连续编辑入口','image']];
    showModal('查看完整的界面状态',`<p class="subtle">这些状态仅用于界面演示，不请求模型，不模拟真实账号错误。</p><div class="state-grid">${states.map(([v,n,t,i])=>button(icon(i)+`<span>${n}<small>${t}</small></span>`,'show-status','',`data-state="${v}"`)).join('')}</div>`);
  }
  function resetStatus() {
    if(s.previewState==='incognito')s.incognito=false;
    s.previewState='normal';
    render();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-action]');
    if(!b)return;
    switch(b.dataset.action){
      case'previous-theme':cycle(-1);break;
      case'next-theme':cycle(1);break;
      case'theme-list':themeList();break;
      case'theme':if(document.querySelector('#modal').classList.contains('theme-catalog'))document.querySelector('#modal').close();break;
      case'state-picker':statePicker();break;
      case'show-status':{
        if(s.previewState==='incognito')s.incognito=false;
        s.previewState=b.dataset.state;
        document.querySelector('#modal').close();
        if(s.previewState==='incognito')s.incognito=true;
        if(s.previewState==='multi'){
          s.imageMode='multi';
          s.attached=[{name:'金属参考',url:'./chrome.svg'},{name:'棱镜参考',url:'./prism.svg'}];
          navigate('images');
        }else navigate(s.previewState==='empty'?'projects':'chat');
        break;
      }
      case'reset-status':resetStatus();break;
      case'remove-seat':if(s.seatModels.length>2){s.seatModels.splice(Number(b.dataset.index),1);render();toast('已移除示例讨论席位')}break;
      case'image-thinking':s.imageThinking=b.dataset.value;selectChoice(b);break;
      case'image-quality':s.imageQuality=b.dataset.value;selectChoice(b);break;
      case'image-count':s.imageCount=Number(b.dataset.value);selectChoice(b);break;
      case'image-grounding':s.imageGrounding=b.dataset.value;s.imageSearch=s.imageGrounding!=='off';selectChoice(b);break;
      case'image-output':s.imageText=b.dataset.value==='true';selectChoice(b);break;
      case'preview-about':showModal('关于这次整站设计',`<p class="subtle">这是第二轮设计探索，10 套风格覆盖同一组完整的 AI 助手页面与主要状态，方便比较。</p><div class="project-note"><strong>预览与真实账号隔离</strong>所有会话、模型状态、资料和图片均为内置示例。网络连接策略禁止 API 请求；操作不消耗模型费用。</div><div class="project-note"><strong>苹果官网版本的参考</strong>对照 <a href="https://www.apple.com/" target="_blank" rel="noopener" style="text-decoration:underline;text-underline-offset:3px">apple.com</a> 的全宽导航、产品展示式排版与胶囊按钮；AI 助手的内容与功能仍属于你的网站。其余九套是独立视觉方向。</div><p class="form-help">手机布局可以直接用手机打开此预览比较。当前检查为浏览器响应式检查，不代表实体设备验收。</p><div class="modal-footer">${button('继续浏览','close-modal','primary')}</div>`);break;
    }
  });
  function selectChoice(button) {
    for(const other of button.parentElement.querySelectorAll('[aria-pressed]'))other.setAttribute('aria-pressed',String(other===button));
  }
  document.addEventListener('keydown',()=>document.body.classList.add('keyboard'),{capture:true});
  document.addEventListener('pointerdown',()=>document.body.classList.remove('keyboard'),{capture:true});

  // Rare visual exploration only: continuous, interruptible tilt on the hero object.
  // Update one transform, never layout or inherited variables on every frame.
  let active=null,frame=0,last=0;
  function tick(time) {
    if(!active||!active.el.isConnected){active=null;frame=0;return}
    const dt=Math.min(.032,Math.max(.001,(time-last)/1000||.016));last=time;
    for(const axis of ['x','y']){
      const force=200*(active['t'+axis]-active[axis])-28.3*active['v'+axis];
      active['v'+axis]+=force*dt;
      active[axis]+=active['v'+axis]*dt;
    }
    active.el.style.transform=`perspective(1000px) rotateX(${active.y.toFixed(3)}deg) rotateY(${active.x.toFixed(3)}deg)`;
    if(Math.abs(active.x-active.tx)+Math.abs(active.y-active.ty)+Math.abs(active.vx)+Math.abs(active.vy)<.008){
      if(active.tx===0&&active.ty===0)active.el.style.transform='';
      frame=0;return;
    }
    frame=requestAnimationFrame(tick);
  }
  function start(){if(!frame){last=performance.now();frame=requestAnimationFrame(tick)}}
  document.addEventListener('pointermove',e=>{
    if(!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
    const el=e.target.closest('[data-tilt]');
    if(!el){if(active){active.tx=0;active.ty=0;start()}return}
    if(active?.el!==el){if(active)active.el.style.transform='';active={el,x:0,y:0,vx:0,vy:0,tx:0,ty:0}}
    const rect=el.getBoundingClientRect();
    active.tx=((e.clientX-rect.left)/rect.width-.5)*5;
    active.ty=-((e.clientY-rect.top)/rect.height-.5)*4;
    start();
  },{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;if(active)active.el.style.transform='';active=null}});
}
