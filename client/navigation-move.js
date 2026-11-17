export function navigationItems(value, sidebar, parts = []) {
  let items = value[sidebar];
  if (!Array.isArray(items)) throw new Error('Choose an existing sidebar.');
  for (const index of parts) {
    if (!Number.isInteger(index) || index < 0 || items[index]?.type !== 'category')
      throw new Error('Choose an existing section.');
    items = items[index].items;
    if (!Array.isArray(items)) throw new Error('This section has no editable items.');
  }
  return items;
}
export function moveNavigationItem(value, source, target) {
  if (
    !source?.parts?.length ||
    !Array.isArray(target?.parts) ||
    !['before', 'after', 'inside'].includes(target.where)
  )
    throw new Error('Choose a page or section to move.');
  const next = structuredClone(value),
    sourceParent = navigationItems(next, source.sidebar, source.parts.slice(0, -1)),
    from = source.parts.at(-1),
    moving = sourceParent[from];
  if (!Number.isInteger(from) || from < 0 || moving === undefined)
    throw new Error('The dragged item changed. Select it and try again.');
  if (
    source.sidebar === target.sidebar &&
    source.parts.length === target.parts.length &&
    source.parts.every((part, i) => part === target.parts[i])
  ) {
    if (target.where === 'inside') throw new Error('A section cannot contain itself.');
    return next;
  }
  const parentParts = target.where === 'inside' ? target.parts : target.parts.slice(0, -1);
  if (
    source.sidebar === target.sidebar &&
    parentParts.length >= source.parts.length &&
    source.parts.every((part, i) => part === parentParts[i])
  )
    throw new Error('A section cannot be moved into itself or one of its children.');
  const destination = navigationItems(next, target.sidebar, parentParts);
  const targetIndex = target.parts.at(-1);
  if (
    target.where !== 'inside' &&
    (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= destination.length)
  )
    throw new Error('Choose an existing drop position.');
  let index =
    target.where === 'inside'
      ? destination.length
      : targetIndex + (target.where === 'after' ? 1 : 0);
  if (!Number.isInteger(index) || index < 0 || index > destination.length)
    throw new Error('Choose an existing drop position.');
  if (sourceParent === destination && from < index) index--;
  sourceParent.splice(from, 1);
  destination.splice(index, 0, moving);
  return next;
}
