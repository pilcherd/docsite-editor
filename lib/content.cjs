const fs = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');
const { EditorError, hash, walk } = require('./paths.cjs');
let modules;
async function tools() {
  if (!modules)
    modules = Promise.all(
      [
        'unified',
        'remark-parse',
        'remark-gfm',
        'remark-mdx',
        'remark-stringify',
        'mdast-util-to-hast',
        'hast-util-to-html',
        'remark-directive',
      ].map((name) => import(name)),
    );
  const [u, p, g, m, s, h, html, d] = await modules;
  return {
    parser: u.unified().use(p.default).use(g.default).use(m.default).use(d.default),
    stringify: u
      .unified()
      .use(s.default, { bullet: '-', listItemIndent: 'one' })
      .use(g.default)
      .use(m.default)
      .use(d.default),
    toHast: h.toHast,
    toHtml: html.toHtml,
  };
}
function split(source) {
  const match = source.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/);
  const prefix = match ? match[1] : '';
  let metadata;
  try {
    metadata = prefix
      ? yaml.load(prefix.replace(/^---\r?\n/, '').replace(/\r?\n---(?:\r?\n|$)$/, '')) || {}
      : {};
  } catch (error) {
    throw new EditorError(400, 'Invalid page metadata: ' + error.message);
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object')
    throw new EditorError(400, 'Page metadata must be a YAML object.');
  return { prefix, body: source.slice(prefix.length), metadata };
}
function jsxProperties(node) {
  const result = {};
  for (const attr of node.attributes || []) {
    if (attr.type !== 'mdxJsxAttribute') continue;
    const key = attr.name === 'className' ? 'className' : attr.name;
    if (attr.name === 'style' && attr.value && typeof attr.value === 'object') {
      try {
        const expression = require('@babel/parser').parseExpression(attr.value.value);
        if (expression.type === 'ObjectExpression') {
          const pairs = expression.properties.filter(
            (property) =>
              property.type === 'ObjectProperty' &&
              !property.computed &&
              ['StringLiteral', 'NumericLiteral'].includes(property.value.type),
          );
          result.style = pairs
            .map((property) => {
              const name = (property.key.name || property.key.value).replace(
                /[A-Z]/g,
                (letter) => '-' + letter.toLowerCase(),
              );
              let value = property.value.value;
              if (
                typeof value === 'number' &&
                value !== 0 &&
                ![
                  'opacity',
                  'z-index',
                  'font-weight',
                  'line-height',
                  'flex-grow',
                  'flex-shrink',
                  'order',
                ].includes(name)
              )
                value += 'px';
              return name + ':' + value;
            })
            .join(';');
        }
      } catch {}
      continue;
    }
    if (typeof attr.value === 'string') result[key] = attr.value;
    else if (attr.value === null) result[key] = true;
    else if (attr.value && /^require\((['"]).*\1\)(?:\.default)?$/.test(attr.value.value))
      result[key] = attr.value.value.match(/^require\((['"])(.*?)\1\)/)[2];
    else if (attr.value && /^useBaseUrl\(['"].*['"]\)$/.test(attr.value.value))
      result[key] = attr.value.value.slice(12, -2);
    else if (attr.value && /^['"].*['"]$/.test(attr.value.value))
      result[key] = attr.value.value.slice(1, -1);
  }
  return result;
}
async function describe(source) {
  const { prefix, body, metadata } = split(source);
  const { parser, toHast, toHtml } = await tools();
  let tree;
  try {
    tree = parser.parse(body);
  } catch (error) {
    throw new EditorError(400, 'The markup is invalid: ' + error.message);
  }
  const definitions = tree.children.filter((node) => node.type === 'definition');
  const tabs = require('./tabs.cjs').tabContext(tree);
  const handlers = {
    mdxJsxFlowElement(state, node) {
      return jsx(state, node);
    },
    mdxJsxTextElement(state, node) {
      return jsx(state, node);
    },
    mdxjsEsm(state, node) {
      return {
        type: 'element',
        tagName: 'div',
        properties: { 'data-ce-component': node.value },
        children: [],
      };
    },
    mdxFlowExpression(state, node) {
      return {
        type: 'element',
        tagName: 'div',
        properties: { 'data-ce-component': '{' + node.value + '}' },
        children: [],
      };
    },
    mdxTextExpression(state, node) {
      return {
        type: 'element',
        tagName: 'span',
        properties: { 'data-ce-expression': node.value },
        children: [],
      };
    },
  };
  function jsx(state, node) {
    if (!node.name || (/^[A-Z]/.test(node.name) && node.name !== 'Link'))
      return {
        type: 'element',
        tagName: 'div',
        properties: {
          'data-ce-component': body.slice(node.position.start.offset, node.position.end.offset),
        },
        children: [],
      };
    const properties = jsxProperties(node);
    if (node.name === 'Link') {
      properties.href = properties.to;
      delete properties.to;
      properties['data-react-component'] = 'Link';
    }
    let children = state.all(node);
    if (
      [
        'Link',
        'a',
        'p',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'span',
        'strong',
        'em',
        'u',
        'sup',
        'sub',
        'mark',
        'figcaption',
        'summary',
      ].includes(node.name)
    )
      children = children.flatMap((child) =>
        child.type === 'element' && child.tagName === 'p' ? child.children : [child],
      );
    return {
      type: 'element',
      tagName: node.name === 'Link' ? 'a' : node.name,
      properties,
      children,
    };
  }
  function unsafe(node) {
    if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') return true;
    for (const attr of Array.isArray(node.attributes) ? node.attributes : [])
      if (
        attr.type !== 'mdxJsxAttribute' ||
        (attr.value &&
          typeof attr.value === 'object' &&
          !(
            /^useBaseUrl\(['"].*['"]\)$/.test(attr.value.value) ||
            /^['"].*['"]$/.test(attr.value.value) ||
            /^require\((['"]).*\1\)(?:\.default)?$/.test(attr.value.value) ||
            attr.name === 'style'
          ))
      )
        return true;
    return (node.children || []).some(unsafe);
  }

  function unsupportedComponent(node) {
    return (
      !!(
        node.name &&
        /^[A-Z]/.test(node.name) &&
        node.name !== 'Link' &&
        !tabs.is(node, 'tabs') &&
        !tabs.is(node, 'tabItem')
      ) || (node.children || []).some(unsupportedComponent)
    );
  }
  function tabsNode(node) {
    if (tabs.is(node, 'tabs')) return node;
    if (
      node.type === 'paragraph' &&
      node.children.length === 1 &&
      tabs.is(node.children[0], 'tabs')
    )
      return node.children[0];
    return null;
  }
  function elementRange(node) {
    const last = node.attributes?.at(-1)?.position.end.offset ?? node.position.start.offset;
    const openEnd = body.indexOf('>', last) + 1;
    const raw = body.slice(node.position.start.offset, node.position.end.offset);
    const closing = raw.lastIndexOf('</' + node.name);
    const closeStart =
      closing >= 0 ? node.position.start.offset + closing : node.position.end.offset;
    return { openEnd, closeStart };
  }
  function describeNodes(nodes, limit, prefixId) {
    return nodes.map((node, index) => {
      const start = node.position.start.offset,
        end = node.position.end.offset,
        raw = body.slice(start, end);
      const id = prefixId + index,
        tab = tabsNode(node);
      let kind = ['mdxjsEsm', 'definition'].includes(node.type)
        ? 'module'
        : (node.name && /^[A-Z]/.test(node.name)) ||
            node.type === 'mdxFlowExpression' ||
            /Directive$/.test(node.type) ||
            unsafe(node) ||
            unsupportedComponent(node)
          ? 'component'
          : 'content';
      let html = '',
        tabGroup;
      if (tab) {
        const items = tab.children.filter(
          (child) => !(child.type === 'text' && !child.value.trim()),
        );
        const tabProps = require('./tabs.cjs').attributes(tab, body);
        const values = tabProps.find((prop) => prop.name === 'values');
        const staticValues = !values || Array.isArray(values.literal);
        const staticItems = items.every((child) => {
          const props = require('./tabs.cjs').attributes(child, body);
          return (
            !props.some((prop) => prop.kind === 'spread') &&
            props
              .filter((prop) => ['value', 'label'].includes(prop.name))
              .every((prop) => Object.hasOwn(prop, 'literal'))
          );
        });
        if (
          items.length &&
          items.every((child) => tabs.is(child, 'tabItem')) &&
          staticValues &&
          staticItems &&
          !tabProps.some((prop) => prop.kind === 'spread')
        ) {
          const range = elementRange(tab);
          tabGroup = {
            component: tab.name,
            props: require('./tabs.cjs').attributes(tab, body),
            leading: body.slice(range.openEnd, items[0].position.start.offset),
            items: items.map((item, itemIndex) => {
              const r = elementRange(item),
                children = describeNodes(
                  item.children,
                  r.closeStart,
                  id + '/item-' + itemIndex + '/',
                );
              return {
                id: id + '/item-' + itemIndex,
                raw: body.slice(item.position.start.offset, item.position.end.offset),
                gap: body.slice(
                  item.position.end.offset,
                  items[itemIndex + 1]?.position.start.offset ?? range.closeStart,
                ),
                component: item.name,
                props: require('./tabs.cjs').attributes(item, body),
                leading: body.slice(r.openEnd, children[0]?.start ?? r.closeStart),
                children,
              };
            }),
          };
          kind = 'content';
        }
      }
      if (kind === 'content' && !tabGroup) {
        html = toHtml(
          toHast(
            { type: 'root', children: [node, ...definitions.filter((other) => other !== node)] },
            { allowDangerousHtml: true, handlers },
          ),
          { allowDangerousHtml: true },
        );
      }
      return {
        id,
        raw,
        html,
        kind,
        type: node.type,
        start,
        end,
        gap: body.slice(end, nodes[index + 1]?.position.start.offset ?? limit),
        ...(tabGroup ? { tabs: tabGroup } : {}),
        ...(node.type === 'code' ? { fence: { lang: node.lang, meta: node.meta } } : {}),
        ...(tabs.modules.has(node)
          ? { moduleParts: require('./tabs.cjs').moduleParts(node, tabs.modules.get(node)) }
          : {}),
      };
    });
  }
  const blocks = describeNodes(tree.children, body.length, 'block-');

  return {
    prefix,
    metadata,
    body,
    leading: body.slice(0, blocks[0]?.start ?? body.length),
    tabInfo: { names: tabs.names, bindings: tabs.bindings },
    blocks,
  };
}

function pageInfo(project, collection, relative, source) {
  const { within, route } = require('./project.cjs');
  const metadata = split(source).metadata;
  const name = collection.root === '.' ? relative : relative.slice(collection.root.length + 1);
  const logical = name.replace(/\.(?:md|mdx|markdown|jsx?|tsx?)$/, '');
  const clean = collection.numberPrefixParser
    ? logical
        .split('/')
        .map((part) => part.replace(/^\d+[-_.]/, ''))
        .join('/')
    : logical;
  const dirname = path.posix.dirname(clean);
  const id = metadata.id ? (dirname === '.' ? '' : dirname + '/') + metadata.id : clean;
  const slug = metadata.slug;
  let url = route(
    project.baseUrl,
    collection.routeBasePath,
    slug
      ? String(slug).startsWith('/')
        ? slug
        : route(dirname === '.' ? '' : dirname, slug)
      : (collection.type === 'docs' ? id : clean).replace(/(?:^|\/)index$/, ''),
  );
  const known = project.pages.find(
    (page) => page.path === relative && page.collection === collection.id,
  );
  if (known?.url) url = known.url;
  let imageFolder =
    project.mediaRoots.find((root) => root.kind === 'static')?.uploadPath || collection.root;
  const matches = [...source.matchAll(/(?:src=["']|!\[[^\]]*\]\()([^"'\s)]+)/g)];
  for (const match of matches) {
    const asset = resolveMediaReference(project, relative, match[1]);
    if (asset) {
      imageFolder = path.posix.dirname(asset);
      break;
    }
  }
  return {
    path: relative,
    title: metadata.title || known?.title || path.posix.basename(logical),
    id: collection.type === 'docs' ? known?.id || id : null,
    url,
    route: url,
    collection: collection.id,
    type: collection.type,
    version: collection.version,
    locale: collection.locale,
    imageFolder,
    draft: metadata.draft === true,
    kind: /\.[jt]sx?$/.test(name) ? 'jsx' : 'mdx',
  };
}
function resolveMediaReference(project, documentPath, reference) {
  if (!reference || /^(?:https?:|data:|blob:)/.test(reference)) return null;
  const { within, relative } = require('./project.cjs');
  let value;
  try {
    value = decodeURIComponent(reference.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (value.startsWith('/')) {
    const base = project.baseUrl.replace(/\/$/, '');
    if (base && value.startsWith(base + '/')) value = value.slice(base.length);
    for (const root of project.mediaRoots
      .filter((root) => root.kind === 'static')
      .sort((a, b) => b.publicPath.length - a.publicPath.length)) {
      const prefix = root.publicPath.replace(/\/$/, '');
      if (value === prefix || value.startsWith(prefix + '/')) {
        const target = path.posix.join(root.path, value.slice(prefix.length).replace(/^\//, ''));
        if (within(target, root.path)) return target;
      }
    }
  } else if (documentPath) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), value));
    if (project.mediaRoots.some((root) => within(target, root.path))) return target;
  }
  return null;
}
function mediaReference(project, asset, documentPath) {
  const { within, route } = require('./project.cjs');
  const root = project.mediaRoots
    .filter((root) => root.kind === 'static' && within(asset, root.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (root) return route(root.publicPath, path.posix.relative(root.path, asset));
  if (documentPath) {
    const result = path.posix.relative(path.posix.dirname(documentPath), asset);
    return result.startsWith('.') ? result : './' + result;
  }
  return null;
}
async function listPages(siteDir, project) {
  project = project || require('./project.cjs').resolveProject(siteDir);
  const picomatch = require('picomatch'),
    result = [];
  for (const collection of project.collections) {
    const include = picomatch(collection.include, { dot: true }),
      exclude = picomatch(collection.exclude, { dot: true });
    const names = await walk(
      path.join(siteDir, collection.root),
      (name) => /\.(?:md|mdx|markdown|jsx?|tsx?)$/.test(name) && include(name) && !exclude(name),
    );
    for (const name of names) {
      const relative = path.posix.join(collection.root, name),
        source = await fs.readFile(path.join(siteDir, relative), 'utf8');
      if (/\.[jt]sx?$/.test(name) && collection.type !== 'pages') continue;
      result.push(pageInfo(project, collection, relative, source));
    }
  }
  return result;
}
module.exports = {
  tools,
  split,
  describe,
  listPages,
  pageInfo,
  resolveMediaReference,
  mediaReference,
  jsxProperties,
};
