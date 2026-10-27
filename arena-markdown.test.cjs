const test = require('node:test');
const assert = require('node:assert/strict');
const {render, inline} = require('./arena-markdown.js');

test('dollar prices stay in the same paragraph and are never converted into formula blocks', () => {
  const html = render('Opus 是 $4 / $20，Sonnet 是 $2 / $10。\n\n每月 $80，订阅 $20/月，Max 是 $100 或 $200/月。');
  assert.equal((html.match(/<p>/g) || []).length, 2);
  assert.ok(html.includes('Opus 是 $4 / $20，Sonnet 是 $2 / $10。'));
  assert.ok(html.includes('Max 是 $100 或 $200/月。'));
  assert.doesNotMatch(html, /<code|formula|BLOCK_/);
});

test('table cells render inline formatting, align numeric values and retain repeated rows', () => {
  const html = render('| 模型 | 输入 | 说明 |\n| --- | ---: | --- |\n| **Opus** | $4 | `a|b` |\n| Sonnet | $2 | A\\|B |\n| Sonnet | $2 | A\\|B |');
  assert.ok(html.includes('<strong>Opus</strong>'));
  assert.ok(html.includes('text-align:right">$4'));
  assert.ok(html.includes('<code>a|b</code>'));
  assert.equal((html.match(/A\|B/g) || []).length, 2);
  assert.equal((html.match(/<td /g) || []).length, 9);
  assert.ok(html.includes('scope="col"'));
});

test('inline code remains literal even when it contains markdown, currency or HTML', () => {
  assert.equal(inline('`**原样** $4 <img>`'), '<code>**原样** $4 &lt;img&gt;</code>');
  assert.equal(inline('**粗体** 和 *斜体*'), '<strong>粗体</strong> 和 <em>斜体</em>');
});

test('paragraph spacing, ordered and nested lists use semantic blocks', () => {
  const html = render('第一段。\n仍在第一段。\n\n\n第二段。\n\n3. 第三项\n   - 子项\n4. 第四项');
  assert.ok(html.includes('第一段。\n仍在第一段。</p><p>第二段。'));
  assert.ok(html.includes('<ol start="3">'));
  assert.ok(html.includes('<ul><li><p>子项</p></li></ul>'));
  assert.equal((html.match(/<br>/g) || []).length, 0);
});

test('fenced code and incomplete streaming fences preserve duplicate lines', () => {
  const source = '```js\nconst price = "$4 / $20";\nx();\nx();\n```\n\n```txt\n**not bold**';
  const html = render(source);
  assert.ok(html.includes('x();\nx();'));
  assert.ok(html.includes('**not bold**</code></pre>'));
  assert.equal((html.match(/<pre>/g) || []).length, 2);
  assert.doesNotMatch(html, /<strong>/);
});

test('code action hooks receive the exact language and original source', () => {
  const received = [];
  const html = render('```pptx\n{"slides":[]}\n```', {code(lang, source) { received.push({lang,source}); return '<div>export</div>'; }});
  assert.deepEqual(received, [{lang:'pptx',source:'{"slides":[]}'}]);
  assert.equal(html, '<div>export</div>');
});

test('links retain descriptive labels and punctuation with safe URL attributes', () => {
  const html = render('[官方价格](https://example.com/pricing) 和 https://example.com/a。');
  assert.ok(html.includes('>官方价格</a>'));
  assert.ok(html.includes('>https://example.com/a</a>。'));
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.ok(inline('[**官方** `API`](https://example.com)').includes('<strong>官方</strong> <code>API</code></a>'));
  const malicious = render('<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n[x](https://example.com/"onclick="oops)');
  assert.doesNotMatch(malicious, /<img|href="javascript:|"onclick=/);
  assert.ok(malicious.includes('&lt;img'));
});

test('explicit display formulas are readable without capturing dollar-denominated prose', () => {
  const html = render('费用 $2，输出 $10。\n\n$$\nx^2 + y^2\n$$\n\n结束。');
  assert.ok(html.includes('<p>费用 $2，输出 $10。</p>'));
  assert.ok(html.includes('<pre class="aa-md-formula">x^2 + y^2</pre>'));
});
