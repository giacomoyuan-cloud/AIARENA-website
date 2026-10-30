import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
export function extractNativeContract(html) {
 const literal=name=>{
  const start=html.indexOf('var '+name+' =');
  if(start<0)throw Error('Website contract missing: '+name);
  const value=html.slice(html.indexOf('=',start)+1,html.indexOf(';',start)).trim();
  return vm.runInNewContext('('+value+')',Object.create(null),{timeout:1000});
 };
 const chat=literal('AVAILABLE_CHAT_MODELS'),images=literal('IMAGE_MODELS'),subs=literal('SUBS'),levels=literal('EFFORT_LEVELS'),selection=literal('brandSelection'),active=literal('activeBrands'),efforts=literal('effortSelection');
 const defaultModel=selection[Object.keys(active).find(k=>active[k]&&selection[k]&&chat.includes(selection[k]))];
 if(!defaultModel||!chat.length||!images.length||new Set([...chat,...images.map(m=>m.value)]).size!==chat.length+images.length)throw Error('Invalid website model contract');
 return {schemaVersion:1,source:'index.html',defaultModel,defaultImageModel:images.find(m=>subs[m.value]?.brand==='google')?.value,searchDefault:/\bsearchOn\s*=\s*true\b/.test(html),voiceInput:false,modeNavigation:'drawer',chatModels:chat.map(id=>{if(!subs[id]||!levels[id]?.length)throw Error('Missing current model metadata: '+id);return {id,name:subs[id].name,provider:subs[id].brand,levels:levels[id],defaultEffort:efforts[id]};}),imageModels:images.map(m=>({id:m.value,name:m.label,provider:subs[m.value]?.brand,image:true,levels:[]}))};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
 const contract=extractNativeContract(await readFile(resolve(root,'index.html'),'utf8'));
 const out=resolve(process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:resolve(root,'native-client-contract.json'));
 const content=JSON.stringify(contract,null,2)+'\n';
 if(process.argv.includes('--check')){if(await readFile(out,'utf8')!==content)throw Error('Native contract differs from website; run node scripts/build-native-contract.mjs');}
 else {await mkdir(dirname(out),{recursive:true});await writeFile(out,content);}
 console.log('Website/native contract: '+contract.chatModels.length+' chat + '+contract.imageModels.length+' image models.');
}
