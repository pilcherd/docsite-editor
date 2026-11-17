const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..'),
  bundle = path.join(root, 'node_modules/.cache/preview-selection-test.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
require('esbuild').buildSync({
  stdin: {
    contents:
      "export {extensions} from './client/extensions.jsx';export {loadVisual,normalizeModel,exportVisual} from './client/document.js';export {mapPreviewSelection} from './client/preview-selection.js';export {installPreviewBridge} from './client/preview-bridge.js';",
    resolveDir: root,
    sourcefile: 'selection-entry.jsx',
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
const { Editor } = require('@tiptap/core'),
  {
    extensions,
    loadVisual,
    normalizeModel,
    exportVisual,
    mapPreviewSelection,
    installPreviewBridge,
  } = require(bundle),
  { describe } = require('../lib/content.cjs');
async function fixture(t, source) {
  const description = await describe(source),
    exts = extensions(),
    model = loadVisual(description, exts),
    editor = new Editor({
      element: document.createElement('div'),
      extensions: exts,
      content: model.json,
    });
  normalizeModel(editor, model);
  t.after(() => editor.destroy());
  function point(index, text, offset) {
    const block = description.blocks[index];
    return {
      start: description.prefix.length + block.start,
      end: description.prefix.length + block.end,
      groupStart: description.prefix.length + block.start,
      groupEnd: description.prefix.length + block.end,
      text,
      offset,
      elementText: text,
      elementOffset: offset,
    };
  }
  const select = (anchor, head = anchor, extra = {}) =>
    mapPreviewSelection(editor, model, 'mdx', source, {
      anchor,
      head,
      collapsed: anchor === head,
      ...extra,
    });
  return { description, model, editor, point, select };
}
test('preview selections map to the correct repeated paragraph and preserve source', async (t) => {
  const source =
    '---\ntitle: Sample\n---\n\n# Title\n\nRepeated **same** text.\n\nRepeated **same** text.\n';
  const f = await fixture(t, source),
    a = f.point(2, 'Repeated same text.', 9),
    b = f.point(2, 'Repeated same text.', 13),
    range = f.select(a, b);
  assert.equal(f.editor.state.doc.textBetween(range.from, range.to), 'same');
  const first = f.select(f.point(1, 'Repeated same text.', 9));
  assert(range.from > first.from);
  assert.equal(exportVisual(f.editor, f.model, 'mdx'), source);
  assert.equal(
    mapPreviewSelection(f.editor, f.model, 'mdx', source + 'new', { anchor: a, head: b }),
    null,
  );
});
test('nested list text, table cells and cross-block ranges are mapped accurately', async (t) => {
  const source =
    '# Heading\n\n- First **value**\n- Second value\n\n| Name | Value |\n| --- | --- |\n| Alpha | One |\n| Beta | Two |\n\nAfter table.\n';
  const f = await fixture(t, source),
    list = 'First valueSecond value',
    table = 'NameValueAlphaOneBetaTwo';
  let range = f.select(f.point(1, list, list.lastIndexOf('value')), f.point(1, list, list.length));
  assert.equal(f.editor.state.doc.textBetween(range.from, range.to), 'value');
  range = f.select(f.point(2, table, table.indexOf('Two')), f.point(2, table, table.length));
  assert.equal(f.editor.state.doc.textBetween(range.from, range.to), 'Two');
  range = f.select(f.point(0, 'Heading', 0), f.point(1, list, 5));
  assert.match(f.editor.state.doc.textBetween(range.from, range.to, ' '), /^Heading First/);
});
test('source components and images are selected as nodes, and edited text remains mappable', async (t) => {
  const f = await fixture(
    t,
    '# Heading\n\n<Widget>Custom text</Widget>\n\n![Diagram](/img/test.svg)\n',
  );
  assert(f.select(f.point(1, 'Custom text', 0)).node);
  assert(f.select(f.point(2, '', 0), undefined, { image: true }).node);
  f.editor.commands.insertContentAt(1, 'New ');
  const source = exportVisual(f.editor, f.model, 'mdx'),
    description = await describe(source),
    block = description.blocks[0];
  const anchor = {
      start: block.start,
      end: block.end,
      groupStart: block.start,
      groupEnd: block.end,
      text: 'New Heading',
      offset: 4,
    },
    head = { ...anchor, offset: 11 };
  const range = mapPreviewSelection(f.editor, f.model, 'mdx', source, {
    anchor,
    head,
    collapsed: false,
  });
  assert.equal(f.editor.state.doc.textBetween(range.from, range.to), 'Heading');
});
test('sandbox bridge reports DOM ranges, render identity and prevents link navigation', () => {
  const root = document.createElement('main');
  root.innerHTML =
    '<p data-ce-start="10" data-ce-end="40" data-ce-group-start="10" data-ce-group-end="40">First <strong>second</strong> word <a href="/other">link</a></p>';
  document.body.append(root);
  const sent = [],
    dispose = installPreviewBridge(
      root,
      () => 7,
      (message) => sent.push(message),
    ),
    text = root.querySelector('strong').firstChild,
    range = document.createRange();
  range.setStart(text, 1);
  range.setEnd(text, 5);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.querySelector('strong').dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(sent[0].type, 'preview-select');
  assert.equal(sent[0].renderId, 7);
  assert.equal(sent[0].anchor.offset, 7);
  assert.equal(sent[0].head.offset, 11);
  assert.equal(sent[0].collapsed, false);
  const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  root.querySelector('a').dispatchEvent(click);
  assert(click.defaultPrevented);
  dispose();
  root.remove();
});

test('an empty trailing editor placeholder does not break preview mapping or dirty the source', async (t) => {
  const source = '# Title\n\nSaved paragraph.\n',
    f = await fixture(t, source);
  f.editor.commands.insertContentAt(f.editor.state.doc.content.size, { type: 'paragraph' });
  assert.equal(exportVisual(f.editor, f.model, 'mdx'), source);
  const range = f.select(f.point(1, 'Saved paragraph.', 6), f.point(1, 'Saved paragraph.', 15));
  assert.equal(f.editor.state.doc.textBetween(range.from, range.to), 'paragraph');
});
test('preview bridge waits for the iframe document before attaching listeners', async () => {
  const code = fs.readFileSync(path.join(root, 'client/dist/preview.js'), 'utf8'),
    messages = [],
    errors = [];
  const virtualConsole = new (require('jsdom').VirtualConsole)();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const frame = new JSDOM(
    '<!doctype html><html><head><script>' +
      code.replaceAll('</script', '<\\/script') +
      '</script></head><body><main id="preview-root"></main></body></html>',
    {
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(win) {
        win.postMessage = (message) => messages.push(message);
      },
    },
  );
  await new Promise((resolve) => frame.window.addEventListener('load', resolve, { once: true }));
  assert.deepEqual(errors, []);
  assert.equal(messages[0]?.type, 'preview-ready');
  frame.window.close();
});

test('figures with and without captions are visual images and preserve their source', async (t) => {
  const figures = [
    '<figure className="handbook-figure">\n<img src="/img/manual/overview.png" alt="" data-word-width="5.383232720909886in" data-word-height="3.19152883696in" data-word-caption="false" />\n</figure>',
    '<figure className="handbook-figure"><img src="/img/manual/device-ready.png" alt="Device screen waiting for a connection" data-word-width="6.791666666666667in" data-word-height="4.05160438413in" data-word-caption="false" style={{"width":"50%","height":"auto","maxWidth":"100%"}} /><figcaption>Device screen waiting for a connection</figcaption></figure>',
  ];
  for (const raw of figures) {
    const source = raw + '\n',
      f = await fixture(t, source);
    assert.equal(f.editor.getJSON().content.filter((n) => n.type === 'figure').length, 1);
    assert(!f.editor.getJSON().content.some((n) => n.type === 'sourceBlock'));
    assert.equal(exportVisual(f.editor, f.model, 'mdx'), source);
    const figure = f.editor.getJSON().content.find((n) => n.type === 'figure'),
      caption = figure.content?.map((n) => n.text || '').join('') || '';
    let figurePosition;
    f.editor.state.doc.forEach((node, position) => {
      if (node.type.name === 'figure') figurePosition = position;
    });
    f.editor.commands.setNodeSelection(figurePosition);
    f.editor.commands.updateAttributes('figure', {
      image: { ...figure.attrs.image, alt: 'Updated alternative text' },
    });
    const edited = exportVisual(f.editor, f.model, 'mdx');
    assert.match(edited, /alt="Updated alternative text"/);
    assert.match(edited, /className="handbook-figure"/);
    assert.match(edited, /data-word-width="/);
    assert.equal(edited.includes('<figcaption>'), !!caption);
    if (caption) assert(edited.includes(caption));
    const reloaded = await fixture(t, edited);
    assert.equal(reloaded.editor.getJSON().content.filter((n) => n.type === 'figure').length, 1);
  }
});
