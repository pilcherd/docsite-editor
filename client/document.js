import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { generateJSON } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
export const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function loadVisual(description, extensions) {
  const originals = {};
  function remember(block, nodes) {
    originals[block.id] = {
      raw: block.raw,
      gap: block.gap,
      json: JSON.stringify(nodes),
      fence: block.fence,
    };
    return nodes;
  }
  function load(blocks) {
    return blocks.flatMap((block) => {
      let nodes;
      if (block.tabs) {
        const tab = block.tabs;
        const items = tab.items.map((item) => {
          const content = load(item.children);
          const node = {
            type: 'tabItem',
            attrs: {
              sourceId: item.id,
              component: item.component,
              props: item.props,
              leading: item.leading,
            },
            content: content.length ? content : [{ type: 'paragraph' }],
          };
          remember(item, [node]);
          return node;
        });
        nodes = [
          {
            type: 'tabs',
            attrs: { component: tab.component, props: tab.props, leading: tab.leading },
            content: items,
          },
        ];
      } else if (block.moduleParts) {
        nodes = block.moduleParts.map((part) => ({
          type: part.kind === 'managedImport' ? 'managedImport' : 'sourceBlock',
          attrs: { raw: part.raw, kind: 'module', bindings: part.bindings || [] },
        }));
      } else if (block.kind !== 'content' || !block.html) {
        nodes = [
          {
            type: 'sourceBlock',
            attrs: {
              raw: block.raw,
              kind: block.type === 'definition' ? 'definition' : block.kind,
            },
          },
        ];
      } else {
        try {
          nodes = generateJSON(block.html, extensions).content || [];
        } catch {
          nodes = [];
        }
        if (!nodes.length)
          nodes = [{ type: 'sourceBlock', attrs: { raw: block.raw, kind: 'component' } }];
      }
      for (const node of nodes) {
        node.attrs = { ...node.attrs, sourceId: block.id };
        if (node.type === 'codeBlock' && block.fence)
          node.attrs.fenceMeta = block.fence.meta || null;
      }
      return remember(block, nodes);
    });
  }
  const content = load(description.blocks);
  return {
    json: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    originals,
    leading: description.leading,
    prefix: description.prefix,
    tabInfo: description.tabInfo || { names: { tabs: 'Tabs', tabItem: 'TabItem' }, bindings: [] },
    originalHasTabs: Object.values(originals).some((record) =>
      record.json.includes('"type":"tabs"'),
    ),
  };
}

function htmlToMdx(html, jsxImageHelper = false) {
  const template = document.createElement('template');
  template.innerHTML = html;
  function serialize(node) {
    if (node.nodeType === 3)
      return node.textContent
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    if (node.nodeType !== 1) return '';
    let tag = node.tagName.toLowerCase();
    const attributes = [];
    const component = node.getAttribute('data-react-component');
    if (component === 'Link') tag = 'Link';
    for (const attr of node.attributes) {
      if (
        attr.name.startsWith('data-ce-') ||
        attr.name === 'data-source-id' ||
        attr.name === 'data-react-component' ||
        attr.name === 'contenteditable'
      )
        continue;
      let name =
        {
          class: 'className',
          colspan: 'colSpan',
          rowspan: 'rowSpan',
          tabindex: 'tabIndex',
          for: 'htmlFor',
        }[attr.name] || attr.name;
      if (component === 'Link' && name === 'href') name = 'to';
      if (name === 'style') {
        const styles = {};
        for (const property of Array.from(node.style))
          styles[property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = node.style
            .getPropertyValue(property)
            .trim();
        attributes.push('style={' + JSON.stringify(styles) + '}');
        continue;
      }
      if (tag === 'img' && name === 'src' && !/^(?:[a-z]+:|\/)/i.test(attr.value)) {
        attributes.push('src={require(' + JSON.stringify(attr.value) + ').default}');
        continue;
      }
      if (jsxImageHelper && tag === 'img' && name === 'src' && attr.value.startsWith('/')) {
        attributes.push('src={useBaseUrl(' + JSON.stringify(attr.value) + ')}');
        continue;
      }
      attributes.push(name + '="' + escape(attr.value) + '"');
    }
    const start = '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '');
    if (['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr'].includes(tag.toLowerCase()))
      return start + ' />';
    return start + '>' + [...node.childNodes].map(serialize).join('') + '</' + tag + '>';
  }
  return [...template.content.childNodes].map(serialize).join('');
}
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});
turndown.use(gfm);
turndown.keep([
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'span',
  'u',
  'sup',
  'sub',
  'mark',
  'div',
  'section',
  'main',
  'article',
  'details',
  'summary',
  'img',
]);

function mdxAttributes(props = []) {
  return props
    .map((prop) => {
      if (prop.raw) return prop.raw;
      if (prop.kind === 'spread') return '';
      if (prop.kind === 'boolean') return prop.name;
      if (prop.kind === 'expression') return prop.name + '={' + prop.value + '}';
      return prop.name + '="' + escape(prop.value) + '"';
    })
    .filter(Boolean)
    .join(' ');
}
export function exportVisual(editor, model, kind, options = {}) {
  const json = editor.getJSON(),
    required = new Map(),
    available = new Map(),
    otherText = [];
  function inspect(nodes) {
    for (const node of nodes || []) {
      if (node.type === 'tabs') required.set(node.attrs.component, 'tabs');
      if (node.type === 'tabItem') required.set(node.attrs.component, 'tabItem');
      if (node.type === 'managedImport')
        for (const binding of node.attrs.bindings || []) available.set(binding.name, binding.kind);
      else if (node.type === 'sourceBlock') otherText.push(node.attrs.raw);
      else if (node.text) otherText.push(node.text);
      inspect(node.content);
    }
  }
  inspect(json.content);
  const other = otherText.join('\n');
  const unused = new Set();
  if (model.originalHasTabs)
    for (const [name] of available)
      if (!required.has(name) && !new RegExp('\\b' + name + '\\b').test(other)) unused.add(name);
  const imports = [...required]
    .filter(([name]) => !available.has(name))
    .map(
      ([name, type]) =>
        'import ' + name + " from '@theme/" + (type === 'tabs' ? 'Tabs' : 'TabItem') + "';",
    )
    .join('\n');
  const inserted = imports ? '\n' + imports + '\n\n' : '';
  const serializer = DOMSerializer.fromSchema(editor.schema);
  function groups(nodes) {
    const result = [];
    for (const node of nodes || []) {
      const id = node.attrs?.sourceId;
      if (!id && node.type === 'paragraph' && !node.content?.length) continue;
      if (id && result.at(-1)?.id === id) result.at(-1).nodes.push(node);
      else result.push({ id, nodes: [node] });
    }
    return result;
  }
  function structured(node) {
    const attrs = mdxAttributes(node.attrs.props),
      name = node.attrs.component;
    return (
      '<' +
      name +
      (attrs ? ' ' + attrs : '') +
      '>' +
      node.attrs.leading +
      groups(node.content).map(render).join('') +
      '</' +
      name +
      '>'
    );
  }
  function render(group) {
    const old = model.originals[group.id],
      gap = old?.gap ?? '\n\n';
    const dropping = group.nodes.some(
      (node) =>
        node.type === 'managedImport' &&
        (node.attrs.bindings || []).some((binding) => unused.has(binding.name)),
    );
    if (old && !dropping && JSON.stringify(group.nodes) === old.json) return old.raw + old.gap;
    if (group.nodes.every((node) => ['sourceBlock', 'managedImport'].includes(node.type)))
      return (
        group.nodes
          .map((node) =>
            node.type === 'managedImport' &&
            (node.attrs.bindings || []).some((binding) => unused.has(binding.name))
              ? ''
              : node.attrs.raw,
          )
          .join('') + gap
      );
    if (group.nodes.length === 1 && ['tabs', 'tabItem'].includes(group.nodes[0].type))
      return structured(group.nodes[0]) + gap;
    if (group.nodes.length === 1 && group.nodes[0].type === 'codeBlock') {
      const node = group.nodes[0],
        code = (node.content || []).map((child) => child.text || '').join('');
      const fence = '`'.repeat(
        Math.max(3, ...[...code.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      );
      return (
        fence +
        (node.attrs.language || '') +
        (node.attrs.fenceMeta ? ' ' + node.attrs.fenceMeta : '') +
        '\n' +
        code +
        '\n' +
        fence +
        gap
      );
    }
    const container = document.createElement('div');
    for (const node of group.nodes)
      container.append(serializer.serializeNode(editor.schema.nodeFromJSON(node)));
    let text;
    if (
      ['jsx', 'tsx'].includes(kind) ||
      group.nodes.some(
        (node) =>
          ['layout', 'figure', 'table', 'image'].includes(node.type) ||
          node.attrs?.textAlign ||
          Object.keys(node.attrs?.extra || {}).length,
      )
    )
      text = htmlToMdx(container.innerHTML, model.jsxImageHelper ?? kind === 'tsx');
    else {
      const markdown = turndown.turndown(container.innerHTML);
      text = markdown
        .split(/(^\x60{3,}[\s\S]*?^\x60{3,}\s*$)/m)
        .map((part, index) =>
          index % 2
            ? part
            : part.replace(
                /<(?:span|u|sup|sub|mark)\b[\s\S]*?<\/(?:span|u|sup|sub|mark)>/g,
                (match) => htmlToMdx(match),
              ),
        )
        .join('');
    }
    return text + gap;
  }
  const ranges = [];
  let position = 0,
    offset = model.prefix.length + model.leading.length + inserted.length;
  const output = groups(json.content)
    .map((group) => {
      const text = render(group),
        from = position;
      position += group.nodes.reduce(
        (size, node) => size + editor.schema.nodeFromJSON(node).nodeSize,
        0,
      );
      ranges.push({ start: offset, end: offset + text.length, from, to: position });
      offset += text.length;
      return text;
    })
    .join('');
  const source = model.prefix + model.leading + inserted + output;
  return options.withMap ? { source, ranges } : source;
}
export function normalizeModel(editor, model) {
  const found = {};
  function visit(nodes) {
    for (const node of nodes || []) {
      const id = node.attrs?.sourceId;
      if (id) (found[id] ??= []).push(node);
      if (['tabs', 'tabItem'].includes(node.type)) visit(node.content);
    }
  }
  visit(editor.getJSON().content);
  for (const [id, nodes] of Object.entries(found))
    if (model.originals[id]) model.originals[id].json = JSON.stringify(nodes);
  return model;
}
