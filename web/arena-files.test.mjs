import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { decodeText, expandFiles, extractText, openZip, preflightZip, prepareChatFile, readZipEntry } from './arena-files.mjs';
import { isDocument } from './file-types.mjs';

async function archive(entries, options = {}) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', ...options })], '资料包.zip', { type: 'application/zip' });
}
async function changed(file, mutate) {
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  let central = -1;
  for (let i = 0; i + 46 < bytes.length; i++) if (view.getUint32(i, true) === 0x02014b50) { central = i; break; }
  assert(central >= 0); mutate(bytes, view, central);
  return new File([bytes], file.name, { type: file.type });
}
test('text, source code, structured data and extensionless project documents preserve their actual contents', async () => {
  for (const name of ['notes.md', '数据.jsonl', 'settings.yaml', 'app.tsx', 'main.py', 'query.sql', 'run.sh', 'Dockerfile', '.gitignore', 'drawing.svg']) {
    assert(isDocument(name), name);
    assert.equal(await extractText(new File(['  中文 & <tag>\nline 2  '], name)), '  中文 & <tag>\nline 2  ');
  }
  assert(!isDocument('program.exe')); assert(!isDocument('legacy.doc')); assert(!isDocument('data.zip'));
});
test('UTF-16 and Chinese legacy text decode; a binary renamed to txt is rejected', async () => {
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65])), '中文');
  assert.equal(decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文');
  await assert.rejects(extractText(new File([new Uint8Array([0x4d, 0x5a, 0, 0])], 'renamed.txt')), /二进制/);
});
test('ZIP expands real Unicode paths, code and images while reporting unsupported and system files', async () => {
  const file = await archive({ '产品/规格.md': '# 规格\n净重 20g', 'src/main.py': 'print("hi")', 'photo.png': new Uint8Array([1, 2]), '__MACOSX/._x': 'ignored', 'program.exe': 'binary' });
  const result = await expandFiles([file], { images: true });
  assert.deepEqual(result.files.map(entry => entry.path), ['资料包.zip/产品/规格.md', '资料包.zip/src/main.py', '资料包.zip/photo.png']);
  assert.equal(await result.files[0].file.text(), '# 规格\n净重 20g');
  assert.equal(result.skipped.length, 2);
  const project = await expandFiles([file]);
  assert.equal(project.files.length, 2); assert(project.skipped.some(item => item.name.endsWith('photo.png')));
});
test('a chat ZIP is one original attachment with readable per-file labels and explicit skips', async () => {
  const file = await archive({ 'docs/a.md': 'first source', 'src/b.js': 'second source', 'nested.zip': 'not expanded', 'unsupported.exe': 'ignored' });
  const result = await prepareChatFile(file);
  assert.equal(result.source, file); assert.equal(result.count, 2); assert.equal(result.skipped.length, 2);
  assert.match(result.text, /^\[文件: 资料包.zip\]\nZIP 已自动解压：2 个文档/);
  assert.match(result.text, /\[文件: 资料包.zip\/docs\/a.md\]\nfirst source/);
  assert.match(result.text, /second source/);
});
test('unsafe traversal and absolute archive paths never yield attachments', async () => {
  for (const name of ['../private.txt', '/private.txt', 'C:\\private.txt']) {
    const result = await expandFiles([await archive({ [name]: 'secret' })]);
    assert.equal(result.files.length, 0, name); assert(result.skipped.length > 0);
  }
});
test('symlinks are reported without following or reading their targets', async () => {
  const zip = new JSZip(); zip.file('link.txt', '/etc/passwd', { unixPermissions: 0o120777 });
  const file = new File([await zip.generateAsync({ type: 'uint8array', platform: 'UNIX' })], 'links.zip');
  const result = await expandFiles([file]);
  assert.equal(result.files.length, 0); assert(result.skipped.some(item => /符号链接/.test(item.reason)));
});
test('corrupt, encrypted, truncated and excessive-entry archives report readable failures', async () => {
  const file = await archive({ 'a.txt': 'content' }, { compression: 'STORE' });
  const corrupt = await changed(file, bytes => { bytes[30 + new TextEncoder().encode('a.txt').length] ^= 1; });
  const encrypted = await changed(file, (_bytes, view, central) => view.setUint16(central + 8, 1, true));
  const truncated = new File([(await file.arrayBuffer()).slice(0, -12)], 'truncated.zip');
  const excessive = await archive(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [index + '.txt', 'a'])));
  for (const [source, message] of [[corrupt, /校验/], [encrypted, /加密/], [truncated, /损坏/], [excessive, /100/]]) {
    const result = await expandFiles([source]); assert.equal(result.files.length, 0); assert(result.skipped.some(item => message.test(item.reason)), JSON.stringify(result.skipped));
  }
});
test('both declared ZIP bombs and forged small sizes are bounded before they become attachments', async () => {
  const file = await archive({ 'a.txt': 'A'.repeat(10000) });
  const declaredBomb = await changed(file, (_bytes, view, central) => view.setUint32(central + 24, 41 * 1024 * 1024, true));
  assert.throws(() => preflightZip(new Uint8Array([])), /ZIP/);
  await assert.rejects(openZip(await declaredBomb.arrayBuffer()), /40MB/);
  const forged = await changed(file, (_bytes, view, central) => view.setUint32(central + 24, 1, true));
  const zip = await openZip(await forged.arrayBuffer());
  await assert.rejects(readZipEntry(zip.files['a.txt'], 100), /上限|校验|损坏/);
});
test('one unreadable member does not hide other useful content or its own error', async () => {
  const result = await prepareChatFile(await archive({ 'bad.pdf': 'not a PDF', 'good.md': 'usable source' }), { extract: async file => { if (file.name === 'bad.pdf') throw Error('PDF 已损坏'); return extractText(file); } });
  assert.equal(result.count, 1); assert.match(result.text, /usable source/); assert(result.skipped.some(item => /PDF 已损坏/.test(item.reason)));
});
test('scanned PDFs remain an explicit error and the parser is always released', async () => {
  let destroyed = 0;
  const load = async () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }), destroy: async () => { destroyed++; } }) }) });
  await assert.rejects(extractText(new File(['%PDF-fixture'], 'scan.pdf'), { load }), /OCR/); assert.equal(destroyed, 1);
});
