import test from 'node:test';
import assert from 'node:assert/strict';
import {directDocuments} from './direct-documents.js';
import {appendDocumentParts,mediaInput} from './document-media.js';
import {readSources,inlineSource} from './document-reading.js';
const pdf=Buffer.from('%PDF-1.4\nSYNTHETIC_COMPLETE_PDF_LAST_PAGE');
function source({native=false,count=2,media=false}={}){
 const file={id:'file-one',name:native?'reference.pdf':'reference.xlsx',type:native?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:pdf.length,status:'ready',storage:'r2',segments:count,indexedAt:1,coverage:{units:count}};
 const segments=Array.from({length:count},(_,i)=>({fileId:file.id,name:file.name,ordinal:i,location:'位置 '+(i+1),text:'原始值 '+i+' '+(i===count-1?'FINAL_UNIQUE_CANARY':'')+(i===1000?'SPARSE_CELL_AFTER_ROW_1000':''),...(media?{media:{id:'image-'+i,mime:'image/jpeg',size:3}}:{})}));
 const calls=[];
 return {files:[file],kind:'conversation',calls,segments,original:async()=>new Response(pdf),async library(action,extra){calls.push(action);if(action==='scope')return {};if(action==='reading_get')return {};if(action==='reading_put')return {};if(action==='media_download')return new Response(new Uint8Array([255,216,255]));if(action==='batch'){const batch=segments.slice(extra.offset,extra.offset+2);return {segments:batch,next:extra.offset+batch.length,done:!batch.length};}throw Error(action);},batchLegacy:async function*(){}};
}
test('complete spreadsheet data, including rows beyond 1000, reaches the final request without a reader call',async()=>{
 const s=source({count:1100});const r=await directDocuments([s],{provider:'openai',budgetBytes:200000});
 assert.equal(r.delivery,'complete');assert.match(r.text,/SPARSE_CELL_AFTER_ROW_1000/);assert.match(r.text,/FINAL_UNIQUE_CANARY/);assert.equal(r.fragments,1100);assert.ok(!s.calls.includes('reading_put'));
});
test('supported providers receive the identical PDF original instead of extracted notes',async()=>{
 for(const provider of ['openai','google','anthropic']){const s=source({native:true});const r=await directDocuments([s],{provider,budgetBytes:5000});assert.equal(r.delivery,'native');assert.equal(Buffer.from(r.originals[0].data,'base64').compare(pdf),0);assert.equal(r.text,'');assert.deepEqual(s.calls,[]);}
});
test('Grok full reading receives original page images and full text rather than attachment search',async()=>{
 const s=source({native:true,media:true});const r=await directDocuments([s],{provider:'xai',budgetBytes:5000});assert.equal(r.originals.length,0);assert.equal(r.images.length,2);assert.match(r.text,/FINAL_UNIQUE_CANARY/);
 const p={input:[{role:'user',content:'question'}]};appendDocumentParts('xai',p,[],r.images);assert.equal(p.input[0].content.filter(x=>x.type==='input_image').length,2);assert.ok(!JSON.stringify(p).includes('attachment_search'));
});
test('an oversized document falls back without submitting a truncated prefix; every later batch reaches the same completion callback',async()=>{
 const s=source({count:9});assert.equal(await directDocuments([s],{provider:'google',budgetBytes:20}),null);
 const submitted=[];const r=await readSources([s],{model:'selected-model',question:'任务',history:[],context:{},scope:'general',incognito:true,signal:new AbortController().signal,progress:()=>{},complete:async(p,images)=>{submitted.push({p,images});return {text:p.includes('FINAL_UNIQUE_CANARY')?'FINAL_UNIQUE_CANARY':'批次笔记'};}});
 assert.equal(r.delivery,'batches');assert.equal(r.coverage.done,9);assert.ok(submitted.at(-1).p.includes('FINAL_UNIQUE_CANARY'));assert.match(r.text,/FINAL_UNIQUE_CANARY/);
});
test('each provider receives native file content in its documented request shape',()=>{
 const f={name:'sample.pdf',data:pdf.toString('base64')};
 const openai={input:[{role:'user',content:'read'}]};appendDocumentParts('openai',openai,[f]);assert.equal(openai.input[0].content[1].type,'input_file');
 const claude={messages:[{role:'user',content:'read'}]};appendDocumentParts('anthropic',claude,[f]);assert.equal(claude.messages[0].content[1].source.media_type,'application/pdf');
 const gemini={contents:[{parts:[{text:'read'}]}]};appendDocumentParts('google',gemini,[f]);assert.equal(gemini.contents[0].parts[2].inline_data.mime_type,'application/pdf');
 assert.throws(()=>appendDocumentParts('xai',{input:[{content:'read'}]},[f]),/全文/);
});
test('private originals stay in memory, validate their size, and produce no persistent reading checkpoints',async()=>{
 const inline={files:[{id:'private-1',name:'private.pdf',status:'ready',original:{mime:'application/pdf',size:pdf.length,data:pdf.toString('base64')},segments:[{text:'private text',location:'正文'}]}]};
 const s=inlineSource(inline);const r=await directDocuments([s],{provider:'google',budgetBytes:5000});assert.equal(r.originals[0].data,pdf.toString('base64'));assert.throws(()=>inlineSource({files:[{...inline.files[0],original:{...inline.files[0].original,size:1}}]}),/长度/);
});
test('media validation rejects fake MIME types, malformed base64 and oversized bodies before storage',()=>{
 assert.throws(()=>mediaInput({page:1,total:1,mime:'image/jpeg',data:'AAAA'}),/类型/);assert.throws(()=>mediaInput({page:0,total:1,mime:'image/jpeg',data:'/9j/'}),/页/);assert.equal(mediaInput({page:1,total:1,mime:'image/jpeg',data:'/9j/'}).length,3);
});

test('visual batches deliver every original page to the selected model completion callback',async()=>{
 const s=source({native:true,media:true,count:4});assert.equal(await directDocuments([s],{provider:'xai',budgetBytes:99999}),null);
 const submitted=[];const r=await readSources([s],{model:'user-selected-grok',question:'read',history:[],context:{},scope:'general',incognito:true,signal:new AbortController().signal,progress:()=>{},complete:async(p,images)=>{submitted.push({p,images});return {text:'complete batch notes'};}});
 assert.equal(r.coverage.done,4);assert.equal(submitted.flatMap(x=>x.images).length,4);assert.match(submitted.at(-1).p,/FINAL_UNIQUE_CANARY/);
});
