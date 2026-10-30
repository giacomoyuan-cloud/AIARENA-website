const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('every published entry point uses the same self-hosted modern font policy', () => {
  const css = fs.readFileSync('arena-fonts.css', 'utf8');
  assert.deepEqual([...new Set([...css.matchAll(/font-family: '([^']+)'/g)].map(m => m[1]))].sort(), ['Inter', 'Noto Sans SC']);
  assert.match(css, /body \*, body \*::before, body \*::after[^}]+font-family: var\(--arena-ui-font\) !important/s);
  for (const file of ['index.html', 'android.html', 'pitch-analyzer.html']) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /href="\/arena-fonts.css\?v=/, file);
    assert.equal(/fonts\.(?:googleapis|gstatic)\.com|Sora|Courier New|Source Serif|Noto Serif/.test(html), false, file);
  }
  for (const file of fs.readdirSync('.').filter(n => /^arena.*\.css$/.test(n) && !['arena-fonts.css', 'arena-pet.css'].includes(n))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /claude-serif|ui-monospace|SFMono|Source Serif|Noto Serif|BlinkMacSystemFont|Georgia|Songti SC/, file);
  }
});

test('all CSS font shards exist, are WOFF2, and retain both OFL licenses', () => {
  const css = fs.readFileSync('arena-fonts.css', 'utf8');
  const urls = [...new Set([...css.matchAll(/src: url\(([^)]+)\)/g)].map(m => m[1]))];
  assert.ok(urls.length > 50, 'Chinese must load by Unicode shards rather than a whole font');
  for (const url of urls) {
    assert.match(url, /^\/assets\/fonts\/modern\/[a-f0-9]{20}\.woff2$/);
    const data = fs.readFileSync(path.join('.', url));
    assert.equal(data.subarray(0,4).toString(), 'wOF2');
  }
  for (const font of ['inter', 'notosanssc']) assert.match(fs.readFileSync(`assets/fonts/modern/${font}-OFL.txt`, 'utf8'), /SIL OPEN FONT LICENSE/);
});
