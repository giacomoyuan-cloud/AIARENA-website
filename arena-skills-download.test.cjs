const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('a prepared native document retains a visible save link until its Blob is released',async()=>{
  let clickHandler,expiry,current,clicked=0,revoked=0,request;
  const button={dataset:{skillFile:'0',skillMessage:'7'},disabled:false,replaceWith(node){current=node;node.isConnected=true;}};
  const anchor={dataset:{},isConnected:false,click(){clicked++;},replaceWith(node){current=node;this.isConnected=false;}};
  current=button;
  const context=vm.createContext({document:{getElementById(){return {addEventListener(type,handler){clickHandler=handler;}};},createElement(){return anchor;}},localStorage:{},
    URL:{createObjectURL:()=> 'blob:synthetic-document',revokeObjectURL(){revoked++;}},setTimeout(callback){expiry=callback;},
    fetch:async(url,options)=>{request=JSON.parse(options.body);return {ok:true,blob:async()=>({size:10})};}});
  vm.runInContext(fs.readFileSync(__dirname+'/arena-skills.js','utf8'),context);
  context.ArenaSkills.install({auth:()=>({username:'tester',password:'synthetic'}),scope:()=> 'general',worker:()=> 'https://api.pickandcase.com',messages:()=>[{uid:7,executionModel:'claude-sonnet-5-5',artifacts:[{name:'report.pdf',token:'synthetic-file-token',provider:'anthropic'}]}],notice:assert.fail});
  await clickHandler({target:{closest:()=>button}});
  assert.equal(current,anchor);assert.equal(anchor.href,'blob:synthetic-document');assert.equal(anchor.download,'report.pdf');assert.equal(anchor.textContent,'保存文件');
  assert.equal(anchor.dataset.executionModel,'claude-sonnet-5-5');assert.equal(anchor.dataset.provider,'anthropic');assert.equal(request.action,'download');assert.equal(clicked,1);assert.equal(revoked,0);
  expiry();assert.equal(current,button);assert.equal(button.disabled,false);assert.equal(revoked,1);
});
