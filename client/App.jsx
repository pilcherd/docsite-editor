import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent } from '@tiptap/react';
import yaml from 'js-yaml';
import { extensions } from './extensions.jsx';
import { mapPreviewSelection } from './preview-selection.js';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { loadVisual, normalizeModel, exportVisual } from './document.js';
import {
  api,
  session,
  setSession,
  Dialog,
  Button,
  NewPage,
  SidebarEditor,
  RuntimePreview,
} from './ui.jsx';
import Toolbar from './Toolbar.jsx';
import { createTabGroup } from './tab-properties.js';
import MediaDialog from './MediaDialog.jsx';
import ImageSizeControls from './ImageSizeControls.jsx';
import { imageAttributes, mergeImageSize, setImageAttributes } from './image-size.js';
import LinkDialog from './LinkDialog.jsx';
import GitDialog from './GitDialog.jsx';
import PullDialog from './PullDialog.jsx';
import SiteSettings from './Settings.jsx';
import ComponentInspector from './ComponentInspector.jsx';
import './editor.css';
function PanelToggle({ side, open, onClick, controls, label }) {
  const action = (open ? 'Hide ' : 'Show ') + label;
  return (
    <Button
      className="ce-panel-toggle"
      aria-label={action}
      title={action}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path
          d={side === 'left' ? 'M9 4v16' : 'M15 4v16'}
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect
          x={side === 'left' ? 4 : 16}
          y="5"
          width="4"
          height="14"
          fill="currentColor"
          opacity={open ? '.2' : '.06'}
        />
      </svg>
    </Button>
  );
}
function EditorApp({ onClose }) {
  const panelStorageKey = 'docsite-editor:panels:' + (session.baseUrl || '/');
  const [panels, setPanels] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(panelStorageKey));
      if (saved && typeof saved.left === 'boolean' && typeof saved.right === 'boolean')
        return saved;
    } catch {}
    return { left: window.innerWidth > 760, right: window.innerWidth > 760 };
  });
  useEffect(() => {
    try {
      localStorage.setItem(panelStorageKey, JSON.stringify(panels));
    } catch {}
  }, [panels, panelStorageKey]);
  const [pages, setPages] = useState([]),
    [query, setQuery] = useState(''),
    [doc, setDoc] = useState(null),
    [draft, setDraft] = useState(''),
    [saved, setSaved] = useState(''),
    [navDirty, setNavDirty] = useState(false),
    [mode, setMode] = useState('visual'),
    [tab, setTab] = useState('page'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [buildStatus, setBuildStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [reloadVersion, setReloadVersion] = useState(0),
    [gitOpen, setGitOpen] = useState(false),
    [pullOpen, setPullOpen] = useState(false),
    [media, setMedia] = useState(null),
    [newPage, setNewPage] = useState(false),
    [discard, setDiscard] = useState(null),
    [preview, setPreview] = useState(false),
    [, setTick] = useState(0),
    [link, setLink] = useState(null),
    [metadataText, setMetadataText] = useState('');
  const markup = useRef(null),
    previewTarget = useRef(null),
    model = useRef(null),
    current = useRef(null),
    loading = useRef(false),
    draftRef = useRef(''),
    exts = useMemo(extensions, []);
  const fail = useCallback((e) => {
    setError(e.message || String(e));
    setNotice('');
  }, []);
  const editor = useEditor({
    extensions: exts,
    immediatelyRender: false,
    content: '',
    editorProps: {
      attributes: { class: 'markdown ce-canvas', 'aria-label': 'Page content editor' },
      handleClick: (view, pos, event) => !!event.target.closest('a'),
    },
    onUpdate: ({ editor }) => {
      if (loading.current || !model.current || !current.current) return;
      const value = exportVisual(editor, model.current, current.current.kind);
      setDraft(value);
      draftRef.current = value;
    },
    onSelectionUpdate: () => setTick((t) => t + 1),
    onTransaction: () => setTick((t) => t + 1),
  });
  useEffect(() => {
    editor?.setEditable(!busy, false);
  }, [editor, busy]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const dirty = draft !== saved;
  const guard = (fn) => {
    if (busy) return;
    if (dirty || navDirty)
      setDiscard(() => async () => {
        if (dirty && doc) await install(doc);
        setNavDirty(false);
        fn();
      });
    else fn();
  };
  async function install(record) {
    loading.current = true;
    try {
      if (record.document) {
        const value = loadVisual(record.document, exts);
        value.jsxImageHelper = record.jsxImageHelper;
        editor.commands.setContent(value.json, { emitUpdate: false });
        model.current = normalizeModel(editor, value);
      } else {
        editor.commands.setContent('', { emitUpdate: false });
        model.current = null;
      }
      window.__ceImageUrl = (src) => {
        if (!src || /^(?:https?:|data:|blob:|\/\/)/.test(src)) return src;
        if (src.startsWith('/')) {
          const base = session.baseUrl.replace(/\/$/, '');
          return base && src.startsWith(base + '/') ? src : base + src;
        }
        const parts = (record.path.split('/').slice(0, -1).join('/') + '/' + src).split('/'),
          normalized = [];
        for (const part of parts) {
          if (part === '..') normalized.pop();
          else if (part !== '.' && part) normalized.push(part);
        }
        return '/__site_editor/media/file?path=' + encodeURIComponent(normalized.join('/'));
      };
      current.current = record;
      setDoc(record);
      setDraft(record.source);
      draftRef.current = record.source;
      setSaved(record.source);
      setMode(record.document ? 'visual' : 'source');
      setMetadataText(yaml.dump(record.metadata || record.document?.metadata || {}));
      setError('');
      setTab('page');
    } finally {
      loading.current = false;
    }
  }
  useEffect(
    () => () => {
      clearTimeout(previewTarget.current?.timer);
      previewTarget.current?.element?.classList.remove('ce-preview-target');
    },
    [],
  );
  function selectFromPreview(message) {
    if (message.source !== draftRef.current || message.path !== current.current?.path) return;
    if (mode === 'source') {
      const field = markup.current,
        start = message.anchor?.start,
        end = message.head?.end;
      if (
        !field ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > draftRef.current.length
      )
        return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(start, end);
      const line = draftRef.current.slice(0, start).split('\n').length - 1,
        lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 23;
      field.scrollTop = Math.max(0, line * lineHeight - field.clientHeight * 0.35);
      return;
    }
    const range = mapPreviewSelection(
      editor,
      model.current,
      current.current.kind,
      draftRef.current,
      message,
    );
    if (!range) return;
    const selection = range.node
      ? NodeSelection.create(editor.state.doc, range.from)
      : TextSelection.create(editor.state.doc, range.from, range.to);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.commands.focus(undefined, { scrollIntoView: false });
    const surface = editor.view.dom.closest('.ce-edit-surface'),
      point = editor.view.coordsAtPos(range.from);
    if (surface) {
      const bounds = surface.getBoundingClientRect();
      surface.scrollTo({
        top: Math.max(0, surface.scrollTop + point.top - bounds.top - surface.clientHeight * 0.3),
        behavior: 'smooth',
      });
    }
    const node = range.node
      ? editor.view.nodeDOM(range.from)
      : editor.view.domAtPos(range.from).node;
    const element = (node?.nodeType === 1 ? node : node?.parentElement)?.closest(
      'p,h1,h2,h3,h4,h5,h6,li,td,th,figure,pre,.ce-source-block',
    );
    clearTimeout(previewTarget.current?.timer);
    previewTarget.current?.element?.classList.remove('ce-preview-target');
    if (element) {
      element.classList.add('ce-preview-target');
      previewTarget.current = {
        element,
        timer: setTimeout(() => element.classList.remove('ce-preview-target'), 1200),
      };
    }
  }
  async function refreshAfterPull() {
    if (dirty || navDirty) {
      await refreshPages();
      // Keep both the draft and its original disk revision. A stale save must not overwrite a pulled update.
      if (dirty && current.current) {
        try {
          const active = current.current;
          const fresh = await api(
            '/document?path=' +
              encodeURIComponent(active.path) +
              '&collection=' +
              encodeURIComponent(active.collection),
          );
          if (fresh.revision !== active.revision) {
            setError(
              'Updates were pulled, and this page changed on disk. Your unsaved draft is still open. Review or copy your draft before reloading the updated page.',
            );
          }
        } catch (error) {
          setError(
            'Updates were pulled. Your unsaved draft is still open, but the page could not be reloaded: ' +
              error.message,
          );
        }
      }
      setNotice('Updates pulled. Your unsaved drafts were preserved.');
      return;
    }
    await refreshAfterRevert({
      affected: [current.current?.path].filter(Boolean),
      restored: [],
    });
    setNotice('Updated the editor from the pulled checkout.');
  }
  async function refreshAfterRevert(result) {
    setReloadVersion((value) => value + 1);
    const list = await refreshPages(),
      active = current.current;
    if (active && result.affected.includes(active.path)) {
      const next =
        list.find((page) => page.path === active.path && page.collection === active.collection) ||
        list.find((page) => result.restored.includes(page.path)) ||
        list[0];
      if (next) await openPage(next.path, next.collection);
      else {
        loading.current = true;
        editor.commands.clearContent(false);
        current.current = null;
        model.current = null;
        setDoc(null);
        setDraft('');
        draftRef.current = '';
        setSaved('');
        setMetadataText('');
        loading.current = false;
      }
    }
    setNotice('Selected files reverted to the last commit.');
  }
  const refreshPages = () =>
    api('/pages').then((list) => {
      setPages(list);
      return list;
    });
  async function openPage(path, collection) {
    setBusy(true);
    try {
      await install(
        await api(
          '/document?path=' +
            encodeURIComponent(path) +
            (collection ? '&collection=' + encodeURIComponent(collection) : ''),
        ),
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!editor) return;
    refreshPages()
      .then((list) => {
        const currentPath = location.pathname.replace(/\/$/, '') || '/';
        const match =
          list.find((page) => (page.url || page.route).replace(/\/$/, '') === currentPath) ||
          list[0];
        if (match) openPage(match.path, match.collection);
      })
      .catch(fail);
  }, [editor]);
  useEffect(() => {
    const h = (e) => {
      if (dirty || navDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, navDirty]);
  async function save() {
    if (!doc || !dirty) return;
    setBusy(true);
    setError('');
    try {
      const value = await api(
        '/document',
        {
          path: doc.path,
          collection: doc.collection,
          source: draftRef.current,
          revision: doc.revision,
        },
        'PUT',
      );
      await install(value);
      await refreshPages();
      setNotice('Saved to your checkout. The website is updating.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (session.mode !== 'built') return;
    const timer = setInterval(
      () =>
        api('/status')
          .then((value) => {
            if (value.error)
              setError(
                'The page was saved, but rebuilding failed. ' +
                  value.error +
                  ' The previous built site is still being served.',
              );
            else setBuildStatus(value.building ? 'Rebuilding…' : '');
          })
          .catch(() => {}),
      1500,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doc, dirty]);
  async function toggle(next) {
    if (next === mode) return;
    if (next === 'visual') {
      setBusy(true);
      try {
        const parsed = await api('/parse', { source: draftRef.current });
        loading.current = true;
        const value = loadVisual(parsed, exts);
        value.jsxImageHelper = current.current.jsxImageHelper;
        editor.commands.setContent(value.json, { emitUpdate: false });
        model.current = normalizeModel(editor, value);
        setMetadataText(yaml.dump(parsed.metadata || {}));
        setMode(next);
        setError('');
      } catch (e) {
        fail(e);
      } finally {
        loading.current = false;
        setBusy(false);
      }
    } else setMode(next);
  }
  function applyMetadata() {
    try {
      const data = yaml.load(metadataText);
      if (!data || Array.isArray(data) || typeof data !== 'object')
        throw new Error('Page settings must be a YAML object.');
      const prefix = '---\n' + yaml.dump(data) + '---\n',
        body = draftRef.current.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
      if (model.current) model.current.prefix = prefix;
      setDraft(prefix + body);
      draftRef.current = prefix + body;
      setNotice('Page settings applied to the draft.');
    } catch (e) {
      fail(e);
    }
  }
  if (!editor) return null;
  const selected = editor.state.selection.node,
    imageNode = ['figure', 'image'].includes(selected?.type.name);
  const selectedImage = imageNode ? imageAttributes(selected) : null;
  function updateImage(value) {
    setImageAttributes(editor, editor.state.selection.from, value);
  }
  const folder =
    doc?.imageFolder ||
    pages.find((p) => p.path === doc?.path)?.imageFolder ||
    session.mediaRoots.find((r) => r.uploadPath)?.uploadPath ||
    '';
  function chooseImage(file) {
    const alt = file.name?.replace(/\.[^.]+$/, '').replaceAll('-', ' ') || '';
    if (media === 'replace' && imageNode) {
      setImageAttributes(
        editor,
        editor.state.selection.from,
        mergeImageSize({ ...imageAttributes(selected), src: file.url }, file.dimensions || {}),
      );
      editor.commands.focus(undefined, { scrollIntoView: false });
    } else {
      const sourceId = 'new-image-' + crypto.randomUUID();
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'figure',
          attrs: {
            sourceId,
            image: mergeImageSize({ src: file.url, alt }, file.dimensions || {}),
            figure: {},
          },
          content: [],
        })
        .run();
      let position;
      editor.state.doc.descendants((node, pos) => {
        if (node.attrs.sourceId === sourceId) position = pos;
      });
      if (position !== undefined) editor.commands.setNodeSelection(position);
    }
    setMedia(null);
  }
  return (
    <div
      className="ce-shell"
      role="dialog"
      aria-modal="true"
      aria-label="Documentation editor"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="ce-topbar">
        <PanelToggle
          side="left"
          open={panels.left}
          controls="ce-page-panel"
          label="navigation panel"
          onClick={() => setPanels((value) => ({ ...value, left: !value.left }))}
        />
        <div className="ce-brand">
          <span aria-hidden="true">✎</span>
          <div title={session.siteName}>
            <small>{session.siteName}</small>
          </div>
        </div>
        <div className="ce-top-page" title={doc?.path}>
          <strong>{pages.find((p) => p.path === doc?.path)?.title || 'Documentation'}</strong>
          <span className={dirty ? 'ce-dirty' : 'ce-muted'} role="status">
            {dirty ? 'Unsaved changes' : buildStatus || 'Saved'}
          </span>
        </div>
        {tab === 'page' && (
          <>
            <div className="ce-segmented">
              <Button
                active={mode === 'visual'}
                disabled={!doc?.capabilities?.visual}
                onClick={() => toggle('visual')}
              >
                Visual editor
              </Button>
              <Button active={mode === 'source'} onClick={() => toggle('source')}>
                Markup
              </Button>
            </div>
            <Button
              aria-label="Reload file"
              title="Reload file"
              disabled={!doc || busy}
              onClick={() => guard(() => openPage(doc.path, doc.collection))}
            >
              ↻
            </Button>
          </>
        )}
        <Button onClick={() => guard(() => setNewPage(true))}>＋ New page</Button>
        <Button onClick={() => setPreview(!preview)} active={preview}>
          Live preview
        </Button>
        <Button
          title="Pull updates from the tracking branch"
          aria-label="Pull updates"
          disabled={busy}
          onClick={() => setPullOpen(true)}
        >
          Pull
        </Button>
        <Button
          title="Review and commit saved files"
          aria-label="Commit changes"
          onClick={() => setGitOpen(true)}
        >
          Commit
        </Button>
        <Button onClick={save} disabled={!dirty || busy || tab !== 'page'} className="ce-primary">
          {busy ? 'Working…' : 'Save page'}
        </Button>
        {tab === 'page' && (
          <PanelToggle
            side="right"
            open={panels.right}
            controls="ce-settings-panel"
            label="page settings panel"
            onClick={() => setPanels((value) => ({ ...value, right: !value.right }))}
          />
        )}
        <Button
          onClick={() => guard(() => onClose(current.current?.url || current.current?.route))}
          aria-label="Close site editor"
        >
          ✕
        </Button>
      </header>
      <div className="ce-workspace">
        <aside id="ce-page-panel" className="ce-pages" hidden={!panels.left}>
          <div className="ce-tabs">
            <Button active={tab === 'page'} onClick={() => guard(() => setTab('page'))}>
              Pages
            </Button>
            <Button active={tab === 'navigation'} onClick={() => guard(() => setTab('navigation'))}>
              Navigation
            </Button>
            <Button active={tab === 'settings'} onClick={() => guard(() => setTab('settings'))}>
              Settings
            </Button>
          </div>
          <input
            aria-label="Find a page"
            placeholder="Find a page…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label="Editable pages">
            {pages
              .filter((p) => (p.title + ' ' + p.path).toLowerCase().includes(query.toLowerCase()))
              .map((page) => (
                <button
                  key={page.collection + ':' + page.path}
                  className={
                    doc?.path === page.path && doc?.collection === page.collection
                      ? 'ce-current'
                      : ''
                  }
                  onClick={() => guard(() => openPage(page.path, page.collection))}
                >
                  <strong>{page.title}</strong>
                  <small>
                    {page.collection} · {page.path}
                  </small>
                </button>
              ))}
          </nav>
          <footer>Local checkout · Git commits stay under your control.</footer>
        </aside>
        <main className="ce-main">
          {(error || notice) && (
            <div role={error ? 'alert' : 'status'} className={error ? 'ce-error' : 'ce-notice'}>
              {error || notice}
              <button
                aria-label="Dismiss message"
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                ×
              </button>
            </div>
          )}
          {tab === 'settings' ? (
            <SiteSettings
              key={'settings:' + reloadVersion}
              onError={fail}
              onSaved={setNotice}
              onDirty={setNavDirty}
            />
          ) : tab === 'navigation' ? (
            <SidebarEditor
              key={'navigation:' + reloadVersion}
              pages={pages}
              onError={fail}
              onSaved={setNotice}
              onDirty={setNavDirty}
            />
          ) : (
            <>
              {doc?.capabilities?.message && (
                <p className="ce-notice">
                  Visual view unavailable for this page: {doc.capabilities.message} Your source
                  remains editable.
                </p>
              )}
              {mode === 'visual' && (
                <Toolbar
                  editor={editor}
                  onMedia={() => setMedia('insert')}
                  onTabs={() =>
                    editor
                      .chain()
                      .focus()
                      .insertContent(createTabGroup(model.current?.tabInfo?.names))
                      .run()
                  }
                  onLink={() => setLink(editor.getAttributes('link').href || '')}
                />
              )}
              {mode === 'visual' && imageNode && (
                <div className="ce-image-controls" role="region" aria-label="Selected image size">
                  <strong>Image size</strong>
                  <ImageSizeControls
                    attributes={selectedImage}
                    onChange={updateImage}
                    imageKey={editor.state.selection.from}
                    compact
                  />
                  <Button onClick={() => setMedia('replace')}>Choose image</Button>
                </div>
              )}
              <div className={'ce-edit-area ' + (preview ? 'ce-split' : '')}>
                <section className="ce-edit-surface">
                  {mode === 'visual' ? (
                    <EditorContent editor={editor} />
                  ) : (
                    <textarea
                      ref={markup}
                      className="ce-markup"
                      readOnly={busy}
                      spellCheck={false}
                      aria-label="Page markup"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        draftRef.current = e.target.value;
                      }}
                    />
                  )}
                </section>
                {preview && (
                  <RuntimePreview
                    source={draft}
                    kind={doc?.kind}
                    path={doc?.path}
                    onSelect={selectFromPreview}
                  />
                )}
              </div>
            </>
          )}
        </main>
        {tab === 'page' && (
          <aside id="ce-settings-panel" className="ce-inspector" hidden={!panels.right}>
            <h2>Page settings</h2>
            {doc?.kind === 'mdx' && (
              <>
                {['title', 'sidebar_label', 'slug'].map((key) => {
                  let value = '';
                  try {
                    value = yaml.load(metadataText)?.[key] || '';
                  } catch {}
                  return (
                    <label key={key}>
                      {
                        {
                          title: 'Page title',
                          sidebar_label: 'Menu label',
                          slug: 'Custom page address',
                        }[key]
                      }
                      <input
                        aria-label={
                          key === 'title'
                            ? 'Page title'
                            : key === 'sidebar_label'
                              ? 'Menu label'
                              : 'Custom page address'
                        }
                        value={value}
                        onChange={(event) => {
                          try {
                            const data = yaml.load(metadataText) || {};
                            if (event.target.value) data[key] = event.target.value;
                            else delete data[key];
                            const yamlText = yaml.dump(data),
                              prefix = '---\n' + yamlText + '---\n',
                              body = draftRef.current.replace(
                                /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
                                '',
                              );
                            setMetadataText(yamlText);
                            if (model.current) model.current.prefix = prefix;
                            setDraft(prefix + body);
                            draftRef.current = prefix + body;
                          } catch (error) {
                            fail(error);
                          }
                        }}
                      />
                    </label>
                  );
                })}
                <details>
                  <summary>All page metadata</summary>
                  <label>
                    Front matter
                    <textarea
                      aria-label="Page metadata"
                      value={metadataText}
                      onChange={(e) => setMetadataText(e.target.value)}
                      rows={8}
                    />
                  </label>
                  <Button onClick={applyMetadata}>Apply to draft</Button>
                </details>
              </>
            )}
            {imageNode && (
              <section>
                <h3>Image</h3>
                <Button onClick={() => setMedia('replace')}>Choose or upload image</Button>
                <label>
                  Alternative text
                  <input
                    aria-label="Image alternative text"
                    value={
                      (selected.type.name === 'figure'
                        ? selected.attrs.image.alt
                        : selected.attrs.alt) || ''
                    }
                    onChange={(e) =>
                      selected.type.name === 'figure'
                        ? editor.commands.updateAttributes('figure', {
                            image: { ...selected.attrs.image, alt: e.target.value },
                          })
                        : editor.commands.updateAttributes('image', { alt: e.target.value })
                    }
                  />
                </label>
                <details>
                  <summary>Advanced image styling</summary>
                  <label>
                    Display style
                    <input
                      aria-label="Image display style"
                      value={selectedImage.style || ''}
                      onChange={(event) =>
                        updateImage({ ...selectedImage, style: event.target.value })
                      }
                    />
                  </label>
                </details>
                <p className="ce-muted">Existing image attributes are retained.</p>
              </section>
            )}
            {editor.isActive('codeBlock') && (
              <section>
                <h3>Code block</h3>
                <label>
                  Language
                  <input
                    aria-label="Code block language"
                    value={editor.getAttributes('codeBlock').language || ''}
                    placeholder="bash, csharp, json…"
                    onChange={(e) =>
                      editor.commands.updateAttributes('codeBlock', { language: e.target.value })
                    }
                  />
                </label>
              </section>
            )}
            {selected?.type.name === 'sourceBlock' && (
              <ComponentInspector node={selected} editor={editor} onError={fail} />
            )}
            <section>
              <h3>Site styles</h3>
              <select
                aria-label="Block style"
                defaultValue=""
                onChange={(e) => {
                  const name = editor.isActive('table')
                    ? 'table'
                    : editor.isActive('layout')
                      ? 'layout'
                      : editor.isActive('heading')
                        ? 'heading'
                        : 'paragraph';
                  editor.commands.updateAttributes(name, {
                    extra: { ...editor.getAttributes(name).extra, class: e.target.value },
                  });
                }}
              >
                <option value="">Default style</option>
                {(session.styles || []).map((style) => (
                  <option key={style.className} value={style.className}>
                    {style.label || style.className}
                  </option>
                ))}
              </select>
              <Button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: 'layout',
                      attrs: { tag: 'section', extra: {} },
                      content: [
                        {
                          type: 'heading',
                          attrs: { level: 2 },
                          content: [{ type: 'text', text: 'New section' }],
                        },
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Write your section here.' }],
                        },
                      ],
                    })
                    .run()
                }
              >
                ＋ Content section
              </Button>
            </section>
          </aside>
        )}
      </div>
      {gitOpen && (
        <GitDialog
          unsaved={dirty || navDirty}
          onReverted={refreshAfterRevert}
          onClose={() => setGitOpen(false)}
        />
      )}
      {pullOpen && (
        <PullDialog
          unsaved={dirty || navDirty}
          onPulled={refreshAfterPull}
          onClose={() => setPullOpen(false)}
        />
      )}
      {media && (
        <MediaDialog
          folder={folder}
          documentPath={doc?.path}
          imageAttributes={media === 'replace' && selectedImage ? selectedImage : undefined}
          onChoose={chooseImage}
          onClose={() => setMedia(null)}
        />
      )}
      {newPage && (
        <NewPage
          onClose={() => setNewPage(false)}
          onError={fail}
          onCreated={async (record) => {
            setNewPage(false);
            await refreshPages();
            await install(record);
            setNotice('Page created in the selected collection.');
          }}
        />
      )}
      {discard && (
        <Dialog title="Keep editing or discard this draft?" onClose={() => setDiscard(null)}>
          <p>Your page has unsaved changes.</p>
          <footer>
            <Button onClick={() => setDiscard(null)}>Keep editing</Button>
            <Button
              onClick={() => {
                const next = discard;
                setDiscard(null);
                next();
              }}
            >
              Discard draft
            </Button>
          </footer>
        </Dialog>
      )}
      {link !== null && (
        <LinkDialog
          pages={pages}
          initialUrl={link}
          onClose={() => setLink(null)}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setLink(null);
          }}
          onApply={({ href, title }) => {
            let applied;
            if (editor.state.selection.empty && !editor.isActive('link'))
              applied = editor
                .chain()
                .focus()
                .insertContent({
                  type: 'text',
                  text: title,
                  marks: [{ type: 'link', attrs: { href } }],
                })
                .run();
            else applied = editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            if (!applied)
              throw new Error('This link address could not be applied. Check its format.');
            setLink(null);
          }}
        />
      )}
    </div>
  );
}
let root;
window.DocusaurusSiteEditor = {
  open(value) {
    setSession(value);
    if (root) return;
    const host = document.createElement('div');
    host.id = 'docsite-editor';
    document.body.append(host);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root = createRoot(host);
    root.render(
      <EditorApp
        onClose={(pageUrl) => {
          let target;
          try {
            if (pageUrl) {
              const url = new URL(pageUrl, window.location.href);
              if (
                url.origin === window.location.origin &&
                ['http:', 'https:'].includes(url.protocol)
              )
                target = url;
            }
          } catch {}
          root.unmount();
          root = null;
          host.remove();
          document.body.style.overflow = overflow;
          if (target) {
            if (target.href === window.location.href) window.location.reload();
            else window.location.assign(target.href);
          }
        }}
      />,
    );
  },
};
