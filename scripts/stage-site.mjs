import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { releaseIndex } from './app-version.mjs';
const root=resolve(import.meta.dirname,'..');
const target=resolve(process.env.ARENA_SITE_OUTPUT_DIR || resolve(root,'dist-site'));
const release=JSON.parse(await readFile(resolve(root,'app-version.json'),'utf8'));
const index=releaseIndex(await readFile(resolve(root,'index.html'),'utf8'),release.version);
// Keep the paused mascot source recoverable without publishing its runtime or media.
const petEnabled=/<script\b[^>]*\bsrc=["']\/arena-pet\.js[?"']/i.test(index);
await mkdir(target,{recursive:true});
// Only public website assets go to Pages; Android sources, build outputs and keys stay local.
const publicFiles=(await readdir(root)).filter(name => /^(index|android|pitch-analyzer)\.html$/.test(name)
  || /^arena[^/]*\.(css|js)$/.test(name) || /^icon-\d+\.png$/.test(name)
  || ['native-client-contract.json','manifest.json','sw.js','app-version.json','_headers','THIRD_PARTY_LICENSES.txt'].includes(name))
  .filter(name=>petEnabled||!/^arena-pet(?:-catalog)?\.(css|js)$/.test(name));
for(const name of await readdir(target)) await rm(resolve(target,name),{recursive:true,force:true});
for(const name of [...publicFiles,'songs','downloads','welcome-media'])await cp(resolve(root,name),resolve(target,name),{recursive:true});
await writeFile(resolve(target,'index.html'),index);
if(petEnabled){
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
