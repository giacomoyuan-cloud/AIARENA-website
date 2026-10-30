export const UPLOAD_LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  roundBytes: 20 * 1024 * 1024,
  projectBytes: 100 * 1024 * 1024,
  expandedBytes: 100 * 1024 * 1024,
});
export const MAX_FILE_BASE64_CHARS = 4 * Math.ceil(UPLOAD_LIMITS.fileBytes / 3);

// Validate the decoded size without allocating another full binary copy.
export function uploadDataInfo(value) {
  if (typeof value !== 'string' || value.length > MAX_FILE_BASE64_CHARS) throw Error('单个文件不能超过 20MB');
  const data = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1 || (data.includes('=') && data.length % 4 !== 0)) throw Error('文件编码无效');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const size = Math.floor(data.length * 3 / 4) - padding;
  if (!size || size > UPLOAD_LIMITS.fileBytes) throw Error('单个文件不能超过 20MB');
  return { data, size };
}
