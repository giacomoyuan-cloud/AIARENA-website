import Context from '../arena-context.js';
import {isDocument,isImage,materialName} from '../web/file-types.mjs';
import {OCR_MODEL} from './project-ocr.js';
import {mediaInput,DOCUMENT_DELIVERY_VERSION} from './document-media.js';

const initialized=new WeakSet();
const readableSQL="(f.state='ready' OR (f.state='partial' AND COALESCE(json_extract(f.meta,'$.coverage.emptyUnits'),-1)=0 AND COALESCE(json_extract(f.meta,'$.coverage.uncertainUnits'),0)>0))";
// OCR is appended after native extraction. Preserve chunk IDs while reading the
// combined document in physical page order, including already indexed files.
const readingOrder=(alias='')=>"CASE WHEN "+alias+"location GLOB '第 [0-9]* 页*' THEN CAST(substr("+alias+"location,3) AS INTEGER) ELSE "+alias+"ordinal+1 END,"+alias+'ordinal';
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{6,80}$/.test(id);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const rows=(ctx,sql,...args)=>ctx.storage.sql.exec(sql,...args).toArray();
function init(ctx){
  if(initialized.has(ctx))return;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_identity (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_files (id TEXT PRIMARY KEY, meta TEXT NOT NULL, state TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_segments (file_id TEXT NOT NULL, ordinal INTEGER NOT NULL, location TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(file_id,ordinal))');
  ctx.storage.sql.exec('CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(words, file_id UNINDEXED, ordinal UNINDEXED)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_retired (id TEXT PRIMARY KEY, meta TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_readings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_scope_files (scope TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY(scope,file_id))');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_ocr_pages (file_id TEXT NOT NULL, page INTEGER NOT NULL, state TEXT NOT NULL, result TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(file_id,page))');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_pending_segments (file_id TEXT NOT NULL, ordinal INTEGER NOT NULL, location TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL, words TEXT NOT NULL, PRIMARY KEY(file_id,ordinal))');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS library_media (file_id TEXT NOT NULL,id TEXT NOT NULL,meta TEXT NOT NULL,PRIMARY KEY(file_id,id))');
  for(const table of ['library_segments','library_pending_segments'])if(!rows(ctx,'PRAGMA table_info('+table+')').some(c=>c.name==='media'))ctx.storage.sql.exec('ALTER TABLE '+table+' ADD COLUMN media TEXT');
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
function readingText(meta,where,text){
  const page=Number(String(where||'').match(/^第\s+(\d+)\s+页/)?.[1]),warnings=(meta?.coverage?.warnings||[]).filter(w=>(w.location?String(where||'').startsWith(w.location):w.page===page)&&typeof w.text==='string').map(w=>w.text);
  return text+(warnings.length?'\n\n[本页识别提示：'+warnings.join('；')+'。不清晰部分不得推测补全。]':'');
}

// This actor uses a separate, project-specific ID in the existing SQLite-backed
// namespace. Its files/search tables never share an instance with chat runs.
export async function handleProjectLibrary(ctx,env,request){
  try{
    init(ctx);
    const url=new URL(request.url),part=request.method==='PUT';
    const body=part?{owner:request.headers.get('x-library-owner'),projectId:request.headers.get('x-library-project'),conversation:request.headers.get('x-library-conversation')==='true',channel:request.headers.get('x-library-channel'),action:'part',fileId:url.searchParams.get('file'),part:Number(url.searchParams.get('part'))}:await request.json();
    await identity(ctx,body.owner,body.projectId);
    const action=body.action;
    if(action==='ocr_page')return json({error:'已停止 Sol 预处理。请刷新网页或更新 App；文件会在发送时交给当前模型。'},409);
    const settings=JSON.parse(rows(ctx,'SELECT value FROM library_settings WHERE id=1')[0]?.value||'{}');
    if(body.conversation){
      if(typeof body.channel!=='string'||(body.channel!=='general'&&!idOK(body.channel)))fail('对话文件范围无效');
      if(action==='move_scope'&&settings.channel===body.targetChannel)return json({ok:true});
      if(settings.channel&&settings.channel!==body.channel)fail('对话文件已移动，请从所属对话打开',409);
      if(!settings.channel){settings.channel=body.channel;ctx.storage.sql.exec('INSERT INTO library_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(settings));}
      if(action==='settings'||action==='move_scope'){
        if(action==='settings'){if(!['retrieve','full'].includes(body.mode))fail('阅读方式无效');settings.readingMode=body.mode;}
        else{if(body.targetChannel!=='general'&&!idOK(body.targetChannel))fail('目标范围无效');settings.channel=body.targetChannel;}
        ctx.storage.sql.exec('UPDATE library_settings SET value=? WHERE id=1',JSON.stringify(settings));return json({ok:true,readingMode:settings.readingMode||'full'});
      }
    }
    if(action==='list'){
      const all=rows(ctx,'SELECT meta,state,removed FROM library_files').map(r=>publicFile({...JSON.parse(r.meta),state:r.state,removed:!!r.removed}));
      return json({files:all.filter(f=>!f.removed&&f.state!=='aborted'),removed:all.filter(f=>f.removed),readingMode:settings.readingMode||'full',retired:rows(ctx,'SELECT meta FROM library_retired').map(r=>JSON.parse(r.meta))});
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
      if(!isDocument(input.name)&&!isImage(input.name))fail('暂不支持此资料格式');
      const existing=rows(ctx,'SELECT id FROM library_files WHERE id=?',input.id)[0];
      if(existing){const prior=file(ctx,input.id);if(prior.name!==input.name||prior.size!==input.size||(prior.folder||'')!==(input.folder||'')||(prior.relativePath||'')!==(input.relativePath||'')||(prior.replaced?.id||'')!==(body.replaced?.id||'')||prior.state==='aborted'||prior.removed)fail('上传会话与文件不匹配，请重新开始上传',409);return json({file:publicFile(prior),partSize:prior.partSize});}
      if(input.folder!==undefined&&(typeof input.folder!=='string'||!input.folder.trim()||input.folder.length>180||/[\u0000-\u001f/\\]/.test(input.folder)||typeof input.relativePath!=='string'||input.relativePath.length>500||input.relativePath.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')))fail('文件夹路径无效');
      const objectKey=(body.conversation?'conversations/':'projects/')+encodeURIComponent(body.owner)+'/'+(body.conversation?encodeURIComponent(body.channel)+'/':'')+body.projectId+'/'+input.id+'/original';
      const upload=await env.PROJECT_DOCUMENTS.createMultipartUpload(objectKey,{httpMetadata:{contentType:input.type||'application/octet-stream'}});
      const value={id:input.id,name:input.name,size:input.size,type:String(input.type||'application/octet-stream').slice(0,120),createdAt:Date.now(),characters:0,segments:0,partSize:Math.max(5*1024*1024,Math.ceil(input.size/9999/1024/1024)*1024*1024),objectKey,uploadId:upload.uploadId,state:'uploading',removed:false,...(input.folder?{folder:input.folder,relativePath:input.relativePath}:{}),...(body.replaced?{replaced:body.replaced}:{})};
      save(ctx,value);return json({file:publicFile(value),partSize:value.partSize});
    }
    if(action==='search'){
      const terms=Context.terms(body.query).slice(0,32),query=terms.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' OR ');
      let hits=[];
      if(query)hits=rows(ctx,"SELECT s.file_id,s.ordinal,s.location,s.text,s.media,bm25(library_search) AS score FROM library_search JOIN library_segments s ON s.file_id=library_search.file_id AND s.ordinal=library_search.ordinal JOIN library_files f ON f.id=s.file_id WHERE library_search MATCH ? AND f.state IN ('ready','partial') AND f.removed=0 ORDER BY score LIMIT 12",query);
      const available=rows(ctx,"SELECT meta FROM library_files WHERE state IN ('ready','partial') AND removed=0").map(r=>JSON.parse(r.meta));
      const queryName=String(body.query||'').toLowerCase(),specific=available.filter(f=>f.relativePath&&queryName.includes(materialName(f).toLowerCase())),relative=available.filter(f=>f.relativePath&&queryName.includes(f.relativePath.toLowerCase())),named=specific.length?specific:relative.length?relative:available.filter(f=>{const name=f.name.toLowerCase(),stem=name.replace(/\.[^.]+$/,'');return queryName.includes(name)||(stem.length>1&&queryName.includes(stem));});
      for(const f of named.slice(0,3))if(!hits.some(h=>f.id===h.file_id))hits.push(...rows(ctx,'SELECT file_id,ordinal,location,text,media,0 AS score FROM library_segments WHERE file_id=? ORDER BY '+readingOrder()+' LIMIT 1',f.id));
      const byId=new Map(available.map(f=>[f.id,f]));
      return json({hits:hits.map(h=>({...h,text:readingText(byId.get(h.file_id),h.location,h.text),media:h.media?JSON.parse(h.media):undefined,file:{id:h.file_id,name:materialName(byId.get(h.file_id)),characters:byId.get(h.file_id)?.characters},score:-h.score+(named.some(f=>f.id===h.file_id)?1000:0)})),available:available.map(f=>({id:f.id,name:materialName(f),characters:f.characters,segments:f.segments}))});
    }
    if(action==='scope'){
      if(typeof body.scope!=='string'||!/^[a-f0-9]{64}$/.test(body.scope)||!Array.isArray(body.ids)||body.ids.some(id=>!idOK(id)))fail('阅读范围无效');
      transact(ctx,()=>{ctx.storage.sql.exec('DELETE FROM library_scope_files WHERE scope=?',body.scope);for(const id of body.ids)ctx.storage.sql.exec('INSERT INTO library_scope_files(scope,file_id) VALUES(?,?)',body.scope,id);});return json({ok:true});
    }
    if(action==='batch'){
      const offset=Number(body.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail('阅读位置无效');
      if(typeof body.scope!=='string'||!/^[a-f0-9]{64}$/.test(body.scope))fail('阅读范围无效');
      const unavailable=rows(ctx,"SELECT COUNT(*) AS n FROM library_scope_files q LEFT JOIN library_files f ON f.id=q.file_id WHERE q.scope=? AND (f.id IS NULL OR NOT "+readableSQL+" OR f.removed!=0)",body.scope)[0].n;
      if(unavailable)fail('阅读期间项目资料发生变化，请重新开始全文阅读',409);
      const result=rows(ctx,"SELECT s.file_id,s.ordinal,s.location,s.text,s.media,f.meta FROM library_segments s JOIN library_files f ON f.id=s.file_id JOIN library_scope_files q ON q.file_id=f.id WHERE q.scope=? AND "+readableSQL+" AND f.removed=0 ORDER BY s.file_id,"+readingOrder('s.')+" LIMIT 16 OFFSET ?",body.scope,offset);
      const resultRows=[];let chars=0,mediaCount=0,mediaBytes=0;
      for(const row of result){const meta=JSON.parse(row.meta),text=readingText(meta,row.location,row.text),media=row.media?JSON.parse(row.media):null;if(resultRows.length&&(chars+text.length>24000||media&&(mediaCount>=3||mediaBytes+media.size>3*1024*1024)))break;resultRows.push({fileId:row.file_id,name:materialName(meta),ordinal:row.ordinal,location:row.location,text,...(media?{media}:{})});chars+=text.length;if(media){mediaCount++;mediaBytes+=media.size;}}
      return json({segments:resultRows,next:offset+resultRows.length,done:resultRows.length===0,total:rows(ctx,"SELECT COUNT(*) AS n FROM library_segments s JOIN library_files f ON f.id=s.file_id JOIN library_scope_files q ON q.file_id=f.id WHERE q.scope=?",body.scope)[0].n});
    }
    if(action==='restore_legacy'){ctx.storage.sql.exec('DELETE FROM library_retired WHERE id=?',body.fileId);return json({ok:true});}
    if(action==='purge_conversation'&&body.conversation){
      for(const row of rows(ctx,'SELECT meta,state FROM library_files')){const f=JSON.parse(row.meta);if(f.objectKey)await env.PROJECT_DOCUMENTS.delete(f.objectKey);if(f.uploadId&&!f.originalComplete)await env.PROJECT_DOCUMENTS.resumeMultipartUpload(f.objectKey,f.uploadId).abort().catch(()=>{});}
      for(const row of rows(ctx,'SELECT meta FROM library_media'))await env.PROJECT_DOCUMENTS.delete(JSON.parse(row.meta).key);
      transact(ctx,()=>{for(const table of ['library_media','library_search','library_segments','library_pending_segments','library_ocr_pages','library_retired','library_files','library_readings','library_scope_files'])ctx.storage.sql.exec('DELETE FROM '+table);});return json({ok:true});
    }
    const value=file(ctx,body.fileId);
    if(action==='media'){
      if(value.removed||!value.originalComplete||value.state!=='indexing')fail('文件当前不能准备原图',409);
      if(value.pendingGeneration&&body.generation!==value.pendingGeneration)fail('文件准备任务已变化',409);
      let bytes;try{bytes=mediaInput(body);}catch(e){fail(e.message);}
      const id=(await digest(body.data+':'+String(body.location||body.page))).slice(0,48),key=value.objectKey+':media:'+id;
      const media={id,key,size:bytes.length,mime:body.mime,page:body.page,location:location(body.location||('第 '+body.page+' 页'))};
      if(!rows(ctx,'SELECT id FROM library_media WHERE file_id=? AND id=?',value.id,id).length){await env.PROJECT_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:body.mime}});ctx.storage.sql.exec('INSERT INTO library_media(file_id,id,meta) VALUES(?,?,?)',value.id,id,JSON.stringify(media));}
      const {key:privateKey,...publicMedia}=media;return json({kind:'text',text:'',deferred:true,media:publicMedia,warning:''});
    }
    if(action==='media_download'){
      if(value.removed)fail('文件已移除',404);
      const row=rows(ctx,'SELECT meta FROM library_media WHERE file_id=? AND id=?',value.id,body.mediaId)[0];if(!row)fail('文件原图不存在',404);
      const meta=JSON.parse(row.meta),object=await env.PROJECT_DOCUMENTS.get(meta.key);if(!object)fail('文件原图暂不可用',404);
      return new Response(object.body,{headers:{'Content-Type':meta.mime,'Cache-Control':'no-store','Content-Length':String(object.size)}});
    }
    if(action==='reparse'){
      if(value.removed||!value.originalComplete||(!isDocument(value.name)&&!isImage(value.name)))fail('此资料暂不能继续识别',409);
      if(value.state!=='indexing')value.previousParseState=value.state;
      value.state='indexing';value.pendingGeneration=crypto.randomUUID();
      transact(ctx,()=>{ctx.storage.sql.exec('DELETE FROM library_pending_segments WHERE file_id=?',value.id);save(ctx,value);});
      return json({file:publicFile(value),generation:value.pendingGeneration});
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
      let chars=0;for(const s of body.segments){if(!Number.isSafeInteger(s.ordinal)||s.ordinal<0||typeof s.text!=='string'||(!s.text.trim()&&!s.media)||s.text.length>5000)fail('文件片段无效');chars+=s.text.length;}
      if(chars>128000)fail('单个索引批次过大');
      const prepared=await Promise.all(body.segments.map(async s=>{let media=null;if(s.media){const row=rows(ctx,'SELECT meta FROM library_media WHERE file_id=? AND id=?',value.id,s.media.id)[0];if(!row)fail('文件原图引用无效');const {key,...meta}=JSON.parse(row.meta);media=meta;}return {...s,media:media?JSON.stringify(media):null,location:location(s.location),digest:await digest(s.text+(media?JSON.stringify(media):''))};}));
      const table=value.pendingGeneration?'library_pending_segments':'library_segments';
      transact(ctx,()=>{for(const s of prepared){
        const prior=rows(ctx,'SELECT digest FROM '+table+' WHERE file_id=? AND ordinal=?',value.id,s.ordinal)[0];
        if(prior){if(prior.digest!==s.digest)fail('相同位置的文件片段不一致，请重新上传',409);continue;}
        if(value.pendingGeneration)ctx.storage.sql.exec('INSERT INTO library_pending_segments(file_id,ordinal,location,text,digest,words,media) VALUES(?,?,?,?,?,?,?)',value.id,s.ordinal,s.location,s.text,s.digest,Context.terms(s.text).join(' '),s.media);
        else{
          ctx.storage.sql.exec('INSERT INTO library_segments(file_id,ordinal,location,text,digest,media) VALUES(?,?,?,?,?,?)',value.id,s.ordinal,s.location,s.text,s.digest,s.media);
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
      value.coverage=coverage||null;value.state=coverage?.emptyUnits>0||coverage?.uncertainUnits>0?'partial':'ready';value.characters=stats.chars;value.segments=stats.n;value.indexedAt=Math.max(Date.now(),Number(value.indexedAt||0)+1);if(coverage?.sourceVersion===DOCUMENT_DELIVERY_VERSION){delete value.ocrModel;delete value.ocrPages;}else if(ocrCount){value.ocrModel=OCR_MODEL;value.ocrPages=ocrCount;}delete value.parseError;delete value.previousParseState;
      transact(ctx,()=>{
        if(value.pendingGeneration){
          ctx.storage.sql.exec('DELETE FROM library_search WHERE file_id=?',value.id);
          ctx.storage.sql.exec('DELETE FROM library_segments WHERE file_id=?',value.id);
          ctx.storage.sql.exec('INSERT INTO library_segments(file_id,ordinal,location,text,digest,media) SELECT file_id,ordinal,location,text,digest,media FROM library_pending_segments WHERE file_id=?',value.id);
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
      const parts=rows(ctx,'SELECT location,text FROM library_segments WHERE file_id=? ORDER BY '+readingOrder()+' LIMIT 256',value.id);let text='',shown=0;
      for(const p of parts){if(text.length>=60000)break;text+=(p.location?'['+p.location+']\n':'')+readingText(value,p.location,p.text)+'\n\n';shown++;}
      return json({file:{...publicFile(value),text:text.slice(0,60000),previewTruncated:shown<value.segments||text.length>60000}});
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
  if(['download','media_download'].includes(action))return response;
  return response.json();
}
