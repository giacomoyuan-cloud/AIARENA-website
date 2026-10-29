// The deployed document and update endpoint must identify the same release.
export function releaseIndex(html, version) {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error('Invalid app release version');
  let count = 0;
  const stamped = html.replace(/(<meta\s+name=["']app-version["']\s+content=["'])[^"']*(["'][^>]*>)/g, (_, before, after) => {
    count++;
    return before + version + after;
  });
  if (count !== 1) throw new Error('Expected exactly one app-version meta tag');
  return stamped;
}
