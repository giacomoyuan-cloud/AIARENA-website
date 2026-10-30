import {SaxesParser} from 'saxes';
import JSZip from 'jszip';
const local=n=>n?.name?.split(':').pop()||'';
export function xml(source){
 if(source.length>50*1024*1024)throw Error('文档内部 XML 过大，请拆分文件');
 source=source.replace(/&(?:nbsp|copy|reg|mdash|ndash|hellip);/g,v=>({'&nbsp;':' ','&copy;':'©','&reg;':'®','&mdash;':'—','&ndash;':'–','&hellip;':'…'})[v]);
 const root={name:'root',children:[]},stack=[root],p=new SaxesParser({xmlns:false});
 p.on('opentag',tag=>{if(stack.length>256)throw Error('文档结构嵌套过深');const n={name:tag.name,attrs:tag.attributes,children:[]};stack.at(-1).children.push(n);stack.push(n);});
 p.on('text',text=>stack.at(-1).children.push(text));p.on('cdata',text=>stack.at(-1).children.push(text));p.on('closetag',()=>stack.pop());p.write(source).close();return root;
}
export function text(n){if(typeof n==='string')return n;if(['del','instrText','script','style','noscript'].includes(local(n)))return '';if(['br','tab'].includes(local(n)))return local(n)==='br'?'\n':'\t';return (n.children||[]).map(text).join('');}
function nodes(n,name){return (n.children||[]).filter(x=>typeof x!=='string'&&(!name||local(x)===name));}
export function descendants(n,name){let out=[];for(const c of nodes(n)){if(local(c)===name)out.push(c);out.push(...descendants(c,name));}return out;}
function attr(n,key){return Object.entries(n.attrs||{}).find(([k])=>k.split(':').pop()===key)?.[1]||'';}
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const chunks=(value,location)=>{const out=[];for(let i=0;i<value.length;){let end=Math.min(i+2400,value.length);if(/[\uD800-\uDBFF]/.test(value[end-1]||''))end--;const t=value.slice(i,end);if(t.trim())out.push({text:t,location});i=end;}return out;};
function table(n){
 const rs=local(n)==='table'?descendants(n,'table-row'):nodes(n,'tr');let rows=rs.map(row=>nodes(row).filter(c=>['tc','table-cell','covered-table-cell'].includes(local(c))).map(c=>text(c).trim().replace(/\s*\n\s*/g,' / ').replace(/\|/g,'\\|')+(descendants(c,'gridSpan').length?' [横跨 '+attr(descendants(c,'gridSpan')[0],'val')+' 列]':'')+(descendants(c,'vMerge').length?' [纵向合并]':'')));
 const width=Math.max(0,...rows.map(x=>x.length));if(!width)return '';
 return '| '+Array.from({length:width},(_,i)=>'列 '+(i+1)).join(' | ')+' |\n| '+Array(width).fill('---').join(' | ')+' |\n'+rows.map(row=>'| '+Array.from({length:width},(_,i)=>row[i]||'').join(' | ')+' |').join('\n');
}
export function blocks(tree,prefix){
 const out=[];let p=0,t=0;
 function walk(n){const tag=local(n);if(['tbl','table'].includes(tag)){const value=table(n);if(value)out.push({text:value,location:prefix+' · 表格 '+(++t)});return;}
 if(['p','h','h1','h2','h3','h4','h5','h6','li'].includes(tag)){const value=text(n).trim();if(value)out.push({text:value,location:prefix+' · 段落 '+(++p)});return;}
 for(const child of nodes(n))walk(child);}
 walk(tree);return out;
}
export function chart(tree){
 const series=descendants(tree,'ser'),title=descendants(tree,'title').map(text).filter(Boolean).join(' / ');
 return (title?'图表标题：'+title+'\n':'')+series.map((s,i)=>{
  const tx=nodes(s,'tx')[0],cat=nodes(s).find(n=>['cat','xVal'].includes(local(n))),val=nodes(s).find(n=>['val','yVal'].includes(local(n)));
  const values=n=>n?descendants(n,'pt').map(p=>({index:attr(p,'idx'),value:text(nodes(p,'v')[0]||p)})):[];
  return '系列 '+(i+1)+'：'+(tx?text(tx):'未命名')+'\n分类/横轴：'+JSON.stringify(values(cat))+'\n数值/纵轴：'+JSON.stringify(values(val));
 }).join('\n')+'\n轴、图例与单位：'+descendants(tree,'axId').map(n=>attr(n,'val')).join('、')+' '+descendants(tree,'formatCode').map(text).join('、');
}
export function rtf(source){
 const images=[];let rebuilt='',cursor=0,match;const pattern=/\{\\pict\b/g;
 while((match=pattern.exec(source))){
  let end=pattern.lastIndex,depth=1;
  for(;end<source.length&&depth;end++){if(source[end]==='\\'){end++;continue;}if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
  if(depth)throw Error('RTF 图片结构不完整');
  const raw=source.slice(match.index+1,end-1);let body='',nested=0;
  for(let j=0;j<raw.length;j++){if(raw[j]==='{'&&raw[j-1]!=='\\'){nested++;continue;}if(raw[j]==='}'&&raw[j-1]!=='\\'){nested--;continue;}if(!nested)body+=raw[j];}
  const type=/\\pngblip/.test(body)?'image/png':/\\jpe?gblip/.test(body)?'image/jpeg':null;
  if(!type)images.push({unsupported:true});else{const hex=body.replace(/\\[a-z]+-?\d* ?/gi,'').replace(/[{}\s]/g,'');if(hex.length%2||!/^[a-f\d]+$/i.test(hex))throw Error('RTF 图片数据损坏');images.push({mime:type,data:b64(Uint8Array.from(hex.match(/../g),v=>parseInt(v,16)))});}
  rebuilt+=source.slice(cursor,match.index)+'\n[内嵌图片 '+images.length+']\n';cursor=end;pattern.lastIndex=end;
 }
 source=rebuilt+source.slice(cursor);if(/\{\\object\b/.test(source))images.push({unsupported:true});
 let out='',stack=[],state={skip:false,uc:1},fallback=0;
 const tokens=source.match(/\\'[a-f\d]{2}(?:\\'[a-f\d]{2})*|\\[a-z]+-?\d* ?|\\[^a-z]|[{}]|[^\\{}]+/gi)||[];
 const cpg=Number(source.match(/\\ansicpg(\d+)/)?.[1]||1252),encoding=cpg===936?'gb18030':cpg===65001?'utf-8':'windows-1252';
 for(const token of tokens){
  if(token==='{'){stack.push({...state});continue;}if(token==='}'){state=stack.pop()||{skip:false,uc:1};continue;}
  const control=token.match(/^\\([a-z]+)(-?\d+)? ?$/i);
  if(control){const [,name,num]=control;if(['fonttbl','colortbl','stylesheet','info','object','datastore','themedata','xmlnstbl'].includes(name))state.skip=true;
   if(name==='uc')state.uc=Math.max(0,Number(num));if(state.skip)continue;
   if(name==='u'){out+=String.fromCharCode(Number(num)&65535);fallback=state.uc;}
   else if(['par','line','row'].includes(name))out+='\n';else if(name==='cell'||name==='tab')out+='\t';else if(name==='emdash')out+='—';else if(name==='endash')out+='–';continue;}
  if(state.skip)continue;
  let literal=token.startsWith("\\'")?new TextDecoder(encoding).decode(Uint8Array.from(token.match(/[a-f\d]{2}/gi),h=>parseInt(h,16))):token.startsWith('\\')?({'\\~':' ','\\_':'-','\\*':''}[token]??token.slice(1)):token.replace(/[\r\n]/g,'');
  if(fallback){const n=Math.min(fallback,literal.length);literal=literal.slice(n);fallback-=n;}out+=literal;
 }
 return {text:out.trim(),images};
}
async function library(name,url){if(globalThis[name])return globalThis[name];if(typeof importScripts==='function'){importScripts(url);return globalThis[name];}return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=()=>resolve(globalThis[name]);s.onerror=()=>reject(Error('解析工具加载失败'));document.head.append(s);});}
function imageMime(name){return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml'})[name.split('.').pop().toLowerCase()];}
export async function* parse(file,coverage,options={}){
 const ext=file.name.split('.').pop().toLowerCase(),native=[],assets=[];let zip;
 const append=(value,location)=>{if(value.trim())native.push({text:value,location});};
 if(imageMime(file.name)){assets.push({location:'图片 1',mime:imageMime(file.name),data:b64(new Uint8Array(await file.arrayBuffer()))});}
 else if(ext==='rtf'){const doc=rtf(await file.text());append(doc.text,'RTF 正文与表格（制表符分列）');doc.images.forEach((a,i)=>assets.push({...a,location:'RTF 图片 '+(i+1)}));}
 else{
  const bytes=await file.arrayBuffer();
  if(['xlsx','xls','xlsm','xlsb','ods'].includes(ext)){
   const xlsx=await library('XLSX','https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'),book=xlsx.read(bytes,{type:'array',cellDates:false,cellFormula:true});
   for(const name of book.SheetNames){const sheet=book.Sheets[name],addresses=Object.keys(sheet).filter(k=>/^[A-Z]+[1-9]\d*$/.test(k)).sort((a,b)=>{const x=xlsx.utils.decode_cell(a),y=xlsx.utils.decode_cell(b);return x.r-y.r||x.c-y.c;});let pending='',row=0;
    for(const address of addresses){const cell=sheet[address],line=address+'='+JSON.stringify({value:cell.v,display:cell.w,type:cell.t,...(cell.f?{formula:cell.f,hasCachedValue:cell.v!==undefined}:{}),...(cell.z?{format:cell.z}:{})})+'\n';
     if(pending.length+line.length>2200){append(pending,'工作表「'+name+'」· 至第 '+row+' 行');pending='';}pending+=line;row=xlsx.utils.decode_cell(address).r+1;
    }append(pending,'工作表「'+name+'」· 至第 '+row+' 行');if(sheet['!merges']?.length)append('合并单元格范围：'+sheet['!merges'].map(xlsx.utils.encode_range).join('、'),'工作表「'+name+'」· 结构');
   }
   if(ext==='xls')zip=null;else try{zip=await JSZip.loadAsync(bytes);}catch{}
  }else zip=await JSZip.loadAsync(bytes);
  if(zip){
   const read=async name=>{const f=zip.file(name);if(!f)throw Error('文档缺少 '+name);return f.async('string');};
   if(ext==='docx'){for(const name of Object.keys(zip.files).filter(n=>/^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(n)).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))){native.push(...blocks(xml(await read(name)),'Word '+name.split('/').pop().replace('.xml','')));}}
   if(ext==='pptx'){for(const name of Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]))){const number=name.match(/slide(\d+)/)[1];native.push(...blocks(xml(await read(name)),'幻灯片 '+number));}}
   if(['odt','odp'].includes(ext)){native.push(...blocks(xml(await read('content.xml')),ext==='odt'?'OpenDocument 正文':'OpenDocument 演示'));}
   if(ext==='epub'){const container=xml(await read('META-INF/container.xml')),opf=attr(descendants(container,'rootfile')[0],'full-path'),book=xml(await read(opf)),base=opf.slice(0,opf.lastIndexOf('/')+1),items=new Map(descendants(book,'item').map(n=>[attr(n,'id'),attr(n,'href')]));
    for(const [i,node] of descendants(book,'itemref').entries()){const href=items.get(attr(node,'idref'));if(href)native.push(...blocks(xml(await read(new URL(decodeURIComponent(href.split('#')[0]),'https://epub.local/'+base).pathname.slice(1))),'EPUB 第 '+(i+1)+' 章'));}}
   for(const name of Object.keys(zip.files).filter(n=>!zip.files[n].dir&&/\/diagrams\/data\d+\.xml$/.test(n)).sort()){const diagram=xml(await read(name));append('图示节点：'+descendants(diagram,'pt').map(n=>attr(n,'modelId')+': '+text(n)).join('\n')+'\n连接：'+descendants(diagram,'cxn').map(n=>JSON.stringify(n.attrs)).join('\n'),'图示结构 · '+name);}
   for(const name of Object.keys(zip.files).filter(n=>!zip.files[n].dir&&/\/charts\/chart\d+\.xml$/.test(n)).sort()){append(chart(xml(await read(name))),'图表数据 · '+name);}
   const pictures=Object.keys(zip.files).filter(n=>!zip.files[n].dir&&imageMime(n)&&(/^(word|ppt|xl)\/media\//.test(n)||/^Pictures\//.test(n)||ext==='epub'&&!/^META-INF\//.test(n))).sort();
   for(const name of Object.keys(zip.files).filter(n=>!zip.files[n].dir&&(/^(word|ppt|xl)\/media\//.test(n)||/^Pictures\//.test(n))&&!imageMime(n))){assets.push({unsupported:true,location:'内嵌图片 · '+name});}
   for(const [i,name] of pictures.entries()){const f=zip.file(name);if(f._data?.uncompressedSize>40*1024*1024)throw Error('内嵌图片过大，请拆分文档');assets.push({location:'内嵌图片 '+(i+1)+' · '+name,mime:imageMime(name),load:()=>f.async('base64')});}
  }
 }
 coverage.units=native.length+assets.length;coverage.emptyUnits=assets.length;coverage.ocrPages=0;coverage.uncertainUnits=0;coverage.warnings=[];coverage.visualComplete=true;coverage.unitLabel='项';coverage.blankUnits=0;if(ext==='xls'){coverage.visualComplete=false;coverage.uncertainUnits=1;coverage.warnings.push({location:'工作表',text:'旧版 XLS 已读取单元格与公式；如含内嵌图片或图表，请另存 XLSX 后补全图文。'});}
 for(const [i,item] of native.entries()){for(const part of chunks(item.text,item.location))yield part;if(options.progress)options.progress({phase:'读取文字与表格',done:i+1,total:coverage.units});}
 for(const [i,asset] of assets.entries()){
  const unit=i+1;
  try{if(options.progress)options.progress({phase:'准备原始图片（不调用模型）',done:native.length+i,total:coverage.units});
   if(asset.unsupported)throw Error('此内嵌图片格式需转换为 PNG/JPEG 或 PDF');
   if(!options.ocr)throw Error('图片尚未进行视觉识别');const result=await options.ocr({location:asset.location,mime:asset.mime,data:asset.load?await asset.load():asset.data,page:unit,total:Math.max(1,coverage.units)});
   if(result.media)yield {text:'',location:asset.location,media:result.media};else for(const part of chunks(result.text||'',asset.location+' · 视觉文字'))yield part;
   coverage.emptyUnits--;if(result.media)coverage.preparedVisuals=(coverage.preparedVisuals||0)+1;else coverage.ocrPages++;if(result.kind==='blank')coverage.blankUnits++;if(result.uncertain)coverage.uncertainUnits++;
   if(result.warning&&coverage.warnings.length<100)coverage.warnings.push({page:unit,location:asset.location,text:result.warning});
  }catch(e){if(e.name==='AbortError')throw e;coverage.ocrError=String(e.message).slice(0,250);coverage.visualComplete=false;break;}
 }
 if(options.progress)options.progress({phase:'内容读取完成',done:coverage.units-coverage.emptyUnits,total:coverage.units});
}
