const parser = require('@babel/parser');
const { EditorError } = require('./paths.cjs');
function mainRange(source, preferred = 'main') {
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] }),
    matches = [],
    returns = [];
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement' && node.openingElement.name.name === preferred)
      matches.push(node);
    if (
      node.type === 'ReturnStatement' &&
      ['JSXElement', 'JSXFragment'].includes(node.argument?.type)
    )
      returns.push(node.argument);
    if (
      node.type === 'ArrowFunctionExpression' &&
      ['JSXElement', 'JSXFragment'].includes(node.body?.type)
    )
      returns.push(node.body);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'tokens', 'comments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  }
  visit(ast);
  const selected =
    matches.length === 1
      ? matches[0]
      : returns.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (!selected)
    throw new EditorError(
      400,
      'This React page has no inline JSX content. Its source is editable; use a page adapter for a custom visual model.',
    );
  return { start: selected.start, end: selected.end };
}
module.exports = { mainRange };
