const path = require('node:path'),
  fs = require('node:fs/promises'),
  esbuild = require('esbuild');
const { safePath, EditorError } = require('./paths.cjs'),
  { within, relative } = require('./project.cjs'),
  { split } = require('./content.cjs');
async function buildPreview(siteDir, project, input) {
  const file = await safePath(siteDir, input.path, (p) =>
    project.collections.some((c) => within(p, c.root)),
  );
  if (typeof input.source !== 'string' || input.source.length > 4_000_000)
    throw new EditorError(400, 'Invalid preview source.');
  const [{ compile }, { default: gfm }, { default: directive }] = await Promise.all([
    import('@mdx-js/mdx'),
    import('remark-gfm'),
    import('remark-directive'),
  ]);
  const directives = () => (tree) => {
    function visit(node) {
      if (node.type === 'containerDirective') {
        node.data = { hName: 'aside', hProperties: { className: 'alert alert--info' } };
        if (node.children?.[0]?.data?.directiveLabel) node.children[0].data = { hName: 'strong' };
      } else if (/Directive$/.test(node.type))
        throw new Error('Custom directives need a preview remark plugin: ' + node.name);
      node.children?.forEach(visit);
    }
    visit(tree);
  };
  const remarkPlugins = [gfm, directive, directives];
  for (const pluginPath of project.preview.remarkPlugins || []) {
    const imported = await import(
      require('node:url').pathToFileURL(path.join(siteDir, relative(siteDir, pluginPath))).href
    );
    remarkPlugins.push(imported.default);
  }
  function mediaPlugin(documentPath) {
    return () => async (tree) => {
      const jobs = [];
      function visit(node) {
        const attr =
          node.name === 'img'
            ? (node.attributes || []).find((a) => a.name === 'src' && typeof a.value === 'string')
            : null;
        const reference = node.type === 'image' ? node.url : attr?.value;
        if (reference && !/^(?:[a-z]+:|\/\/)/i.test(reference)) {
          if (reference.startsWith('/')) {
            const base = project.baseUrl.replace(/\/$/, '');
            const url = base && reference.startsWith(base + '/') ? reference : base + reference;
            if (attr) attr.value = url;
            else node.url = url;
          } else
            jobs.push(
              (async () => {
                const asset = require('./content.cjs').resolveMediaReference(
                  project,
                  documentPath,
                  reference,
                );
                if (!asset) return;
                const file = await safePath(siteDir, asset, (p) =>
                  project.mediaRoots.some((root) => within(p, root.path)),
                );
                const mime = {
                  '.svg': 'image/svg+xml',
                  '.png': 'image/png',
                  '.jpg': 'image/jpeg',
                  '.jpeg': 'image/jpeg',
                  '.webp': 'image/webp',
                  '.gif': 'image/gif',
                  '.avif': 'image/avif',
                }[path.extname(asset).toLowerCase()];
                if (!mime) return;
                const data =
                  'data:' + mime + ';base64,' + (await fs.readFile(file)).toString('base64');
                if (attr) attr.value = data;
                else node.url = data;
              })(),
            );
        }
        node.children?.forEach(visit);
      }
      visit(tree);
      await Promise.all(jobs);
    };
  }
  async function markdown(source, file, map = false) {
    const parts = split(source);
    return String(
      await compile(parts.body, {
        remarkPlugins: [
          ...remarkPlugins,
          mediaPlugin(path.relative(siteDir, file).split(path.sep).join('/')),
          ...(map ? [require('./preview-map.cjs').annotateMarkdown(parts.prefix.length)] : []),
        ],
        development: false,
      }),
    );
  }
  let draft = input.source,
    loader = 'jsx';
  if (input.kind === 'jsx') {
    const old = await fs.readFile(file, 'utf8'),
      range = require('./homepage.cjs').mainRange(old, project.jsxRoot);
    draft = require('./preview-map.cjs').annotateJsx(
      old.slice(0, range.start) + draft + old.slice(range.end),
      { start: range.start, end: range.start + draft.length },
    );
    loader = /\.tsx?$/.test(file) ? 'tsx' : 'jsx';
  } else if (input.kind === 'code') loader = /\.tsx?$/.test(file) ? 'tsx' : 'jsx';
  else draft = await markdown(draft, file, true);
  const adapter = project.preview.module
    ? path.join(siteDir, relative(siteDir, project.preview.module))
    : null;
  const entry =
    'import React from "react";import {createRoot} from "react-dom/client";import Content from "ce:draft";' +
    (adapter ? 'import * as adapter from ' + JSON.stringify(adapter) + ';' : 'const adapter={};') +
    'window.__ceUnmount?.();const root=createRoot(document.getElementById("preview-root"));window.__ceUnmount=()=>root.unmount();' +
    'const node=React.createElement(Content,{components:adapter.components||{}});root.render(adapter.PreviewRoot?React.createElement(adapter.PreviewRoot,null,node):node);';
  const base = JSON.stringify(project.baseUrl.replace(/\/$/, '')),
    config = JSON.stringify({ title: project.siteName, baseUrl: project.baseUrl });
  const helpers =
    'import React from "react";const base=' +
    base +
    ';const url=value=>typeof value==="string"&&value.startsWith("/")&&!value.startsWith("//")?base+value:value;';
  const shims = {
    '@docusaurus/Head': 'export default function Head(){return null;}',
    '@docusaurus/useBaseUrl':
      helpers + 'export default url;export const useBaseUrlUtils=()=>({withBaseUrl:url});',
    '@docusaurus/Link':
      helpers +
      'export default function Link({to,href,children,...props}){return <a {...props} href={url(to||href)}>{children}</a>;}',
    '@docusaurus/useDocusaurusContext': 'export default ()=>({siteConfig:' + config + '});',
    '@theme/Layout':
      helpers +
      'export default function Layout({children}){return <main className="markdown">{children}</main>;}',
    '@theme/Admonition':
      helpers +
      'export default function Admonition({children,title,type="note"}){return <aside className={"alert alert--"+(type==="warning"?"warning":"info")}><strong>{title||type}</strong>{children}</aside>;}',
    '@theme/Tabs': await fs.readFile(path.join(__dirname, '../client/preview-tabs.jsx'), 'utf8'),
    '@theme/TabItem':
      helpers + 'export default function TabItem({children}){return <>{children}</>;}',
    '@theme/CodeBlock':
      helpers +
      'export default function CodeBlock({children,className}){return <pre><code className={className}>{children}</code></pre>;}',
    '@theme/Details':
      helpers +
      'export default function Details({children,summary}){return <details open><summary>{summary}</summary>{children}</details>;}',
  };
  const aliases = project.preview.imports || {};
  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: siteDir,
      sourcefile: 'site-editor-preview.jsx',
      loader: 'jsx',
    },
    absWorkingDir: siteDir,
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.webp': 'dataurl',
      '.svg': 'dataurl',
      '.avif': 'dataurl',
      '.css': 'local-css',
    },
    plugins: [
      {
        name: 'site-editor-preview',
        setup(build) {
          build.onResolve({ filter: /^ce:draft$/ }, () => ({ path: file, namespace: 'ce-draft' }));
          build.onLoad({ filter: /.*/, namespace: 'ce-draft' }, () => ({
            contents: draft,
            loader,
            resolveDir: path.dirname(file),
          }));
          build.onResolve({ filter: /.*/ }, (args) => {
            if (aliases[args.path])
              return { path: path.join(siteDir, relative(siteDir, aliases[args.path])) };
            if (shims[args.path]) return { path: args.path, namespace: 'ce-shim' };
            if (args.path.startsWith('@site/'))
              return { path: path.join(siteDir, relative(siteDir, args.path)) };
            if (args.path.startsWith('@theme/') || args.path.startsWith('@docusaurus/'))
              throw new Error(
                'Configure previewImports for ' + args.path + ' to provide its preview adapter.',
              );
            if (
              args.path === 'react' ||
              args.path.startsWith('react/') ||
              args.path.startsWith('react-dom/')
            )
              return { path: require.resolve(args.path, { paths: [siteDir] }) };
          });
          build.onLoad({ filter: /.*/, namespace: 'ce-shim' }, (args) => ({
            contents: shims[args.path],
            loader: 'jsx',
            resolveDir: siteDir,
          }));
          build.onLoad({ filter: /\.mdx?$/ }, async (args) => ({
            contents: await markdown(await fs.readFile(args.path, 'utf8'), args.path),
            loader: 'jsx',
            resolveDir: path.dirname(args.path),
          }));
        },
      },
    ],
  });
  return {
    code: result.outputFiles
      .filter((f) => f.path.endsWith('.js'))
      .map((f) => f.text)
      .join('\n'),
    css: result.outputFiles
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.text)
      .join('\n'),
  };
}
module.exports = { buildPreview };
