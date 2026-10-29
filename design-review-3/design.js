import {installExplorer} from './explorer.js';
import {directions as themes,sculpture} from './directions.js';
import {createExperience} from './experience.js';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  chat:'<path d="M20 11.5a8 8 0 0 1-8 8H4l-1 1v-9a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8Z"/><path d="M7 9h9M7 13h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  debate:'<path d="M8 5v14M4 19h9M3 8h10M8 3v2M16 5v14M12 19h9M11 8h10"/><path d="m4 8-2 6h5L5 8m10 0-2 6h6l-2-6"/>',
  grid:'<rect x="3.5" y="3.5" width="6" height="6" rx="1.4"/><rect x="14.5" y="3.5" width="6" height="6" rx="1.4"/><rect x="3.5" y="14.5" width="6" height="6" rx="1.4"/><rect x="14.5" y="14.5" width="6" height="6" rx="1.4"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  pin:'<path d="m15 3 6 6-4 1-4 5-1 4-7-7 4-1 5-4Z"/><path d="m8 16-4 4"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  down:'<path d="m7 10 5 5 5-5"/>',
  right:'<path d="m9 6 6 6-6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  more:'<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
  send:'<path d="M19 5v10H5m5-5-5 5 5 5"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  phone:'<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10 5h4M11 19h2"/>',
  sidebar:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M6 8v5"/>',
  history:'<path d="M4 7a9 9 0 1 1-1 7M4 2v5h5M12 7v6l4 2"/>',
  edit:'<path d="m14 5 5 5M4 20l4-1L21 6a2 2 0 0 0-3-3L5 16Z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  moon:'<path d="M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
  memory:'<path d="M8 4c-5-2-8 5-4 7-5 4 0 10 4 8m8-15c5-2 8 5 4 7 5 4 0 10-4 8M8 3v18M16 3v18M8 8H6m10 8h3M8 15H5m11-8h3"/>',
  sound:'<path d="M4 10v4h4l5 4V6l-5 4Z"/><path d="M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/>',
  note:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  keyboard:'<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M6 9h1m4 0h1m4 0h1M6 13h1m4 0h1m4 0h1M7 16h10"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'
};
const icon = name => `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const ib = (name, action, label, attrs='') => `<button type="button" class="icon ${name==='close'?'close':''}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
const pet = '/assets/kitten/motion/portrait.png';
const pages = [
 ['login','登录','登录与进入','user'],['welcome','首页','新对话与快捷入口','spark'],['chat','对话','历史、模型与思考强度','chat'],
 ['images','图像创作','生成、单图与多图编辑','image'],['debate','多 AI 辩论','席位、角色、轮次与总结','debate'],['projects','项目','项目列表、资料与记忆','folder'],
 ['skills','Skills','工具能力与启用状态','grid'],['settings','设置','账号、外观、模型与记忆','settings'],['install','Android App','安装与网页同步更新','phone'],['project','项目详情','资料库、项目设置与连续对话','folder'],['tuner','音准工具','音高、参考音与演示','note']
];
const models = ['Gemini 4','Claude Fable 5.1','Claude Opus 5.5','Claude Sonnet 5.5','Grok 4.7'];
const state = {theme:'apple',page:'welcome',previewState:'normal',customPrompt:'先说重点，使用自然、清楚的语言。对不确定的信息明确说明。',imageThinking:'medium',imageGrounding:'off',imageQuality:'auto',imageCount:1,chat:'c1',model:'Gemini 4',effort:2,draft:'',incognito:false,search:false,modelOpen:false,attachmentOpen:false,online:false,attached:[],messages:[],busy:false,settings:'account',imageMode:'generate',imageModel:'Nano Banana 2.1',ratio:'3:2',resolution:'1K',style:'无预设',imageSearch:false,imageText:true,rounds:2,debateMode:'free',seatModels:['Gemini 4','Claude Opus 5.5'],debateDone:false,skillFilter:'全部',project:'p1',profile:'体验账号',note:'A',noteRunning:false,memory:true,compact:false};
let serial=10,toastTimer,undoAction=null,selectionTarget=null,simulateTimer=null;
const chats=[
 {id:'c1',title:'给灵感一个开始',excerpt:'先找到重点，再把想法变成行动。',pinned:true},
 {id:'c2',title:'春日产品拍摄方案',excerpt:'自然光、暖白背景与克制的构图。',pinned:true},
 {id:'c3',title:'关于品牌的一些新想法',excerpt:'用更简单的语言，说清楚我们是谁。',pinned:false},
 {id:'c4',title:'一份轻松的周末计划',excerpt:'把时间留给散步、阅读和好好休息。',pinned:false},
 {id:'c5',title:'落日、海岸与一杯咖啡',excerpt:'图像创作 · 3:2 · 1K',pinned:false},
 {id:'c6',title:'网站交互细节整理',excerpt:'减少干扰，保持每次操作的确定感。',pinned:false}
];
const projects=[
 {id:'p1',name:'春日品牌计划',desc:'从品牌语言，到视觉与产品表达。',files:3,count:8,icon:'folder'},
 {id:'p2',name:'日常灵感手册',desc:'记下那些还没成形、但值得留下的想法。',files:2,count:12,icon:'spark'},
 {id:'p3',name:'产品与设计',desc:'资料、调研和下一步的工作。',files:5,count:6,icon:'grid'},
 {id:'p4',name:'旅行小记',desc:'路线、清单，以及旅途中的偶然发现。',files:1,count:3,icon:'globe'}
];
const files=[{id:'f1',project:'p1',name:'品牌调性与表达.md',type:'Markdown',size:'4.2 KB',text:'# 品牌调性与表达\n\n清楚、温和、有分寸。\n\n我们希望每一次表达，都能让人自然理解产品的价值。\n\n## 核心原则\n\n1. 优先使用简短、具体的语言。\n2. 让留白帮助内容呼吸。\n3. 用真实的细节代替空泛的形容。\n\n## 视觉方向\n\n温润的中性色，自然的光线，以及少量有意义的色彩。'},
 {id:'f2',project:'p1',name:'春日拍摄参考.pdf',type:'PDF 摘要',size:'1.8 MB',text:'春日拍摄参考\n\n场景：清晨的自然光与温暖的室内空间。\n\n构图：主体留出呼吸空间，避免过多道具。\n\n色彩：暖白、浅灰、雾绿；少量深色作为视觉支点。\n\n交付：横版主图、竖版故事图与细节特写。\n\n此处为设计预览的示例资料摘要。'},
 {id:'f3',project:'p1',name:'产品信息整理.txt',type:'纯文本',size:'2.1 KB',text:'产品信息整理\n\n项目目标\n统一产品描述与视觉呈现。\n\n下一步\n- 确定拍摄清单\n- 核对每款产品的真实信息\n- 收集图片参考\n- 讨论品牌文案\n\n以上均为预览示例内容。'}];
for(const p of projects.slice(1))for(let i=0;i<p.files;i++)files.push({...files[i%3],id:p.id+'f'+i,project:p.id});
const skills=[
 {id:'writing',name:'写作与润色',desc:'理清思路，让文字更准确、更自然。',icon:'edit',category:'文字',on:true},
 {id:'research',name:'资料研究',desc:'带着问题阅读资料，整理线索与出处。',icon:'search',category:'研究',on:true},
 {id:'visual',name:'视觉创意',desc:'从构图、配色到提示词，找到合适的表达。',icon:'image',category:'创作',on:false},
 {id:'code',name:'编程助手',desc:'解释代码、排查问题、整理实现思路。',icon:'keyboard',category:'研究',on:true},
 {id:'plan',name:'计划与清单',desc:'把复杂的任务，拆成可以开始的一小步。',icon:'check',category:'文字',on:false},
 {id:'sound',name:'音准工具',desc:'查看音高与参考音，练习时多一个小帮手。',icon:'note',category:'创作',on:false}
];
const gallery=[{id:'landscape',name:'能量场 / Energy',sub:'3:2 · 1K · 内置设计素材',src:'./orb.svg'},{id:'objects',name:'液态金属 / Metal',sub:'1:1 · 内置设计素材',src:'./chrome.svg'},{id:'poster',name:'光的形状 / Prism',sub:'3:4 · 内置设计素材',src:'./prism.svg'}];
function effortNames(){return state.model.startsWith('Claude')?['Low','Medium','High','Extra high','Max']:state.model.startsWith('Grok')?['Low','Medium','High','Extra high']:['Low','Medium','High']}
const V=createExperience({state,effortNames,showModal,themes,sculpture,icon,ib,button,esc,pet,chats,projects,files,gallery,skills,nav,historyLane,inspector,toolbar,renderPage,composer,updateSend,assistant,modelOptions,effortInput,fileRows,history,settingsContent,projectFiles,title});
function button(label,action,cls='secondary',attrs=''){return `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`}
function themePicker(){return V.themePicker()}
function nav(){return `<aside class="nav-pane" aria-label="主导航"><div class="brand"><a class="brand-home" href="#${state.theme}/welcome"><span class="brand-mark">${icon('spark')}</span><span class="brand-text">AI 助手</span></a>${ib('search','search','搜索对话')}</div><nav class="nav-links">${button(icon('plus')+'<span>新建对话</span><small>⌘ N</small>','new','nav-link new-chat')}${[['chat','对话','chat'],['images','图像创作','image'],['debate','多 AI 辩论','debate'],['projects','项目','folder'],['skills','Skills','grid']].map(([p,n,i])=>`<button class="nav-link" data-action="navigate" data-page="${p}" title="${n}" ${state.page===p||(state.page==='project'&&p==='projects')?'aria-current="page"':''}>${icon(i)}<span>${n}</span></button>`).join('')}${state.theme==='studio'?button(icon('search')+'<span>搜索对话</span><small>⌘ K</small>','search','nav-link'):''}</nav><section class="sidebar-history"><div class="section-label"><span>对话和任务</span>${ib('settings','sort','排序对话')}</div><div class="history-list">${history()}</div></section><footer class="nav-bottom">${button(icon('phone')+'<span>安装 Android App</span>','navigate','install-link','data-page="install"')}<button class="account" data-action="navigate" data-page="settings" aria-label="账号与设置"><span class="avatar">O</span><span>${esc(state.profile)}<small>个人工作空间</small></span>${icon('settings')}</button></footer></aside>`}
function history(query=''){let list=chats.filter(c=>c.title.includes(query)).sort((a,b)=>Number(b.pinned)-Number(a.pinned));return list.map((c,i)=>`${i===0?'<div class="history-group">'+(c.pinned?'置顶':'最近')+'</div>':(list[i-1].pinned&&!c.pinned?'<div class="history-group">最近</div>':'')}<div class="history-row ${state.chat===c.id?'selected':''}" data-chat-row="${c.id}"><button class="history-open" data-action="open-chat" data-id="${c.id}" title="${esc(c.title)}">${icon('chat')}<strong>${esc(c.title)}</strong></button><div class="history-actions"><button class="icon pin ${c.pinned?'pinned':''}" data-action="pin" data-id="${c.id}" aria-label="${c.pinned?'取消置顶':'置顶'}：${esc(c.title)}" aria-pressed="${c.pinned}">${icon('pin')}</button><button class="icon close" data-action="delete-chat" data-id="${c.id}" aria-label="删除：${esc(c.title)}">${icon('close')}</button></div><span class="history-excerpt">${esc(c.excerpt)}</span></div>`).join('')||'<div class="empty">没有找到相关对话</div>'}
function historyLane(){return `<aside class="history-lane" aria-label="会话列表"><header class="lane-head"><h2>${state.page==='images'?'创作记录':'对话和任务'}</h2>${ib('search','search','搜索对话')}</header><div class="history-list">${history()}</div><footer class="lane-foot">${chats.length} 条示例对话 · 仅用于设计预览</footer></aside>`}
function inspector(){return `<aside class="inspector" aria-label="工作参数"><div class="inspector-block"><h3>当前模型</h3><button class="inspector-model-button" data-action="inspector-model">${esc(state.model)}${icon('down')}</button><div class="effort-value"><span>${effortNames()[state.effort]}</span><small>思考强度</small></div>${effortInput()}</div><div class="inspector-block"><h3>项目资料 <span class="tag">3</span></h3>${fileRows(files.slice(0,2))}${button('查看项目资料 '+icon('right'),'open-project','quiet','data-id="p1"')}</div><div class="inspector-block"><h3>最近的对话</h3><div class="history-list">${history()}</div></div><div class="inspector-block"><p class="form-help">这是整站设计预览。模型、资料和会话均使用示例内容，操作不产生 API 费用。</p></div></aside>`}
function title(){if(state.page==='chat')return chats.find(c=>c.id===state.chat)?.title||'新对话';if(state.page==='project')return projects.find(p=>p.id===state.project)?.name||'项目';return pages.find(p=>p[0]===state.page)?.[1]||'AI 助手'}
function toolbar(){return `<header class="main-toolbar"><div class="toolbar-title">${ib('sidebar','sidebar','打开侧边栏').replace('class="icon ','class="icon mobile-menu ')}<h2>${esc(title())}</h2><span>${state.page==='chat'?'个人工作空间':'AI 助手'}</span></div><div class="toolbar-actions">${state.page==='chat'||state.page==='welcome'?`<button class="quiet" data-action="incognito" aria-pressed="${state.incognito}">${icon('shield')}无痕模式</button>`:''}${ib('settings','inspector','查看工作参数','data-inspector-toggle').replace('class="icon ','class="icon inspector-toggle ')}${ib('more','page-actions','更多操作')}</div></header>`}
function render(){return V.render()}
function heading(eyebrow,title,sub,action=''){return V.heading(eyebrow,title,sub,action)}
function renderPage(){switch(state.page){case'welcome':return welcome();case'chat':return chat();case'images':return images();case'debate':return debate();case'projects':return projectList();case'project':return projectDetail();case'skills':return skillsPage();case'settings':return settings();case'install':return install();case'tuner':return tuner();default:return welcome()}}
function welcome(){return V.welcome()}
const initialResponse=`<p>好的。先给想法留一点空间，再让它一步步清晰起来。</p><p>一个舒服的开始，通常只需要回答三个问题：</p><div class="response-grid"><div><strong>你想做什么？</strong><small>用一句简单的话，描述此刻最想推进的事。</small></div><div><strong>什么最重要？</strong><small>选一个重点，让后面的每一步都有方向。</small></div></div><p>不必一次想得完整。你可以先把零散的想法写下来，我会帮你梳理线索、补充细节，整理成一份可以继续的计划。</p><div class="response-callout">先有一个小小的开始，就已经很好。</div>`;
function assistant(content,thinking=true){return `<article class="assistant-turn"><div class="assistant-meta"><img class="pet-avatar" src="${pet}" alt="袁啾啾"><div><strong>${esc(state.model)}</strong><small>思考强度 ${effortNames()[state.effort]} · 示例回复</small></div></div>${thinking?`<details class="thinking"><summary>${icon('right')}思考记录</summary><p>先理解目标，再确定重点。这里展示的是交互和阅读样式的示例，不是实际模型输出。</p></details>`:''}<div class="response-body">${content}</div><div class="message-actions">${ib('copy','copy','复制回复')}${ib('refresh','regenerate','重新查看示例回复')}${ib('more','message-more','更多回复操作')}<span>示例内容 · 不产生费用</span></div></article>`}
function chat(){return V.chat()}
function modelOptions(){const selectedModel=selectionTarget===null?state.model:state.seatModels[selectionTarget];return `<div class="model-options">${models.map((m,i)=>`<button type="button" class="model-option ${selectedModel===m?'selected':''}" data-action="model" data-value="${m}"><span>${m}<small>${i===0?'Google':i===4?'xAI':'Anthropic'}</small></span>${selectedModel===m?icon('check'):''}</button>`).join('')}</div>`}
function effortInput(){return `<input class="effort-slider" style="--level:${state.effort/(effortNames().length-1)*100}%" type="range" min="0" max="${effortNames().length-1}" step="1" value="${state.effort}" aria-label="思考强度" aria-valuetext="${effortNames()[state.effort]}"><div class="effort-labels">${effortNames().map(n=>`<span>${n}</span>`).join('')}</div>`}
function modelPanel(){return `<div class="model-panel" role="dialog" aria-label="模型与思考强度"><div class="panel-label">思考强度</div><div class="effort-value"><span data-effort-label>${effortNames()[state.effort]}</span><small>拖动选择</small></div>${effortInput()}${modelOptions()}<p>预览中的参数仅展示交互，不会向模型发送请求。</p></div>`}
function composer(){let image=state.page==='images';let placeholder=image?(state.imageMode==='generate'?'描述你想生成的图片…':'你想怎样修改这张图片？'):state.page==='debate'?'写下一个值得讨论的问题…':'输入内容…';return `<div class="composer-wrap"><form id="composer-form" class="composer">${state.attached.length?`<div class="attached">${state.attached.map(a=>a.url?`<img src="${esc(a.url)}" alt="本地参考图">`:`${icon('file')}`).join('')}<span>${state.attached.length} 个本地附件</span>${ib('close','clear-attachments','移除附件')}</div>`:''}<textarea id="draft" rows="1" aria-label="消息内容" placeholder="${placeholder}">${esc(state.draft)}</textarea><div class="composer-footer"><div class="attachment-control">${ib('plus','attachment-menu','添加附件或工具').replace('class="icon ','class="icon add ')}${state.attachmentOpen?`<div class="attachment-menu" role="menu">${button(icon('image')+'上传图片','upload-image','','role="menuitem"')}${button(icon('file')+'上传文件','upload-file','','role="menuitem"')}<button type="button" data-action="online" role="menuitemcheckbox" aria-checked="${state.online}">${icon('globe')}联网搜索<span class="switch ${state.online?'on':''}" aria-hidden="true"></span></button></div>`:''}</div>${image?`<button type="button" class="composer-context" data-action="image-settings" title="打开图像设置">${esc(state.ratio)} · ${state.resolution} · 图像设置</button>`:state.online?'<span class="composer-context">联网搜索已开启</span>':'<span class="composer-context">'+(state.incognito?'无痕对话':'')+'</span>'}<div class="model-control">${image?`<button type="button" class="model-button" data-action="image-model" aria-haspopup="dialog">${state.imageModel}${icon('down')}</button>`:`<button type="button" class="model-button" data-action="model-panel" aria-haspopup="dialog" aria-expanded="${state.modelOpen}">${state.model}<span data-button-effort>${effortNames()[state.effort]}</span>${icon('down')}</button>${state.modelOpen?modelPanel():''}`}</div><button class="send" type="submit" aria-label="${image?'生成图片':'发送消息'}" ${state.busy?'disabled':''}>${icon('send')}</button></div></form><div class="composer-note"><span>${state.incognito?'无痕模式 · 本次内容不保存':'AI 可能会出错，请核对重要信息。'}</span><span>Enter 发送 · Shift Enter 换行</span></div></div>`}
function images(){return V.images()}
function projectList(){return V.projectList()}
function fileRows(list){return list.map(f=>`<button class="file-row" data-action="file" data-id="${f.id}"><span class="file-symbol">${icon('file')}</span><span><strong>${esc(f.name)}</strong><small>${f.type} · ${f.size}</small></span>${icon('right')}</button>`).join('')}
function projectFiles(){return files.filter(f=>f.project===state.project)}
function projectDetail(){let p=projects.find(p=>p.id===state.project)||projects[0];return `<div class="page">${heading('PROJECT WORKSPACE',esc(p.name),esc(p.desc),button(icon('settings')+'项目设置','project-settings','secondary'))}<div class="segmented" style="margin-bottom:24px">${button('项目资料','project-files','','aria-pressed="true"')}${button('相关对话','project-chats','','aria-pressed="false"')}</div><div class="inline-actions" style="justify-content:space-between"><h3>资料库 <span class="tag">${projectFiles().length}</span></h3>${button(icon('upload')+'添加资料','upload-project','secondary')}</div><div class="file-list">${projectFiles().length?fileRows(projectFiles()):'<div class="empty">还没有资料。点击上方「添加资料」，从一个小小的开始出发。</div>'}</div><div class="project-note"><strong>项目提示词</strong>用清楚、温和、具体的语言表达。创作前先阅读项目资料，让每一次对话都能延续之前的方向。</div><div class="image-hint">${icon('memory')}项目资料与记忆在正式功能中独立于普通对话。</div></div>`}
function debate(){return V.debate()}
function skillsPage(){return V.skillsPage()}
const settingSections=[['account','个人账号','user'],['appearance','外观与使用','sun'],['models','模型服务','grid'],['memory','提示词与记忆','memory']];
function settings(){return `<div class="page wide">${heading('MAKE IT YOURS','按你的习惯来。','少一点打扰，多一点恰到好处。')}<div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${settingSections.map(([v,l,i])=>button(icon(i)+l,'setting-tab','','data-value="'+v+'" aria-pressed="'+(state.settings===v)+'"')).join('')}</nav><section class="settings-content">${settingsContent()}</section></div></div>`}
function toggle(label,desc,key,on){return `<div class="toggle-row"><div>${label}<p>${desc}</p></div><button data-action="preference" data-key="${key}" role="switch" aria-checked="${on}" aria-label="${label}"><span class="switch ${on?'on':''}" aria-hidden="true"></span></button></div>`}
function settingsContent(){switch(state.settings){case'appearance':return `<h2 class="settings-title">外观与使用</h2><div class="field-section"><div class="field-label">整站设计风格</div><div class="style-swatches">${themes.map(t=>button(`<i style="--swatch:${t.color}"></i>${t.name}`,'theme','style-swatch',`data-theme="${t.id}" aria-pressed="${t.id===state.theme}"`)).join('')}</div></div>${toggle('紧凑阅读','减少内容之间的空隙，适合高频浏览。','compact',state.compact)}${toggle('联网搜索','在对话中显示搜索状态，具体调用以正式模型能力为准。','online',state.online)}<p class="form-help">你可以在此切换整站方案，比较同一页面的不同设计。</p>`;case'models':return `<h2 class="settings-title">模型服务</h2><p class="form-help">展示服务连接与模型选择的界面设计。这里的状态为示例，不代表真实 API 的运行状态。</p>${[['Google','Gemini 4 · Nano Banana 2.1','G'],['Anthropic','Claude Fable / Opus / Sonnet','C'],['xAI','Grok · Grok Image','𝕏']].map(([n,d,i])=>`<div class="model-status"><span class="provider-mark">${i}</span><div>${n}<small>${d}</small></div><span class="tag"><i class="status-dot"></i>示例连接</span>${ib('settings','service','查看'+n+'服务设置','data-value="'+n+'"')}</div>`).join('')}<p class="form-help">正式 API key 继续由服务器管理。设计预览无需输入密钥。</p>`;case'memory':return `<h2 class="settings-title">提示词与记忆</h2>${toggle('个人记忆','保存偏好，让后续对话更连贯。项目记忆单独管理。','memory',state.memory)}<label class="form-field" style="margin-top:22px">你希望助手怎样回复？<textarea id="custom-prompt" rows="4" placeholder="例如：先讲结论，尽量简洁，用中文回复。">${esc(state.customPrompt)}</textarea></label><div class="project-note"><strong>已记录的示例偏好</strong>偏好中文交流；界面清爽；需要保留足够的阅读空间。</div><div class="settings-actions">${button('保存到预览','save-settings','primary')}</div>`;default:return `<div class="profile"><span class="avatar">O</span><div><strong>${esc(state.profile)}</strong><small>个人工作空间 · 设计预览账号</small></div></div><label class="form-field">显示名称<input id="profile-name" value="${esc(state.profile)}" autocomplete="off" maxlength="30"></label><div class="toggle-row"><div>账号安全<p>密码与登录记录在正式账号设置中管理。</p></div>${button('查看','security','secondary')}</div><div class="toggle-row"><div>数据与隐私<p>管理会话与项目资料，控制自己的内容。</p></div>${button('查看','privacy','secondary')}</div><div class="settings-actions">${button('保存到预览','save-settings','primary')}</div><div class="divider"></div>${button('查看登录页面','navigate','quiet','data-page="login"')}`}}
function login(){return V.login()}
function install(){return V.install()}
function tuner(){return V.tuner()}
function showModal(title,content,cls=''){const m=$('#modal'),alreadyOpen=m.open;m.className='modal '+cls;m.innerHTML=`<header class="modal-header"><h2 id="modal-title">${title}</h2>${ib('close','close-modal','关闭')}</header><div class="modal-content">${content}</div>`;if(!alreadyOpen)m.showModal();else $('.modal-content button,.modal-content input',m)?.focus()}
function toast(text,undo=null){clearTimeout(toastTimer);undoAction=undo;$('#toast').innerHTML=`<span>${esc(text)}</span>${undo?button('撤销','undo',''):''}`;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;undoAction=null},undo?6500:3300)}
function navigate(page){document.body.classList.remove('nav-open');state.page=page;state.modelOpen=false;state.attachmentOpen=false;location.hash=`${state.theme}/${page}`;render()}
function setTheme(id){if(!themes.some(t=>t.id===id))return;state.theme=id;location.hash=`${id}/${state.page}`;render()}
function pagePicker(){showModal('浏览整套设计',`<p class="subtle">当前：${themes.find(t=>t.id===state.theme).name}。切换页面时会保留所选方案。</p><div class="page-directory">${pages.map(([p,n,d,i])=>button(icon(i)+`<span>${n}<small>${d}</small></span>`,'directory-page',state.page===p?'selected':'','data-page="'+p+'"')).join('')}</div><p class="directory-footer">十套方案均覆盖以上页面，以及项目详情、资料预览、图像参数、模型选择等展开状态。设计参考 <a href="https://www.apple.com/" target="_blank" rel="noopener">Apple.com 官网视觉参考</a>。</p>`)}
function imageSettings(){return V.imageSettings()}
function openSearch(){showModal('搜索对话',`<div class="search-field"><input type="search" id="history-query" placeholder="搜索示例对话…" aria-label="搜索示例对话" autocomplete="off"></div><div id="search-results" class="search-results">${history()}</div>`);$('#history-query').focus()}
function formModal(title,fields,action){showModal(title,`<form id="modal-form" data-submit="${action}">${fields}<div class="modal-footer">${button('取消','close-modal','secondary')}<button class="primary" type="submit">保存</button></div></form>`)}
function currentProject(){return projects.find(p=>p.id===state.project)||projects[0]}
function scrollBottom(){const el=$('#page-scroll');if(el)el.scrollTop=el.scrollHeight}
function send(){if(!state.draft.trim()||state.busy)return;const text=state.draft.trim();state.draft='';state.modelOpen=false;state.attachmentOpen=false;if(state.page==='images'){V.imageResult(text);render();return}if(state.page==='debate'){state.debateDone=true;render();scrollBottom();toast('已展示讨论结果示例，没有调用模型');return}if(state.page==='project'){state.chatContext=state.project;state.page='chat'}if(state.page==='welcome')state.page='chat';state.messages.push({role:'user',text});state.busy=true;location.hash=`${state.theme}/${state.page}`;render();scrollBottom();clearTimeout(simulateTimer);simulateTimer=setTimeout(()=>{state.busy=false;state.messages.push({role:'assistant',text:`<p>收到。我们可以从「${esc(text.slice(0,80))}」开始，把目标、重点和下一步分别写清楚。</p><p>这是一条本地示例回复，用来体验消息发送、阅读和模型切换的界面。没有向模型发送请求，也不会产生 API 费用。</p>`});render();scrollBottom()},750)}
function updateSend(){const b=$('#composer-form .send');if(b)b.disabled=!state.draft.trim()||state.busy}
function upload(kind){const input=$('#file-picker');input.accept=kind==='image'?'image/*':'.txt,.md,.pdf,.csv,.json';input.multiple=true;input.dataset.kind=kind;input.value='';input.click()}
document.addEventListener('submit',e=>{e.preventDefault();if(e.target.id==='composer-form')send();else if(e.target.id==='login-form'){navigate('welcome');toast('已进入设计预览，无需真实账号')}else if(e.target.id==='modal-form'){const data=new FormData(e.target),action=e.target.dataset.submit;const name=String(data.get('name')||'').trim();if(!name){toast('请填写名称');return}if(action==='new-project'){state.previewState='normal';projects.unshift({id:'p'+(++serial),name,desc:String(data.get('desc')||'一个新的工作空间。'),files:0,count:0,icon:'folder'});$('#modal').close();navigate('projects');toast('已在预览中创建项目')}else if(action==='project-settings'){Object.assign(currentProject(),{name,desc:String(data.get('desc')||'')});$('#modal').close();render();toast('已保存项目示例设置')}else if(action==='rename'){const c=chats.find(c=>c.id===state.chat);if(c)c.title=name;$('#modal').close();render();toast('已修改示例对话名称')}}});
document.addEventListener('keydown',e=>{if(e.target.id==='draft'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openSearch()}if((e.metaKey||e.ctrlKey)&&e.key==='n'){e.preventDefault();state.draft='';state.messages=[];navigate('welcome')}if(e.key==='Escape'){state.modelOpen=false;state.attachmentOpen=false;document.body.classList.remove('nav-open');if(!$('#modal').open)render()}});
document.addEventListener('input',e=>{if(e.target.id==='draft'){state.draft=e.target.value;updateSend();e.target.style.height='auto';e.target.style.height=Math.min(150,e.target.scrollHeight)+'px'}if(e.target.id==='history-query')$('#search-results').innerHTML=history(e.target.value);if(e.target.classList.contains('effort-slider')){state.effort=Number(e.target.value);$$('[data-effort-label],[data-button-effort]').forEach(n=>n.textContent=effortNames()[state.effort]);$$('.effort-slider').forEach(n=>{n.value=state.effort;n.style.setProperty('--level',(state.effort/(effortNames().length-1)*100)+'%');n.setAttribute('aria-valuetext',effortNames()[state.effort])})}});
document.addEventListener('change',async e=>{if(e.target.id!=='file-picker')return;const limit=e.target.dataset.kind==='image'&&state.page==='images'?V.imageCaps().references:8;const list=[...e.target.files].slice(0,limit);if(!list.length)return;if(e.target.dataset.kind==='project'){for(const file of list){const id='f'+(++serial);files.push({id,project:state.project,name:file.name,type:'本地资料',size:(file.size/1024).toFixed(1)+' KB',text:/\.(md|txt|csv|json)$/i.test(file.name)?(await file.text()).slice(0,50000):'文件仅留在当前预览中。此格式在预览中显示文件信息。'});currentProject().files++}render();toast('已添加到预览资料库，没有上传到服务器')}else{for(const a of state.attached)if(a.url)URL.revokeObjectURL(a.url);state.attached=list.map(f=>({name:f.name,url:f.type.startsWith('image/')?URL.createObjectURL(f):null}));state.attachmentOpen=false;render();toast('附件仅用于本地预览')}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b){if(state.modelOpen&&!e.target.closest('.model-panel,.model-control')){state.modelOpen=false;render()}return}const a=b.dataset.action,v=b.dataset.value,id=b.dataset.id;switch(a){
 case'theme':setTheme(b.dataset.theme);break;
 case'navigate':state.chatContext=null;navigate(b.dataset.page);break;
 case'new':state.chatContext=null;state.messages=[];state.draft='';navigate('welcome');break;
 case'page-picker':pagePicker();break;
 case'directory-page':$('#modal').close();navigate(b.dataset.page);break;
 case'sidebar':document.body.classList.toggle('nav-open');break;
 case'incognito':state.incognito=!state.incognito;render();toast(state.incognito?'已开启预览无痕模式':'已关闭预览无痕模式');break;
 case'search':openSearch();break;
 case'open-chat':state.chatContext=null;if($('#modal').open)$('#modal').close();state.chat=id;state.messages=[];navigate('chat');break;
 case'pin':{let c=chats.find(c=>c.id===id);c.pinned=!c.pinned;const search=$('#history-query')?.value;render();if($('#modal').open&&$('#search-results'))$('#search-results').innerHTML=history(search);toast(c.pinned?'已置顶示例对话':'已取消置顶');break}
 case'delete-chat':{const c=chats.find(c=>c.id===id);showModal('删除这条示例对话？',`<p class="subtle">「${esc(c.title)}」将从当前预览中移除。此操作不影响正式网站的会话，删除后可以撤销。</p><div class="modal-footer">${button('取消','close-modal','secondary')}${button('删除示例','confirm-delete','primary danger','data-id="'+id+'"')}</div>`);break}
 case'confirm-delete':{const i=chats.findIndex(c=>c.id===id),removed=chats.splice(i,1)[0];$('#modal').close();render();toast('已移除示例对话',()=>{chats.splice(i,0,removed);render();toast('已恢复示例对话')});break}
 case'undo':if(undoAction)undoAction();break;
 case'close-modal':$('#modal').close();break;
 case'sort':chats.reverse();render();toast('已反转最近对话顺序，置顶仍优先显示');break;
 case'suggest':state.draft=b.dataset.text;render();$('#draft')?.focus();break;
 case'model-panel':state.modelOpen=!state.modelOpen;state.attachmentOpen=false;render();break;
 case'model':if(selectionTarget!==null){state.seatModels[selectionTarget]=v;selectionTarget=null;$('#modal').close()}else{state.model=v;state.effort=Math.min(state.effort,effortNames().length-1);}state.modelOpen=false;render();break;
 case'attachment-menu':state.attachmentOpen=!state.attachmentOpen;state.modelOpen=false;render();break;
 case'online':state.online=!state.online;render();break;
 case'upload-image':upload('image');break;
 case'upload-file':upload('file');break;
 case'upload-project':upload('project');break;
 case'clear-attachments':state.attached.forEach(a=>a.url&&URL.revokeObjectURL(a.url));state.attached=[];render();break;
 case'copy':try{await navigator.clipboard.writeText(e.target.closest('.assistant-turn')?.querySelector('.response-body')?.textContent||e.target.closest('.opinion')?.querySelector('p')?.textContent||'AI 助手 · 设计预览');toast('已复制示例回复')}catch{toast('浏览器未开放剪贴板权限，可直接选择文字复制')}break;
 case'regenerate':toast('已重新展示示例回复，没有调用模型');break;
 case'message-more':showModal('回复操作',`<div class="page-directory">${button(icon('copy')+'复制回复','copy','')}${button(icon('file')+'保存示例文字','download-text','')}</div>`);break;
 case'page-actions':showModal('当前页面',`<div class="page-directory">${button(icon('edit')+'重命名示例对话','rename','')}${button(icon('search')+'搜索历史记录','search','')}${button(icon('settings')+'账号与设置','directory-page','','data-page="settings"')}${button(icon('phone')+'Android 安装页','directory-page','','data-page="install"')}</div>`);break;
 case'rename':formModal('重命名示例对话',`<label class="form-field">名称<input name="name" required maxlength="60" value="${esc(title())}"></label>`,'rename');break;
 case'inspector-model':showModal('选择模型',modelOptions());break;
 case'inspector':showModal('工作参数',`<div class="field-label">当前模型</div>${modelOptions()}<div class="divider"></div><div class="field-label">思考强度</div>${effortInput()}<div class="divider"></div><h3>项目资料</h3>${fileRows(files.slice(0,3))}`);break;
 case'image-mode':state.imageMode=v;render();break;
 case'image-model':showModal('选择图像模型',`<div class="model-options">${['Nano Banana 2.1','Grok Image 2.0'].map(m=>button(m+(state.imageModel===m?icon('check'):''),'set-image-model','model-option','data-value="'+m+'"')).join('')}</div><p class="form-help">模型名称沿用当前网站；此页面仅比较设计与交互。</p>`);break;
 case'set-image-model':state.imageModel=v;if(!V.imageCaps().ratios.includes(state.ratio))state.ratio='1:1';if(v.includes('Grok')&&state.resolution==='4K')state.resolution='2K';$('#modal').close();render();break;
 case'image-settings':imageSettings();break;
 case'ratio':state.ratio=v;updatePressed(b);break;
 case'resolution':state.resolution=v;updatePressed(b);break;
 case'image-style':state.style=v;updatePressed(b);break;
 case'image-settings-done':$('#modal').close();render();toast('已更新预览中的图像参数');break;
 case'view-image':{const g=gallery.find(g=>g.id===id);showModal(g.name,`<img class="preview-image" src="${g.src}" alt="${g.name}，内置示例插画"><div class="preview-image-actions">${button(icon('download')+'下载示例','download-image','secondary','data-id="'+id+'"')}${button(icon('edit')+'继续编辑','edit-demo-image','primary')}</div>`);break}
 case'edit-demo-image':$('#modal').close();state.attached=[{name:'能量场',url:'./orb.svg'}];state.imageMode='edit';state.draft='把画面的色调变得温暖一些，保留原来的构图。';navigate('images');$('#draft')?.focus();break;
 case'download-image':{const g=gallery.find(g=>g.id===id);const link=document.createElement('a');link.href=g.src;link.download=g.name+'.svg';link.click();toast('正在下载内置示例插画');break}
 case'new-project':formModal('新建项目',`<label class="form-field">项目名称<input name="name" required placeholder="给这个想法起一个名字" maxlength="40"></label><label class="form-field">项目描述<textarea name="desc" rows="3" placeholder="希望在这里做些什么？"></textarea></label>`,'new-project');break;
 case'open-project':state.project=id;navigate('project');break;
 case'project-settings':{const p=currentProject();formModal('项目设置',`<label class="form-field">项目名称<input name="name" required value="${esc(p.name)}" maxlength="40"></label><label class="form-field">项目描述<textarea name="desc" rows="3">${esc(p.desc)}</textarea></label>`,'project-settings');break}
 case'project-files':toast('当前展示项目资料库');break;
 case'project-chats':showModal('项目中的对话',`<div class="search-results">${history()}</div>`);break;
 case'file':{const f=files.find(f=>f.id===id);showModal(esc(f.name),`<p class="subtle">${f.type} · ${f.size} · 预览资料</p><div class="file-preview">${esc(f.text)}</div><div class="modal-footer">${button(icon('copy')+'复制资料','copy-file','secondary','data-id="'+id+'"')}${button('完成','close-modal','primary')}</div>`);break}
 case'copy-file':try{await navigator.clipboard.writeText(files.find(f=>f.id===id).text);toast('已复制示例资料')}catch{toast('可以在资料预览中选择文字复制')}break;
 case'debate-mode':state.debateMode=v;if(v==='teams'&&state.seatModels.length<4)state.seatModels=[...state.seatModels,'Grok 4.7','Claude Sonnet 5.5'];render();break;
 case'rounds':state.rounds=Number(v);render();break;
 case'add-seat':if(state.seatModels.length>=4){toast('预览支持最多 4 个讨论席位');break}state.seatModels.push('Grok 4.7');render();break;
 case'seat-model':selectionTarget=Number(b.dataset.index);showModal('选择席位模型',modelOptions());break;
 case'skill-filter':state.skillFilter=v;render();break;
 case'skill-toggle':{const s=skills.find(s=>s.id===id);s.on=!s.on;render();toast((s.on?'已在预览中启用':'已在预览中停用')+s.name);break}
 case'skill-detail':{const s=skills.find(s=>s.id===id);showModal(s.name,`<p class="subtle">${s.desc}</p><div class="project-note"><strong>可以这样开始</strong>${id==='sound'?'选择一个参考音，预览音高识别界面。':'说明你的目标、提供必要资料，再告诉助手你期待的输出形式。'}</div><div class="modal-footer">${id==='sound'?button('打开音准工具','directory-page','primary','data-page="tuner"'):button(s.on?'已启用 · 关闭':'启用此能力','enable-skill','primary','data-id="'+id+'"')}</div>`);break}
 case'enable-skill':skills.find(s=>s.id===id).on=true;$('#modal').close();render();toast('已启用示例能力');break;
 case'setting-tab':state.settings=v;render();break;
 case'preference':state[b.dataset.key]=!state[b.dataset.key];b.setAttribute('aria-checked',String(state[b.dataset.key]));$('.switch',b).classList.toggle('on',state[b.dataset.key]);if(b.dataset.key==='compact'){document.body.classList.toggle('compact-reading',state.compact)}break;
 case'save-settings':if($('#custom-prompt'))state.customPrompt=$('#custom-prompt').value;if($('#profile-name'))state.profile=$('#profile-name').value.trim()||'体验账号';render();toast('已保存当前预览设置');break;
 case'service':showModal(esc(v)+' 服务',`<p class="subtle">此界面展示模型服务设置的设计，预览中无需填写 API key。</p><div class="project-note"><strong>密钥由服务器管理</strong>正式配置继续通过现有 Cloudflare 环境变量管理。设计方案不改变服务接入方式。</div><div class="modal-footer">${button('知道了','close-modal','primary')}</div>`);break;
 case'security':showModal('账号安全',`<p class="subtle">这里展示账号安全信息的排版，不读取你的真实账号。</p><div class="model-status"><div>当前会话<small>设计预览 · 当前浏览器</small></div><span class="tag">示例</span></div><div class="toggle-row"><div>更改密码<p>正式账号操作会在完整功能接入后保留。</p></div><span class="tag">仅预览</span></div>`);break;
 case'privacy':showModal('数据与隐私',`<p class="subtle">预览数据仅存于当前页面内存，不关联正式会话。</p><div class="toggle-row"><div>预览会话<p>${chats.length} 条示例内容</p></div><span class="tag">本地示例</span></div><div class="toggle-row"><div>API 请求<p>此设计预览不会向模型发送请求。</p></div><span class="tag">0 次</span></div><div class="modal-footer">${button('导出示例文字','download-text','secondary')}${button('完成','close-modal','primary')}</div>`);break;
 case'download-text':{const blob=new Blob(['AI 助手 · 设计预览\n\n'+chats.map(c=>c.title+'\n'+c.excerpt).join('\n\n')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='AI助手-设计预览.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('正在导出示例文字');break}
 case'note':state.note=v;render();break;
 case'tuner-demo':state.noteRunning=!state.noteRunning;render();toast(state.noteRunning?'正在演示识别状态，未启用麦克风':'已停止界面演示');break;
 case'play-note':{try{const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value={C:261.63,D:293.66,E:329.63,F:349.23,G:392,A:440,B:493.88}[state.note];gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(.06,ctx.currentTime+.03);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.65);osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.7);osc.onended=()=>ctx.close();toast('正在播放 '+state.note+'4 参考音')}catch{toast('当前浏览器未开放音频播放')}break}
}});
function updatePressed(b){$$('[aria-pressed]',b.parentElement).forEach(n=>n.setAttribute('aria-pressed',String(n===b)))}
window.addEventListener('hashchange',()=>{const[t,p]=location.hash.slice(1).split('/');if(t===state.theme&&p===state.page)return;if(themes.some(n=>n.id===t))state.theme=t;if(pages.some(n=>n[0]===p)||p==='project'||p==='compare')state.page=p;render()});
$('#modal').addEventListener('close',()=>{selectionTarget=null});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
installExplorer({state,themes,setTheme,navigate,render,showModal,icon,button,esc,sculpture,toast});
const[t,p]=location.hash.slice(1).split('/');if(themes.some(n=>n.id===t))state.theme=t;if(pages.some(n=>n[0]===p)||p==='project'||p==='compare')state.page=p;render();
