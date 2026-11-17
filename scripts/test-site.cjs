const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawn } = require('node:child_process');
(async () => {
  const host = process.env.TEST_DOCS_SITE || path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-editor-build-')),
    plugin = path.resolve(__dirname, '..'),
    log = path.join(root, 'editor.log');
  let child;
  async function write(file, source) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  function stop() {
    if (child?.pid)
      try {
        if (process.platform === 'win32') child.kill();
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
  }
  try {
    await fs.symlink(path.join(host, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await write('package.json', '{"name":"generic-editor-fixture","private":true}');
    await write(
      'docusaurus.config.cjs',
      "module.exports=async()=>({title:'Generic fixture',url:'https://example.test',baseUrl:'/help/',onBrokenLinks:'throw',staticDirectories:['public-files'],presets:[['classic',{docs:{path:'handbook',routeBasePath:'/',sidebarPath:require.resolve('./nav.cjs')},blog:false,pages:{path:'web/pages'},theme:{customCss:require.resolve('./theme.css')}}]],plugins:[[" +
        JSON.stringify(plugin) +
        ",{styles:[{label:'Notice',className:'custom-notice'}]}],['@docusaurus/plugin-content-docs',{id:'sdk',path:'reference',routeBasePath:'sdk',sidebarPath:require.resolve('./sdk-nav.json')}]],themeConfig:{navbar:{title:'Generic fixture'}}});",
    );
    await write('nav.cjs', "module.exports={main:[{Basics:['intro']}]};");
    await write('sdk-nav.json', '{"sdk":["api"]}');
    await write(
      'handbook/intro.mdx',
      "---\ntitle: Start\nslug: /\n---\n\nimport Card from '@site/src/Card.jsx';\n\n# Generic documentation\n\n<Card>Project component</Card>\n\n![Local diagram](./diagram.svg)\n\n:::note\n\nImportant information.\n\n:::\n",
    );
    await write(
      'handbook/diagram.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await write('reference/api.md', '---\ntitle: API\n---\n\n# Reference\n\nAPI content.\n');
    await write(
      'web/pages/about.jsx',
      "import React from 'react';export default ()=> <article><h1>About this site</h1><p>Generic React page.</p></article>;",
    );
    await write(
      'src/Card.jsx',
      "import React from 'react';export default ({children})=><aside className='custom-notice'>{children}</aside>;",
    );
    await write(
      'public-files/pictures/logo.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
    );
    await write(
      'theme.css',
      ':root{--ifm-color-primary:#174a8b}.custom-notice{padding:1rem;background:#eef5ff}',
    );
    const { open } = require('node:fs/promises'),
      out = await open(log, 'w');
    child = spawn(
      process.execPath,
      [path.join(plugin, 'bin/editor.cjs'), '--built', '--site', root, '--port', '3102'],
      {
        env: { ...process.env },
        stdio: ['ignore', out.fd, out.fd],
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    );
    const base = 'http://127.0.0.1:3102';
    let session;
    for (let i = 0; i < 180; i++) {
      try {
        const response = await fetch(base + '/__site_editor/session');
        if (response.ok) {
          session = await response.json();
          break;
        }
      } catch {}
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(session, 'Built editor did not start:\n' + (await fs.readFile(log, 'utf8')));
    async function call(route, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + '/__site_editor' + route, {
        method,
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          'X-Site-Editor-Token': session.token,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      assert(response.ok, route + ': ' + JSON.stringify(data));
      return data;
    }
    const pages = await call('/pages');
    assert.equal(pages.length, 3);
    assert.equal(pages.find((p) => p.path === 'handbook/intro.mdx').url, '/help/');
    assert.equal(pages.find((p) => p.path === 'reference/api.md').url, '/help/sdk/api');
    assert(pages.some((p) => p.path === 'web/pages/about.jsx' && p.url === '/help/about'));
    assert.equal((await fetch(base + '/help/')).status, 200);
    assert.equal((await fetch(base + '/help/pictures/logo.svg')).status, 200);
    assert.match(await (await fetch(base + '/help/')).text(), /site_editor/);
    const nav = await call('/navigation?collection=docs:default');
    assert.equal(nav.descriptor.path, 'nav.cjs');
    const code = await call('/preview', {
      path: 'handbook/intro.mdx',
      kind: 'mdx',
      source: (await call('/document?path=handbook/intro.mdx')).source,
    });
    assert(code.code.includes('Project component'));
    assert(code.code.includes('Important information'));
    const created = await call('/pages', {
      collection: 'docs:sdk',
      path: 'reference/new.md',
      title: 'New SDK page',
      sidebar: 'sdk',
      navigationRevision: (await call('/navigation?collection=docs:sdk')).revision,
    });
    assert.equal(created.collection, 'docs:sdk');
    assert((await fs.readFile(path.join(root, 'sdk-nav.json'), 'utf8')).includes('"new"'));
    console.log(
      'Actual Docusaurus build and built editor passed: CJS async config, /help/ base URL, custom docs/pages/media/CSS, two docs instances, colocated image, custom React component, directives, JSON sidebar save.',
    );
    stop();
    await new Promise((r) => setTimeout(r, 500));
    await out.close();
    const core = path.join(
      path.dirname(require.resolve('@docusaurus/core/package.json', { paths: [host] })),
      'bin/docusaurus.mjs',
    );
    await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.DOCUSAURUS_SITE_EDITOR;
      const build = spawn(
        process.execPath,
        [core, 'build', '--out-dir', path.join(root, 'release')],
        { cwd: root, env, stdio: 'ignore', windowsHide: true },
      );
      build.on('exit', (c) =>
        c === 0 ? resolve() : reject(new Error('Normal fixture build failed.')),
      );
    });
    const html = await fs.readFile(path.join(root, 'release/index.html'), 'utf8');
    assert(!html.includes('/__site_editor/'));
    console.log('Normal release build contains no editor loader.');
    const devout = await open(log, 'a');
    child = spawn(
      process.execPath,
      [path.join(plugin, 'bin/editor.cjs'), '--site', root, '--port', '3102'],
      {
        stdio: ['ignore', devout.fd, devout.fd],
        detached: process.platform !== 'win32',
        windowsHide: true,
      },
    );
    let development;
    for (let i = 0; i < 90; i++) {
      try {
        const response = await fetch(base + '/__site_editor/session');
        if (response.ok) {
          development = await response.json();
          break;
        }
      } catch {}
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(development?.mode === 'development', 'Development editor did not start.');
    const devPages = await (await fetch(base + '/__site_editor/pages')).json();
    assert.equal(devPages.length, 4);
    assert.equal((await fetch(base + '/help/')).status, 200);
    stop();
    await new Promise((r) => setTimeout(r, 500));
    await devout.close();
    console.log('Development server editor middleware and custom base URL passed.');
  } catch (error) {
    console.error('Fixture logs:\n' + (await fs.readFile(log, 'utf8').catch(() => '')));
    throw error;
  } finally {
    stop();
    if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'site-editor-build-'))
      await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
