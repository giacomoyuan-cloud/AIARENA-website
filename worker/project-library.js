import Context from '../arena-context.js';
import {isDocument,materialName} from '../web/file-types.mjs';
import {recognizeProjectPage, ocrPayload, OCR_MODEL} from './project-ocr.js';

const initialized=new WeakSet();
const activeOCR=new WeakMap();
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(id);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const rows=(ctx,sql,...args)=>ctx.storage.sql.exec(sql,...args).toArray();
function init(ctx){
  if(initialized.has(ctx))return;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_identity (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_files (id TEXT PRIMARY KEY, meta TEXT NOT NULL, state TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_segments (file_id TEXT NOT NULL, ordinal INTEGER NOT NULL, location TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(file_id,ordinal))');
  ctx.storage.sql.exec('CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(words, file_id UNINDEXED, ordinal UNINDEXED)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_retired (id TEXT PRIMARY KEY, meta TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_readings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_scope_files (scope TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY(scope,file_id))');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_ocr_pages (file_id TEXT NOT NULL, page INTEGER NOT NULL, state TEXT NOT NULL, result TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(file_id,page))');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_pending_segments (file_id TEXT NOT NULL, ordinal INTEGER NOT NULL, location TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, words TEXT NOT NULL, PRIMARY KEY(file_id,ordinal))');
  initialized.add(ctx);
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function file(ctx,id){
  if(!idOK(id))fail('资料编号无效');
  const row=rows(ctx,'SELECT meta,state,removed FROM library_files WHERE id = ?',id)[0];
  if(!row)fail('项目资料不存在',404);
  return {...JSON.parse(row.meta),state:row.state,removed:!!row.removed};
}
function publicFile(value){
  const {objectKey,uploadId,replaced,originalComplete,previousParseState,pendingGeneration,indexGeneration,...rest}=value;
  return {...rest,storage:'r2',status:value.state};
}
function save(ctx,value){
  const {state,removed,...meta}=value;
  ctx.storage.sql.exec('INSERT INTO library_files(id,meta,state,removed) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET meta=excluded.meta,state=excluded.state,removed=excluded.removed',value.id,JSON.stringify(meta),state,removed?1:0);
}
function transact(ctx,fn){return ctx.storage.transactionSync?ctx.storage.transactionSync(fn):fn();}
async function identity(ctx,owner,project){
  if(typeof owner!=='string'||!owner||owner.length>120||!idOK(project))fail('项目资料范围无效');
  const existing=rows(ctx,'SELECT owner,project FROM library_identity WHERE id=1')[0];
  if(existing&&(existing.owner!==owner||existing.project!==project))fail('项目资料范围不匹配',403);
  if(!existing)ctx.storage.sql.exec('INSERT INTO library_identity(id,owner,project) VALUES(1,?,?)',owner,project);
}
function location(value){return typeof value==='string'?value.slice(0,400):'';}

// This actor uses a separate, project-specific ID in the existing SQLite-backed
// namespace. Its files/search tables never share an instance with chat runs.
export async function handleProjectLibrary(ctx,env,request){
  try{
    init(ctx);
    const url=new URL(request.url),part=request.method==='PUT';
    const body=part?{owner:request.headers.get('x-library-owner'),projectId:request.headers.get('x-library-project'),action:'part',fileId:url.searchParams.get('file'),part:Number(url.searchParams.get('part'))}:await request.json();
    await identity(ctx,body.owner,body.projectId);
    const action=body.action;
    if(action==='list'){
      const all=rows(ctx,'SELECT meta,state,removed FROM library_files').map(r=>publicFile({...JSON.parse(r.meta),state:r.state,removed:!!r.removed}));
      return json({files:all.filter(f=>!f.removed&&f.state!=='aborted'),removed:all.filter(f=>f.removed),retired:rows(ctx,'SELECT meta FROM library_retired').map(r=>JSON.parse(r.meta))});
    }
    if(action==='reading_get'){const value=JSON.parse(rows(ctx,'SELECT value FROM library_readings WHERE key=?',String(body.key))[0]?.value||'null');return json({value:value&&value.expiresAt>Date.now()?value:null});}
    if(action==='reading_put'){
      if(typeof body.key!=='string'||body.key.length>180||typeof body.value?.text!=='string'||body.value.text.length>16000)fail('阅读记录无效');
      const value={...body.value,expiresAt:Date.now()+7*86400000};
      ctx.storage.sql.exec('DELETE FROM library_readings WHERE json_extract(value,\'$.expiresAt\') < ?',Date.now());
      ctx.storage.sql.exec('INSERT INTO library_readings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',body.key,JSON.stringify(value));return json({ok:true});
    }
    if(action==='start'){
      if(!env.PROJECT_DOCUMENTS)fail('大文件存储暂未配置',503);
      const input=body.file;
      if(!input||!idOK(input.id)||typeof input.name!=='string'||!input.name.trim()||input.name.length>180||/[\u0000-\u001f]/.test(input.name)||!Number.isSafeInteger(input.size)||input.size<0)fail('文件信息无效');
      if(!isDocument(input.name))fail('暂不支持此资料格式');
      const existing=rows(ctx,'SELECT id FROM library_files WHERE id=?',input.id)[0];
      if(existing){const prior=file(ctx,input.id);if(prior.name!==input.name||prior.size!==input.size||(prior.folder||'')!==(input.folder||'')||(prior.relativePath||'')!==(input.relativePath||'')||(prior.replaced?.id||'')!==(body.replaced?.id||'')||prior.state==='aborted'||prior.removed)fail('上传会话与文件不匹配，请重新开始上传',409);return json({file:publicFile(prior),partSize:prior.partSize});}
      if(input.folder!==undefined&&(typeof input.folder!=='string'||!input.folder.trim()||input.folder.length>180||/[\u0000-\u001f/\\]/.test(input.folder)||typeof input.relativePath!=='string'||input.relativePath.length>500||input.relativePath.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')))fail('文件夹路径无效');
      const objectKey='projects/'+encodeURIComponent(body.owner)+'/'+body.projectId+'/'+input.id+'/original';
      const upload=await env.PROJECT_DOCUMENTS.createMultipartUpload(objectKey,{httpMetadata:{contentType:input.type||'application/octet-stream'}});
      const value={id:input.id,name:input.name,size:input.size,type:String(input.type||'application/octet-stream').slice(0,120),createdAt:Date.now(),characters:0,segments:0,partSize:Math.max(5*1024*1024,Math.ceil(input.size/9999/1024/1024)*1024*1024),objectKey,uploadId:upload.uploadId,state:'uploading',removed:false,...(input.folder?{folder:input.folder,relativePath:input.relativePath}:{}),...(body.replaced?{replaced:body.replaced}:{})};
      save(ctx,value);return json({file:publicFile(value),partSize:value.partSize});
    }
    if(action==='search'){
      const terms=Context.terms(body.query).slice(0,32),query=terms.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' OR ');
      let hits=[];
      if(query)hits=rows(ctx,"SELECT s.file_id,s.ordinal,s.location,s.text,bm25(library_search) AS score FROM library_search JOIN library_segments s ON s.file_id=library_search.file_id AND s.ordinal=library_search.ordinal JOIN library_files f ON f.id=s.file_id WHERE library_search MATCH ? AND f.state IN ('ready','partial') AND f.removed=0 ORDER BY score LIMIT 12",query);
      const available=rows(ctx,"SELECT meta FROM library_files WHERE state IN ('ready','partial') AND removed=0").map(r=>JSON.parse(r.meta));
      const queryName=String(body.query||'').toLowerCase(),specific=available.filter(f=>f.relativePath&&queryName.includes(materialName(f).toLowerCase())),relative=available.filter(f=>f.relativePath&&queryName.includes(f.relativePath.toLowerCase())),named=specific.length?specific:relative.length?relative:available.filter(f=>{const name=f.name.toLowerCase(),stem=name.replace(/\.[^.]+$/,'');return queryName.includes(name)||(stem.length>1&&queryName.includes(stem));});
      for(const f of named.slice(0,3))if(!hits.some(h=>f.id===h.file_id))hits.push(...rows(ctx,'SELECT file_id,ordinal,location,text,0 AS score FROM library_segments WHERE file_id=? ORDER BY ordinal LIMIT 1',f.id));
      const byId=new Map(available.map(f=>[f.id,f]));
      return json({hits:hits.map(h=>({...h,file:{id:h.file_id,name:materialName(byId.get(h.file_id)),characters:byId.get(h.file_id)?.characters},score:-h.score+(named.some(f=>f.id===h.file_id)?1000:0)})),available:available.map(f=>({id:f.id,name:materialName(f),characters:f.characters,segments:f.segments}))});
    }
    if(action==='scope'){
      if(typeof body.scope!=='string'||!/^[a-f0-9]{64}$/.test(body.scope)||!Array.isArray(body.ids)||body.ids.some(id=>!idOK(id)))fail('阅读范围无效');
      transact(ctx,()=>{ctx.storage.sql.exec('DELETE FROM library_scope_files WHERE scope=?',body.scope);for(const id of body.ids)ctx.storage.sql.exec('INSERT INTO library_scope_files(scope,file_id) VALUES(?,?)',body.scope,id);});return json({ok:true});
    }
    if(action==='batch'){
      const offset=Number(body.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail('阅读位置无效');
      if(typeof body.scope!=='string'||!/^[a-f0-9]{64}$/.test(body.scope))fail('阅读范围无效');
      const unavailable=rows(ctx,"SELECT COUNT(*) AS n FROM library_scope_files q LEFT JOIN library_files f ON f.id=q.file_id WHERE q.scope=? AND (f.id IS NULL OR f.state!='ready' OR f.removed!=0)",body.scope)[0].n;
      if(unavailable)fail('阅读期间项目资料发生变化，请重新开始全文阅读',409);
      const result=rows(ctx,"SELECT s.file_id,s.ordinal,s.location,s.text,f.meta FROM library_segments s JOIN library_files f ON f.id=s.file_id JOIN library_scope_files q ON q.file_id=f.id WHERE q.scope=? AND f.state='ready' AND f.removed=0 ORDER BY s.file_id,s.ordinal LIMIT 16 OFFSET ?",body.scope,offset);
      const resultRows=[];let chars=0;
      for(const row of result){if(resultRows.length&&chars+row.text.length>24000)break;const meta=JSON.parse(row.meta);resultRows.push({fileId:row.file_id,name:materialName(meta),ordinal:row.ordinal,location:row.location,text:row.text});chars+=row.text.length;}
      return json({segments:resultRows,next:offset+resultRows.length,done:resultRows.length===0,total:rows(ctx,"SELECT COUNT(*) AS n FROM library_segments s JOIN library_files f ON f.id=s.file_id JOIN library_scope_files q ON q.file_id=f.id WHERE q.scope=?",body.scope)[0].n});
    }
    if(action==='restore_legacy'){ctx.storage.sql.exec('DELETE FROM library_retired WHERE id=?',body.fileId);return json({ok:true});}
    const value=file(ctx,body.fileId);
    if(action==='reparse'){
      if(value.removed||!value.originalComplete||!/\.pdf$/i.test(value.name))fail('此资料暂不能继续识别',409);
      if(value.state!=='indexing')value.previousParseState=value.state;
      value.state='indexing';value.pendingGeneration=crypto.randomUUID();
      transact(ctx,()=>{ctx.storage.sql.exec('DELETE FROM library_pending_segments WHERE file_id=?',value.id);save(ctx,value);});
      return json({file:publicFile(value),generation:value.pendingGeneration});
    }
    if(action==='ocr_page'){
      if(value.removed||!value.originalComplete||value.state!=='indexing'||!/\.pdf$/i.test(value.name))fail('文件当前不能识别扫描页',409);
      if(value.pendingGeneration&&body.generation!==value.pendingGeneration)fail('识别任务已更新，请刷新资料状态',409);
      if(!Number.isSafeInteger(body.total)||body.total<1||!Number.isSafeInteger(body.page)||body.page<1||body.page>body.total)fail('识别页码无效');
      const cached=rows(ctx,'SELECT state,result FROM library_ocr_pages WHERE file_id=? AND page=?',value.id,body.page)[0];
      if(cached?.state==='done'&&!(body.retry===true&&JSON.parse(cached.result).uncertain))return json({...JSON.parse(cached.result),cached:true});
      let jobs=activeOCR.get(ctx);if(!jobs){jobs=new Map();activeOCR.set(ctx,jobs);}
      const key=value.id+':'+body.page;
      if(jobs.has(key))return json(await jobs.get(key));
      if(cached?.state==='running'&&body.retry!==true)fail('上次识别连接已中断；点击“继续识别”后仅重试未完成页',409);
      ocrPayload(body.page,body.data,body.mime);
      ctx.storage.sql.exec('INSERT INTO library_ocr_pages(file_id,page,state,result,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(file_id,page) DO UPDATE SET state=excluded.state,result=NULL,updated_at=excluded.updated_at',value.id,body.page,'running',null,Date.now());
      const job=(async()=>{
        try{
          const result=await recognizeProjectPage(env,body.owner,body.projectId,body.page,body.data,body.mime);
          ctx.storage.sql.exec('UPDATE library_ocr_pages SET state=?,result=?,updated_at=? WHERE file_id=? AND page=?','done',JSON.stringify(result),Date.now(),value.id,body.page);
          return result;
        }catch(error){
          ctx.storage.sql.exec('UPDATE library_ocr_pages SET state=?,updated_at=? WHERE file_id=? AND page=?','failed',Date.now(),value.id,body.page);throw error;
        }finally{jobs.delete(key);}
      })();
      jobs.set(key,job);return json(await job);
    }
    if(action==='part'){
      if(value.state!=='uploading'||value.removed)fail('上传会话已结束',409);
      const count=Math.max(1,Math.ceil(value.size/value.partSize));
      if(!Number.isInteger(body.part)||body.part<1||body.part>count||body.part>10000)fail('上传分片编号无效');
      const uploaded=await env.PROJECT_DOCUMENTS.resumeMultipartUpload(value.objectKey,value.uploadId).uploadPart(body.part,request.body);
      return json({part:uploaded});
    }
    if(action==='original_complete'){
      if(value.originalComplete)return json({file:publicFile(value)});
      if(value.state!=='uploading')fail('上传状态无效',409);
      const count=Math.max(1,Math.ceil(value.size/value.partSize));
      if(!Array.isArray(body.parts)||body.parts.length!==count||body.parts.some((p,i)=>p.partNumber!==i+1||typeof p.etag!=='string'||!p.etag))fail('上传分片不完整');
      let object=await env.PROJECT_DOCUMENTS.head(value.objectKey);
      if(!object)object=await env.PROJECT_DOCUMENTS.resumeMultipartUpload(value.objectKey,value.uploadId).complete(body.parts);
      if(object.size!==value.size)fail('文件大小校验失败，请重新上传',409);
      value.originalComplete=true;value.state='indexing';save(ctx,value);return json({file:publicFile(value)});
    }
    if(action==='segments'){
      if(!value.originalComplete||value.removed||!['indexing','unreadable'].includes(value.state))fail('文件当前不能建立索引',409);
      if(value.pendingGeneration&&body.generation!==value.pendingGeneration)fail('本次识别已被更新的任务替代，请刷新资料状态',409);
      if(!Array.isArray(body.segments)||body.segments.length>32)fail('索引批次无效');
      let chars=0;for(const s of body.segments){if(!Number.isSafeInteger(s.ordinal)||s.ordinal<0||typeof s.text!=='string'||!s.text.trim()||s.text.length>5000)fail('文件片段无效');chars+=s.text.length;}
      if(chars>128000)fail('单个索引批次过大');
      const prepared=await Promise.all(body.segments.map(async s=>({...s,location:location(s.location),digest:await digest(s.text)})));
      const table=value.pendingGeneration?'library_pending_segments':'library_segments';
      transact(ctx,()=>{for(const s of prepared){
        const prior=rows(ctx,'SELECT digest FROM '+table+' WHERE file_id=? AND ordinal=?',value.id,s.ordinal)[0];
        if(prior){if(prior.digest!==s.digest)fail('相同位置的文件片段不一致，请重新上传',409);continue;}
        if(value.pendingGeneration)ctx.storage.sql.exec('INSERT INTO library_pending_segments(file_id,ordinal,location,text,digest,words) VALUES(?,?,?,?,?,?)',value.id,s.ordinal,s.location,s.text,s.digest,Context.terms(s.text).join(' '));
        else{
          ctx.storage.sql.exec('INSERT INTO library_segments(file_id,ordinal,location,text,digest) VALUES(?,?,?,?,?)',value.id,s.ordinal,s.location,s.text,s.digest);
          ctx.storage.sql.exec('INSERT INTO library_search(words,file_id,ordinal) VALUES(?,?,?)',Context.terms(s.text).join(' '),value.id,s.ordinal);
        }
      }});return json({ok:true});
    }
    if(action==='commit'){
      if(value.pendingGeneration&&body.generation!==value.pendingGeneration||!value.pendingGeneration&&body.generation&&body.generation!==value.indexGeneration)fail('识别任务已更新，旧结果不会覆盖当前资料',409);
      if(['ready','partial'].includes(value.state))return json({file:publicFile(value)});
      const table=value.pendingGeneration?'library_pending_segments':'library_segments';
      const stats=rows(ctx,'SELECT COUNT(*) AS n,MAX(ordinal) AS last,SUM(length(text)) AS chars FROM '+table+' WHERE file_id=?',value.id)[0];
      if(!value.originalComplete||!Number.isSafeInteger(body.segments)||body.segments<1||stats.n!==body.segments||stats.last!==body.segments-1)fail('解析结果不完整，尚不能供 AI 使用',409);
      const coverage=body.coverage;
      if(coverage&&(!Number.isSafeInteger(coverage.units)||!Number.isSafeInteger(coverage.emptyUnits)||coverage.emptyUnits<0||coverage.emptyUnits>coverage.units))fail('解析覆盖范围无效');
      if(coverage&&['uncertainUnits','ocrPages','blankUnits','nativeEmptyUnits'].some(key=>coverage[key]!==undefined&&(!Number.isSafeInteger(coverage[key])||coverage[key]<0||coverage[key]>coverage.units)))fail('识别覆盖范围无效');
      const ocrCount=rows(ctx,"SELECT COUNT(*) AS n FROM library_ocr_pages WHERE file_id=? AND state='done'",value.id)[0].n;
      value.coverage=coverage||null;value.state=coverage?.emptyUnits>0||coverage?.uncertainUnits>0?'partial':'ready';value.characters=stats.chars;value.segments=stats.n;value.indexedAt=Date.now();if(ocrCount){value.ocrModel=OCR_MODEL;value.ocrPages=ocrCount;}delete value.parseError;delete value.previousParseState;
      transact(ctx,()=>{
        if(value.pendingGeneration){
          ctx.storage.sql.exec('DELETE FROM library_search WHERE file_id=?',value.id);
          ctx.storage.sql.exec('DELETE FROM library_segments WHERE file_id=?',value.id);
          ctx.storage.sql.exec('INSERT INTO library_segments(file_id,ordinal,location,text,digest) SELECT file_id,ordinal,location,text,digest FROM library_pending_segments WHERE file_id=?',value.id);
          ctx.storage.sql.exec('INSERT INTO library_search(words,file_id,ordinal) SELECT words,file_id,ordinal FROM library_pending_segments WHERE file_id=?',value.id);
          ctx.storage.sql.exec('DELETE FROM library_pending_segments WHERE file_id=?',value.id);
          value.indexGeneration=value.pendingGeneration;delete value.pendingGeneration;
        }
        save(ctx,value);if(value.replaced){const prior=rows(ctx,'SELECT id FROM library_files WHERE id=?',value.replaced.id)[0];if(prior){const old=file(ctx,prior.id);old.removed=true;save(ctx,old);}else ctx.storage.sql.exec('INSERT INTO library_retired(id,meta) VALUES(?,?) ON CONFLICT(id) DO NOTHING',value.replaced.id,JSON.stringify(value.replaced));}
      });
      return json({file:publicFile(value)});
    }
    if(action==='parse_failed'){
      if(value.pendingGeneration&&body.generation!==value.pendingGeneration)fail('识别任务已更新',409);
      if(!['ready','partial'].includes(value.state)){
        value.state=['ready','partial'].includes(value.previousParseState)?value.previousParseState:'unreadable';value.parseError=String(body.error||'未识别到可读文字').slice(0,250);delete value.previousParseState;
        transact(ctx,()=>{ctx.storage.sql.exec('DELETE FROM library_pending_segments WHERE file_id=?',value.id);delete value.pendingGeneration;save(ctx,value);});
      }return json({file:publicFile(value)});
    }
    if(action==='preview'){
      if(value.removed)fail('项目资料不存在',404);
      const parts=rows(ctx,'SELECT location,text FROM library_segments WHERE file_id=? ORDER BY ordinal LIMIT 32',value.id);let text='';
      for(const p of parts){if(text.length>=60000)break;text+=(p.location?'['+p.location+']\n':'')+p.text+'\n\n';}
      return json({file:{...publicFile(value),text:text.slice(0,60000),previewTruncated:value.characters>60000}});
    }
    if(action==='download'){
      if(value.removed||!value.originalComplete)fail('原文件尚不可下载',404);
      const object=await env.PROJECT_DOCUMENTS.get(value.objectKey);if(!object)fail('原文件暂不可用',503);
      return new Response(object.body,{headers:{'Content-Type':value.type,'Content-Length':String(object.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(value.name),'Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*'}});
    }
    if(action==='remove'||action==='restore'){value.removed=action==='remove';save(ctx,value);return json({file:publicFile(value)});}
    if(action==='abort'){
      if(value.state==='ready')fail('请使用移除资料',409);
      if(!value.originalComplete)await env.PROJECT_DOCUMENTS.resumeMultipartUpload(value.objectKey,value.uploadId).abort().catch(()=>{});
      else await env.PROJECT_DOCUMENTS.delete(value.objectKey);
      value.state='aborted';save(ctx,value);return json({ok:true});
    }
    fail('未知资料操作');
  }catch(error){return json({error:error.status?error.message:'项目资料处理失败，请稍后重试'},error.status||500);}
}

export async function projectLibrary(env,owner,projectId,action,extra={}){
  if(!env.CHAT_RUNS)throw Object.assign(Error('项目资料索引服务未就绪'),{status:503});
  const actor=env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName('project-library:'+owner+':'+projectId));
  const response=await actor.fetch(new Request('https://project-library.internal/__library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...extra,owner,projectId,action})}));
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(Error(data.error||'项目资料操作失败'),{status:response.status});}
  if(action==='download')return response;
  return response.json();
}
