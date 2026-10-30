const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('./arena-context.js');
test('full text history preserves original source links and attachments without leaking credentialed URLs',()=>{
  const value=C.fullHistory([{uid:1,isUser:true,text:'question',pastedTexts:['complete attachment']},{uid:2,text:'answer [[aa-citation:1]]',citations:[{url:'https://example.com/source',title:'Original source'},{url:'https://private:secret@example.com/unsafe'}]}]);
  assert.equal(value.messages.length,2);assert.equal(value.messages[0].text,'question\ncomplete attachment');assert.match(value.messages[1].text,/Original source https:\/\/example.com\/source/);
  assert.doesNotMatch(value.messages[1].text,/aa-citation|private:secret/);assert.equal(value.truncated,false);
});
test('recent context stays bounded without deleting the original message array',()=>{
  const source=Array.from({length:120},(_,i)=>({uid:i,role:i%2?'assistant':'user',text:'记录 '+i+' '+('内容'.repeat(300))}));
  const original=JSON.stringify(source),recent=C.selectRecent(source);
  assert.ok(recent.chars<=7000);assert.ok(recent.messages.length<=8);assert.equal(recent.messages.at(-1).uid,'119');
  assert.equal(JSON.stringify(source),original);assert.ok(recent.earlier.length>100);assert.equal(recent.truncated,true);
});
test('older facts and code are retrieved verbatim when recent history no longer includes them',()=>{
  const records=[{uid:1,isUser:true,text:'合同约定：蓝莓项目预算为 73921.50 元，截止日 2027-03-19。'}, {uid:2,text:'function restoreBudget() { return 73921.50; }'}];
  const hits=C.excerpts(records,'蓝莓项目预算和 restoreBudget 是什么');
  assert.ok(hits.some(h=>h.text.includes('73921.50 元')));
  assert.ok(hits.some(h=>h.text.includes('function restoreBudget() { return 73921.50; }')));
});
test('stored full history wins over a clipped duplicate and excerpts retain attachment text',()=>{
  const stored=[{uid:7,isUser:true,topicText:'请读这份资料',text:'请读这份资料',pastedTexts:['附件暗号 BLUE-789']}];
  const merged=C.merge(stored,[{uid:7,role:'user',text:'请读…',clipped:true}]);
  assert.equal(merged.length,1);assert.ok(C.excerpts(merged,'BLUE-789')[0].text.includes('附件暗号 BLUE-789'));
});
test('recent attachments remain retrievable even when only their question is in recent text',()=>{
  const recent=C.selectRecent([{uid:7,isUser:true,topicText:'请读这份资料',text:'请读这份资料',pastedTexts:['附件暗号 BLUE-789']}]);
  assert.equal(recent.messages[0].text,'请读这份资料');assert.equal(recent.messages[0].clipped,true);
  assert.ok(C.excerpts(recent.earlier,'BLUE-789')[0].text.includes('附件暗号 BLUE-789'));
});
test('Chinese and English file indexing finds a relevant chunk without transmitting whole documents',()=>{
  const doc=('无关的产品说明。\n'.repeat(500))+'\n售后退款窗口为 37 天。品牌代号 AURORA-Z9。\n'+('其他内容。\n'.repeat(400));
  const index=C.indexDocument(doc),hits=C.rankIndex(index,'售后退款窗口 AURORA-Z9','背景资料.txt');
  assert.ok(hits.length);assert.ok(index.parts[hits[0].index].text.includes('37 天'));
  assert.ok(index.parts[hits[0].index].text.length<2000);
  assert.equal(C.rankIndex(index,'卫星发射轨道','背景资料.txt').length,0);
});
test('summaries retain commitments and exact numbers while marking old context as condensed',()=>{
  const notes=C.notes([{uid:1,isUser:true,text:'必须使用蓝色。预算上限 73921.50 元。不要更改密码。'}]);
  assert.ok(notes.includes('73921.50'));assert.ok(notes.includes('必须'));assert.ok(notes.length<=1400);
});
