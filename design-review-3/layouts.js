// Each direction owns its page composition and navigation. Only state and semantic
// controls are shared. No palette switch can turn one structure into another.
const canCompose=p=>['welcome','chat','images','debate','project'].includes(p);
const scroll=(body,cls='')=>`<main id="page-scroll" class="page-scroll ${cls}">${body}</main>`;

export const layouts={
  apple(b){
    const {s}=b;
    const views={
      welcome:()=>`<section class="apple-hero"><span class="eyebrow">你的个人智能空间</span><h1>AI 助手。</h1><h2>你的每一种可能。</h2><div class="hero-links">${b.goto('开始对话','chat','primary')}${b.goto('探索图像创作','images','apple-link')}</div><div class="apple-word" aria-hidden="true">AI</div><p>好问题，值得好答案。</p></section><section class="apple-feature dark-feature"><span class="eyebrow">图像创作</span><h2>让想象，<br>拥有形状。</h2>${b.goto('进入创作','images','primary')}${b.art('chrome')}</section><div class="apple-products"><section><h2>多种观点。<br>一个更好的答案。</h2>${b.goto('开始讨论','debate','apple-link')}${b.art('prism')}</section><section><h2>每个想法，<br>都有自己的空间。</h2>${b.goto('查看项目','projects','apple-link')}${b.art('bronze')}</section></div>`,
      chat:()=>`<div class="apple-reading"><header class="apple-chapter"><span>对话</span><h1>聊出，<br>新的可能。</h1></header>${b.conversation('apple')}</div>`,
      debate:()=>`<section class="apple-debate-hero">${b.topic('showcase')}<div class="apple-participants">${b.seats('inline')}</div><div class="hero-links">${b.debateStart()}${b.debateSettings()}</div></section><section class="apple-perspectives"><header><span class="eyebrow">从不同角度，看见更多。</span><h2>两种思考，<br>让答案更完整。</h2></header>${b.opinions('showcase')}</section><div class="apple-reading">${b.conclusion()}</div>`,
      images:()=>`<div class="apple-image-heading">${b.pageTitle('图像创作','把想象，带到眼前。','从一句话开始，或在喜欢的画面上继续。')}${b.imageTools()}${b.imageModel()}</div>${b.reference()}<div class="apple-gallery">${b.images('showcase')}</div>`,
      projects:()=>`<div class="apple-category">${b.pageTitle('每个想法，都有去处。','项目。','资料、对话与记忆，在这里继续。')}${b.projectNew()}</div><div class="apple-projects">${b.projectList('cover')}</div>`,
      project:()=>`<section class="apple-project-intro">${b.pageTitle('你的项目',b.esc(b.current().name),b.esc(b.current().desc))}${b.button('项目设置','project-settings','apple-link')}</section><div class="apple-project-detail">${b.materials()}${b.projectNote()}</div>`,
      skills:()=>`<section class="apple-category">${b.pageTitle('更多能力','一点帮助。<br>更多可能。','用你需要的方式，继续向前。')}${b.skillTabs()}</section><div class="apple-skill-list">${b.skillList('feature')}</div>`,
      settings:()=>`<section class="apple-settings-intro"><h1>你的空间。<br>由你设定。</h1></section>${b.settingsTabs()}<section class="apple-settings-body">${b.settingsBody()}</section>`,
      login:()=>`<section class="apple-login"><div class="apple-login-mark">AI</div>${b.loginForm()}</section>`,
      install:()=>`<section class="apple-install">${b.installCopy()}${b.phone()}</section>`,
      tuner:()=>`<section class="apple-category">${b.pageTitle('音准工具','每一个音，<br>恰到好处。','选择参考音，轻松开始。')}</section><div class="apple-reading">${b.tuner()}</div>`
    };
    return `<div class="layout apple-layout">${b.mobile()}<header class="apple-nav">${b.brand()}${b.nav('text')}${b.utility()}</header><div class="apple-local-nav"><strong>${b.names[s.page]||'AI 助手'}</strong>${b.button('浏览功能 '+b.icon('down'),'page-picker','text-link')}</div><section class="work apple-work">${scroll(views[s.page]?.()||views.welcome(),s.page==='welcome'?'showcase-scroll':'')}${canCompose(s.page)&&s.page!=='welcome'?b.composer('apple'):''}</section></div>`;
  },

  focus(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="focus-welcome"><div class="focus-sphere">${b.art('orb')}</div><span class="eyebrow">想法在这里，慢慢清晰。</span><h1>今天，想聊点什么？</h1><p>带上你的好奇心，其他交给我。</p>${b.suggestions()}</div>`,
      chat:()=>`<div class="focus-conversation">${b.conversation('focus')}</div>`,
      debate:()=>`<div class="focus-discussion">${b.topic('focus')}<div class="focus-seat-tabs" role="tablist" aria-label="查看不同模型的观点">${s.seatModels.map((m,i)=>b.button(m,'focus-perspective','',`data-index="${i}" role="tab" aria-selected="${(s.focusSeat||0)===i}"`)).join('')}</div><div class="focus-active-perspective" role="tabpanel">${b.opinion(Math.min(s.focusSeat||0,s.seatModels.length-1),'focus')}</div><div class="focus-discussion-tools">${b.seats('pill')}<div class="inline-tools">${b.debateSettings()}${b.debateStart()}</div></div>${b.conclusion()}</div>`,
      images:()=>`<div class="focus-gallery-heading">${b.pageTitle('图像创作','先有一个画面。')}${b.imageTools()}</div>${b.reference()}<div class="focus-image-stage">${b.image(0,'focus')}<div>${b.image(1,'small')}${b.image(2,'small')}</div></div>`,
      projects:()=>`<div class="focus-page-head">${b.pageTitle('项目','让思路，接着生长。')}${b.projectNew()}</div>${b.projectList('quiet')}`,
      project:()=>`${b.pageTitle('项目',b.esc(b.current().name),b.esc(b.current().desc))}<div class="focus-materials">${b.materials()}${b.projectNote()}</div>`,
      skills:()=>`${b.pageTitle('更多能力','给想做的事，一点帮助。')}${b.skillTabs()}${b.skillList('quiet')}`,
      settings:()=>`${b.pageTitle('设置','按你的习惯来。')}<div class="focus-settings">${b.settingsTabs()}${b.settingsBody()}</div>`,
      login:()=>`<div class="focus-login"><span class="focus-star">✧</span>${b.loginForm()}</div>`,
      install:()=>`<div class="focus-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('音准工具','听见，准确的自己。')}${b.tuner()}`
    };
    return `<div class="layout focus-layout">${b.mobile()}<header class="focus-header">${b.brand()}<div>${b.button(b.icon('history')+'历史对话','search','text-link')}${b.utility()}</div></header><section class="work focus-work">${scroll(views[s.page]?.()||views.welcome(),'focus-scroll')}${canCompose(s.page)?b.composer('focus'):''}</section><footer class="focus-dock">${b.nav('dock')}</footer></div>`;
  },

  split(b){
    const {s}=b;
    let left='',right='';
    switch(s.page){
      case 'welcome':left=`<span class="eyebrow">从这里开始</span><h1>一边想。<br>一边实现。</h1><p>把问题放在这里，<br>让答案出现在身边。</p>${b.suggestions()}`;right=`<div class="split-home-visual">${b.art('prism')}<h2>一个空间。<br>两种可能。</h2><span>THINK / CREATE</span></div>`;break;
      case 'chat':left=`${b.pageTitle('你的问题','想法，<br>从哪里开始？')}<p>先找到目标，再整理出下一步。</p><div class="brief-materials">${b.projectNote()}</div>`;right=b.conversation('split');break;
      case 'debate':left=`${b.topic('split')}<div class="brief-participants"><span class="field-label">参与讨论</span>${b.seats('stack')}</div>`;right=`<header class="split-results-label"><span>不同角度</span><span>01 — ${String(s.seatModels.length).padStart(2,'0')}</span></header>${b.opinions('split')}${b.conclusion()}`;break;
      case 'images':left=`${b.pageTitle('图像创作','你描述。<br>我呈现。')}${b.imageTools()}${b.quickImageSettings()}${b.reference()}`;right=`<div class="split-image-main">${b.image(0,'large')}</div><div class="split-image-row">${b.image(1)}${b.image(2)}</div>`;break;
      case 'projects':left=`${b.pageTitle('项目','把想法，<br>放在一起。')}<p>每个项目，都有独立的资料、记忆与对话。</p>${b.projectNew()}`;right=b.projectList('row');break;
      case 'project':left=`${b.pageTitle('项目',b.esc(b.current().name),b.esc(b.current().desc))}${b.projectNote()}`;right=b.materials('large');break;
      case 'skills':left=`${b.pageTitle('更多能力','多一点，<br>恰好的帮助。')}${b.skillTabs()}`;right=b.skillList('row');break;
      case 'settings':left=`${b.pageTitle('设置','你的方式。')}${b.settingsTabs()}`;right=b.settingsBody();break;
      case 'login':left=`<h1>很高兴，<br>又见到你。</h1>${b.art('chrome')}`;right=b.loginForm();break;
      case 'install':left=b.installCopy();right=`<div class="split-phone">${b.phone()}</div>`;break;
      case 'tuner':left=`${b.pageTitle('音准工具','听见。<br>对准。')}<p>先选一个音符，再播放参考音。</p>`;right=b.tuner();break;
    }
    return `<div class="layout split-layout">${b.mobile()}<header class="split-header">${b.brand()}${b.nav('text')}${b.utility()}</header><section class="work split-work"><aside class="brief-pane"><div class="brief-scroll">${left}</div>${s.page==='debate'?`<div class="brief-actions">${b.debateSettings()}${b.debateStart()}</div>`:''}${canCompose(s.page)?b.composer('split'):''}</aside>${scroll(right,'result-pane')}</section><footer class="split-status"><span>AI 助手 / ${b.names[s.page]}</span><span>问题与结果，都在眼前。</span></footer></div>`;
  },

  studio(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="studio-home"><div class="studio-home-copy"><span class="eyebrow">你的创作工作室</span><h1>从灵感，<br>到作品。</h1><p>对话、画面与资料，都有自己的位置。</p>${b.goto('开始创作','images','primary')}</div><div class="studio-home-board">${b.art('chrome')}<div class="studio-home-note"><span>IDEA / 01</span><h3>让想法，<br>更具体一点。</h3></div></div></div><div class="studio-launch">${b.suggestions()}</div>`,
      chat:()=>`<div class="studio-document">${b.conversation('document')}</div>`,
      debate:()=>`<div class="studio-discussion"><div class="studio-title">${b.topic('studio')}<span class="workspace-label">多 AI 辩论 / 讨论画布</span></div><div class="studio-mobile-actions">${b.seats('pill')}${b.debateStart()}</div><div class="studio-opinions">${b.opinions('document')}</div>${b.conclusion()}</div>`,
      images:()=>`<div class="studio-mobile-actions">${b.imageTools()}</div>${b.reference()}<div class="studio-artboard">${b.image(0,'canvas')}</div><div class="studio-contact-sheet">${b.images('thumbnail')}</div>`,
      projects:()=>`<div class="studio-title">${b.pageTitle('项目','每个想法，一张工作台。')}${b.projectNew()}</div>${b.projectList('desk')}`,
      project:()=>`<div class="studio-title">${b.pageTitle('项目',b.esc(b.current().name))}${b.attachment()}</div>${b.materials('tiles')}`,
      skills:()=>`${b.pageTitle('更多能力','按需添加，你的工具。')}${b.skillTabs()}${b.skillList('tiles')}`,
      settings:()=>`${b.pageTitle('工作室设置','适合你的工作方式。')}${b.settingsTabs()}${b.settingsBody()}`,
      login:()=>`<div class="studio-login">${b.art('chrome')}${b.loginForm()}</div>`,
      install:()=>`<div class="studio-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('音准工具','让每个音，更准确。')}${b.tuner()}`
    };
    const side=s.page==='images'?`${b.imageModel()}${b.imageTools()}${b.quickImageSettings()}`:s.page==='debate'?`<span class="eyebrow">参与模型</span>${b.seats('stack')}${b.debateSettings()}${b.debateStart()}`:s.page==='project'?b.projectNote():`<span class="eyebrow">相关资料</span>${b.materials('compact')}${b.projectNote()}`;
    return `<div class="layout studio-layout">${b.mobile()}<aside class="studio-tools">${b.brand(true)}${b.nav('rail')}${b.utility()}</aside><div class="studio-center"><header class="studio-header"><span>${b.icon(s.page==='images'?'image':'folder')}<strong>${b.names[s.page]}</strong></span><div>${s.page==='images'?b.button('图像设置','image-settings','secondary small-button'):s.page==='debate'?b.debateSettings():''}${b.button(b.icon('settings'),'inspector','icon','aria-label="查看工作参数"')}</div></header><section class="work studio-work">${scroll(views[s.page]?.()||views.welcome(),'studio-scroll')}${canCompose(s.page)?b.composer('studio'):''}</section></div><aside class="studio-inspector"><header><h3>${s.page==='images'?'创作设置':s.page==='debate'?'讨论设置':'项目资料'}</h3><span>⌘</span></header>${side}</aside></div>`;
  },

  folio(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="folio-cover"><div class="folio-cover-number">01 / A NEW CHAPTER</div><h1>让每个想法，<br>有好的开始。</h1><div class="folio-cover-bottom"><div><p>一个好问题，<br>可以带你去更远的地方。</p>${b.goto('写下第一个问题','chat','text-link')}</div>${b.art('bronze')}</div></div><div class="folio-feature-links">${b.suggestions()}</div>`,
      chat:()=>`<div class="folio-article"><header><span class="eyebrow">对话 / 一页新的想法</span><h1>把灵感，<br>慢慢写清楚。</h1></header><div class="folio-chat-text">${b.conversation('editorial')}</div></div>`,
      debate:()=>`<div class="folio-discussion"><header class="folio-debate-header"><span class="folio-issue">PERSPECTIVES <br>NO. 03</span>${b.topic('editorial')}</header><div class="folio-debate-caption"><span>不同的思考，相同的好奇。</span>${b.debateSettings()}${b.debateStart()}</div><div class="folio-columns">${s.seatModels.map((_,i)=>`<section><div class="folio-column-number">0${i+1}</div>${b.seat(i,'editorial')}${b.opinion(i,'editorial')}</section>`).join('')}</div>${b.conclusion()}</div>`,
      images:()=>`<header class="folio-page-head">${b.pageTitle('视觉随笔','光，形状，与想象。')}${b.imageTools()}</header>${b.reference()}<div class="folio-contact">${b.images('editorial')}</div>`,
      projects:()=>`${b.pageTitle('项目目录','给想法，留个位置。')}${b.projectNew()}${b.projectList('editorial')}`,
      project:()=>`${b.pageTitle('项目手记',b.esc(b.current().name),b.esc(b.current().desc))}<div class="folio-two-col">${b.materials()}${b.projectNote()}</div>`,
      skills:()=>`${b.pageTitle('工具索引','需要时，恰好在。')}${b.skillTabs()}${b.skillList('editorial')}`,
      settings:()=>`${b.pageTitle('你的习惯','小小偏好。<br>刚刚好的帮助。')}<div class="folio-two-col folio-settings">${b.settingsTabs()}${b.settingsBody()}</div>`,
      login:()=>`<div class="folio-login"><div><span class="eyebrow">下一章</span><h1>很高兴，<br>又见到你。</h1>${b.art('bronze')}</div>${b.loginForm()}</div>`,
      install:()=>`<div class="folio-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('聆听的练习','每个音，都有位置。')}${b.tuner()}`
    };
    return `<div class="layout folio-layout">${b.mobile()}<aside class="folio-index">${b.brand()}<span class="eyebrow">CONTENTS</span>${b.nav('index')}<div class="folio-index-bottom">${b.goto('Android App','install')}${b.goto('音准工具','tuner')}<span>给思考，<br>多一点空间。</span></div></aside><section class="work folio-work"><header class="folio-masthead"><span>YOUR IDEAS, WELL CONSIDERED.</span>${b.utility()}</header>${scroll(views[s.page]?.()||views.welcome(),'folio-scroll')}${canCompose(s.page)?b.composer('folio'):''}</section></div>`;
  },

  cinema(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="cinema-home"><div class="cinema-home-image">${b.art('orb')}</div><div class="cinema-home-copy"><span class="eyebrow">灵感，值得被看见。</span><h1>Make room<br>for imagination.</h1><p>给想象，留一个更大的空间。</p>${b.goto('开始你的创作','images','primary')}</div><span class="cinema-frame-label">AI ASSISTANT / YOUR NEXT FRAME</span></div><div class="cinema-reel-links">${b.suggestions()}</div>`,
      chat:()=>`<div class="cinema-story"><div class="cinema-story-title"><span class="eyebrow">一段新的对话</span><h1>一个问题。<br>更多可能。</h1>${b.art('chrome')}</div><div class="cinema-story-answer">${b.conversation('cinema')}</div></div>`,
      debate:()=>`<div class="cinema-discussion"><header><span class="eyebrow">TWO PERSPECTIVES. ONE BETTER ANSWER.</span><h1>不同视角。<br>同一个好问题。</h1><p>简单与强大，如何同时拥有？</p><div class="inline-tools">${b.debateStart()}${b.debateSettings()}</div></header><div class="cinema-duel">${s.seatModels.map((_,i)=>`<section><div class="cinema-duel-image">${b.art(i%2?'chrome':'orb')}<span>0${i+1} / ${i%2?'REFINE':'EXPLORE'}</span></div>${b.seat(i,'cinema')}${b.opinion(i,'cinema')}</section>`).join('')}</div>${b.conclusion()}</div>`,
      images:()=>`<div class="cinema-gallery"><div class="cinema-gallery-head"><h1>你的下一帧。</h1>${b.imageTools()}</div>${b.reference()}${b.image(0,'screen')}<div class="cinema-filmstrip">${b.images('film')}${b.imageModel()}</div></div>`,
      projects:()=>`<div class="cinema-catalog-head">${b.pageTitle('项目','每个想法，<br>都有自己的故事。')}${b.projectNew()}</div>${b.projectList('cover')}`,
      project:()=>`<div class="cinema-project"><div>${b.pageTitle('项目',b.esc(b.current().name),b.esc(b.current().desc))}${b.art('prism')}</div><div>${b.materials()}${b.projectNote()}</div></div>`,
      skills:()=>`${b.pageTitle('更多能力','给创作，一点助力。')}${b.skillTabs()}${b.skillList('cinema')}`,
      settings:()=>`<div class="cinema-settings"><div>${b.pageTitle('你的空间','按自己的方式。')}${b.settingsTabs()}</div>${b.settingsBody()}</div>`,
      login:()=>`<div class="cinema-login"><div>${b.art('orb')}<h1>Every idea<br>starts here.</h1></div>${b.loginForm()}</div>`,
      install:()=>`<div class="cinema-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('声音的形状','听见，每一点不同。')}${b.tuner()}`
    };
    return `<div class="layout cinema-layout">${b.mobile()}<header class="cinema-nav">${b.brand()}${b.nav('text')}${b.utility()}</header><section class="work cinema-work">${scroll(views[s.page]?.()||views.welcome(),'cinema-scroll')}${canCompose(s.page)?b.composer('cinema'):''}</section></div>`;
  },

  messenger(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="messenger-welcome"><div class="messenger-greeting-icon">${b.icon('spark')}</div><h1>嗨，今天聊点什么？</h1><p>想法、问题，或还没成形的一点灵感。</p>${b.suggestions()}</div>`,
      chat:()=>b.conversation('bubbles'),
      debate:()=>`<div class="group-chat"><div class="group-chat-members">${b.seats('pill')}<div class="group-top-actions">${b.debateSettings()}${b.debateStart()}</div></div><span class="chat-marker">今天 · 示例讨论群组</span><div class="group-question"><span>你</span><h1>简单与强大，<br>如何同时拥有？</h1></div><div class="group-thread">${s.seatModels.map((_,i)=>`<div class="group-message"><span class="group-avatar">${i%2?'C':'G'}</span><div>${b.opinion(i,'bubble')}</div></div>`).join('')}</div>${b.conclusion()}</div>`,
      images:()=>`<div class="messenger-image-chat"><div class="chat-marker">图像创作 · 你的作品</div><div class="messenger-image-tools">${b.imageTools()}</div>${b.reference()}<div class="image-chat-turn"><span class="group-avatar">✧</span><div><span class="field-label">${s.imageModel}</span>${b.image(0,'message')}<div class="message-image-references">${b.image(1,'small')}${b.image(2,'small')}</div></div></div></div>`,
      projects:()=>`${b.pageTitle('项目','把相关的想法，放在一起。')}${b.projectNew()}${b.projectList('row')}`,
      project:()=>`${b.pageTitle('项目',b.esc(b.current().name),b.esc(b.current().desc))}${b.materials()}${b.projectNote()}`,
      skills:()=>`${b.pageTitle('能力','需要时，给你帮把手。')}${b.skillTabs()}${b.skillList('row')}`,
      settings:()=>`<div class="messenger-settings">${b.settingsTabs()}${b.settingsBody()}</div>`,
      login:()=>`<div class="messenger-login"><span class="messenger-greeting-icon">${b.icon('spark')}</span>${b.loginForm()}</div>`,
      install:()=>`<div class="messenger-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('音准工具','选择一个音，听一听。')}${b.tuner()}`
    };
    return `<div class="layout messenger-layout">${b.mobile()}<aside class="messenger-rail">${b.brand(true)}${b.nav('rail')}${b.utility()}</aside><aside class="messenger-inbox"><header><h2>对话和任务</h2>${b.ib('plus','new','新建对话')}</header>${b.button(b.icon('search')+'搜索对话','search','inbox-search')}${b.historyList()}<footer>${b.icon('folder')}${b.goto('查看项目资料','project')}</footer></aside><section class="work messenger-work">${b.paneHeader()}${scroll(views[s.page]?.()||views.welcome(),'messenger-scroll')}${canCompose(s.page)?b.composer('messenger'):''}</section></div>`;
  },

  bento(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="bento-home"><section class="bento-welcome card"><span class="eyebrow">新的灵感，从这里开始。</span><h1>今天，<br>想创造点什么？</h1>${b.goto('开始对话','chat','primary')}${b.art('chrome')}</section><section class="bento-shortcuts card"><h2>随手开始</h2>${b.suggestions()}</section><section class="bento-recent card"><header><h2>继续之前的想法</h2>${b.goto('全部项目','projects')}</header>${b.projectList('mini')}</section></div>`,
      chat:()=>`<div class="bento-chat"><div class="bento-answer card">${b.conversation('bento')}</div><aside><div class="card">${b.projectNote()}</div><div class="card">${b.materials('compact')}</div></aside></div>`,
      debate:()=>`<div class="bento-debate"><section class="bento-question card">${b.topic('bento')}${b.debateStart()}<span class="bento-question-mark" aria-hidden="true">✳</span></section><section class="bento-setup card"><h2>一起思考</h2>${b.seats('stack')}${b.debateSettings()}</section><div class="bento-perspectives">${b.opinions('card')}</div>${b.conclusion()}</div>`,
      images:()=>`<div class="bento-images"><header>${b.pageTitle('图像创作','给灵感，一个画面。')}${b.imageTools()}</header>${b.reference()}<div class="bento-image-mosaic">${b.image(0,'large')}<div>${b.image(1)}${b.image(2)}</div><aside class="card">${b.quickImageSettings()}</aside></div></div>`,
      projects:()=>`<div class="bento-heading">${b.pageTitle('项目','灵感，都有自己的位置。')}${b.projectNew()}</div>${b.projectList('desk')}`,
      project:()=>`${b.pageTitle('项目',b.esc(b.current().name),b.esc(b.current().desc))}<div class="bento-project"><div class="card">${b.materials()}</div><div class="card">${b.projectNote()}</div></div>`,
      skills:()=>`${b.pageTitle('能力','让工作，顺手一点。')}${b.skillTabs()}${b.skillList('tiles')}`,
      settings:()=>`${b.pageTitle('设置','打造你的舒适区。')}<div class="bento-settings"><div class="card">${b.settingsTabs()}</div><div class="card">${b.settingsBody()}</div></div>`,
      login:()=>`<div class="bento-login"><section class="card">${b.art('chrome')}<h1>你的想法，<br>值得一个好空间。</h1></section><section class="card">${b.loginForm()}</section></div>`,
      install:()=>`<div class="bento-install"><div class="card">${b.installCopy()}</div><div class="card">${b.phone()}</div></div>`,
      tuner:()=>`${b.pageTitle('音准工具','对准，每一个好声音。')}<div class="card">${b.tuner()}</div>`
    };
    return `<div class="layout bento-layout">${b.mobile()}<aside class="bento-sidebar">${b.brand()}${b.nav('side')}<div class="bento-side-bottom">${b.goto(b.icon('phone')+'Android App','install','text-link')}${b.goto('<span class="avatar">O</span>'+b.esc(s.profile),'settings','text-link')}</div></aside><section class="work bento-work"><header class="bento-toolbar"><span>你的个人工作空间</span>${b.utility()}</header>${scroll(views[s.page]?.()||views.welcome(),'bento-scroll')}${canCompose(s.page)?b.composer('bento'):''}</section></div>`;
  },

  outline(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="outline-welcome"><span class="eyebrow">01 / THINK CLEARLY</span><h1>简单。<br>有力。</h1><p>让问题清晰，让下一步可见。</p>${b.goto('开始对话 '+b.arrow(),'chat','primary')}<div class="outline-welcome-art">${b.art('wire')}</div></div><div class="outline-links">${b.suggestions()}</div>`,
      chat:()=>`<div class="outline-chat"><aside><span class="outline-large-index">01</span><span>对话<br>CONVERSATION</span>${b.goto('相关项目 '+b.arrow(),'project')}</aside>${b.conversation('outline')}</div>`,
      debate:()=>`<div class="outline-debate"><div class="outline-question"><span class="outline-label">03 / 多 AI 辩论</span>${b.topic('outline')}<aside>${b.seats('stack')}${b.debateSettings()}${b.debateStart()}</aside></div><div class="outline-opinions">${b.opinions('outline')}</div>${b.conclusion()}</div>`,
      images:()=>`<header class="outline-page-title">${b.pageTitle('02 / 图像创作','让想象成形。')}${b.imageTools()}</header>${b.reference()}<div class="outline-gallery">${b.images('outline')}</div>`,
      projects:()=>`<header class="outline-page-title">${b.pageTitle('04 / 项目','想法，各就各位。')}${b.projectNew()}</header>${b.projectList('outline')}`,
      project:()=>`${b.pageTitle('04 / 项目',b.esc(b.current().name),b.esc(b.current().desc))}<div class="outline-project">${b.materials()}${b.projectNote()}</div>`,
      skills:()=>`${b.pageTitle('05 / 更多能力','你的下一种能力。')}${b.skillTabs()}${b.skillList('outline')}`,
      settings:()=>`<div class="outline-settings"><div>${b.pageTitle('06 / 设置','你的偏好。')}${b.settingsTabs()}</div>${b.settingsBody()}</div>`,
      login:()=>`<div class="outline-login"><div><span class="eyebrow">AI / ASSISTANT</span><h1>READY<br>WHEN<br>YOU ARE.</h1></div>${b.loginForm()}</div>`,
      install:()=>`<div class="outline-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('08 / 音准工具','听得清。对得准。')}${b.tuner()}`
    };
    return `<div class="layout outline-layout">${b.mobile()}<header class="outline-nav">${b.brand()}${b.nav('text')}${b.utility()}</header><section class="work outline-work">${scroll(views[s.page]?.()||views.welcome(),'outline-scroll')}${canCompose(s.page)?b.composer('outline'):''}</section><footer class="outline-footer"><span>AI ASSISTANT</span><span>清晰，从这里开始。</span>${b.goto('ANDROID APP ↗','install')}</footer></div>`;
  },

  notebook(b){
    const {s}=b;
    const views={
      welcome:()=>`<div class="notebook-cover"><div class="notebook-cover-copy"><span class="eyebrow">一本，属于你的想法。</span><h1>今天，<br>写下点什么？</h1><p>对话、灵感与下一步，都在这里。</p>${b.goto('开始这一页','chat','primary')}</div><div class="notebook-cover-image">${b.art('bronze')}<span>Keep a little room<br>for a new idea.</span></div></div><div class="notebook-suggestions">${b.suggestions()}</div>`,
      chat:()=>`<div class="notebook-note"><div class="notebook-note-date">今天 / 对话手记</div><h1>把灵感，写成下一步。</h1>${b.conversation('notebook')}</div>`,
      debate:()=>`<div class="notebook-debate"><div class="notebook-note-date">讨论手记 / 第 ${s.debateDone?s.rounds:1} 轮</div>${b.topic('notebook')}<div class="notebook-participants">${b.seats('pill')}${b.debateSettings()}${b.debateStart()}</div><div class="notebook-perspectives">${b.opinions('notebook')}</div>${b.conclusion()}</div>`,
      images:()=>`<div class="notebook-photo-page"><header>${b.pageTitle('灵感剪贴簿','把想象，贴在这一页。')}${b.imageTools()}</header>${b.reference()}<div class="notebook-photos">${b.images('print')}</div></div>`,
      projects:()=>`${b.pageTitle('项目书架','那些值得继续的想法。')}${b.projectNew()}${b.projectList('notebook')}`,
      project:()=>`${b.pageTitle('项目笔记',b.esc(b.current().name),b.esc(b.current().desc))}<div class="notebook-project">${b.materials()}${b.projectNote()}</div>`,
      skills:()=>`${b.pageTitle('工具箱','需要的时候，随手可得。')}${b.skillTabs()}${b.skillList('notebook')}`,
      settings:()=>`<div class="notebook-settings"><div>${b.pageTitle('偏好','刚刚好，适合你。')}${b.settingsTabs()}</div>${b.settingsBody()}</div>`,
      login:()=>`<div class="notebook-login"><div><span class="eyebrow">继续你的下一页</span><h1>很高兴，<br>你又来了。</h1>${b.art('bronze')}</div>${b.loginForm()}</div>`,
      install:()=>`<div class="notebook-install">${b.installCopy()}${b.phone()}</div>`,
      tuner:()=>`${b.pageTitle('练习笔记','听见，一点点进步。')}${b.tuner()}`
    };
    return `<div class="layout notebook-layout">${b.mobile()}<header class="notebook-header">${b.brand()}${b.utility()}</header><nav class="notebook-tabs" aria-label="功能书签">${b.nav('tabs')}</nav><section class="work notebook-work"><aside class="notebook-margin"><span>YOUR<br>IDEAS.</span>${b.ib('history','search','历史对话')}${b.ib('folder','navigate','项目资料','data-page="project"')}</aside>${scroll(views[s.page]?.()||views.welcome(),'notebook-paper')}${canCompose(s.page)?b.composer('notebook'):''}</section></div>`;
  }
};
