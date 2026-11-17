const fs = require('node:fs/promises'),
  path = require('node:path'),
  { JSDOM } = require('jsdom'),
  esbuild = require('esbuild');
(async () => {
  const site = process.env.TEST_DOCS_SITE;
  if (!site) throw new Error('Set TEST_DOCS_SITE to a Docusaurus checkout.');
  const root = path.resolve(__dirname, '..'),
    output = path.join(root, 'node_modules/.cache/editor-corpus.cjs');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await esbuild.build({
    stdin: {
      contents:
        "export {extensions} from './client/extensions.jsx';export {loadVisual,normalizeModel,exportVisual} from './client/document.js';",
      resolveDir: root,
      sourcefile: 'corpus-entry.jsx',
      loader: 'jsx',
    },
    outfile: output,
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
  const { Editor } = require('@tiptap/core'),
    { extensions, loadVisual, normalizeModel, exportVisual } = require(output);
  const { describe, listPages, split } = require('../lib/content.cjs'),
    { loadProject } = require('../lib/project.cjs'),
    { mainRange } = require('../lib/homepage.cjs');
  const project = await loadProject(site),
    pages = await listPages(site, project),
    failures = [];
  let edits = 0;
  for (const page of pages) {
    let editor;
    try {
      const source = await fs.readFile(path.join(site, page.path), 'utf8');
      let raw = source;
      if (page.kind === 'jsx') {
        try {
          const range = mainRange(source);
          raw = source.slice(range.start, range.end);
        } catch {
          continue;
        }
      }
      const description = await describe(raw),
        exts = extensions(),
        model = loadVisual(description, exts);
      model.jsxImageHelper = /\buseBaseUrl\b/.test(source);
      editor = new Editor({
        element: document.createElement('div'),
        extensions: exts,
        content: model.json,
      });
      normalizeModel(editor, model);
      if (exportVisual(editor, model, page.kind) !== raw)
        throw new Error('Visual round-trip changed the original source');
      let pos;
      editor.state.doc.descendants((node, p) => {
        if (pos === undefined && node.isText) pos = p;
      });
      if (pos !== undefined) {
        editor.commands.insertContentAt(pos, 'Edited ');
        const changed = exportVisual(editor, model, page.kind);
        if (page.kind === 'jsx') {
          for (const block of description.blocks)
            if (
              block.raw.includes('<Link') &&
              block.raw.includes('Support') &&
              !changed.includes('Support')
            )
              throw new Error('React link text was lost');
        }
        if (!changed.includes('Edited ')) throw new Error('Visual text edit was lost');
        if (page.kind === 'jsx')
          require('@babel/parser').parseExpression(changed.trim(), {
            plugins: ['jsx', 'typescript'],
          });
        else await (await import('@mdx-js/mdx')).compile(split(changed).body);
        edits++;
      }
    } catch (error) {
      failures.push(page.path + ': ' + error.stack);
    } finally {
      editor?.destroy();
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(
    'Exact visual/source round-trips passed for ' +
      pages.length +
      ' pages; ' +
      edits +
      ' real visual edits compiled.',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
