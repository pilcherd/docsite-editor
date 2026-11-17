const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { JSDOM } = require('jsdom'),
  express = require('express'),
  { resolveProject } = require('../lib/project.cjs'),
  { createApi } = require('../lib/server.cjs');
const bundle = path.resolve(__dirname, '../node_modules/.cache/media-test.cjs');
require('node:fs').mkdirSync(path.dirname(bundle), { recursive: true });
require('esbuild').buildSync({
  stdin: {
    contents:
      "export * from './client/media-tree.js';export * from './client/image-size.js';export {extensions} from './client/extensions.jsx';export {loadVisual,normalizeModel,exportVisual} from './client/document.js';",
    resolveDir: path.resolve(__dirname, '..'),
    sourcefile: 'media-entry.jsx',
    loader: 'jsx',
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
});
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
for (const name of [
  'window',
  'document',
  'navigator',
  'Node',
  'HTMLElement',
  'Element',
  'MutationObserver',
  'DOMParser',
  'getComputedStyle',
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === 'getComputedStyle' ? dom.window[name].bind(dom.window) : dom.window[name],
  });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
const media = require(bundle);
test('folder tree includes empty folders, nested paths and deduplicated media roots', () => {
  const roots = [
      { path: 'static', uploadPath: 'static/uploads' },
      { path: 'static/img' },
      { path: 'docs' },
    ],
    files = [
      { path: 'static/img/a/one.png', folder: 'static/img/a', name: 'one.png' },
      { path: 'docs/guide/two.png', folder: 'docs/guide', name: 'two.png' },
    ];
  const tree = media.buildMediaTree(
    roots,
    ['static', 'static/img', 'static/img/a', 'static/empty', 'docs'],
    files,
    'static/new/subfolder',
  );
  assert.equal(tree.length, 2);
  const flat = (list) => list.flatMap((node) => [node, ...flat(node.children)]);
  const nodes = flat(tree);
  assert.equal(nodes.filter((node) => node.path === 'static/img').length, 1);
  assert(nodes.some((node) => node.path === 'static/empty'));
  assert(nodes.some((node) => node.path === 'static/new/subfolder'));
  assert.equal(nodes.find((node) => node.path === 'static/img/a').count, 1);
  assert.deepEqual(media.folderAncestors('static/img/a'), ['static', 'static/img', 'static/img/a']);
});
test('folder browsing is direct while search includes every folder', () => {
  const files = [
    { path: 'static/a/one.png', folder: 'static/a', name: 'one.png' },
    { path: 'static/a/nested/two.png', folder: 'static/a/nested', name: 'two.png' },
    { path: 'static/b/one-more.png', folder: 'static/b', name: 'one-more.png' },
  ];
  assert.deepEqual(
    media.visibleMedia(files, 'static/a', '').map((f) => f.name),
    ['one.png'],
  );
  assert.deepEqual(
    media.visibleMedia(files, 'static/a', 'ONE').map((f) => f.name),
    ['one.png', 'one-more.png'],
  );
  assert.equal(media.visibleMedia(files, 'static/a', '', true).length, 3);
});
test('image sizing preserves other styles and attributes, supports percentages and explicit heights', () => {
  const original = {
    src: '/img/a.png',
    alt: 'Original',
    width: '640',
    height: '480',
    'data-word-width': '6.4',
    style: 'border: 1px solid red; margin-left: auto',
  };
  const scaled = media.resizeImage(original, 'width', '50', '%', true),
    size = media.dimensionsOf(scaled);
  assert.equal(size.width.value, '50');
  assert.equal(size.width.unit, '%');
  assert.equal(size.keep, true);
  assert.equal(scaled['data-word-width'], '6.4');
  assert.match(scaled.style, /border: 1px solid red/);
  assert.match(scaled.style, /margin-left: auto/);
  assert(!('width' in scaled));
  assert(!('height' in scaled));
  const tall = media.resizeImage(scaled, 'height', '200', 'px', false);
  assert.equal(media.dimensionsOf(tall).height.value, '200');
  const reset = media.resetImageSize(tall);
  assert.equal(media.dimensionsOf(reset).width.value, '');
  assert.equal(media.dimensionsOf(reset).height.value, '');
  assert.match(reset.style, /border:/);
  const props = media.displayImageProps(tall);
  assert.equal(props.style.width, '50%');
  assert.equal(props.style.height, '200px');
  const replaced = media.mergeImageSize(original, media.sizeOnly(reset));
  assert(!replaced.width);
  assert(!replaced.height);
  assert.equal(replaced.src, original.src);
});
test('image size changes survive Markdown/MDX export for ordinary images and figures', async (t) => {
  const { describe } = require('../lib/content.cjs'),
    { Editor } = require('@tiptap/core');
  for (const raw of [
    '# Image\n\n![Diagram](/img/a.png)\n',
    '<figure><img src="/img/a.png" alt="Diagram" data-word-width="6.4" /><figcaption>Caption</figcaption></figure>\n',
  ]) {
    const description = await describe(raw),
      exts = media.extensions(),
      model = media.loadVisual(description, exts),
      editor = new Editor({
        element: document.createElement('div'),
        extensions: exts,
        content: model.json,
      });
    media.normalizeModel(editor, model);
    t.after(() => editor.destroy());
    let selected;
    editor.state.doc.descendants((node, pos) => {
      if (!selected && ['image', 'figure'].includes(node.type.name)) selected = { node, pos };
    });
    const attributes = media.resizeImage(
      media.imageAttributes(selected.node),
      'width',
      '320',
      'px',
      true,
    );
    editor.commands.setNodeSelection(selected.pos);
    assert(media.setImageAttributes(editor, selected.pos, attributes));
    assert.equal(editor.state.selection.node.type.name, selected.node.type.name);
    const source = media.exportVisual(editor, model, 'mdx');
    assert.match(source, /"width":"320px"/);
    assert.match(source, /"height":"auto"/);
    assert.match(source, /\/img\/a.png/);
    if (raw.includes('data-word-width')) assert.match(source, /data-word-width="6.4"/);
    await (await import('@mdx-js/mdx')).compile(source);
  }
});
test('media API exposes empty folders and uploads to the selected folder', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['public-files/a', 'public-files/b', 'public-files/empty', 'docs'])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(path.join(root, 'public-files/a/one.svg'), '<svg/>');
  await fs.writeFile(path.join(root, 'public-files/b/two.svg'), '<svg/>');
  const project = resolveProject(root, {
    staticDirectories: ['public-files'],
    plugins: [['@docusaurus/plugin-content-docs', { path: 'docs' }]],
  });
  const app = express();
  app.use(createApi({ siteDir: root, project }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port,
    session = await (await fetch(base + '/__site_editor/session')).json();
  let library = await (await fetch(base + '/__site_editor/media')).json();
  assert(library.folders.includes('public-files/empty'));
  assert(library.folders.includes('public-files/uploads'));
  const response = await fetch(base + '/__site_editor/media', {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'X-Site-Editor-Token': session.token,
    },
    body: JSON.stringify({
      folder: 'public-files/b',
      name: 'uploaded.svg',
      data: Buffer.from('<svg/>').toString('base64'),
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).path, 'public-files/b/uploaded.svg');
  assert.equal(await fs.readFile(path.join(root, 'public-files/b/uploaded.svg'), 'utf8'), '<svg/>');
  await assert.rejects(() => fs.access(path.join(root, 'public-files/a/uploaded.svg')));
  library = await (await fetch(base + '/__site_editor/media')).json();
  assert.equal(media.visibleMedia(library.files, 'public-files/b', '').length, 2);
  assert.equal(media.visibleMedia(library.files, 'public-files/b', 'one').length, 1);
});

test('library roots are the configured Docusaurus static directories, including custom names', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-static-only-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of [
    'public-files/images',
    'public-files/other',
    'second-static',
    'docs/private',
    'extra-media',
  ])
    await fs.mkdir(path.join(root, folder), { recursive: true });
  for (const name of [
    'public-files/images/a.svg',
    'public-files/other/b.svg',
    'second-static/c.svg',
    'docs/private/d.svg',
    'extra-media/e.svg',
  ])
    await fs.writeFile(path.join(root, name), '<svg/>');
  const project = resolveProject(
    root,
    {
      staticDirectories: ['public-files', 'second-static'],
      plugins: [['@docusaurus/plugin-content-docs', { path: 'docs' }]],
    },
    {
      mediaRoots: [
        { path: 'public-files/images', publicPath: '/images' },
        { path: 'extra-media', publicPath: '/extra' },
      ],
    },
  );
  const app = express();
  app.use(createApi({ siteDir: root, project }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/__site_editor/media?search=.svg'),
    library = await response.json();
  assert.deepEqual(
    library.roots.map((root) => root.path),
    ['public-files', 'second-static'],
  );
  assert.deepEqual(library.files.map((file) => file.path).sort(), [
    'public-files/images/a.svg',
    'public-files/other/b.svg',
    'second-static/c.svg',
  ]);
  assert(
    !library.folders.some(
      (folder) => folder.startsWith('docs') || folder.startsWith('extra-media'),
    ),
  );
  assert.equal(
    (await fetch(base + '/__site_editor/media/file?path=public-files/other/b.svg')).status,
    200,
  );
});
