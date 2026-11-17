const parser = require('@babel/parser');
const { EditorError } = require('./paths.cjs');
function componentFields(source) {
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch {
    return [];
  }
  const fields = [];
  function visit(node, context = '', parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration') return;
    if (node.type === 'JSXElement') context = node.openingElement.name.name || context;
    if (node.type === 'JSXText' && node.value.trim())
      fields.push({
        key: 'text-' + node.start,
        label: (context || 'Component') + ' text',
        value: node.value.trim(),
        start: node.start,
        end: node.end,
        kind: 'jsxText',
        original: node.value,
      });
    else if (node.type === 'JSXAttribute' && node.value?.type === 'StringLiteral')
      fields.push({
        key: 'attribute-' + node.start,
        label: context + ' ' + node.name.name,
        value: node.value.value,
        start: node.value.start,
        end: node.value.end,
        kind: 'string',
      });
    else if (node.type === 'StringLiteral' && parent?.type !== 'JSXAttribute')
      fields.push({
        key: 'value-' + node.start,
        label:
          parent?.type === 'CallExpression'
            ? (parent.callee?.name || 'Component') + ' value'
            : 'Component value',
        value: node.value,
        start: node.start,
        end: node.end,
        kind: 'string',
      });
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, context, node));
      else if (value && typeof value === 'object') visit(value, context, node);
    }
  }
  visit(ast);
  return fields;
}
function updateComponent(source, key, value) {
  if (typeof value !== 'string') throw new EditorError(400, 'Enter a text value.');
  const field = componentFields(source).find((field) => field.key === key);
  if (!field) throw new EditorError(400, 'Reload the component properties before editing.');
  let next;
  if (field.kind === 'jsxText') {
    const safe = value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('{', '&#123;')
      .replaceAll('}', '&#125;');
    next =
      (field.original.match(/^\s*/)?.[0] || '') + safe + (field.original.match(/\s*$/)?.[0] || '');
  } else next = JSON.stringify(value);
  return source.slice(0, field.start) + next + source.slice(field.end);
}
module.exports = { componentFields, updateComponent };
