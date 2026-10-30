const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function node(){
  const children=new Map(),listeners=new Map(),classes=new Set();
  return {hidden:false,open:false,textContent:'',isConnected:true,focus(){this.focused=true;},appendChild(){},setAttribute(){},
    querySelector(selector){if(!children.has(selector))children.set(selector,node());return children.get(selector);},
    addEventListener(name,fn){listeners.set(name,fn);},listeners,
    close(){this.open=false;listeners.get('close')?.();},
    classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n)}};
}
function fixture(){
  const host=node(),requests=[],notices=[],elements=[],focus=node();let account='reader-a',scope='project-a',downloads=0;
  const app={host,api(action,extra){return new Promise((resolve,reject)=>requests.push({action,extra,resolve,reject}));},
    binary(){downloads++;},accountKey:()=>account,currentScope:()=>scope,currentProject:()=>({id:scope}),notice:m=>notices.push(m)};
  const context={window:{ArenaMarkdown:{escape:String},ArenaControls:{createPinStore:()=>({})},ArenaFiles:{DOCUMENT_ACCEPT:'.txt'},ArenaProjectFiles:require('./arena-project-files.js')},document:{activeElement:focus,createElement(){const el=node();elements.push(el);return el;}}};
  vm.runInNewContext(fs.readFileSync(process.env.ARENA_WORKSPACE_SOURCE||'arena-workspace.js','utf8'),context);
  const controller=context.window.ArenaWorkspace.mount(app),pane=elements[1];
  const finish=(n,name)=>requests[n].resolve({file:{id:name,name,storage:'r2',text:'SOURCE_'+name,status:'ready'}});
  return {controller,pane,requests,notices,finish,focus,account:value=>account=value,scope:value=>scope=value,downloads:()=>downloads};
}
test('closing a pending preview invalidates its response and removes retained content and download state',async()=>{
  const f=fixture(),pending=f.controller.preview('old-file','project-a');f.controller.closeFile();f.finish(0,'old-file');await pending;
  assert.equal(f.pane.hidden,true);assert.equal(f.pane.querySelector('#aaFilePreview').textContent,'');
  await f.pane.querySelector('[data-file-download]').listeners.get('click')();assert.equal(f.downloads(),0);
});
test('responses and errors from an earlier project or account cannot open a preview in the new view',async()=>{
  for(const change of ['scope','account'])for(const failed of [false,true]){
    const f=fixture(),pending=f.controller.preview('old-file','project-a');f[change]('different');
    if(failed)f.requests[0].reject(Error('OLD_ACCOUNT_ERROR'));else f.finish(0,'old-file');await pending;
    assert.equal(f.pane.hidden,true);assert.deepEqual(f.notices,[]);
  }
});
test('the newest clicked preview wins even when an older request finishes last',async()=>{
  const f=fixture(),older=f.controller.preview('file-a','project-a'),newer=f.controller.preview('file-b','project-a');
  f.finish(1,'file-b');await newer;f.finish(0,'file-a');await older;
  assert.equal(f.pane.hidden,false);assert.equal(f.pane.querySelector('#aaFileName').textContent,'file-b');assert.equal(f.pane.querySelector('#aaFilePreview').textContent,'SOURCE_file-b');
});
test('a folder preview shows its full source path and closing restores its trigger focus',async()=>{
  const f=fixture(),pending=f.controller.preview('folder-file','project-a');
  f.requests[0].resolve({file:{name:'说明.txt',folder:'QA.zip',relativePath:'设计/说明.txt',text:'design',status:'ready'}});await pending;
  assert.equal(f.pane.querySelector('#aaFileName').textContent,'QA.zip/设计/说明.txt');
  f.pane.querySelector('[data-file-close]').listeners.get('click')();assert.equal(f.focus.focused,true);assert.equal(f.pane.querySelector('#aaFilePreview').textContent,'');
});
