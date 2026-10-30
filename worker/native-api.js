// Native clients share the website's account identities and business handlers.
// Tokens are opaque, revocable and have no automatic expiry. Passwords stay off-device after login.
const sessions = 'native-session:';
const allowedPaths = new Set(['/', '/chats', '/projects', '/schedules', '/system-prompt', '/account', '/skills', '/memory', '/usage', '/skill-files', '/chat-runs', '/debate-runs', '/pricing', '/skill-catalog','/project-original']);
const allowedGet = new Set(['/skills', '/memory', '/pricing', '/skill-catalog']);
const reply = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
const fault = (message, status) => Object.assign(new Error(message), {status});
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

async function boundedJson(request,limit){
  if(Number(request.headers.get('Content-Length')||0)>limit)throw fault('请求内容过大，请分批发送',413);
  const reader=request.body?.getReader();if(!reader)throw fault('请求内容为空',400);
  const decoder=new TextDecoder();let text='',bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit){await reader.cancel();throw fault('请求内容过大，请分批发送',413)}text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode();return JSON.parse(text)}finally{reader.releaseLock()}
}

async function identity(request, env, context) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) throw fault('请先登录账号', 401);
  const key = sessions + await context.hashText(token);
  const stored = await env.MEMORY_KV.get(key);
  if (!stored) throw fault('登录会话不可用，请在设置中退出后重新登录', 401);
  const session = JSON.parse(stored), raw = await env.MEMORY_KV.get('user:' + session.accountId);
  if (!raw) throw fault('账号不可用', 401);
  const record = JSON.parse(raw);
  if (record.disabled) throw fault('账号已停用', 403);
  const profile = JSON.parse(await env.BIZ_KV.get('profile:' + session.accountId) || '{}');
  return {key, accountId:session.accountId, record, profile:context.accountProfile(session.accountId,record,profile), canManage:!!context.ownerAccountId && session.accountId === context.ownerAccountId};
}
function publicIdentity(account) { return {profile:account.profile, canManage:account.canManage}; }

export async function handleNativeRequest(request, env, context) {
  const url = new URL(request.url), route = url.pathname;
  try {
    if (route === '/native/login' && request.method === 'POST') {
      const body = await boundedJson(request,8192), login = String(body.username || '').trim();
      const passwordHash = typeof body.passwordHash === 'string' ? body.passwordHash : typeof body.password === 'string' ? await context.hashText(body.password) : '';
      if (!login || !/^[a-f0-9]{64}$/.test(passwordHash)) throw fault('登录名或密码错误', 401);
      const accountId = await context.storageAccountName(login, env), raw = await env.MEMORY_KV.get('user:' + accountId);
      if (!raw) throw fault('登录名或密码错误', 401);
      const record = JSON.parse(raw);
      if (record.disabled || record.hash !== passwordHash || record.loginName && record.loginName.toLowerCase() !== login.toLowerCase()) throw fault('登录名或密码错误', 401);
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      await env.MEMORY_KV.put(sessions + await context.hashText(token), JSON.stringify({accountId, createdAt:Date.now()}));
      const profile = JSON.parse(await env.BIZ_KV.get('profile:' + accountId) || '{}');
      return reply({token, profile:context.accountProfile(accountId,record,profile), canManage:!!context.ownerAccountId && accountId === context.ownerAccountId});
    }
    if(route==='/native/logout'&&request.method==='POST') {
      const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'')?.[1];
      if(!token)throw fault('会话格式无效',400);
      await env.MEMORY_KV.delete(sessions+await context.hashText(token));
      return reply({ok:true});
    }
    const account = await identity(request, env, context);
    if(route==='/native/project-upload'&&request.method==='PUT'){
      const projectId=url.searchParams.get('project');await context.ownedProject(env,account.accountId,projectId);
      const destination=new URL('/project-upload','https://api.pickandcase.com');
      for(const key of ['project','file','part'])destination.searchParams.set(key,url.searchParams.get(key)||'');
      const internalAuth=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({user:account.accountId,password:account.record.hash}))));
      const headers=new Headers({'Authorization':'Bearer '+internalAuth,'Content-Type':'application/octet-stream'});
      if(request.headers.has('Content-Length'))headers.set('Content-Length',request.headers.get('Content-Length'));
      return context.forward(new Request(destination,{method:'PUT',headers,body:request.body,duplex:'half',signal:request.signal}));
    }
    if (route === '/native/session' && request.method === 'GET') return reply(publicIdentity(account));
    if (route === '/native/catalog' && request.method === 'GET') return reply({version:'native-v2', models:Object.entries(context.models).map(([id,model]) => ({id,name:model.name,provider:model.provider,image:!!model.image,levels:context.efforts[id] || []})), imageCapabilities:context.imageCore.capabilities, skillModels:context.skillModels, defaultSkillModel:context.defaultSkillModel, uploads:context.uploadLimits, tokenLimits:context.tokenLimits,maxTextChars:context.maxTextChars, skills:context.skillCatalog.map(({instructions,...skill})=>skill), ...publicIdentity(account)});
    if (route === '/native/users') {
      if (!account.canManage) throw fault('仅管理员可使用账号管理', 403);
      if (request.method === 'GET') {
        const page = await env.MEMORY_KV.list({prefix:'user:',limit:20,...(url.searchParams.get('cursor')?{cursor:url.searchParams.get('cursor')}:{})});
        const users = await Promise.all(page.keys.map(async ({name}) => {
          const value = JSON.parse(await env.MEMORY_KV.get(name) || '{}'), id = name.slice(5);
          return {accountId:id,username:value.loginName || context.publicAccountName(id),createdAt:value.created || null,disabled:!!value.disabled};
        }));
        return reply({users,cursor:page.list_complete ? null : page.cursor});
      }
      if (request.method !== 'POST') throw fault('请求方式无效', 405);
      const body = await request.json(), username = String(body.username || '').trim();
      if (!context.validLoginName(username)) throw fault('账号需为 2–40 位中文、字母、数字、点、下划线或短横线', 400);
      const passwordHash = typeof body.passwordHash === 'string' ? body.passwordHash : typeof body.password === 'string' && body.password.length > 0 && body.password.length <= 256 ? await context.hashText(body.password) : '';
      if (!/^[a-f0-9]{64}$/.test(passwordHash)) throw fault('请输入有效密码', 400);
      const id = username.toLowerCase();
      // Do not negatively cache user:<new-name> in the requesting region before
      // the durable actor writes it elsewhere. Alias checks do not read that key.
      const ownerAlias = context.publicAccountName(context.ownerAccountId || '').toLowerCase();
      if((id === ownerAlias && id !== context.ownerAccountId) || await env.MEMORY_KV.get('login:'+id))throw fault('这个账号已存在，请使用其他名称',409);
      if(!env.NATIVE_ACCOUNTS)throw fault('账号管理服务尚未部署',503);
      // One durable actor serializes every creation of this login name, across devices/regions.
      return env.NATIVE_ACCOUNTS.get(env.NATIVE_ACCOUNTS.idFromName('account:'+id)).fetch(new Request('https://native-account.internal/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,username,hash:passwordHash,createdBy:account.accountId})}));
    }
    if (request.method !== 'POST') throw fault('请求方式无效', 405);
    const body = await boundedJson(request,40*1024*1024);
    if (route === '/native/debate-plan') {
      try { return reply({plan:context.debateCore.plan({...body,models:Object.keys(context.models).filter(id=>!context.models[id].image)})}); }
      catch(error) { throw fault(error.message,400); }
    }
    let path, method, payload;
    if (route === '/native/image') {
      path='/';method='POST';
      const model=body.model;
      if (!context.imageCore.cap(model)) throw fault('图片模型无效',400);
      const projectId=body.projectId||null;
      if(projectId)await context.ownedProject(env,account.accountId,projectId);
      let history=[];
      if(body.chatId&&context.validResourceId(body.chatId)&&body.parentUid!=null) {
        const messages=JSON.parse(await env.BIZ_KV.get(context.chatStoragePrefix(account.accountId,projectId)+':'+body.chatId)||'[]');
        history=context.imageCore.historyFor(messages,body.parentUid);
      }
      let options;
      try { options=context.imageCore.requestOptions(model,body.task||'generation',body.settings||{},body.references||[],history); }
      catch(error) { throw fault(error.message,400); }
      const {_imgs,...parameters}=options;
      const styles={photo:'写实摄影',illustration:'插画',watercolor:'水彩',cinematic:'电影质感',anime:'动漫',"3d":'三维渲染',pixel:'像素艺术'};
      let prompt=String(body.prompt||'');
      if(styles[body.settings?.style])prompt+='\n画面风格：'+styles[body.settings.style]+'。';
      if(body.settings?.overlayText)prompt+='\n在画面中准确呈现以下文字：'+String(body.settings.overlayText);
      payload={model,prompt,projectId,...parameters,images:_imgs||[]};
      if(body.imageMask)payload.imageMask=body.imageMask;
    } else if (route === '/native/api') {
      path=body.path;method=body.method || 'POST';payload=body.payload || {};
      if (!allowedPaths.has(path) || !['POST','GET'].includes(method) || method==='GET'&&!allowedGet.has(path) || !payload || typeof payload!=='object' || Array.isArray(payload)) throw fault('接口请求无效',400);
    } else throw fault('原生接口不存在',404);
    // A client cannot switch principals, use the shared password or forward to an arbitrary origin.
    const credentials={user:account.accountId,username:account.accountId,password:account.record.hash,passwordHash:account.record.hash};
    const destination=new URL(path,'https://api.pickandcase.com');
    const init={method,headers:{'Content-Type':'application/json'},signal:request.signal};
    if(method==='GET'){
      for(const[key,value]of Object.entries({...payload,user:account.accountId,pass:account.record.hash}))destination.searchParams.set(key,String(value));
      return context.forward(new Request(destination,init));
    }
    const authorized={...payload,...credentials};
    // The Worker already parsed this JSON. Reuse it instead of serializing and parsing large attachments twice.
    const delegated=new Request(destination,init);
    Object.defineProperty(delegated,'json',{value:async()=>authorized});
    return context.forward(delegated,authorized);
  } catch (error) { return reply({error:error.status ? error.message : error instanceof SyntaxError ? '请求格式无效' : '请求暂时不可用，请稍后重试'},error.status || (error instanceof SyntaxError ? 400 : 503)); }
}

export class NativeAccountRegistry {
  constructor(state,env){this.state=state;this.env=env;this.queue=Promise.resolve();}
  async commit(entry){
    const key='user:'+entry.id,existing=await this.env.MEMORY_KV.get(key);
    if(existing&&JSON.parse(existing).hash!==entry.record.hash)throw fault('这个账号已存在，请使用其他名称',409);
    if(!existing)await this.env.MEMORY_KV.put(key,JSON.stringify(entry.record));
    entry.status='ready';await this.state.storage.put('account',entry);
  }
  async alarm(){const entry=await this.state.storage.get('account');if(entry?.status==='pending'){try{await this.commit(entry)}catch(error){if(error.status!==409)await this.state.storage.setAlarm(Date.now()+30000)}}}
  fetch(request){
    const result=this.queue.then(async()=>{
      try{
        const body=await request.json();let entry=await this.state.storage.get('account');
        if(entry?.status==='ready')throw fault('这个账号已存在，请使用其他名称',409);
        if(entry&&(entry.id!==body.id||entry.record.hash!==body.hash||entry.record.createdBy!==body.createdBy))throw fault('该账号正在创建，请使用原密码重试',409);
        if(!entry){
          if(await this.env.MEMORY_KV.get('user:'+body.id))throw fault('这个账号已存在，请使用其他名称',409);
          entry={id:body.id,status:'pending',record:{hash:body.hash,created:Date.now(),createdBy:body.createdBy}};
          await this.state.storage.put('account',entry);
        }
        try{await this.commit(entry)}catch(error){if(error.status!==409)await this.state.storage.setAlarm(Date.now()+5000);throw error}
        return reply({ok:true,username:body.username,accountId:body.id});
      }catch(error){return reply({error:error.status?error.message:'账号创建暂未完成，请使用相同账号密码重试'},error.status||503)}
    });
    this.queue=result.catch(()=>{});return result;
  }
}
