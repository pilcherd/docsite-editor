import React from 'react';
import { Tabs, TabItem, ManagedImport } from './Tabs.jsx';
import { displayImageProps, imageAttributes } from './image-size.js';
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
const attrsOf = (element) =>
  Object.fromEntries(
    [...element.attributes]
      .filter((a) => !a.name.startsWith('data-ce-'))
      .map((a) => [a.name, a.value]),
  );
const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'inline*',
  draggable: true,
  addAttributes() {
    return {
      image: {
        default: {},
        parseHTML: (element) => attrsOf(element.querySelector('img') || element),
      },
      figure: { default: {}, parseHTML: attrsOf },
      caption: { default: true, parseHTML: (element) => !!element.querySelector('figcaption') },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: (element) =>
          element.querySelector('figcaption') || element.ownerDocument.createElement('figcaption'),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      'figure',
      node.attrs.figure,
      ['img', node.attrs.image],
      ...(node.attrs.caption || node.content.size ? [['figcaption', 0]] : []),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(function FigureView({ node, selected, editor, getPos }) {
      const imageProps = displayImageProps(node.attrs.image);
      imageProps.src = window.__ceImageUrl?.(node.attrs.image.src) || node.attrs.image.src;
      return (
        <NodeViewWrapper as="figure" className={'ce-figure ' + (selected ? 'ce-selected' : '')}>
          <img
            {...imageProps}
            className={'ce-figure-image ' + (imageProps.className || '')}
            draggable="false"
            onClick={() => editor.commands.setNodeSelection(getPos())}
          />
          <NodeViewContent
            as="figcaption"
            className="ce-caption"
            data-placeholder="Add a caption"
          />
        </NodeViewWrapper>
      );
    });
  },
});
const Layout = Node.create({
  name: 'layout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      tag: { default: 'div', parseHTML: (element) => element.tagName.toLowerCase() },
      extra: { default: {}, parseHTML: attrsOf },
    };
  },
  parseHTML() {
    return [
      { tag: 'main' },
      { tag: 'section' },
      { tag: 'article' },
      { tag: 'div:not([data-ce-component])' },
      { tag: 'details' },
    ];
  },
  renderHTML({ node }) {
    return [node.attrs.tag, node.attrs.extra, 0];
  },
});
const RichImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(function ImageView({ node, editor, getPos }) {
      const props = displayImageProps(imageAttributes(node));
      props.src = window.__ceImageUrl?.(node.attrs.src) || node.attrs.src;
      return (
        <NodeViewWrapper>
          <img {...props} onClick={() => editor.commands.setNodeSelection(getPos())} />
        </NodeViewWrapper>
      );
    });
  },
  addAttributes() {
    return { ...this.parent?.(), extra: { default: {}, parseHTML: (element) => attrsOf(element) } };
  },
  renderHTML({ node, HTMLAttributes }) {
    const { extra, ...rest } = HTMLAttributes;
    return ['img', mergeAttributes(node.attrs.extra || {}, rest)];
  },
}).configure({ allowBase64: false, inline: false });
const Source = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { raw: { default: '' }, kind: { default: 'component' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-ce-component]',
        getAttrs: (element) => ({
          raw: element.getAttribute('data-ce-component'),
          kind: 'component',
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['div', { 'data-ce-component': node.attrs.raw }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(function SourceView({ node, editor, getPos, selected }) {
      const title =
        node.attrs.kind === 'module'
          ? 'Page imports and components'
          : node.attrs.kind === 'definition'
            ? 'Reference definition'
            : 'MDX component';
      return (
        <NodeViewWrapper
          className={'ce-source-block ' + (selected ? 'ce-selected' : '')}
          contentEditable={false}
          onClick={() => editor.commands.setNodeSelection(getPos())}
        >
          <strong>{title}</strong>
          <span>{node.attrs.raw.slice(0, 100).replace(/\s+/g, ' ')}</span>
          <small>Select to edit its properties. The exact source is preserved.</small>
        </NodeViewWrapper>
      );
    });
  },
});
const Preservation = Extension.create({
  name: 'sourcePreservation',
  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'bulletList',
          'orderedList',
          'blockquote',
          'codeBlock',
          'horizontalRule',
          'table',
          'image',
          'figure',
          'layout',
          'sourceBlock',
          'tabs',
          'tabItem',
          'managedImport',
          'link',
        ],
        attributes: {
          sourceId: { default: null, renderHTML: () => ({}) },
          fenceMeta: { default: null, renderHTML: () => ({}) },
          extra: { default: {}, parseHTML: attrsOf, renderHTML: (attrs) => attrs.extra || {} },
        },
      },
    ];
  },
});
export function extensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    TableKit.configure({ table: { resizable: true } }),
    Tabs,
    TabItem,
    ManagedImport,
    RichImage,
    Figure,
    Layout,
    Source,
    Preservation,
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
  ];
}
