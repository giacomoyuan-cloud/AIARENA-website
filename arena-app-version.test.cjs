const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
test('deployment stamps the manifest version even when the source page still names an older release',async()=>{
  const {releaseIndex}=await import('./scripts/app-version.mjs');
  const source=readFileSync(__dirname+'/index.html','utf8'),version=JSON.parse(readFileSync(__dirname+'/app-version.json','utf8')).version;
  const stale=source.replace(/(<meta name="app-version" content=")[^"]+/, '$1stale-release');
  const output=releaseIndex(stale,version);
  assert.equal(/<meta name="app-version" content="([^"]+)"/.exec(output)[1],version);
  assert.equal(output.replace(version,'stale-release'),stale);
});
test('ambiguous or invalid release metadata cannot be deployed',async()=>{
  const {releaseIndex}=await import('./scripts/app-version.mjs'),meta='<meta name="app-version" content="old">';
  assert.throws(()=>releaseIndex('<html></html>','v2'),/exactly one/);
  assert.throws(()=>releaseIndex(meta+meta,'v2'),/exactly one/);
  assert.throws(()=>releaseIndex(meta,''),/Invalid/);
});
