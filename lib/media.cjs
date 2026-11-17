const fs = require('node:fs/promises'),
  path = require('node:path');
const reserved = new Set([
  '.git',
  'node_modules',
  '.docusaurus',
  '.docsite-editor',
  'build',
  '.cache',
]);
async function mediaFolders(siteDir, roots) {
  const folders = new Set();
  async function visit(relative) {
    const absolute = path.resolve(siteDir, relative);
    try {
      if ((await fs.realpath(absolute)) !== absolute) return;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    folders.add(relative);
    for (const entry of entries)
      if (entry.isDirectory() && !entry.isSymbolicLink() && !reserved.has(entry.name))
        await visit(path.posix.join(relative, entry.name));
  }
  for (const root of roots) {
    await visit(root.path);
    if (root.uploadPath) folders.add(root.uploadPath);
  }
  return [...folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
module.exports = { mediaFolders };

function staticMediaRoots(project) {
  return project.staticDirectories.map((directory, index) => {
    const configured = project.mediaRoots.find(
      (root) => root.kind === 'static' && root.path === directory,
    );
    const upload = project.mediaRoots.find(
      (root) =>
        root.kind === 'static' &&
        root.uploadPath &&
        (root.uploadPath === directory || root.uploadPath.startsWith(directory + '/')),
    );
    return {
      id: configured?.id || 'static-' + index,
      path: directory,
      publicPath: '/',
      kind: 'static',
      uploadPath: upload?.uploadPath || directory + '/uploads',
    };
  });
}
module.exports.staticMediaRoots = staticMediaRoots;
