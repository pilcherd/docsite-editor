import { NodeSelection } from '@tiptap/pm/state';
export function imageAttributes(node) {
  return node.type.name === 'figure'
    ? { ...node.attrs.image }
    : { ...node.attrs.extra, src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title };
}
export function styleMap(value) {
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
        String(value),
      ]),
    );
  const element = document.createElement('span');
  element.style.cssText = value || '';
  return Object.fromEntries(
    Array.from(element.style).map((key) => [key, element.style.getPropertyValue(key).trim()]),
  );
}
export function styleText(styles) {
  return Object.entries(styles)
    .map(([key, value]) => key + ': ' + value)
    .join('; ');
}
export function dimensionsOf(attrs) {
  const styles = styleMap(attrs.style),
    width = styles.width ?? attrs.width ?? '',
    height = styles.height ?? attrs.height ?? '';
  const parse = (value) => {
    const match = String(value).match(/^(\d+(?:\.\d+)?)(px|%)?$/);
    return match ? { value: match[1], unit: match[2] || 'px' } : { value: '', unit: 'px' };
  };
  return { width: parse(width), height: parse(height), keep: !height || height === 'auto' };
}
export function resizeImage(attrs, dimension, value, unit = 'px', keep = true) {
  const result = { ...attrs },
    styles = styleMap(attrs.style),
    number = Number(value);
  if (value !== '' && (!Number.isFinite(number) || number <= 0)) return attrs;
  if (dimension === 'width') {
    if (value === '') delete styles.width;
    else styles.width = number + unit;
    delete result.width;
  }
  if (dimension === 'height') {
    if (value === '') delete styles.height;
    else styles.height = number + 'px';
    delete result.height;
  }
  if (keep) {
    styles.height = 'auto';
    delete result.height;
  }
  styles['max-width'] = '100%';
  result.style = styleText(styles);
  return result;
}
export function resetImageSize(attrs) {
  const result = { ...attrs },
    styles = styleMap(attrs.style);
  delete styles.width;
  delete styles.height;
  delete styles['max-width'];
  delete result.width;
  delete result.height;
  result.style = styleText(styles);
  return result;
}
export function mergeImageSize(attrs, size) {
  const result = { ...attrs };
  for (const key of ['style', 'width', 'height'])
    if (Object.hasOwn(size, key)) {
      if (size[key] === null || size[key] === undefined || size[key] === '') delete result[key];
      else result[key] = size[key];
    }
  return result;
}
export function sizeOnly(attrs) {
  return { style: attrs.style || '', width: attrs.width ?? null, height: attrs.height ?? null };
}
export function displayImageProps(attrs) {
  const result = { ...attrs },
    styles = styleMap(result.style);
  result.style = Object.fromEntries(
    Object.entries(styles).map(([key, value]) => [
      key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
      value,
    ]),
  );
  if (result.class) {
    result.className = result.class;
    delete result.class;
  }
  for (const key of Object.keys(result))
    if (/^on/i.test(key) || ['extra', 'sourceId'].includes(key)) delete result[key];
  return result;
}

export function setImageAttributes(editor, position, value) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || !['figure', 'image'].includes(node.type.name)) return false;
  const attrs =
    node.type.name === 'figure'
      ? { ...node.attrs, image: value }
      : { ...node.attrs, extra: value, src: value.src, alt: value.alt, title: value.title };
  const transaction = editor.state.tr.setNodeMarkup(position, undefined, attrs);
  transaction.setSelection(NodeSelection.create(transaction.doc, position));
  editor.view.dispatch(transaction);
  return true;
}
