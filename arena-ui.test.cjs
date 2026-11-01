const {test}=require('node:test');
const assert=require('node:assert/strict');
const Markdown=require('./arena-markdown.js');
const {taskState}=require('./arena-ui.js');
async function render(text){const math=await import('./web/arena-math.mjs');return Markdown.render(text,{math:math.render});}
test('real renderer typesets inline, explicit and display equations',async()=>{
  for(const input of ['$a^2+b^2=c^2$',String.raw`\(x_1+\frac{1}{2}\)`,String.raw`\[x^2\]`,'正文\n$$\nx^2+y^2\n$$']){
    const html=await render(input);assert.match(html,/class="katex"/);assert.match(html,/<math /);assert.doesNotMatch(html,/aa-md-formula/);
  }
});
test('currency, code and URL dollars survive the actual math renderer',async()=>{
  for(const text of ['$4 输入，$20 输出','$20/$100','$20/月，Max $100/月','$5.00$','`$x$`','```js\nconst cost = "$x$";\n```','https://example.com/$x$','[价格 $20](https://example.com)']){
    const html=await render(text);assert.doesNotMatch(html,/class="katex"/);assert.ok(html.includes('$'),text);
  }
});
test('untrusted math cannot create links, images or scripts and failures stay readable',async()=>{
  for(const source of [String.raw`\href{javascript:alert(1)}{click}`,String.raw`\includegraphics{https://evil.example/image}`,String.raw`\htmlClass{evil}{x}`,'<img src=x onerror=alert(1)>']){
    const html=await render('\\('+source+'\\)');assert.doesNotMatch(html,/<(?:a|img|script)\b|<[^>]+\sonerror=/);assert.ok(html.length>0);
  }
  const math=await import('./web/arena-math.mjs');assert.equal(math.render('x'.repeat(10001)),null);
  assert.equal(math.render(String.raw`\def\a{\a}\a`),null);
});
test('task list and detail share paused, queued and running precedence',()=>{
  assert.equal(taskState({enabled:false,status:'scheduled'}),'已暂停');
  assert.equal(taskState({enabled:false,status:'failed'}),'已暂停');
  assert.equal(taskState({enabled:false,status:'running'}),'正在执行');
  assert.equal(taskState({enabled:false,status:'scheduled',queued:true}),'已排队');
  assert.equal(taskState({enabled:true,status:'scheduled'}),'已排定');
  assert.equal(taskState({enabled:true,status:'failed'}),'上次执行失败');
});
