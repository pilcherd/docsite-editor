const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
class EditorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function safePath(siteDir, relative, allowed) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    path.isAbsolute(relative) ||
    relative
      .split('/')
      .some((part) =>
        ['..', '.', '.git', 'node_modules', '.docusaurus', '.docsite-editor'].includes(part),
      )
  )
    throw new EditorError(400, 'Invalid repository path.');
  const root = await fs.realpath(siteDir);
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(root + path.sep) || !allowed(relative))
    throw new EditorError(400, 'This path is outside the editable content folders.');
  let current = resolved;
  while (true) {
    try {
      const real = await fs.realpath(current);
      if (real !== current || (real !== root && !real.startsWith(root + path.sep)))
        throw new EditorError(400, 'Symbolic links are not editable.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  return resolved;
}
async function walk(root, filter, relative = '') {
  let result = [];
  for (const item of await fs
    .readdir(path.join(root, relative), { withFileTypes: true })
    .catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))) {
    if (
      item.isSymbolicLink() ||
      (item.isDirectory() &&
        ['.git', 'node_modules', '.docusaurus', '.docsite-editor', 'build', '.cache'].includes(
          item.name,
        ))
    )
      continue;
    const name = path.posix.join(relative, item.name);
    if (item.isDirectory()) result.push(...(await walk(root, filter, name)));
    else if (item.isFile() && filter(name)) result.push(name);
  }
  return result;
}
async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.site-editor-' + crypto.randomUUID();
  try {
    await fs.writeFile(temp, content, { flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
module.exports = { EditorError, hash, safePath, walk, atomicWrite };
