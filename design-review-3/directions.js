export const directions = [
  {id:'apple',name:'苹果官网',en:'Apple.com',color:'#0071e3',asset:'chrome',layout:'showcase',desc:'官网式全宽导航 · 纵向大版面 · 分区展开',idea:'像浏览产品一样，逐步展开能力。',nav:'顶部全宽导航',reading:'纵向展示',controls:'场景内展开'},
  {id:'focus',name:'静谧空间',en:'Focus',color:'#cabff0',asset:'orb',layout:'focus',desc:'留白中央舞台 · 底部轻导航 · 聚焦一件事',idea:'整个界面，只留下眼前的任务。',nav:'底部浮动导航',reading:'中央单任务',controls:'轻浮层'},
  {id:'split',name:'双页协作',en:'Side by Side',color:'#3955ce',asset:'prism',layout:'split',desc:'左右对照 · 问题与结果分开 · 内容始终在眼前',idea:'一边提出问题，一边看见答案。',nav:'顶部标签',reading:'左右双页',controls:'左页内联'},
  {id:'studio',name:'创作工作室',en:'Atelier',color:'#303944',asset:'chrome',layout:'studio',desc:'大画布 · 极窄工具栏 · 收纳式右侧设置',idea:'让作品占据空间，工具退到一侧。',nav:'左侧图标工具栏',reading:'画布工作区',controls:'右侧设置抽屉'},
  {id:'folio',name:'编辑部',en:'Folio',color:'#795841',asset:'bronze',layout:'folio',desc:'杂志式双栏 · 大标题与批注 · 无卡片阅读',idea:'像翻阅一本精心编排的杂志。',nav:'文字目录',reading:'编辑式跨页',controls:'页边批注'},
  {id:'cinema',name:'光影画廊',en:'Cinema',color:'#ded9ce',asset:'orb',layout:'cinema',desc:'全幅视觉 · 画廊选片带 · 边缘轻工具',idea:'把画面放大，把操作变轻。',nav:'顶部场景导航',reading:'全幅舞台',controls:'边缘工具'},
  {id:'messenger',name:'轻盈对话',en:'Messenger',color:'#4d716d',asset:'prism',layout:'messenger',desc:'熟悉的会话列表 · 气泡对话 · 附件与资料并行',idea:'用你已经熟悉的方式，开始对话。',nav:'会话列表',reading:'气泡对话',controls:'输入栏旁展开'},
  {id:'bento',name:'灵感桌面',en:'Bento',color:'#495c8d',asset:'chrome',layout:'bento',desc:'不对称模块桌面 · 主任务大卡 · 辅助能力小卡',idea:'常用的事，放在恰到好处的位置。',nav:'紧凑侧栏',reading:'模块工作桌',controls:'卡片内收纳'},
  {id:'outline',name:'极简未来',en:'Outline',color:'#222222',asset:'wire',layout:'outline',desc:'大字与细线 · 平面网格 · 直接的标签与列表',idea:'通过明确的秩序，让强大一目了然。',nav:'文字标签',reading:'平面网格',controls:'直接内联'},
  {id:'notebook',name:'数字手帐',en:'Notebook',color:'#555f83',asset:'bronze',layout:'notebook',desc:'项目标签页 · 连续笔记 · 页面侧边资料',idea:'把对话、资料与思路，写在同一本里。',nav:'项目书签',reading:'连续笔记',controls:'页边工具'}
];
export const sculpture = id => `<img class="sculpture" src="./${directions.find(t=>t.id===id)?.asset||'chrome'}.svg" alt="">`;
