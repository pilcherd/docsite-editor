export function folderOf(file) {
  return file.folder || file.path.slice(0, file.path.lastIndexOf('/')) || '.';
}
const contains = (name, root) =>
  root === '.' || name === root || name.startsWith(root.replace(/\/$/, '') + '/');
export function buildMediaTree(roots, folders, files, preferred) {
  const known = new Set(folders || []);
  for (const file of files) known.add(folderOf(file));
  for (const root of roots) {
    known.add(root.path);
    if (root.uploadPath) known.add(root.uploadPath);
  }
  if (preferred && roots.some((root) => contains(preferred, root.path))) known.add(preferred);
  const top = roots.filter(
    (root, index) =>
      !roots.some(
        (other, j) =>
          j !== index && contains(root.path, other.path) && (root.path !== other.path || j < index),
      ),
  );
  const counts = new Map();
  files.forEach((file) => counts.set(folderOf(file), (counts.get(folderOf(file)) || 0) + 1));
  function node(path, label) {
    return { path, label, count: counts.get(path) || 0, children: [] };
  }
  const tree = top.map((root) => node(root.path, root.path === '.' ? 'Project files' : root.path));
  for (const folder of [...known].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )) {
    const root = tree.find((root) => contains(folder, root.path));
    if (!root || folder === root.path) continue;
    const relative = root.path === '.' ? folder : folder.slice(root.path.length + 1);
    let parent = root,
      current = root.path === '.' ? '' : root.path;
    for (const part of relative.split('/').filter((part) => part && part !== '.')) {
      current += (current ? '/' : '') + part;
      let child = parent.children.find((child) => child.path === current);
      if (!child) {
        child = node(current, part);
        parent.children.push(child);
      }
      parent = child;
    }
  }
  return tree;
}
export function folderAncestors(folder) {
  const parts = String(folder || '').split('/'),
    result = [];
  for (let i = 1; i <= parts.length; i++) result.push(parts.slice(0, i).join('/'));
  return result;
}
export function visibleMedia(files, folder, query, all = false) {
  const needle = query.trim().toLocaleLowerCase();
  return files.filter((file) =>
    needle
      ? (file.path + ' ' + file.name).toLocaleLowerCase().includes(needle)
      : all || folderOf(file) === folder,
  );
}
