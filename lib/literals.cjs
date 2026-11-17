const parser = require('@babel/parser');
const { EditorError } = require('./paths.cjs');
const unwrap = (node) => {
  while (
    node &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TypeCastExpression',
    ].includes(node.type)
  )
    node = node.expression;
  return node;
};
function exportedObject(source) {
  const ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const bindings = new Map();
  for (const statement of ast.program.body) {
    const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (node?.type === 'VariableDeclaration')
      for (const entry of node.declarations)
        if (entry.id.type === 'Identifier') bindings.set(entry.id.name, entry.init);
    if (node?.type === 'FunctionDeclaration' && node.id) bindings.set(node.id.name, node);
  }
  function resolve(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return null;
    if (node.type === 'ObjectExpression') return node;
    if (node.type === 'Identifier' && !seen.has(node.name)) {
      seen.add(node.name);
      return resolve(bindings.get(node.name), seen);
    }
    if (node.type === 'CallExpression' && node.arguments.length === 1)
      return resolve(node.arguments[0], seen);
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      if (node.body.type !== 'BlockStatement') return resolve(node.body, seen);
      const returns = node.body.body.filter((item) => item.type === 'ReturnStatement');
      if (returns.length === 1) return resolve(returns[0].argument, seen);
    }
    return null;
  }
  for (const statement of ast.program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const object = resolve(statement.declaration);
      if (object) return object;
    }
    if (
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'AssignmentExpression'
    ) {
      const left = statement.expression.left;
      if (
        left.type === 'MemberExpression' &&
        ((left.object.name === 'module' && left.property.name === 'exports') ||
          (left.object.name === 'exports' && left.property.name === 'default'))
      ) {
        const object = resolve(statement.expression.right);
        if (object) return object;
      }
    }
  }
  // A conventional binding is accepted for compatibility with callers editing an excerpt.
  for (const name of ['config', 'sidebars'])
    if (bindings.has(name)) {
      const object = resolve(bindings.get(name));
      if (object) return object;
    }
  throw new EditorError(
    400,
    'This module has no unambiguous exported object. Its dynamic code is preserved; edit its source or use a project adapter.',
  );
}
module.exports = { exportedObject, unwrap };
