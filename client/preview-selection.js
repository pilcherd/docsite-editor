import { exportVisual } from './document.js';
export const compactText = (value) => String(value || '').replace(/[\s\u200b\ufeff]/g, '');
function editorText(editor, segment) {
  let text = '';
  const positions = [],
    atoms = [];
  editor.state.doc.nodesBetween(segment.from, segment.to, (node, pos) => {
    if (['sourceBlock', 'figure', 'image'].includes(node.type.name)) atoms.push({ node, pos });
    if (node.isText)
      for (let i = 0; i < node.text.length; i++)
        if (compactText(node.text[i])) {
          text += node.text[i];
          positions.push(pos + i);
        }
  });
  return { text, positions, atoms };
}
function matchOffset(text, needle, expected) {
  if (!needle) return -1;
  const matches = [];
  let offset = text.indexOf(needle);
  while (offset >= 0) {
    matches.push(offset);
    offset = text.indexOf(needle, offset + 1);
  }
  return matches.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))[0] ?? -1;
}
export function mapPreviewSelection(editor, model, kind, source, message) {
  if (!editor || !model || !message?.anchor || !message.head) return null;
  const exported = exportVisual(editor, model, kind, { withMap: true });
  if (exported.source.trimEnd() !== source.trimEnd()) return null;
  function map(point, ending) {
    if (
      !Number.isInteger(point.start) ||
      !Number.isInteger(point.end) ||
      point.start < 0 ||
      point.end > source.length ||
      point.start > point.end
    )
      return null;
    const segment = exported.ranges.find(
      (range) => point.groupStart >= range.start && point.groupStart < range.end,
    );
    if (!segment) return null;
    const indexed = editorText(editor, segment),
      raw = source.slice(point.groupStart, point.groupEnd).trim();
    const atom = indexed.atoms.find(
      (item) => item.node.type.name === 'sourceBlock' && item.node.attrs.raw.trim() === raw,
    );
    if (atom) return { position: atom.pos, node: atom };
    if (message.image) {
      const image = indexed.atoms.find((item) => ['figure', 'image'].includes(item.node.type.name));
      if (image) return { position: image.pos, node: image };
    }
    const expected = Math.max(
      0,
      ((point.groupStart - segment.start) / Math.max(1, segment.end - segment.start)) *
        indexed.text.length,
    );
    let needle = compactText(point.text),
      offset = Math.max(0, Math.min(Number(point.offset) || 0, String(point.text || '').length));
    let start = matchOffset(indexed.text, needle, expected);
    if (start < 0) {
      needle = compactText(point.elementText);
      offset = Math.max(
        0,
        Math.min(Number(point.elementOffset) || 0, String(point.elementText || '').length),
      );
      start = matchOffset(indexed.text, needle, expected);
      if (start < 0) return null;
      offset = compactText(String(point.elementText || '').slice(0, offset)).length;
    } else offset = compactText(String(point.text || '').slice(0, offset)).length;
    const index = Math.min(indexed.positions.length, start + offset);
    const position =
      ending && index > 0
        ? indexed.positions[index - 1] + 1
        : (indexed.positions[index] ?? indexed.positions.at(-1) + 1);
    return Number.isFinite(position) ? { position } : null;
  }
  const anchor = map(message.anchor, false),
    head = map(message.head, !message.collapsed);
  if (!anchor || !head) return null;
  if (anchor.node)
    return { from: anchor.node.pos, to: anchor.node.pos + anchor.node.node.nodeSize, node: true };
  return {
    from: Math.min(anchor.position, head.position),
    to: Math.max(anchor.position, head.position),
    node: false,
  };
}
