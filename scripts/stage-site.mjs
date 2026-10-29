import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const target=resolve(root,'dist-site');
await mkdir(target,{recursive:true});
// Only public website assets go to Pages; Android sources, build outputs and keys stay local.
const publicFiles=(await readdir(root)).filter(name => /^(index|android|pitch-analyzer)\.html$/.test(name)
  || /^arena[^/]*\.(css|js)$/.test(name) || /^icon-\d+\.png$/.test(name)
  || ['manifest.json','sw.js','app-version.json','_headers','THIRD_PARTY_LICENSES.txt'].includes(name));
for(const name of await readdir(target)) await rm(resolve(target,name),{recursive:true,force:true});
for(const name of [...publicFiles,'songs','downloads','welcome-media'])await cp(resolve(root,name),resolve(target,name),{recursive:true});
// Isolated design exploration; no production entry point imports these files.
if((await readdir(root)).includes('design-review'))await cp(resolve(root,'design-review'),resolve(target,'design-review'),{recursive:true});
if((await readdir(root)).includes('design-review-2'))await cp(resolve(root,'design-review-2'),resolve(target,'design-review-2'),{recursive:true});
if((await readdir(root)).includes('design-review-3'))await cp(resolve(root,'design-review-3'),resolve(target,'design-review-3'),{recursive:true});
if(publicFiles.includes('arena-pet.js')){
  const folder='assets/kitten/motion';
  const manifest=JSON.parse(await readFile(resolve(root,folder,'manifest.json'),'utf8'));
  const files=new Set(['manifest.json','portrait.png','poster.png']);
  for(const action of Object.values(manifest.actions))for(const key of ['poster','webp','webm','hevc']){
    const url=new URL(action[key],'https://ai.pickandcase.com');
    if(url.origin!=='https://ai.pickandcase.com'||!/^\/assets\/kitten\/motion\/[a-z0-9-]+\.(png|webp|webm|mov)$/.test(url.pathname))throw new Error('Invalid public pet asset');
    files.add(url.pathname.split('/').at(-1));
  }
  await mkdir(resolve(target,folder),{recursive:true});
  for(const file of files)await cp(resolve(root,folder,file),resolve(target,folder,file));
  console.log(`Staged ${Object.keys(manifest.actions).length} distinct pet motions (${files.size} public files).`);
}
console.log(`Staged ${publicFiles.length} public files plus songs/downloads/welcome-media; no Android sources or credentials.`);
