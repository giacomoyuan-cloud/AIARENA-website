import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const tokens=JSON.parse(await readFile(resolve(root,'ui-design-tokens.json'),'utf8'));
const css='/* Generated from ui-design-tokens.json. Edit the shared source. */\n:root {\n'+
  Object.entries(tokens).filter(([,value])=>typeof value==='object').flatMap(([group,values])=>Object.entries(values).filter(([,v])=>typeof v==='number').map(([key,value])=>`  --ui-${group}-${key}: ${value}${group==='motion'?'ms':'px'};`)).join('\n')+
  '\n'+Object.entries(tokens.color||{}).map(([key,value])=>`  --ui-color-${key}: ${value};`).join('\n')+'\n  --arena-mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;\n  --ui-ease: cubic-bezier(.23,1,.32,1);\n}\n';
const kt='// Generated from ui-design-tokens.json. Edit the shared source.\npackage com.pickandcase.assistant\n\ninternal object NativeDesignTokens {\n'+
  Object.entries(tokens).filter(([,value])=>typeof value==='object').flatMap(([group,values])=>Object.entries(values).map(([key,value])=>`    const val ${group}_${key} = ${JSON.stringify(value)}`)).join('\n')+'\n}\n';
for(const [file,content] of [['arena-ui-tokens.css',css],['android/app/src/main/java/com/pickandcase/assistant/NativeDesignTokens.kt',kt]]) {
  if(process.argv.includes('--check')) {if(await readFile(resolve(root,file),'utf8').catch(()=>null)!==content)throw Error('Outdated UI tokens: '+file);}
  else await writeFile(resolve(root,file),content);
}
