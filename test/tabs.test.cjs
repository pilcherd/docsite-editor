const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..'),
  bundle = path.join(root, 'node_modules/.cache/tabs-test.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
require('esbuild').buildSync({
  stdin: {
    contents:
      "export {extensions} from './client/extensions.jsx';export {loadVisual,normalizeModel,exportVisual} from './client/document.js';export * from './client/tab-properties.js';",
    resolveDir: root,
    sourcefile: 'tabs-entry.jsx',
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
  api = require(bundle),
  { describe } = require('../lib/content.cjs');
async function fixture(t, source) {
  const description = await describe(source),
    extensions = api.extensions(),
    model = api.loadVisual(description, extensions);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions,
    content: model.json,
  });
  api.normalizeModel(editor, model);
  t.after(() => editor.destroy());
  return { description, model, editor, export: () => api.exportVisual(editor, model, 'mdx') };
}
const imports = "import Panels from '@theme/Tabs';\nimport Pane from '@theme/TabItem';\n";
const source =
  imports +
  '\n<TabsCustom>Keep this custom component.</TabsCustom>\n\n<Panels groupId="language" aria-label="Language" defaultValue={null} lazy>\n  <Pane value="react" label="React">\n\nUse **React**.\n\n§§§tsx title="Search.tsx" showLineNumbers\nconst value = 1;\n§§§\n\n<Widget setting={computeValue()}>Keep this source.</Widget>\n\n  </Pane>\n  <Pane value="js" label="JavaScript">\n\nUse JavaScript.\n\n  </Pane>\n</Panels>\n'.replaceAll(
    '§',
    String.fromCharCode(96),
  );
test('standard aliases become native tabs, imports are hidden, and an untouched page round-trips exactly', async (t) => {
  const f = await fixture(t, source),
    nodes = f.editor.getJSON().content;
  assert(nodes.some((node) => node.type === 'managedImport'));
  assert(
    !nodes.some((node) => node.type === 'sourceBlock' && node.attrs.raw.includes("from '@theme/")),
  );
  assert.equal(nodes.filter((node) => node.type === 'tabs').length, 1);
  const tabs = nodes.find((node) => node.type === 'tabs');
  assert.equal(tabs.content.length, 2);
  assert.equal(tabs.attrs.component, 'Panels');
  assert.equal(tabs.content[0].attrs.component, 'Pane');
  assert.equal(f.export(), source);
});
test('editing a label preserves code fence metadata, custom props, imports and unsupported nested MDX', async (t) => {
  const f = await fixture(t, source),
    json = f.editor.getJSON(),
    index = json.content.findIndex((node) => node.type === 'tabs');
  json.content[index] = api.changeTab(json.content[index], 0, 'label', 'React example');
  f.editor.commands.setContent(json);
  const result = f.export();
  assert.match(result, /label="React example"/);
  assert(
    result.includes(
      '§§§tsx title="Search.tsx" showLineNumbers'.replaceAll('§', String.fromCharCode(96)),
    ),
  );
  assert(result.includes('<Widget setting={computeValue()}>Keep this source.</Widget>'));
  assert(result.includes('defaultValue={null} lazy'));
  assert.equal(result.match(/import Panels from/g).length, 1);
  await (await import('@mdx-js/mdx')).compile(result);
  const loaded = await fixture(t, result);
  assert.equal(loaded.editor.getJSON().content.filter((node) => node.type === 'tabs').length, 1);
});
test('nested tab content edits preserve other tabs and remain compilable', async (t) => {
  const raw =
    imports +
    '\n<Panels><Pane value="outer" label="Outer">\n\n<Panels><Pane value="inner" label="Inner">\n\nNested text.\n\n</Pane></Panels>\n\n</Pane></Panels>\n';
  const f = await fixture(t, raw);
  let position;
  f.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'Nested text.') position = pos;
  });
  assert.notEqual(position, undefined);
  f.editor.commands.insertContentAt(position, 'Updated ');
  const result = f.export();
  assert(result.includes('Updated Nested text.'));
  assert.equal((result.match(/<Panels/g) || []).length, 2);
  await (await import('@mdx-js/mdx')).compile(result);
});
test('new tab groups add imports once and avoid collisions with unrelated components', async (t) => {
  const raw = "import Tabs from './CustomTabs';\n\nA paragraph.\n",
    f = await fixture(t, raw);
  const group = api.createTabGroup(f.model.tabInfo.names);
  assert.notEqual(group.attrs.component, 'Tabs');
  f.editor.commands.insertContentAt(f.editor.state.doc.content.size, group);
  const result = f.export();
  assert(result.includes("import Tabs from './CustomTabs';"));
  assert.equal((result.match(/from '@theme\/Tabs'/g) || []).length, 1);
  assert.equal((result.match(/from '@theme\/TabItem'/g) || []).length, 1);
  const again = await fixture(t, result);
  assert.equal(again.export(), result);
  await (await import('@mdx-js/mdx')).compile(result);
});
test('removing the last native group removes unused managed imports and preserves unrelated module code', async (t) => {
  const raw =
      imports +
      'export const version = 1;\n\n<Panels><Pane value="one" label="One">Body.</Pane></Panels>\n',
    f = await fixture(t, raw);
  const json = f.editor.getJSON();
  json.content = json.content.filter((node) => node.type !== 'tabs');
  f.editor.commands.setContent(json);
  const result = f.export();
  assert(!result.includes("from '@theme/"));
  assert(result.includes('export const version = 1;'));
});
test('values arrays, renamed values, reordering and removal maintain defaults and labels', async (t) => {
  const raw =
    imports +
    '\n<Panels values={[{label:"A",value:"a",attributes:{title:"Keep"}},{label:"B",value:"b"}]} defaultValue="a"><Pane value="a">A body.</Pane><Pane value="b">B body.</Pane></Panels>\n';
  const f = await fixture(t, raw);
  let group = f.editor.getJSON().content.find((node) => node.type === 'tabs');
  group = api.changeTab(group, 0, 'label', 'First');
  assert.equal(api.tabLabel(group, group.content[0], 0), 'First');
  group = api.changeTab(group, 0, 'value', 'first');
  assert.equal(api.propValue(group.attrs.props, 'defaultValue'), 'first');
  group = api.changeTab(group, 0, 'move', 1);
  assert.equal(api.tabValue(group.content[1], 1), 'first');
  assert.equal(api.propValue(group.attrs.props, 'values')[1].attributes.title, 'Keep');
  group = api.changeTab(group, 1, 'remove');
  assert.equal(api.propValue(group.attrs.props, 'defaultValue'), 'b');
  assert.throws(() => api.changeTab(group, 0, 'remove'), /at least one/);
});
test('dynamic values are never evaluated and remain editable as preserved source', async (t) => {
  const raw =
    imports +
    '\n<Panels values={globalThis.__tabTestExecuted = true}><Pane value="one">Content.</Pane></Panels>\n';
  const f = await fixture(t, raw);
  assert(!globalThis.__tabTestExecuted);
  assert(!f.editor.getJSON().content.some((node) => node.type === 'tabs'));
  assert.equal(f.export(), raw);
});
