import { cp, mkdir, readdir, rm } from 'node:fs/promises';
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
console.log(`Staged ${publicFiles.length} public files plus songs/downloads/welcome-media; no Android sources or credentials.`);
