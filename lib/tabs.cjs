const babel = require('@babel/parser');

function literal(node) {
  if (!node) return undefined;
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'ArrayExpression') {
    const values = node.elements.map(literal);
    return values.some((value) => value === undefined) ? undefined : values;
  }
  if (node.type === 'ObjectExpression') {
    const result = {};
    for (const item of node.properties) {
      if (item.type !== 'ObjectProperty' || item.computed || item.method) return undefined;
      const value = literal(item.value),
        name = item.key.name ?? item.key.value;
      if (value === undefined || ['__proto__', 'constructor', 'prototype'].includes(name))
        return undefined;
      result[name] = value;
    }
    return result;
  }
  return undefined;
}
function tabContext(tree) {
  const bindings = [],
    modules = new Map(),
    reserved = new Set();
  for (const node of tree.children.filter((node) => node.type === 'mdxjsEsm')) {
    let ast;
    try {
      ast = babel.parse(node.value, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch {
      continue;
    }
    const declarations = [];
    for (const statement of ast.program.body) {
      const declaration = statement.declaration || statement;
      if (declaration.type === 'ImportDeclaration') {
        for (const specifier of declaration.specifiers) reserved.add(specifier.local.name);
        const kind = { '@theme/Tabs': 'tabs', '@theme/TabItem': 'tabItem' }[
          declaration.source.value
        ];
        if (
          kind &&
          declaration.specifiers.length === 1 &&
          declaration.specifiers[0].type === 'ImportDefaultSpecifier'
        ) {
          const binding = { kind, name: declaration.specifiers[0].local.name };
          bindings.push(binding);
          declarations.push({ start: statement.start, end: statement.end, binding });
        }
      }
      if (declaration.id?.name) reserved.add(declaration.id.name);
      for (const item of declaration.declarations || [])
        if (item.id?.name) reserved.add(item.id.name);
    }
    if (declarations.length) modules.set(node, declarations);
  }
  function free(name) {
    if (!reserved.has(name)) {
      reserved.add(name);
      return name;
    }
    let next = 'SiteEditor' + name,
      index = 2;
    while (reserved.has(next)) next = 'SiteEditor' + name + index++;
    reserved.add(next);
    return next;
  }
  const names = {
    tabs: bindings.find((item) => item.kind === 'tabs')?.name || free('Tabs'),
    tabItem: bindings.find((item) => item.kind === 'tabItem')?.name || free('TabItem'),
  };
  return {
    bindings,
    names,
    modules,
    is: (node, kind) => bindings.some((item) => item.kind === kind && item.name === node.name),
  };
}
function attributes(node, body) {
  return (node.attributes || []).map((attr) => {
    const raw = body.slice(attr.position.start.offset, attr.position.end.offset);
    if (attr.type !== 'mdxJsxAttribute') return { kind: 'spread', raw };
    if (attr.value === null) return { name: attr.name, kind: 'boolean', literal: true, raw };
    if (typeof attr.value === 'string')
      return { name: attr.name, kind: 'string', value: attr.value, literal: attr.value, raw };
    let value;
    try {
      value = literal(babel.parseExpression(attr.value.value, { plugins: ['jsx', 'typescript'] }));
    } catch {}
    return { name: attr.name, kind: 'expression', value: attr.value.value, literal: value, raw };
  });
}
function moduleParts(node, declarations) {
  const parts = [];
  let offset = 0;
  for (const declaration of declarations) {
    if (declaration.start > offset)
      parts.push({ kind: 'module', raw: node.value.slice(offset, declaration.start) });
    parts.push({
      kind: 'managedImport',
      raw: node.value.slice(declaration.start, declaration.end),
      bindings: [declaration.binding],
    });
    offset = declaration.end;
  }
  if (offset < node.value.length) parts.push({ kind: 'module', raw: node.value.slice(offset) });
  // Whitespace must survive export, but should not create visible source boxes.
  for (const part of parts) if (!part.raw.trim()) part.kind = 'managedImport';
  return parts;
}
module.exports = { tabContext, attributes, moduleParts };
