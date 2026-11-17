import React from 'react';
import { Button } from './ui.jsx';
export default function Toolbar({ editor, onMedia, onLink, onTabs }) {
  const action = (name, label, run, active) => (
    <Button key={name} title={label} aria-label={label} active={active} onClick={run}>
      {name}
    </Button>
  );
  const command =
    (name, ...args) =>
    () =>
      editor
        .chain()
        .focus()
        [name](...args)
        .run();
  return (
    <div className="ce-toolbar" role="toolbar" aria-label="Page formatting">
      {action('↶', 'Undo', command('undo'))}
      {action('↷', 'Redo', command('redo'))}
      <select
        aria-label="Text style"
        value={
          editor.isActive('heading') ? 'h' + editor.getAttributes('heading').level : 'paragraph'
        }
        onChange={(e) =>
          (e.target.value === 'paragraph'
            ? command('setParagraph')
            : command('toggleHeading', { level: Number(e.target.value.slice(1)) }))()
        }
      >
        <option value="paragraph">Normal text</option>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <option key={n} value={'h' + n}>
            Heading {n}
          </option>
        ))}
      </select>
      {action('B', 'Bold', command('toggleBold'), editor.isActive('bold'))}
      {action('I', 'Italic', command('toggleItalic'), editor.isActive('italic'))}
      {action('U', 'Underline', command('toggleUnderline'), editor.isActive('underline'))}
      {action('S̶', 'Strikethrough', command('toggleStrike'), editor.isActive('strike'))}
      {action('x₂', 'Subscript', command('toggleSubscript'))}
      {action('x²', 'Superscript', command('toggleSuperscript'))}
      <label title="Text color">
        A
        <input
          aria-label="Text color"
          type="color"
          onInput={(e) => command('setColor', e.target.value)()}
        />
      </label>
      {action('▰', 'Highlight', command('toggleHighlight', { color: '#fff2a8' }))}
      <select
        aria-label="Font size"
        defaultValue=""
        onChange={(e) =>
          (e.target.value ? command('setFontSize', e.target.value) : command('unsetFontSize'))()
        }
      >
        <option value="">Site size</option>
        {['14px', '16px', '18px', '20px', '24px', '32px'].map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
      {action('• List', 'Bullet list', command('toggleBulletList'), editor.isActive('bulletList'))}
      {action(
        '1. List',
        'Numbered list',
        command('toggleOrderedList'),
        editor.isActive('orderedList'),
      )}
      {action('“', 'Quotation', command('toggleBlockquote'))}
      {action('</>', 'Code block', command('toggleCodeBlock'))}
      {action('Link', 'Edit link', onLink)}
      {action('Image', 'Insert image', onMedia)}
      {action('Tabs', 'Insert tab group', onTabs)}
      {action(
        'Table',
        'Insert table',
        command('insertTable', { rows: 3, cols: 3, withHeaderRow: true }),
      )}
      <select
        aria-label="Text alignment"
        defaultValue="left"
        onChange={(e) => command('setTextAlign', e.target.value)()}
      >
        <option value="left">Align left</option>
        <option value="center">Center</option>
        <option value="right">Align right</option>
        <option value="justify">Justify</option>
      </select>
      {action('Clear', 'Clear formatting', () =>
        editor.chain().focus().unsetAllMarks().clearNodes().run(),
      )}
      {editor.isActive('table') && (
        <div className="ce-table-tools">
          {action('+ Row', 'Add table row', command('addRowAfter'))}
          {action('+ Column', 'Add table column', command('addColumnAfter'))}
          {action('− Row', 'Delete table row', command('deleteRow'))}
          {action('− Column', 'Delete table column', command('deleteColumn'))}
          {action('Merge / split', 'Merge or split cells', command('mergeOrSplit'))}
          {action('Header', 'Toggle header row', command('toggleHeaderRow'))}
        </div>
      )}
    </div>
  );
}
