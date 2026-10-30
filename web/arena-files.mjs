import JSZip from 'jszip';
import { UPLOAD_LIMITS } from './upload-limits.mjs';
import { CHAT_ACCEPT, DOCUMENT_ACCEPT, PROJECT_ACCEPT, extension, isArchive, isDocument, isImage, isText, mimeFor } from './file-types.mjs';

export const LIMITS = Object.freeze({ ...UPLOAD_LIMITS, archiveEntries: 100, characters: 400000, chatCharacters: 40000, pages: 200 });
const loaded = new Map();
const zipMetadata = new WeakMap();
export function library(name, url) {
  if (globalThis[name]) return Promise.resolve(globalThis[name]);
  if (loaded.has(name)) return loaded.get(name);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(), 30000);
    function fail() { clearTimeout(timeout); loaded.delete(name); script.remove(); reject(Error('文件解析工具加载失败，请检查网络后重试')); }
    script.src = url;
    script.onload = () => { clearTimeout(timeout); if (globalThis[name]) resolve(globalThis[name]); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  loaded.set(name, promise);
  return promise;
}

export function decodeText(bytes) {
  let text;
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { if (encoding !== 'utf-8') throw Error(); text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
  } catch { throw Error('无法识别文本编码，请另存为 UTF-8 后上传'); }
  if (/[\u0000-\u0008\u000e-\u001f\u007f]/.test(text)) throw Error('文件含二进制内容，无法作为文本读取');
  return text.replace(/^\uFEFF/, '');
}

export function safeArchivePath(value) {
  const name = String(value).replace(/\\/g, '/');
  if (!name || name.length > 500 || name.startsWith('/') || /^[a-z]:/i.test(name) || /[\u0000-\u001f\u007f]/.test(name) || name.split('/').some(part => !part || part === '..' || part === '.')) throw Error('ZIP 包含不安全的文件路径');
  return name;
}
function hiddenPath(name) { return name.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._') || part === '.git' || part === 'node_modules'); }
function zipError() { return Error('ZIP 无法读取：文件可能损坏、已加密或使用了不支持的压缩方式'); }

// Check directory counts and declared sizes before JSZip allocates its entries.
export function preflightZip(buffer, maxEntries = LIMITS.archiveEntries, entries) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw zipError();
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw Error('不支持分卷 ZIP，请合并后上传');
  if (count === 65535 || start === 0xffffffff || size === 0xffffffff) throw Error('ZIP 目录过大，请拆分后上传');
  if (count > maxEntries) throw Error('ZIP 最多包含 ' + maxEntries + ' 个文件或目录，请拆分后上传');
  if (start + size > end) throw zipError();
  let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw zipError();
    if (view.getUint16(offset + 8, true) & 1) throw Error('ZIP 已加密，请去掉密码后上传');
    const length = view.getUint32(offset + 24, true);
    expanded += length;
    if (length === 0xffffffff || expanded > LIMITS.expandedBytes) throw Error('ZIP 解压后总量不能超过 100MB');
    const next = offset + 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (entries && next <= start + size) {
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true));
      let name;
      // Match JSZip's Unicode-path extra field, including its filename CRC check.
      for (let extra = offset + 46 + nameBytes.length, end = extra + view.getUint16(offset + 30, true); extra + 4 <= end;) {
        const kind = view.getUint16(extra, true), size = view.getUint16(extra + 2, true), value = extra + 4;
        if (value + size > end) throw zipError();
        if (!(view.getUint16(offset + 8, true) & 0x800) && kind === 0x7075 && size >= 5 && bytes[value] === 1 && view.getUint32(value + 1, true) === crc32(nameBytes)) name = decodeText(bytes.subarray(value + 5, value + size));
        extra = value + size;
      }
      entries.push({ name: name ?? decodeText(nameBytes), size: length, crc32: view.getUint32(offset + 16, true) });
    }
    offset = next;
    if (offset > start + size) throw zipError();
  }
  if (offset !== start + size) throw zipError();
  return count;
}

export async function openZip(buffer, maxEntries) {
  const entries = [], count = preflightZip(buffer, maxEntries, entries);
  let zip;
  try { zip = await JSZip.loadAsync(buffer, { createFolders: false, decodeFileName: bytes => decodeText(new Uint8Array(bytes)) }); }
  catch { throw zipError(); }
  if (Object.keys(zip.files).length !== count) throw Error('ZIP 包含重复文件名，请整理后上传');
  const metadata = new Map(entries.map(entry => [entry.name, entry]));
  for (const entry of Object.values(zip.files)) {
    const info = metadata.get(entry.unsafeOriginalName || entry.name);
    if (!info) throw zipError();
    zipMetadata.set(entry, info);
  }
  return zip;
}
async function verifyOfficeZip(buffer) {
  const zip = await openZip(buffer, 4000), budget = { remaining: LIMITS.expandedBytes };
  // Validate actual output too: central-directory sizes can be forged.
  for (const entry of Object.values(zip.files)) if (!entry.dir) await readZipEntry(entry, LIMITS.expandedBytes, budget);
}
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = -1; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ -1) >>> 0; }
export function readZipEntry(entry, maxBytes, budget = { remaining: LIMITS.expandedBytes }) {
  const info = zipMetadata.get(entry) || { size: entry._data.uncompressedSize, crc32: entry._data.crc32 };
  if (!Number.isSafeInteger(info.size) || info.size < 0) return Promise.reject(zipError());
  if (info.size > maxBytes || info.size > budget.remaining) return Promise.reject(Error('解压后的文件超过大小上限'));
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0, crc = -1, failed = false;
    const stream = entry.internalStream('uint8array');
    const fail = error => { if (failed) return; failed = true; stream.pause(); chunks = []; reject(error); };
    stream.on('data', chunk => {
      if (failed) return;
      size += chunk.length; budget.remaining -= chunk.length;
      if (size > maxBytes || budget.remaining < 0) { fail(Error('解压后的文件超过大小上限')); return; }
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      chunks.push(chunk);
    }).on('error', () => fail(zipError())).on('end', () => {
      if (failed) return;
      if (size !== info.size || ((crc ^ -1) >>> 0) !== (info.crc32 >>> 0)) { fail(Error('ZIP 文件校验失败，请重新压缩后上传')); return; }
      const bytes = new Uint8Array(size);
      let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      chunks = []; resolve(bytes);
    }).resume();
  });
}

export async function expandFiles(sources, { images = false, progress = () => {} } = {}) {
  const files = [], skipped = [], budget = { remaining: LIMITS.expandedBytes };
  for (const source of sources) {
    const sourcePath = source.webkitRelativePath || source.name;
    if (!source.size || source.size > LIMITS.fileBytes) { skipped.push({ name: sourcePath, reason: '文件为空或超过 20MB' }); continue; }
    if (!isArchive(source.name)) {
      if (hiddenPath(sourcePath) || (!isDocument(source.name) && !(images && isImage(source.name)))) skipped.push({ name: sourcePath, reason: '不支持的文件类型或依赖目录' });
      else files.push({ file: source, path: sourcePath, source });
      continue;
    }
    try {
      progress('正在解压 ' + source.name);
      const zip = await openZip(await source.arrayBuffer());
      const entries = Object.values(zip.files);
      // Reject unsafe members before accepting any content from this archive.
      for (const entry of entries) if (!entry.dir) safeArchivePath(entry.unsafeOriginalName || entry.name);
      const archiveFiles = [];
      for (const entry of entries) {
        if (entry.dir) continue;
        const path = safeArchivePath(entry.unsafeOriginalName || entry.name), name = path.split('/').pop(), label = sourcePath + '/' + path;
        if (hiddenPath(path)) { skipped.push({ name: label, reason: '系统文件或依赖目录' }); continue; }
        if (((entry.unixPermissions || 0) & 0xf000) === 0xa000) { skipped.push({ name: label, reason: '不读取符号链接' }); continue; }
        if (isArchive(name)) { skipped.push({ name: label, reason: '嵌套 ZIP 请单独上传' }); continue; }
        if (!isDocument(name) && !(images && isImage(name))) { skipped.push({ name: label, reason: '不支持的文件类型' }); continue; }
        try {
          const bytes = await readZipEntry(entry, LIMITS.fileBytes, budget);
          if (!bytes.length) throw Error('文件为空');
          archiveFiles.push({ file: new File([bytes], name, { type: mimeFor(name), lastModified: entry.date?.getTime() || 0 }), path: label, source, archive: source.name });
        } catch (error) { skipped.push({ name: label, reason: error.message }); }
      }
      files.push(...archiveFiles);
      if (!archiveFiles.length) skipped.push({ name: sourcePath, reason: 'ZIP 中没有可导入的文件' });
    } catch (error) { skipped.push({ name: sourcePath, reason: error.message }); }
  }
  return { files, skipped };
}

function xmlDocument(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('文档包含不支持的 XML 声明');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('文档 XML 已损坏');
  return doc;
}
export async function extractText(file, { load = library } = {}) {
  if (!file.size || file.size > LIMITS.fileBytes) throw Error('单个文件必须大于 0 且不超过 20MB');
  const ext = extension(file.name), buffer = await file.arrayBuffer();
  let text = '';
  if (isText(file.name)) text = decodeText(new Uint8Array(buffer));
  else if (ext === 'pdf') {
    const pdfjs = await load('pdfjsLib', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let pdf; const parts = [];
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
      if (pdf.numPages > LIMITS.pages) throw Error('PDF 最多 200 页，请拆分后上传');
      for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i), content = await page.getTextContent(); parts.push('[第 ' + i + ' 页]\n' + content.items.map(item => item.str).join(' ')); }
      // Page labels alone do not make a scanned document readable.
      if (!parts.some(part => part.replace(/^\[第 \d+ 页\]\n/, '').trim())) throw Error('PDF 无法提取文字，扫描件请先 OCR');
      text = parts.join('\n\n');
    } finally { if (pdf) await pdf.destroy(); }
  } else if (ext === 'docx') {
    await verifyOfficeZip(buffer);
    const mammoth = await load('mammoth', 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  } else if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
    if (ext !== 'xls') await verifyOfficeZip(buffer);
    const xlsx = await load('XLSX', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'), workbook = xlsx.read(buffer, { type: 'array' });
    text = workbook.SheetNames.map(name => { const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[name]); return csv.trim() ? '[工作表 ' + name + ']\n' + csv : ''; }).filter(Boolean).join('\n\n');
  } else if (['pptx', 'odt', 'odp'].includes(ext)) {
    const zip = await openZip(buffer, 4000), budget = { remaining: LIMITS.expandedBytes }, parts = [];
    if (ext === 'pptx') {
      const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
      if (slides.length > LIMITS.pages) throw Error('PPT 最多 200 页，请拆分后上传');
      for (let i = 0; i < slides.length; i++) {
        const doc = xmlDocument(decodeText(await readZipEntry(zip.files[slides[i]], LIMITS.fileBytes, budget)));
        const value = Array.from(doc.getElementsByTagName('a:t')).map(node => node.textContent).join(' ');
        if (value.trim()) parts.push('[第 ' + (i + 1) + ' 页]\n' + value);
      }
    } else {
      if (!zip.files['content.xml']) throw Error('不是有效的 OpenDocument 文档');
      const doc = xmlDocument(decodeText(await readZipEntry(zip.files['content.xml'], LIMITS.fileBytes, budget)));
      parts.push(Array.from(doc.getElementsByTagName('*')).filter(node => node.tagName === 'text:p' || node.tagName === 'text:h').map(node => node.textContent).join('\n'));
    }
    text = parts.join('\n\n');
  } else throw Error('暂不支持此文件格式');
  text = String(text || '');
  if (!text.trim()) throw Error('文件没有可读取的文字');
  if (text.length > LIMITS.characters) throw Error('提取文字超过 40 万字符，请拆分后上传');
  return isText(file.name) ? text : text.trim();
}
export function base64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function decodeBase64(data) {
  const padding=data.endsWith('==')?2:data.endsWith('=')?1:0;
  const bytes=new Uint8Array(Math.floor(data.length*3/4)-padding);
  let offset=0;
  for(let i=0;i<data.length;i+=65536){const part=atob(data.slice(i,i+65536));for(let j=0;j<part.length;j++)bytes[offset++]=part.charCodeAt(j);}
  return bytes;
}
export async function readFile(file) {
  const text = await extractText(file);
  return { name: file.name, size: file.size, type: file.type || mimeFor(file.name), text, data: base64(await file.arrayBuffer()) };
}
export async function prepareChatFile(source, { progress = () => {}, extract = extractText } = {}) {
  const result = await expandFiles([source], { images: true, progress }), parts = [], images = [];
  let characters = 0;
  for (const entry of result.files) {
    if (isImage(entry.file.name)) { images.push(entry.file); continue; }
    try {
      progress('正在读取 ' + entry.path);
      const text = await extract(entry.file), part = isArchive(source.name) ? '[文件: ' + entry.path + ']\n' + text : text;
      if (characters + part.length > LIMITS.chatCharacters) throw Error('聊天附件文字合计超过 4 万字符，请分批上传或添加到项目资料');
      parts.push(part); characters += part.length;
    } catch (error) { result.skipped.push({ name: entry.path, reason: error.message }); }
  }
  const summary = isArchive(source.name) ? 'ZIP 已自动解压：' + parts.length + ' 个文档、' + images.length + ' 张图片。\n\n' : '';
  const text = parts.length || (isArchive(source.name) && images.length) ? '[文件: ' + source.name + ']\n' + summary + parts.join('\n\n') : '';
  return { source, text, images, skipped: result.skipped, count: parts.length + images.length };
}
export const api = { CHAT_ACCEPT, DOCUMENT_ACCEPT, PROJECT_ACCEPT, LIMITS, isArchive, isDocument, isImage, expandFiles, extractText, readFile, prepareChatFile, decodeBase64 };
if (typeof window !== 'undefined') window.ArenaFiles = api;
