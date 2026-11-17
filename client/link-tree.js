export const pageKey = (page) => page.collection + ':' + page.path;
export const humanize = (value) =>
  String(value || '')
    .replace(/Sidebar$/i, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/^\d+[-_.]/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim() || 'Pages';
export function pageLabel(page) {
  return /^(?:index|readme)$/i.test(page.title || '')
    ? 'Home'
    : page.title ||
        humanize(
          page.path
            .split('/')
            .at(-1)
            .replace(/\.[^.]+$/, ''),
        );
}
export function pageTarget(page, baseUrl = '/') {
  let target = page.url || page.route || '',
    base = baseUrl.replace(/\/$/, '');
  if (!target.startsWith('/') || target.startsWith('//')) return '';
  if (base && target === base) return '/';
  if (base && target.startsWith(base + '/')) target = target.slice(base.length);
  return target;
}
export function comparableLink(value) {
  const trimmed = String(value || '').trim(),
    path = trimmed.split(/[?#]/)[0];
  return path ? path.replace(/\/$/, '') || '/' : trimmed;
}
export function findLinkedPage(pages, href, baseUrl = '/') {
  if (!href) return null;
  const target = comparableLink(href),
    published = pages.filter((page) => !page.draft && pageTarget(page, baseUrl));
  return (
    published.find((page) => comparableLink(pageTarget(page, baseUrl)) === target) ||
    published.find((page) => comparableLink(page.url || page.route) === target) ||
    null
  );
}

function collectionLabel(collection) {
  const basic =
    { docs: 'Documentation', pages: 'Pages', blog: 'Blog' }[collection?.type] || 'Pages';
  const label =
    collection?.label && !collection.label.includes(':')
      ? collection.label
      : collection?.pluginId && collection.pluginId !== 'default'
        ? humanize(collection.pluginId)
        : basic;
  return (
    label +
    (collection?.version && collection.version !== 'current' ? ' · ' + collection.version : '') +
    (collection?.localized ? ' · ' + collection.locale : '')
  );
}
export function buildLinkTree(pages, collections = [], navigations = []) {
  pages = pages.filter((page) => !page.draft && pageTarget(page));
  const roots = [],
    seen = new Set();
  function leaf(page, label, key) {
    if (!page?.url && !page?.route) return null;
    seen.add(pageKey(page));
    return { key, label: label || pageLabel(page), page };
  }
  function folderTree(list, collection, key, dir = '.', label) {
    const prefix = collection.root === '.' ? '' : collection.root.replace(/\/$/, '') + '/';
    const scope = dir === '.' ? '' : dir.replace(/^\.\/|\/$/g, '') + '/';
    const root = { key, label: label || collectionLabel(collection), children: [] };
    for (const page of [...list].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true }),
    )) {
      let relative = page.path.startsWith(prefix) ? page.path.slice(prefix.length) : page.path;
      if (scope) {
        if (!relative.startsWith(scope)) continue;
        relative = relative.slice(scope.length);
      }
      const parts = relative.split('/');
      parts.pop();
      let parent = root,
        folder = '';
      for (const part of parts) {
        folder += (folder ? '/' : '') + part;
        const folderKey = key + '/folder:' + folder;
        let child = parent.children.find((n) => n.key === folderKey);
        if (!child) {
          child = { key: folderKey, label: humanize(part), children: [] };
          parent.children.push(child);
        }
        parent = child;
      }
      const child = leaf(page, null, parent.key + '/page:' + pageKey(page));
      if (child) parent.children.push(child);
    }
    return root;
  }
  for (const record of navigations) {
    if (record.mode !== 'tree' || !record.value || !record.descriptor) continue;
    const descriptor = record.descriptor,
      collection = collections.find((c) => c.id === descriptor.collection);
    if (!collection) continue;
    const scoped = pages.filter((p) => p.collection === collection.id),
      byId = new Map(scoped.filter((p) => p.id).map((p) => [p.id, p]));
    function items(list, key) {
      return (Array.isArray(list) ? list : []).flatMap((item, index) => {
        const here = key + '/' + index;
        if (typeof item === 'string') {
          const node = leaf(byId.get(item), null, here);
          return node ? [node] : [];
        }
        if (!item || typeof item !== 'object') return [];
        if (!item.type)
          return Object.entries(item)
            .map(([label, children]) => ({
              key: here + '/' + label,
              label,
              children: items(children, here + '/' + label),
            }))
            .filter((n) => n.children.length);
        if (item.type === 'category') {
          const children = items(item.items, here),
            linked =
              item.link?.type === 'doc'
                ? leaf(byId.get(item.link.id || item.link.docId), 'Overview', here + '/overview')
                : null;
          if (linked && !children.some((n) => n.page && pageKey(n.page) === pageKey(linked.page)))
            children.unshift(linked);
          return children.length
            ? [
                {
                  key: here,
                  label: item.label || 'Section',
                  children,
                  defaultOpen: item.collapsed === false,
                },
              ]
            : [];
        }
        if (item.type === 'autogenerated') {
          const tree = folderTree(scoped, collection, here, item.dirName || '.', '');
          return tree.children;
        }
        if (['doc', 'ref'].includes(item.type)) {
          const node = leaf(byId.get(item.id), item.label, here);
          return node ? [node] : [];
        }
        if (item.type === 'link' && typeof item.href === 'string') {
          const page = pages.find((page) => (page.url || page.route) === item.href);
          const node = leaf(page, item.label, here);
          return node ? [node] : [];
        }
        return [];
      });
    }
    for (const [name, list] of Object.entries(record.value)) {
      const key = 'nav:' + descriptor.id + ':' + name,
        children = items(list, key);
      if (children.length)
        roots.push({
          key,
          label:
            humanize(name) + (collection.version !== 'current' ? ' · ' + collection.version : ''),
          children,
          defaultOpen: true,
        });
    }
  }
  const grouped = new Map();
  for (const page of pages)
    if (!seen.has(pageKey(page))) {
      if (!grouped.has(page.collection)) grouped.set(page.collection, []);
      grouped.get(page.collection).push(page);
    }
  for (const [id, list] of grouped) {
    const collection = collections.find((c) => c.id === id) || { id, root: '.', type: 'pages' };
    const hasSidebar = pages.some((page) => page.collection === id && seen.has(pageKey(page)));
    roots.push(
      folderTree(
        list,
        collection,
        'collection:' + id,
        '.',
        (hasSidebar ? 'Other ' : '') + collectionLabel(collection),
      ),
    );
  }
  return roots;
}
export function filterLinkTree(tree, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return tree;
  return tree.flatMap((node) => {
    if ((node.label + ' ' + (node.page?.path || '')).toLocaleLowerCase().includes(needle))
      return [node];
    if (node.children) {
      const children = filterLinkTree(node.children, query);
      if (children.length) return [{ ...node, children }];
    }
    return [];
  });
}
export function openLinkBranches(tree, href, baseUrl) {
  const result = new Set(),
    linked = findLinkedPage(
      tree.flatMap(function flatten(node) {
        return node.page ? [node.page] : (node.children || []).flatMap(flatten);
      }),
      href,
      baseUrl,
    );
  function visit(nodes, ancestors = []) {
    for (const node of nodes) {
      if (node.children) {
        if (!ancestors.length || node.defaultOpen) result.add(node.key);
        visit(node.children, [...ancestors, node.key]);
      } else if (node.page && linked && pageKey(node.page) === pageKey(linked))
        ancestors.forEach((key) => result.add(key));
    }
  }
  visit(tree);
  return result;
}
export function validateLink(value) {
  const href = String(value || '').trim();
  if (!href) return 'Choose a page or enter a link address.';
  if (/[\u0000-\u0020\u007f]/.test(href))
    return 'A link address cannot contain spaces or control characters.';
  if (/^(?:javascript|vbscript|data|file):/i.test(href))
    return 'Use a page link, web address, email address or phone link.';
  return '';
}
