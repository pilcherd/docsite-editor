const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createApi } = require('../lib/server.cjs');
const express = require('express');
const { describe, listPages } = require('../lib/content.cjs');
const { parseNavigation } = require('../lib/navigation.cjs');
test('page model preserves Markdown, MDX, tables, imports and front matter byte-for-byte', async () => {
  for (const raw of [
    '---\ntitle: Example\n---\n\n# Title\n\nA **bold** paragraph.\n',
    'import Box from \'./Box\';\n\n<Box kind="note">Text</Box>\n\n| A | B |\n| - | - |\n| 1 | 2 |\n',
    '<figure className="custom"><img src="/pictures/test.png" /><figcaption>Caption</figcaption></figure>\n',
  ]) {
    const doc = await describe(raw);
    assert.equal(doc.prefix + doc.leading + doc.blocks.map((b) => b.raw + b.gap).join(''), raw);
  }
});
test('API confines writes, rejects stale saves and creates pages with a sidebar item', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docsite-editor-'));
  await fs.mkdir(path.join(root, 'docs/guide'), { recursive: true });
  await fs.mkdir(path.join(root, 'static/img/a/deep'), { recursive: true });
  const source = '---\ntitle: Original\nhide_title: true\n---\n\n# Original\n\nText.\n';
  await fs.writeFile(path.join(root, 'docs/guide/page.md'), source);
  const nav =
    'import type {SidebarsConfig} from "@docusaurus/plugin-content-docs";\nconst sidebars:SidebarsConfig={guide:[{type:"category",label:"Guide",items:["guide/page"]}]};\nexport default sidebars;';
  await fs.writeFile(path.join(root, 'sidebars.ts'), nav);
  await fs.writeFile(path.join(root, 'static/img/a/deep/test.svg'), '<svg/>');
  const app = express();
  app.use(createApi({ siteDir: root }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const session = await (await fetch(base + '/__site_editor/session')).json();
  async function call(route, body, method = body ? 'POST' : 'GET', token = session.token) {
    const response = await fetch(base + '/__site_editor' + route, {
      method,
      headers: { Origin: base, 'Content-Type': 'application/json', 'X-Site-Editor-Token': token },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  const current = (await call('/document?path=docs/guide/page.md')).data;
  assert.equal(
    (
      await call(
        '/document',
        { path: 'docs/guide/page.md', source: source + 'new', revision: current.revision },
        'PUT',
        'wrong',
      )
    ).status,
    403,
  );
  assert.equal((await call('/document?path=../secret')).status, 400);
  assert.equal(
    (await call('/document', { path: 'docs/guide/page.md', source, revision: 'stale' }, 'PUT'))
      .status,
    409,
  );
  const saved = await call(
    '/document',
    {
      path: 'docs/guide/page.md',
      source: source.replace('Text.', 'Changed text.'),
      revision: current.revision,
    },
    'PUT',
  );
  assert.equal(saved.status, 200);
  assert.match(await fs.readFile(path.join(root, 'docs/guide/page.md'), 'utf8'), /Changed text/);
  assert.equal(
    (
      await call(
        '/document',
        { path: 'docs/guide/page.md', source, revision: current.revision },
        'PUT',
      )
    ).status,
    409,
  );
  const media = (await call('/media')).data;
  assert.equal(media.files.length, 1);
  assert.equal(media.files[0].path, 'static/img/a/deep/test.svg');
  const navigation = (await call('/navigation')).data;
  const created = await call('/pages', {
    path: 'docs/guide/new.md',
    title: 'New page',
    sidebar: 'guide',
    parent: [0],
    navigationRevision: navigation.revision,
  });
  assert.equal(created.status, 201);
  assert.equal(
    parseNavigation(
      await fs.readFile(path.join(root, 'sidebars.ts'), 'utf8'),
    ).value.guide[0].items.at(-1),
    'guide/new',
  );
  assert.equal(
    (
      await call('/media', {
        folder: 'static/img/a',
        name: '../evil.svg',
        data: Buffer.from('<svg/>').toString('base64'),
      })
    ).status,
    400,
  );
  const upload = await call('/media', {
    folder: 'static/img/a',
    name: 'uploaded.svg',
    data: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    ).toString('base64'),
  });
  assert.equal(upload.status, 201);
  assert.equal(upload.data.url, '/img/a/uploaded.svg');
  assert.equal(
    (
      await call('/media', {
        folder: 'static/img/a',
        name: 'unsafe.svg',
        data: Buffer.from('<svg><script/></svg>').toString('base64'),
      })
    ).status,
    400,
  );
});

test('site settings preserve executable configuration while editing literal fields', () => {
  const { configFields, updateSettings } = require('../lib/settings.cjs');
  const source =
    "const config={title:'Old',baseUrl:process.env.BASE||'/',themeConfig:{navbar:{title:'Docs'},footer:{copyright:\x60Copyright " +
    (String.fromCharCode(36) + '{new Date().getFullYear()}') +
    '\x60}}};export default config;';
  const fields = configFields(source);
  assert(fields.some((f) => f.key === 'title'));
  assert(!fields.some((f) => f.key === 'baseUrl'));
  const next = updateSettings(source, { title: 'New', 'themeConfig.navbar.title': 'Library' });
  assert(next.includes('process.env.BASE'));
  assert(next.includes('new Date().getFullYear()'));
  assert(next.includes('"New"'));
});
test('graphical MDX component text editing preserves imports and code', () => {
  const { componentFields, updateComponent } = require('../lib/components.cjs');
  const source =
    "export const Box=()=>{const url=useBaseUrl('/guide.pdf');return <p>Open the guide <a href={url}>Download</a></p>}";
  const field = componentFields(source).find((f) => f.value === 'Download');
  assert(field);
  const next = updateComponent(source, field.key, 'Read handbook');
  assert(next.includes('useBaseUrl'));
  assert(next.includes('href={url}'));
  assert(next.includes('Read handbook'));
});

test('visual styling survives a markup-to-visual parse', async () => {
  const doc = await describe(
    '# Styled\n\n<span style={{color: "#ff6200", fontSize: "24px"}}>Colored text</span>\n',
  );
  assert(
    doc.blocks.some(
      (block) => block.html.includes('color:#ff6200') && block.html.includes('font-size:24px'),
    ),
  );
});
