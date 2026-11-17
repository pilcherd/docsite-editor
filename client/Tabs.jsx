import React, { useEffect, useId, useState } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { propValue, setProp, tabValue, tabLabel, defaultTab, changeTab } from './tab-properties.js';

function TabsView({ node, editor, getPos, deleteNode }) {
  const group = node.toJSON(),
    [active, setActive] = useState(() => defaultTab(group)),
    [error, setError] = useState('');
  const key = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const selected = Math.min(active, node.childCount - 1),
    item = group.content[selected];
  useEffect(() => {
    const follow = () => {
      const position = getPos();
      if (typeof position !== 'number') return;
      const anchor = editor.state.selection.from;
      let offset = position + 1;
      node.forEach((child, childOffset, index) => {
        const start = offset + childOffset;
        if (anchor > start && anchor < start + child.nodeSize) setActive(index);
      });
    };
    editor.on('selectionUpdate', follow);
    return () => editor.off('selectionUpdate', follow);
  }, [node, editor, getPos]);
  function replace(next, nextActive = selected) {
    if (!editor.isEditable) return;
    try {
      const position = getPos();
      if (typeof position !== 'number') return;
      editor.view.dispatch(
        editor.state.tr.replaceWith(
          position,
          position + node.nodeSize,
          editor.schema.nodeFromJSON(next),
        ),
      );
      setActive(nextActive);
      setError('');
    } catch (error) {
      setError(error.message);
    }
  }
  function select(index) {
    setActive(index);
    let position = getPos() + 2;
    for (let i = 0; i < index; i++) position += node.child(i).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(position))),
    );
    editor.commands.focus(undefined, { scrollIntoView: false });
  }
  function change(action, value) {
    try {
      replace(
        changeTab(group, selected, action, value),
        action === 'add'
          ? node.childCount
          : action === 'move'
            ? selected + value
            : Math.min(selected, node.childCount - (action === 'remove' ? 2 : 1)),
      );
    } catch (error) {
      setError(error.message);
    }
  }
  const update = (name, value) =>
    replace({
      ...group,
      attrs: { ...group.attrs, props: setProp(group.attrs.props, name, value) },
    });
  const css =
    '[data-ce-tabs-view="' +
    key +
    '"] > .ce-tab-panels > [data-node-view-content-react] > [data-ce-tab-panel]{display:none;}' +
    '[data-ce-tabs-view="' +
    key +
    '"] > .ce-tab-panels > [data-node-view-content-react] > [data-ce-tab-panel]:nth-child(' +
    (selected + 1) +
    '){display:block;}';
  return (
    <NodeViewWrapper className="ce-visual-tabs" data-ce-tabs-view={key}>
      <style contentEditable={false}>{css}</style>
      <div className="ce-tab-controls" contentEditable={false}>
        <div
          role="tablist"
          aria-label={propValue(group.attrs.props, 'aria-label', 'Documentation tabs')}
          className="ce-tab-strip"
        >
          {group.content.map((item, index) => (
            <button
              type="button"
              role="tab"
              key={index}
              aria-selected={index === selected}
              aria-controls={key + '-panel-' + index}
              id={key + '-tab-' + index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(index)}
            >
              {tabLabel(group, item, index)}
            </button>
          ))}
          <button
            type="button"
            aria-label="Add tab"
            disabled={!editor.isEditable}
            onClick={() => change('add')}
          >
            ＋
          </button>
        </div>
        <details className="ce-tab-settings">
          <summary>Tab settings</summary>
          <div className="ce-tab-fields">
            <label>
              Tab label
              <input
                aria-label="Tab label"
                value={tabLabel(group, item, selected)}
                disabled={!editor.isEditable}
                onChange={(event) => change('label', event.target.value)}
              />
            </label>
            <label>
              Tab value
              <input
                aria-label="Tab value"
                key={selected}
                defaultValue={tabValue(item, selected)}
                disabled={!editor.isEditable}
                onBlur={(event) => {
                  if (event.target.value !== tabValue(item, selected))
                    change('value', event.target.value);
                }}
              />
            </label>
            <label>
              Default tab
              <select
                aria-label="Default tab"
                value={
                  propValue(group.attrs.props, 'defaultValue', undefined) === null
                    ? '__none'
                    : propValue(group.attrs.props, 'defaultValue', '__first')
                }
                disabled={!editor.isEditable}
                onChange={(event) =>
                  update(
                    'defaultValue',
                    event.target.value === '__first'
                      ? undefined
                      : event.target.value === '__none'
                        ? null
                        : event.target.value,
                  )
                }
              >
                <option value="__first">First/default marked tab</option>
                <option value="__none">No default selection</option>
                {group.content.map((item, index) => (
                  <option key={index} value={tabValue(item, index)}>
                    {tabLabel(group, item, index)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sync group
              <input
                aria-label="Tab sync group"
                value={propValue(group.attrs.props, 'groupId', '')}
                disabled={!editor.isEditable}
                onChange={(event) => update('groupId', event.target.value || undefined)}
              />
            </label>
            <label>
              Accessible label
              <input
                aria-label="Tab group accessible label"
                value={propValue(group.attrs.props, 'aria-label', '')}
                disabled={!editor.isEditable}
                onChange={(event) => update('aria-label', event.target.value || undefined)}
              />
            </label>
            <label className="ce-tab-check">
              <input
                type="checkbox"
                aria-label="Lazy tab rendering"
                checked={propValue(group.attrs.props, 'lazy', false) === true}
                disabled={!editor.isEditable}
                onChange={(event) => update('lazy', event.target.checked ? true : undefined)}
              />
              Render only the selected tab on the site
            </label>
          </div>
          <div className="ce-tab-actions">
            <button
              type="button"
              disabled={!editor.isEditable || selected === 0}
              onClick={() => change('move', -1)}
            >
              Move tab left
            </button>
            <button
              type="button"
              disabled={!editor.isEditable || selected === node.childCount - 1}
              onClick={() => change('move', 1)}
            >
              Move tab right
            </button>
            <button
              type="button"
              disabled={!editor.isEditable || node.childCount < 2}
              onClick={() => change('remove')}
            >
              Remove tab
            </button>
            <button type="button" disabled={!editor.isEditable} onClick={deleteNode}>
              Remove tab group
            </button>
          </div>
          <p className="ce-muted">
            Unchanged MDX, component props and code-block options are preserved. Use Markup for
            dynamic expressions.
          </p>
        </details>
        {error && (
          <p className="ce-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <NodeViewContent className="ce-tab-panels" />
    </NodeViewWrapper>
  );
}
const metadata = () => ({
  component: { default: 'Tabs' },
  props: { default: [] },
  leading: { default: '\n\n' },
});
export const Tabs = Node.create({
  name: 'tabs',
  group: 'block',
  content: 'tabItem+',
  isolating: true,
  defining: true,
  addAttributes: metadata,
  parseHTML() {
    return [
      {
        tag: 'div[data-ce-tabs-meta]',
        priority: 1000,
        getAttrs: (element) => JSON.parse(element.getAttribute('data-ce-tabs-meta')),
      },
    ];
  },
  renderHTML({ node }) {
    return ['div', { 'data-ce-tabs-meta': JSON.stringify(node.attrs) }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },
});
export const TabItem = Node.create({
  name: 'tabItem',
  content: 'block+',
  isolating: true,
  defining: true,
  addAttributes() {
    return { ...metadata(), component: { default: 'TabItem' } };
  },
  parseHTML() {
    return [
      {
        tag: 'section[data-ce-tab-meta]',
        priority: 1000,
        getAttrs: (element) => JSON.parse(element.getAttribute('data-ce-tab-meta')),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'section',
      { 'data-ce-tab-panel': '', 'data-ce-tab-meta': JSON.stringify(node.attrs) },
      0,
    ];
  },
});
export const ManagedImport = Node.create({
  name: 'managedImport',
  group: 'block',
  atom: true,
  selectable: false,
  addAttributes() {
    return { raw: { default: '' }, bindings: { default: [] } };
  },
  renderHTML({ node }) {
    return ['div', { 'data-ce-managed-import': JSON.stringify(node.attrs), hidden: true }];
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-ce-managed-import]',
        priority: 1000,
        getAttrs: (element) => JSON.parse(element.getAttribute('data-ce-managed-import')),
      },
    ];
  },
});
