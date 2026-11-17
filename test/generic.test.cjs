const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  express = require('express');
const { resolveProject, loadProject, captureContent } = require('../lib/project.cjs'),
  { listPages, describe, mediaReference } = require('../lib/content.cjs');
const { parseNavigation, replaceNavigation } = require('../lib/navigation.cjs'),
  { configFields, updateSettings, readSettings } = require('../lib/settings.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-generic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function write(file, source) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return { root, write };
}
test('configuration and sidebar formats: CJS, ESM, TypeScript, defineConfig and literal async exports', () => {
  for (const source of [
    "module.exports={title:'Old'}",
    "export default {title:'Old'}",
    "const anything={title:'Old'} satisfies Config;export default anything",
    "export default defineConfig({title:'Old'})",
    "export default async ()=>({title:'Old'})",
  ]) {
    assert.equal(configFields(source)[0].value, 'Old');
    assert.match(updateSettings(source, { title: 'New' }), /"New"/);
  }
  for (const [name, source] of [
    ['sidebars.cjs', "module.exports={guide:[{Basics:['intro']}]};"],
    ['sidebars.mjs', "export default {guide:['intro']}"],
    ['sidebar.json', '{"guide":["intro"]}'],
  ]) {
    const v = parseNavigation(source, name).value;
    assert(v.guide);
    assert.equal(
      parseNavigation(replaceNavigation(source, { docs: ['next'] }, name), name).value.docs[0],
      'next',
    );
  }
});
test('custom roots, multiple instances, versions, locales, media and exact content metadata', async (t) => {
  const { root, write } = await fixture(t);
  await write('manual/01-intro.md', '---\ntitle: Welcome\nid: start\n---\n\nText.\n');
  await write('reference/api.mdx', '# API\n');
  await write('release/old.md', '# Old\n');
  await write(
    'web/pages/about.jsx',
    'export default ()=> <article><h1>About</h1><p>Hello</p></article>;',
  );
  await write('assets/pictures/example.svg', '<svg/>');
  await write('manual/nearby.svg', '<svg/>');
  await write('styles/theme.css', ':root{--brand:#123456;}');
  await write('nav.cjs', "module.exports={guide:['start']};");
  await write('api-nav.json', '{"sdk":["api"]}');
  await write('versions.json', '["1.0"]');
  await write('versioned_docs/version-1.0/old.md', '# Old\n');
  await write('versioned_sidebars/version-1.0-sidebars.json', '{"guide":["old"]}');
  await write('i18n/fr/docusaurus-plugin-content-docs/current/01-intro.md', '# Bonjour\n');
  const config = {
    title: 'Example',
    baseUrl: '/help/',
    staticDirectories: ['assets'],
    i18n: { defaultLocale: 'en', locales: ['en', 'fr'] },
    presets: [
      [
        'classic',
        {
          docs: { path: 'manual', routeBasePath: '/', sidebarPath: 'nav.cjs' },
          blog: false,
          pages: { path: 'web/pages' },
          theme: { customCss: 'styles/theme.css' },
        },
      ],
    ],
    plugins: [
      [
        '@docusaurus/plugin-content-docs',
        { id: 'sdk', path: 'reference', routeBasePath: 'sdk', sidebarPath: 'api-nav.json' },
      ],
    ],
  };
  const project = resolveProject(root, config);
  assert.equal(project.collections.filter((c) => c.type === 'docs').length, 4);
  assert.deepEqual(project.stylesheets, ['styles/theme.css']);
  captureContent(project, {
    'docusaurus-plugin-content-docs': {
      default: {
        loadedVersions: [
          {
            contentPath: path.join(root, 'manual'),
            sidebarFilePath: path.join(root, 'nav.cjs'),
            docs: [
              {
                source: '@site/manual/01-intro.md',
                unversionedId: 'start',
                permalink: '/help/welcome',
                title: 'Welcome',
              },
            ],
          },
        ],
      },
      sdk: {
        loadedVersions: [
          {
            contentPath: path.join(root, 'reference'),
            sidebarFilePath: path.join(root, 'api-nav.json'),
            docs: [
              {
                source: '@site/reference/api.mdx',
                unversionedId: 'api',
                permalink: '/help/sdk/api',
              },
            ],
          },
        ],
      },
    },
  });
  const pages = await listPages(root, project);
  assert.equal(pages.find((p) => p.path === 'manual/01-intro.md').url, '/help/welcome');
  assert.equal(pages.find((p) => p.path === 'reference/api.mdx').collection, 'docs:sdk');
  assert(pages.some((p) => p.path === 'web/pages/about.jsx'));
  assert(pages.some((p) => p.version === '1.0'));
  assert(pages.some((p) => p.locale === 'fr'));
  assert.equal(
    mediaReference(project, 'assets/pictures/example.svg', 'manual/01-intro.md'),
    '/pictures/example.svg',
  );
  assert.equal(mediaReference(project, 'manual/nearby.svg', 'manual/01-intro.md'), './nearby.svg');
  const { mainRange } = require('../lib/homepage.cjs');
  const jsx = 'export default ()=> <article><h1>About</h1></article>';
  assert.equal(
    jsx.slice(mainRange(jsx).start, mainRange(jsx).end),
    '<article><h1>About</h1></article>',
  );
});
test('host loader supports async ESM config without assuming TypeScript or conventional folders', async (t) => {
  const { root, write } = await fixture(t);
  await fs.symlink(
    path.resolve(__dirname, '../node_modules'),
    path.join(root, 'node_modules'),
    'dir',
  );
  await write('package.json', '{"type":"module"}');
  await write(
    'docusaurus.config.mjs',
    "export default async ()=>({title:'Portable',url:'https://example.test',baseUrl:'/guide/',staticDirectories:['public-files'],presets:[['classic',{docs:{path:'handbook',routeBasePath:'/'},blog:false,pages:false}]]});",
  );
  await write('handbook/start.mdx', '# Start\n');
  const project = await loadProject(root);
  assert.equal(project.configFile, 'docusaurus.config.mjs');
  assert.equal(project.collections[0].root, 'handbook');
  assert.equal(project.baseUrl, '/guide/');
  const settings = await readSettings(root, project);
  assert.equal(settings.cssPath, null);
  assert(settings.fields.some((f) => f.key === 'title'));
});
test('custom presets expose their loaded content and authoritative routes', async (t) => {
  const { root, write } = await fixture(t);
  await write('knowledge/first.md', '# First\n');
  const project = resolveProject(root, { presets: ['custom-preset'] });
  captureContent(project, {
    'docusaurus-plugin-content-docs': {
      default: {
        loadedVersions: [
          {
            contentPath: path.join(root, 'knowledge'),
            docs: [{ source: '@site/knowledge/first.md', id: 'first', permalink: '/custom/first' }],
          },
        ],
      },
    },
  });
  const pages = await listPages(root, project);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, '/custom/first');
});
test('generic API handles autogenerated sections, colocated assets, no CSS, conflicts and traversal', async (t) => {
  const { root, write } = await fixture(t);
  await write('knowledge/start.md', '# Start\n');
  await write('public-files/logo.svg', '<svg/>');
  await write('README.md', 'private');
  const project = resolveProject(root, {
    staticDirectories: ['public-files'],
    plugins: [['@docusaurus/plugin-content-docs', { path: 'knowledge', routeBasePath: '/' }]],
  });
  const app = express();
  app.use(require('../lib/server.cjs').createApi({ siteDir: root, project }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const session = await (await fetch(base + '/__site_editor/session')).json();
  async function call(route, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + '/__site_editor' + route, {
      method,
      headers: {
        Origin: base,
        'X-Site-Editor-Token': session.token,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await call('/navigation')).data.mode, 'automatic');
  assert.equal((await call('/document?path=knowledge/../README.md')).status, 400);
  const created = await call('/pages', {
    collection: 'docs:default',
    path: 'knowledge/new.md',
    title: 'New',
  });
  assert.equal(created.status, 201);
  assert(!created.data.source.includes('hide_title'));
  const category = await call('/sections', {
    collection: 'docs:default',
    folder: 'advanced',
    title: 'Advanced',
    position: 2,
  });
  assert.equal(category.status, 201);
  assert.equal(
    (await call('/sections', { collection: 'docs:default', folder: 'advanced', title: 'Stale' }))
      .status,
    409,
  );
  const upload = await call('/media', {
    folder: 'knowledge/advanced',
    name: 'diagram.svg',
    data: Buffer.from('<svg/>').toString('base64'),
    document: 'knowledge/new.md',
  });
  assert.equal(upload.status, 400);
  await write('knowledge/advanced/diagram.svg', '<svg/>');
  const library = (await call('/media?document=knowledge/new.md')).data;
  assert.equal(library.files.length, 1);
  assert(library.roots.every((root) => root.kind === 'static'));
  assert(!library.folders.some((folder) => folder.startsWith('knowledge')));
  const contentImage = await fetch(
    base + '/__site_editor/media/file?path=knowledge/advanced/diagram.svg',
  );
  assert.equal(contentImage.status, 200);
  const settings = (await call('/settings')).data;
  assert.equal(settings.cssPath, null);
});
test('unknown directives and dynamic JSX are preserved as source components', async () => {
  for (const source of [
    ':::note\n\nImportant text\n\n:::\n',
    '<section className={styles.card}>Text {name}</section>\n',
  ]) {
    const doc = await describe(source);
    assert.equal(doc.blocks[0].kind, 'component');
    assert.equal(doc.blocks[0].raw, source.trim());
  }
});
test('preview bundles relative and aliased project components and a project wrapper', async (t) => {
  const { root, write } = await fixture(t);
  await fs.symlink(
    path.resolve(__dirname, '../node_modules'),
    path.join(root, 'node_modules'),
    'dir',
  );
  await write('manual/start.mdx', '# Placeholder\n');
  await write(
    'src/Card.jsx',
    "import React from 'react';export default ({children})=><aside data-card='custom'>{children}</aside>;",
  );
  await write(
    'src/theme-adapter.jsx',
    "import React from 'react';export const components={h1:props=><h1 {...props} data-theme='custom'/>};export const PreviewRoot=({children})=><section data-wrapper='custom'>{children}</section>;",
  );
  const project = resolveProject(
    root,
    { plugins: [['@docusaurus/plugin-content-docs', { path: 'manual' }]] },
    { previewModule: 'src/theme-adapter.jsx', previewImports: { 'special-card': 'src/Card.jsx' } },
  );
  const built = await require('../lib/preview.cjs').buildPreview(root, project, {
    path: 'manual/start.mdx',
    kind: 'mdx',
    source: "import Card from 'special-card';\n\n# Heading\n\n<Card>Portable preview</Card>\n",
  });
  assert(built.code.includes('Portable preview'));
  assert(built.code.includes('data-wrapper'));
  assert(built.code.includes('data-card'));
  await assert.rejects(
    () =>
      require('../lib/preview.cjs').buildPreview(root, project, {
        path: '../bad',
        kind: 'mdx',
        source: '',
      }),
    /Invalid repository path/,
  );
});
