const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EditorError } = require('./paths.cjs');
const CONFIG_FILES = [
  'docusaurus.config.ts',
  'docusaurus.config.js',
  'docusaurus.config.mjs',
  'docusaurus.config.cjs',
  'docusaurus.config.mts',
  'docusaurus.config.cts',
];
const EXTENSIONS = ['.md', '.mdx', '.markdown'];
function relative(siteDir, value) {
  if (typeof value !== 'string') throw new EditorError(400, 'A project path must be a string.');
  const absolute = path.resolve(siteDir, value.replace(/^@site\//, ''));
  const result = path.relative(siteDir, absolute).split(path.sep).join('/');
  if (result === '..' || result.startsWith('../') || path.isAbsolute(result))
    throw new EditorError(400, 'Editable paths must be inside the site checkout: ' + value);
  if (
    result
      .split('/')
      .some((part) => ['.git', 'node_modules', '.docusaurus', '.docsite-editor'].includes(part))
  )
    throw new EditorError(400, 'This project path is reserved: ' + value);
  return result || '.';
}
const within = (file, root) =>
  root === '.' || file === root || file.startsWith(root.replace(/\/$/, '') + '/');
const route = (...parts) =>
  '/' +
  parts
    .filter((p) => p !== undefined && p !== null && p !== false)
    .map((p) => String(p).replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');
function resolveProject(siteDir, config = {}, options = {}, configPath) {
  siteDir = path.resolve(siteDir);
  const configFile = configPath
    ? relative(siteDir, configPath)
    : CONFIG_FILES.find((name) => fs.existsSync(path.join(siteDir, name))) || null;
  const baseUrl = config.baseUrl || options.baseUrl || '/';
  const staticDirectories = (config.staticDirectories || ['static']).map((value) =>
    relative(siteDir, value),
  );
  const collections = [],
    stylesheets = [];
  const sidebarDefault = () =>
    ['sidebars.ts', 'sidebars.js', 'sidebars.mjs', 'sidebars.cjs', 'sidebars.json'].find((file) =>
      fs.existsSync(path.join(siteDir, file)),
    ) || null;
  function add(type, input = {}, pluginId = 'default') {
    if (input === false) return;
    const id = type + ':' + (input.id || pluginId);
    const root = relative(siteDir, input.path || (type === 'pages' ? 'src/pages' : type));
    let navigation =
      input.sidebarPath === false
        ? false
        : input.sidebarPath
          ? relative(siteDir, input.sidebarPath)
          : type === 'docs'
            ? sidebarDefault()
            : false;
    if (
      navigation &&
      fs.existsSync(path.join(siteDir, navigation)) &&
      fs.statSync(path.join(siteDir, navigation)).isDirectory()
    )
      throw new EditorError(400, 'A sidebar path must name a file.');
    collections.push({
      id,
      label: input.label || id,
      root,
      type,
      pluginId: input.id || pluginId,
      routeBasePath: input.routeBasePath ?? (type === 'pages' ? '/' : type),
      sidebarPath: navigation,
      include: input.include || [
        type === 'pages' ? '**/*.{md,mdx,markdown,js,jsx,ts,tsx}' : '**/*.{md,mdx,markdown}',
      ],
      exclude: input.exclude || ['**/_*', '**/_*/**', '**/*.test.*', '**/*.spec.*'],
      numberPrefixParser: input.numberPrefixParser !== false,
      version: 'current',
      locale: config.i18n?.defaultLocale || 'en',
    });
  }
  function classic(input = {}) {
    add('docs', input.docs);
    add('blog', input.blog);
    add('pages', input.pages);
    for (const file of [].concat(input.theme?.customCss || []))
      if (typeof file === 'string') stylesheets.push(relative(siteDir, file));
  }
  function nameOf(entry) {
    return typeof entry === 'string' ? entry : typeof entry === 'function' ? entry.name : '';
  }
  for (const entry of config.presets || []) {
    const [preset, input = {}] = Array.isArray(entry) ? entry : [entry, {}];
    if (/(?:^classic$|preset-classic)/.test(nameOf(preset))) classic(input);
  }
  for (const entry of config.plugins || []) {
    const [plugin, input = {}] = Array.isArray(entry) ? entry : [entry, {}];
    const name = nameOf(plugin);
    const match = name.match(/(?:plugin-content-|^)(docs|blog|pages)(?:\/|$)/);
    if (match) add(match[1], input);
  }
  if (options.collections) {
    collections.length = 0;
    for (const item of options.collections)
      add(
        item.type || 'docs',
        { ...item, path: item.path || item.root, id: item.id || 'default' },
        item.id || 'default',
      );
  }
  if (!collections.length && !config.presets && !config.plugins) {
    for (const type of ['docs', 'blog', 'pages'])
      if (fs.existsSync(path.join(siteDir, type === 'pages' ? 'src/pages' : type))) add(type, {});
  }
  const unique = [...new Map(collections.map((item) => [item.id, item])).values()];
  // Discover historical/localized source roots; loaded Docusaurus metadata refines their exact routes.
  for (const item of [...unique].filter((c) => c.type === 'docs')) {
    const prefix = item.pluginId === 'default' ? '' : item.pluginId + '_';
    const versionDir = prefix + 'versioned_docs',
      sidebarDir = prefix + 'versioned_sidebars';
    const versionFile = path.join(siteDir, prefix + 'versions.json');
    const versions = fs.existsSync(versionFile)
      ? JSON.parse(fs.readFileSync(versionFile, 'utf8'))
      : [];
    for (const version of versions) {
      const root = versionDir + '/version-' + version;
      if (fs.existsSync(path.join(siteDir, root)))
        unique.push({
          ...item,
          id: item.id + '@' + version,
          label: item.label + ' · ' + version,
          root,
          version,
          sidebarPath: sidebarDir + '/version-' + version + '-sidebars.json',
          routeBasePath: route(item.routeBasePath, version),
        });
    }
  }
  const originals = [...unique];
  const localizationRoot = relative(siteDir, config.i18n?.path || 'i18n');
  for (const locale of config.i18n?.locales || []) {
    if (locale === (config.i18n.defaultLocale || 'en')) continue;
    for (const item of originals) {
      const folder =
        'docusaurus-plugin-content-' +
        item.type +
        (item.pluginId === 'default' ? '' : '-' + item.pluginId);
      const root =
        localizationRoot +
        '/' +
        locale +
        '/' +
        folder +
        (item.type === 'docs'
          ? '/' + (item.version === 'current' ? 'current' : 'version-' + item.version)
          : '');
      if (fs.existsSync(path.join(siteDir, root)))
        unique.push({
          ...item,
          id: item.id + '#' + locale,
          label: item.label + ' · ' + locale,
          root,
          locale,
          routeBasePath: route(locale, item.routeBasePath),
          localized: true,
        });
    }
  }
  const mediaRoots = (
    options.mediaRoots || staticDirectories.map((root) => ({ path: root, publicPath: '/' }))
  ).map((value, index) => {
    const item = typeof value === 'string' ? { path: value, publicPath: '/' } : value;
    return {
      id: item.id || 'media-' + index,
      path: relative(siteDir, item.path),
      publicPath: route(item.publicPath || '/'),
      uploadPath: relative(siteDir, item.uploadPath || path.posix.join(item.path, 'uploads')),
      kind: 'static',
    };
  });
  if (options.colocatedMedia !== false)
    for (const c of unique)
      mediaRoots.push({ id: 'content-' + c.id, path: c.root, kind: 'content', collection: c.id });
  const css = [
    ...new Set([
      ...(options.stylesheets || []).map((file) => relative(siteDir, file)),
      ...stylesheets,
    ]),
  ];
  const navigation = new Map();
  for (const c of unique.filter((c) => c.type === 'docs' && c.sidebarPath !== false)) {
    const key = c.sidebarPath || 'auto:' + c.id;
    if (!navigation.has(key))
      navigation.set(key, {
        id: key,
        path: c.sidebarPath || null,
        collection: c.id,
        label: c.label,
        automatic: !c.sidebarPath,
      });
  }
  return {
    schema: 2,
    siteDir,
    configFile,
    siteName: config.title || options.siteName || 'Documentation',
    baseUrl,
    staticDirectories,
    collections: unique,
    navigation: [...navigation.values()],
    stylesheets: css,
    mediaRoots,
    styles: options.styles || [],
    newPageDefaults: options.newPageDefaults || {},
    jsxRoot: options.jsxRoot || 'main',
    preview: {
      remarkPlugins: (options.previewRemarkPlugins || []).map((file) => relative(siteDir, file)),
      module: options.previewModule ? relative(siteDir, options.previewModule) : null,
      imports: options.previewImports || {},
      imageOrigins: options.previewImageOrigins || ['https:', 'http:'],
    },
    pages: [],
    warnings: [],
    fingerprint: crypto
      .createHash('sha256')
      .update(JSON.stringify({ configFile, collections: unique, mediaRoots, css }))
      .digest('hex'),
  };
}
function sourcePath(project, source) {
  if (typeof source !== 'string') return null;
  try {
    return relative(project.siteDir, source.replace(/^@site\//, ''));
  } catch {
    return null;
  }
}
function captureContent(project, allContent) {
  const metadata = new Map(project.pages.map((page) => [page.collection + ':' + page.path, page]));
  const collections = [...project.collections];
  function visit(value, scope) {
    if (!value || typeof value !== 'object') return;
    if (value.contentPath && typeof value.contentPath === 'string') {
      const root = sourcePath(project, value.contentPath);
      const localized = sourcePath(project, value.contentPathLocalized);
      const matching = collections.find(
        (c) =>
          c.root === root && (!scope || (c.type === scope.type && c.pluginId === scope.pluginId)),
      );
      if (matching && value.sidebarFilePath)
        matching.sidebarPath = sourcePath(project, value.sidebarFilePath);
      if (root && !matching && scope) {
        const parent = collections.find(
          (c) => c.type === scope.type && c.pluginId === scope.pluginId,
        ) || {
          id: scope.type + ':' + scope.pluginId,
          label: scope.type + ':' + scope.pluginId,
          type: scope.type,
          pluginId: scope.pluginId,
          root,
          routeBasePath: scope.type === 'pages' ? '/' : scope.type,
          sidebarPath: null,
          include: ['**/*.{md,mdx,markdown,js,jsx,ts,tsx}'],
          exclude: ['**/_*', '**/_*/**'],
          numberPrefixParser: true,
          version: 'current',
          locale: 'en',
        };
        if (parent)
          collections.push({
            ...parent,
            root,
            id: parent.id + '@' + (value.versionName || root),
            version: value.versionName || parent.version,
            sidebarPath: value.sidebarFilePath
              ? sourcePath(project, value.sidebarFilePath)
              : parent.sidebarPath,
          });
      }
      if (localized && !collections.some((c) => c.root === localized) && scope) {
        const parent = collections.find(
          (c) => c.type === scope.type && c.pluginId === scope.pluginId,
        );
        if (parent)
          collections.push({
            ...parent,
            root: localized,
            id: parent.id + '#' + localized,
            label: parent.label + ' · localized',
          });
      }
    }
    const source = sourcePath(project, value.source || value.metadata?.source);
    const permalink = value.permalink || value.metadata?.permalink;
    if (source && permalink) {
      const c = collections
        .filter((c) => within(source, c.root))
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (c)
        metadata.set(c.id + ':' + source, {
          path: source,
          url: permalink,
          route: permalink,
          title: value.title || value.metadata?.title,
          id: value.unversionedId || value.id || value.metadata?.id,
          collection: c.id,
        });
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, scope));
    else
      for (const item of Object.values(value))
        if (item && typeof item === 'object') visit(item, scope);
  }
  for (const [name, instances] of Object.entries(allContent || {})) {
    const type = name.match(/content-(docs|pages|blog)$/)?.[1];
    if (!type) continue;
    for (const [pluginId, content] of Object.entries(instances || {})) {
      if (!collections.some((c) => c.type === type && c.pluginId === pluginId)) {
        const sources = [];
        function collect(value) {
          if (!value || typeof value !== 'object') return;
          const source = sourcePath(project, value.source || value.metadata?.source);
          if (source && /\.(?:md|mdx|markdown|jsx?|tsx?)$/.test(source)) sources.push(source);
          Object.values(value).forEach(collect);
        }
        collect(content);
        if (sources.length) {
          let parts = path.posix.dirname(sources[0]).split('/');
          for (const source of sources) {
            const folder = path.posix.dirname(source).split('/');
            let i = 0;
            while (i < parts.length && parts[i] === folder[i]) i++;
            parts = parts.slice(0, i);
          }
          const root = parts.join('/') || '.';
          collections.push({
            id: type + ':' + pluginId,
            label: type + ':' + pluginId,
            root,
            type,
            pluginId,
            routeBasePath: type === 'pages' ? '/' : type,
            sidebarPath: type === 'docs' ? null : false,
            include: ['**/*.{md,mdx,markdown,js,jsx,ts,tsx}'],
            exclude: ['**/_*', '**/_*/**'],
            numberPrefixParser: true,
            version: 'current',
            locale: 'en',
          });
        }
      }
      visit(content, { type, pluginId });
    }
  }
  project.collections = collections;
  project.pages = [...metadata.values()];
  for (const c of collections)
    if (
      !project.mediaRoots.some((m) => m.kind === 'content' && m.path === c.root) &&
      project.mediaRoots.some((m) => m.kind === 'content')
    )
      project.mediaRoots.push({
        id: 'content-' + c.id,
        path: c.root,
        kind: 'content',
        collection: c.id,
      });
  project.navigation = project.navigation.filter((n) => {
    const c = collections.find((c) => c.id === n.collection);
    return c && c.sidebarPath === n.path;
  });
  for (const c of collections.filter(
    (c) => c.type === 'docs' && !c.sidebarPath && c.sidebarPath !== false,
  ))
    if (!project.navigation.some((n) => n.collection === c.id))
      project.navigation.push({
        id: 'auto:' + c.id,
        path: null,
        collection: c.id,
        label: c.label,
        automatic: true,
      });
  // Exact sidebar file locations are supplied by the docs plugin's version metadata.
  for (const c of collections.filter(
    (c) => c.type === 'docs' && c.sidebarPath && c.sidebarPath !== false,
  )) {
    if (!project.navigation.some((n) => n.path === c.sidebarPath))
      project.navigation.push({
        id: c.sidebarPath,
        path: c.sidebarPath,
        collection: c.id,
        label: c.label,
      });
  }
  return project;
}
async function loadProject(siteDir, options = {}) {
  const core = path.dirname(require.resolve('@docusaurus/core/package.json', { paths: [siteDir] }));
  const { loadSiteConfig } = require(path.join(core, 'lib/server/config.js'));
  const { siteConfig, siteConfigPath } = await loadSiteConfig({
    siteDir,
    customConfigFilePath: options.configFile
      ? path.resolve(siteDir, options.configFile)
      : undefined,
  });
  return resolveProject(siteDir, siteConfig, options, siteConfigPath);
}
module.exports = {
  resolveProject,
  loadProject,
  captureContent,
  relative,
  within,
  route,
  EXTENSIONS,
  CONFIG_FILES,
};
