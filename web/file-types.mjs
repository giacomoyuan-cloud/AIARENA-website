// One allowlist for the composer, project materials and original-file transport.
export const TEXT_EXTENSIONS = 'txt md markdown mdx csv tsv json jsonl ndjson yaml yml xml html htm svg css scss sass less js mjs cjs jsx ts tsx vue svelte py pyi ipynb sql sh bash zsh java kt kts c h cc cpp cxx hpp cs go rs rb php swift r tex toml ini cfg conf properties log env gitignore dockerignore dockerfile'.split(' ');
export const OFFICE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'xls', 'xlsm', 'xlsb', 'pptx', 'odt', 'ods', 'odp'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const specialNames = ['dockerfile', 'makefile', 'gemfile', 'rakefile', 'license', 'readme'];
export function extension(name) { return String(name).split(/[\\/]/).pop().split('.').pop().toLowerCase(); }
export function isText(name) { return TEXT_EXTENSIONS.includes(extension(name)) || specialNames.includes(String(name).split(/[\\/]/).pop().toLowerCase()); }
export function isDocument(name) { return isText(name) || OFFICE_EXTENSIONS.includes(extension(name)); }
export function isImage(name) { return IMAGE_EXTENSIONS.includes(extension(name)); }
export function isArchive(name) { return extension(name) === 'zip'; }
export function materialName(file) { return (file.folder ? file.folder + '/' : '') + (file.relativePath || file.name); }
export const DOCUMENT_ACCEPT = [...TEXT_EXTENSIONS, ...OFFICE_EXTENSIONS, 'zip'].map(ext => '.' + ext).join(',') + ',text/plain';
export const CHAT_ACCEPT = DOCUMENT_ACCEPT + ',' + IMAGE_EXTENSIONS.map(ext => '.' + ext).join(',');
export function mimeFor(name) {
  return ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })[extension(name)] || (isText(name) ? 'text/plain' : 'application/octet-stream');
}
