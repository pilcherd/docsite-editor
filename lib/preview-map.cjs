// Preview-only source markers. These never enter the source checkout or saved editor model.
function annotateMarkdown(prefixLength = 0) {
  return () => (tree) => {
    function mark(node, group = false) {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return;
      const attrs = {
        'data-ce-start': String(start + prefixLength),
        'data-ce-end': String(end + prefixLength),
      };
      if (group) {
        attrs['data-ce-group-start'] = attrs['data-ce-start'];
        attrs['data-ce-group-end'] = attrs['data-ce-end'];
      }
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        node.attributes ??= [];
        for (const [name, value] of Object.entries(attrs)) {
          node.attributes = node.attributes.filter((a) => a.name !== name);
          node.attributes.push({ type: 'mdxJsxAttribute', name, value });
        }
      } else if (
        ![
          'text',
          'inlineCode',
          'break',
          'mdxTextExpression',
          'mdxFlowExpression',
          'mdxjsEsm',
          'definition',
        ].includes(node.type)
      ) {
        node.data ??= {};
        node.data.hProperties = { ...node.data.hProperties, ...attrs };
      }
      node.children?.forEach((child) => mark(child));
    }
    tree.children = tree.children.map((node) => {
      if (['mdxjsEsm', 'definition'].includes(node.type)) return node;
      // Custom components need not forward HTML attributes, so map their entire rendered result.
      if (
        (node.type === 'mdxJsxFlowElement' && (!node.name || /^[A-Z]/.test(node.name))) ||
        node.type === 'mdxFlowExpression'
      ) {
        const wrapper = {
          type: 'mdxJsxFlowElement',
          name: 'div',
          attributes: [{ type: 'mdxJsxAttribute', name: 'className', value: 'ce-preview-block' }],
          children: [node],
          position: node.position,
        };
        mark(wrapper, true);
        return wrapper;
      }
      mark(node, true);
      return node;
    });
  };
}
function annotateJsx(source, range) {
  const ast = require('@babel/parser').parse(source, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
    }),
    edits = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement' && node.start >= range.start && node.end <= range.end) {
      const opening = node.openingElement,
        name = opening.name.name;
      // Do not inject props into imported components; map their nearest intrinsic ancestor.
      if (typeof name === 'string' && /^[a-z]/.test(name)) {
        const start = node.start - range.start,
          end = node.end - range.start;
        const group =
          node.start === range.start
            ? ' data-ce-group-start="' + start + '" data-ce-group-end="' + end + '"'
            : '';
        edits.push({
          at: opening.end - (opening.selfClosing ? 2 : 1),
          text: ' data-ce-start="' + start + '" data-ce-end="' + end + '"' + group,
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'comments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.at - a.at))
    source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
  return source;
}
module.exports = { annotateMarkdown, annotateJsx };
