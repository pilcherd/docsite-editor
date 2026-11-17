export function propValue(props, name, fallback) {
  const prop = (props || []).findLast((prop) => prop.name === name);
  return prop && Object.hasOwn(prop, 'literal') ? prop.literal : fallback;
}
export function setProp(props, name, value) {
  const next = (props || []).filter((prop) => prop.name !== name);
  if (value !== undefined)
    next.push({
      name,
      kind: typeof value === 'string' ? 'string' : value === true ? 'boolean' : 'expression',
      value: typeof value === 'string' ? value : JSON.stringify(value),
      literal: value,
    });
  return next;
}
export function tabValue(item, index) {
  return propValue(item.attrs.props, 'value', 'tab-' + (index + 1));
}
export function tabLabel(group, item, index) {
  const value = tabValue(item, index),
    values = propValue(group.attrs.props, 'values', []);
  return String(
    values.find?.((entry) => entry.value === value)?.label ??
      propValue(item.attrs.props, 'label', value),
  );
}
export function defaultTab(group) {
  const value = propValue(group.attrs.props, 'defaultValue', undefined);
  const index = group.content.findIndex((item, i) =>
    value !== undefined
      ? tabValue(item, i) === value
      : propValue(item.attrs.props, 'default', false),
  );
  return Math.max(0, index);
}
export function createTabGroup(names = { tabs: 'Tabs', tabItem: 'TabItem' }) {
  return {
    type: 'tabs',
    attrs: { component: names.tabs, props: [], leading: '\n\n' },
    content: [0, 1].map((i) => ({
      type: 'tabItem',
      attrs: {
        component: names.tabItem,
        props: setProp(setProp([], 'value', 'tab-' + (i + 1)), 'label', 'Tab ' + (i + 1)),
        leading: '\n\n',
      },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Write tab content here.' }] },
      ],
    })),
  };
}
export function changeTab(group, index, action, value) {
  const next = structuredClone(group),
    items = next.content,
    item = items[index],
    old = tabValue(item, index);
  const values = propValue(next.attrs.props, 'values', undefined);
  const updateValues = (fn) => {
    if (Array.isArray(values)) next.attrs.props = setProp(next.attrs.props, 'values', fn(values));
  };
  if (action === 'label') {
    item.attrs.props = setProp(item.attrs.props, 'label', value);
    updateValues((values) =>
      values.map((entry) => (entry.value === old ? { ...entry, label: value } : entry)),
    );
  } else if (action === 'value') {
    if (!value.trim() || items.some((other, i) => i !== index && tabValue(other, i) === value))
      throw new Error('Give each tab a unique, nonempty value.');
    item.attrs.props = setProp(item.attrs.props, 'value', value);
    updateValues((values) =>
      values.map((entry) => (entry.value === old ? { ...entry, value } : entry)),
    );
    if (propValue(next.attrs.props, 'defaultValue') === old)
      next.attrs.props = setProp(next.attrs.props, 'defaultValue', value);
  } else if (action === 'remove') {
    if (items.length < 2) throw new Error('Keep at least one tab, or delete the whole group.');
    items.splice(index, 1);
    updateValues((values) => values.filter((entry) => entry.value !== old));
    if (propValue(next.attrs.props, 'defaultValue') === old)
      next.attrs.props = setProp(
        next.attrs.props,
        'defaultValue',
        tabValue(items[Math.min(index, items.length - 1)], Math.min(index, items.length - 1)),
      );
  } else if (action === 'move') {
    const to = index + value;
    if (to < 0 || to >= items.length) return next;
    items.splice(index, 1);
    items.splice(to, 0, item);
    updateValues((values) =>
      items.map((entry, i) => values.find((v) => v.value === tabValue(entry, i))).filter(Boolean),
    );
  } else if (action === 'add') {
    let number = items.length + 1;
    while (items.some((entry, i) => tabValue(entry, i) === 'tab-' + number)) number++;
    const added = createTabGroup({ tabs: group.attrs.component, tabItem: items[0].attrs.component })
      .content[0];
    added.attrs.props = setProp(setProp([], 'value', 'tab-' + number), 'label', 'Tab ' + number);
    items.push(added);
    updateValues((values) => [...values, { value: 'tab-' + number, label: 'Tab ' + number }]);
  }
  return next;
}
