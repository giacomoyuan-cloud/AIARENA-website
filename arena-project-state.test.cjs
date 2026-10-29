const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('./arena-project-state.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const project=(id='p1',extra={})=>({id,name:id,updatedAt:100,archivedAt:null,deletedAt:null,pinned:false,...extra});
function setup(api){
  let owner='one';const events=[],errors=[],calls=[];
  const state=create({accountKey:()=>owner,credentials:()=>({username:owner,password:owner+'-fixture'}),api:(action,body)=>{calls.push({action,body});return api(action,body);},onChange:()=>events.push(owner),onError:error=>errors.push(error.message)});
  return {state,calls,events,errors,owner:value=>{owner=value;}};
}
test('pin feedback survives stale lists after success and acknowledges a later confirmed read',async()=>{
  let remote=false;const {state}=setup(async action=>action==='list'?{projects:[project('p1',{pinned:remote})]}:{ok:true,pinned:true});
  await state.load();state.togglePin('p1');assert.equal(state.projects()[0].pinned,true);assert.equal(state.projects()[0].pinPending,true);
  await tick();await state.load();assert.equal(state.projects()[0].pinned,true);assert.equal(state.projects()[0].pinPending,false);
  remote=true;await state.load();assert.equal(state.projects()[0].pinned,true);
});
test('two fast clicks serialize absolute writes and an obsolete failure cannot undo the second click',async()=>{
  const writes=[],{state,errors}=setup((action,body)=>{if(action==='list')return {projects:[project()]};const wait=deferred();writes.push({body,...wait});return wait.promise;});
  await state.load();state.togglePin('p1');state.togglePin('p1');assert.equal(state.projects()[0].pinned,false);assert.equal(writes.length,1);
  writes[0].reject(Error('first request failed'));await tick();assert.equal(writes.length,2);assert.equal(writes[1].body.pinned,false);
  writes[1].resolve({ok:true,pinned:false});await tick();assert.equal(state.projects()[0].pinned,false);assert.deepEqual(errors,[]);
});
test('a rejected or malformed pin rolls back and allows a successful retry',async()=>{
  let attempt=0;const {state,errors}=setup(async action=>action==='list'?{projects:[project()]}:++attempt===1?{ok:true,pinned:false}:{ok:true,pinned:true});
  await state.load();state.togglePin('p1');await tick();assert.equal(state.projects()[0].pinned,false);assert.equal(errors.length,1);
  state.togglePin('p1');await tick();assert.equal(state.projects()[0].pinned,true);
});
test('an older list response cannot replace a newer list from the same account',async()=>{
  const reads=[],{state}=setup(()=>{const wait=deferred();reads.push(wait);return wait.promise;});
  const older=state.load(),newer=state.load();reads[1].resolve({projects:[project('newer')]});await newer;
  reads[0].resolve({projects:[project('older')]});await older;assert.deepEqual(state.projects().map(p=>p.id),['newer']);
});
test('pending pins keep their original credentials and never repaint another account',async()=>{
  const wait=deferred();let auth;const {state,owner,events,errors}=setup((action,body)=>action==='list'?{projects:[project()]}:(auth=body,wait.promise));
  await state.load();state.togglePin('p1');owner('two');await state.load();events.length=0;
  wait.reject(Error('old account failure'));await tick();assert.equal(auth.username,'one');assert.equal(auth.password,'one-fixture');
  assert.equal(state.projects()[0].pinned,false);assert.deepEqual(events,[]);assert.deepEqual(errors,[]);
});
test('deletion and restoration survive stale active and trash reads without touching other projects',async()=>{
  let mode='active';const original=project('p1',{pinned:true}),other=project('p2');
  const {state}=setup(async(action,body)=>{
    if(action==='list')return {projects:body.includeDeleted?(mode==='restored'?[project('p1',{deletedAt:101,updatedAt:101})]:[]):[original,other]};
    if(action==='delete'){mode='deleted';return {ok:true,project:project('p1',{deletedAt:101,updatedAt:101})};}
    mode='restored';return {ok:true,project:project('p1',{updatedAt:102})};
  });
  await state.load();await state.change('delete',original);await state.load();await state.load('deleted');
  assert.deepEqual(state.projects().map(p=>p.id),['p2']);assert.deepEqual(state.projects('deleted').map(p=>p.id),['p1']);
  await state.change('restore',state.projects('deleted')[0]);await state.load('deleted');
  assert.deepEqual(state.projects('deleted'),[]);assert.equal(state.projects().find(p=>p.id==='p1').pinned,false);assert.ok(state.projects().some(p=>p.id==='p2'));
});
test('a failed delete leaves the project available and a duplicate pending action is rejected',async()=>{
  const wait=deferred(),{state}=setup(action=>action==='list'?{projects:[project()]}:wait.promise);
  await state.load();const pending=state.change('delete',project());
  await assert.rejects(state.change('delete',project()),/正在保存/);wait.reject(Error('storage failed'));await assert.rejects(pending,/storage failed/);
  assert.equal(state.projects().length,1);assert.equal(state.projects('deleted').length,0);
});
test('archiving and restoring keep the existing pin preference',async()=>{
  const pinned=project('p1',{pinned:true}),{state}=setup(async(action,body)=>action==='list'?{projects:body.includeArchived?[]:[pinned]}:{project:project('p1',{archivedAt:body.archived===false?null:101,updatedAt:body.archived===false?102:101})});
  await state.load();await state.change('archive',pinned);assert.equal(state.projects().length,0);
  await state.change('restoreArchive',state.projects('archived')[0]);assert.equal(state.projects()[0].pinned,true);
});
test('a newer edit on another device replaces an older local deletion overlay',async()=>{
  let restored=false;const {state}=setup(async action=>action==='list'?{projects:[project('p1',{updatedAt:restored?103:100})]}:{project:project('p1',{updatedAt:101,deletedAt:101})});
  await state.load();await state.change('delete',project());assert.equal(state.projects().length,0);
  restored=true;await state.load();assert.equal(state.projects().length,1);
});
