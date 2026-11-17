const markerSelector = '[data-ce-start][data-ce-end]';
function elementFor(node) {
  return node?.nodeType === 1 ? node : node?.parentElement;
}
function textOffset(element, node, offset) {
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}
function point(node, offset, target) {
  const element = elementFor(node) || elementFor(target),
    marker = element?.closest(markerSelector) || elementFor(target)?.closest(markerSelector);
  if (!marker) return null;
  const group = marker.closest('[data-ce-group-start]') || marker;
  const inside = node && group.contains(node);
  return {
    start: Number(marker.getAttribute('data-ce-start')),
    end: Number(marker.getAttribute('data-ce-end')),
    groupStart: Number(
      group.getAttribute('data-ce-group-start') ?? group.getAttribute('data-ce-start'),
    ),
    groupEnd: Number(group.getAttribute('data-ce-group-end') ?? group.getAttribute('data-ce-end')),
    text: group.textContent || '',
    offset: inside ? textOffset(group, node, offset) : 0,
    elementText: marker.textContent || '',
    elementOffset: node && marker.contains(node) ? textOffset(marker, node, offset) : 0,
  };
}
export function installPreviewBridge(
  root,
  getRenderId,
  send = (message) => parent.postMessage(message, '*'),
) {
  function select(event) {
    if (event.target?.closest('button,input,textarea,select,[contenteditable="true"]')) return;
    const selection = window.getSelection(),
      range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const contains =
      event.target?.tagName !== 'IMG' &&
      range &&
      root.contains(range.startContainer) &&
      root.contains(range.endContainer);
    const start = contains
      ? point(range.startContainer, range.startOffset, event.target)
      : point(null, 0, event.target);
    const end = contains ? point(range.endContainer, range.endOffset, event.target) : start;
    if (!start || !end) return;
    send({
      type: 'preview-select',
      renderId: getRenderId(),
      anchor: start,
      head: end,
      collapsed: !contains || selection.isCollapsed,
      image: event.target?.tagName === 'IMG',
    });
  }
  const click = (event) => {
    if (event.target?.closest('a')) event.preventDefault();
  };
  const keyup = (event) => {
    if (
      event.shiftKey ||
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    )
      select(event);
  };
  root.addEventListener('mouseup', select);
  root.addEventListener('click', click);
  root.addEventListener('keyup', keyup);
  return () => {
    root.removeEventListener('mouseup', select);
    root.removeEventListener('click', click);
    root.removeEventListener('keyup', keyup);
  };
}
