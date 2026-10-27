import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const shared=await readFile(new URL('arena-context.js',root),'utf8');
const file=new URL('worker/worker.js',root),source=await readFile(file,'utf8');
const start='// BEGIN SHARED CONTEXT\n',end='// END SHARED CONTEXT\n';
const a=source.indexOf(start),b=source.indexOf(end);
if(a<0||b<a)throw new Error('Shared context markers are missing');
const updated=source.slice(0,a)+start+shared+end+source.slice(b+end.length);
if(process.argv.includes('--check')){if(source!==updated)throw new Error('Run node worker/sync-shared-context.mjs');}
else await writeFile(file,updated);
