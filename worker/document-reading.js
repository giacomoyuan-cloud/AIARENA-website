import Context from '../arena-context.js';
import {readProject,ReadingPaused} from './project-reading.js';
import {materialName} from '../web/file-types.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
export function namedFiles(files,query){
  const q=String(query).toLowerCase(),specific=files.filter(f=>f.relativePath&&q.includes(materialName(f).toLowerCase())),relative=files.filter(f=>f.relativePath&&q.includes(f.relativePath.toLowerCase()));
  return new Set(specific.length?specific:relative.length?relative:files.filter(f=>{const name=f.name.toLowerCase(),stem=name.replace(/\.[^.]+$/,'');return q.includes(name)||(stem.length>1&&q.includes(stem));}));
}
export function inlineSource(input){
  if(!input||!Array.isArray(input.files)||input.files.length>100)fail('无痕文件信息无效');
  const files=[],segments=[];let chars=0;
  for(const source of input.files){
    if(!source||typeof source.id!=='string'||!/^[a-zA-Z0-9_-]{6,80}$/.test(source.id)||typeof source.name!=='string'||source.name.length>180||!Array.isArray(source.segments)||source.segments.length>192||!['ready','partial'].includes(source.status))fail('无痕文件内容无效，较大的全文阅读请使用普通模式');
    if(files.some(f=>f.id===source.id))fail('无痕文件编号重复');
    const file={id:source.id,name:source.name,characters:0,segments:source.segments.length,storage:'r2',status:source.status,indexedAt:source.indexedAt||0};
    for(const [ordinal,s]of source.segments.entries()){
      if(typeof s.text!=='string'||s.text.length>5000||typeof s.location!=='string'||s.location.length>400)fail('无痕文件片段无效');
      chars+=s.text.length;if(chars>600000)fail('本轮无痕文件文字过多，请分批或使用普通模式');
      file.characters+=s.text.length;segments.push({fileId:source.id,name:source.name,ordinal,location:s.location,text:s.text});
    }files.push(file);
  }
  let selected=new Set();
  return {files,kind:'conversation',async library(action,extra){
    if(action==='scope'){selected=new Set(extra.ids);return {ok:true};}
    if(action==='batch'){const all=segments.filter(s=>selected.has(s.fileId)),batch=[];let chars=0;for(const s of all.slice(extra.offset)){if(batch.length&&chars+s.text.length>24000)break;batch.push(s);chars+=s.text.length;}return {segments:batch,next:extra.offset+batch.length,done:!batch.length};}
    if(action==='search')return {hits:segments.map(s=>{const terms=Context.terms(extra.query),textTerms=new Set(Context.terms(s.text)),score=terms.filter(t=>textTerms.has(t)).length+(s.ordinal===0&&String(extra.query).toLowerCase().includes(s.name.toLowerCase())?1000:0);return {...s,text:s.text,file:files.find(f=>f.id===s.fileId),score};}).filter(h=>h.score>0).sort((a,b)=>b.score-a.score).slice(0,12)};
    fail('无痕文件操作无效');
  },batchLegacy:async function*(){}};
}
export async function retrieveLibrary(source,query,currentFileIds=[]){
  if(!source.files.length||/^\s*(你好|您好|谢谢|hi|hello|thanks|ok)[!！。.\s]*$/i.test(query))return {text:'',files:[],fragments:0,mode:'retrieve'};
  const names=source.files.filter(f=>currentFileIds.includes(f.id)).slice(0,3).map(materialName),searchQuery=query+(names.length?'\n'+names.join('\n'):'');
  const result=await source.library('search',{query:searchQuery}),preferred=[...currentFileIds,...namedFiles(source.files,query)].map(f=>typeof f==='string'?f:f.id),hits=[];
  for(const id of preferred){const hit=result.hits.find(h=>h.file.id===id);if(hit&&!hits.includes(hit))hits.push(hit);}
  for(const hit of result.hits)if(!hits.includes(hit))hits.push(hit);
  const items=hits.slice(0,3).map(h=>({text:h.text.slice(0,1600),file:{id:h.file.id,name:h.file.name,location:h.location,source:source.kind||'conversation'},score:h.score}));
  return materialItems(items,source.files.map(f=>({...f,name:materialName(f)})));
}
export function materialItems(items,available=[]){
  const chosen=items.slice(0,3),files=[];for(const x of chosen)if(!files.some(f=>f.id===x.file.id))files.push(x.file);
  return {text:chosen.map(x=>'资料：'+x.file.name+'，'+(x.file.location||'正文')+'\n'+x.text).join('\n\n'),files,fragments:chosen.length,mode:'retrieve',available:available.map(({id,name,status})=>({id,name,status})).slice(0,20),items:chosen};
}
export function mergeMaterials(first,second,query){
  const a=first.items||[],b=second.items||[];
  const available=[...(first.available||[]),...(second.available||[])];
  if(!a.length)return {...second,available};if(!b.length)return {...first,available};
  const named=x=>String(query).toLowerCase().includes(x.file.name.toLowerCase());
  const items=[...a.filter(named),...b.filter(named),a[0],b[0],...a.slice(1),...b.slice(1)],seen=new Set(),unique=items.filter(x=>{const key=x.file.id+':'+x.file.location+':'+x.text;if(seen.has(key))return false;seen.add(key);return true;});
  return materialItems(unique,available);
}
export async function readSources(sources,options){
  const actual=sources.filter(s=>s.files.length),total=actual.reduce((n,s)=>n+s.files.reduce((m,f)=>m+Number(f.segments||f.chunks||0),0),0);let offset=0,calls=0;const results=[];
  // Validate every source before the first potentially paid reading call.
  const invalid=actual.flatMap(s=>s.files.filter(f=>f.storage==='r2'&&f.status!=='ready'&&!(f.status==='partial'&&f.coverage?.emptyUnits===0&&f.coverage?.uncertainUnits>0)));
  if(invalid.length)fail('尚不能全文阅读：'+invalid.map(f=>f.name+'（'+(f.status==='partial'?'部分页面需要 OCR':'索引未完成或解析失败')+'）').join('、'));
  if(actual.some(s=>s.files.some(f=>!Number.isSafeInteger(f.segments||f.chunks)||Number(f.segments||f.chunks)<1)))fail('文件索引不完整，请重新上传；本轮尚未产生阅读调用');
  if(options.incognito&&total>192)fail('这份资料需要保存分批阅读进度，请使用普通模式；本轮尚未产生阅读调用');
  for(const source of actual){
    try{
      const result=await readProject({...options,...source,budget:Math.max(0,24-calls),complete:async prompt=>{calls++;return options.complete(prompt);},progress:p=>options.progress({...p,done:offset+p.done,total,complete:p.complete&&offset+p.done===total,label:p.complete?'已读入 '+(offset+p.done)+'/'+total+' 个片段'+(p.recognitionWarnings?.length?' · 保留识别不清晰提示':''):'全文阅读 · '+(offset+p.done)+'/'+total+' 个片段'})});
      results.push({...result,files:result.files.map(f=>({...f,source:source.kind||'project'}))});offset+=result.fragments;
    }catch(error){if(error instanceof ReadingPaused)throw new ReadingPaused({...error.progress,done:offset+error.progress.done,total});throw error;}
  }
  const recognitionWarnings=results.flatMap(r=>r.coverage?.recognitionWarnings||[]);
  return {text:results.map(r=>r.text).join('\n\n'),files:results.flatMap(r=>r.files),fragments:offset,mode:'full',coverage:{done:offset,total,complete:offset===total,...(recognitionWarnings.length?{recognitionWarnings}:{})},usage:results.flatMap(r=>r.usage||[])};
}
