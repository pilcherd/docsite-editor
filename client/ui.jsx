import React, { useEffect, useRef, useState } from 'react';
import { moveNavigationItem } from './navigation-move.js';
export const ROOT = '/__site_editor';
export let session;
export function setSession(value) {
  session = value;
}
export async function api(route, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(ROOT + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Site-Editor-Token': session.token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The editor request failed.');
  return data;
}
export function Dialog({ title, children, onClose, wide = false, className = '' }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className={'ce-dialog ' + (wide ? 'ce-wide' : '') + ' ' + className}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export const Button = ({ active, children, ...props }) => (
  <button type="button" className={active ? 'ce-active' : ''} {...props}>
    {children}
  </button>
);
export function sectionOptions(nav) {
  const result = [];
  function scan(sidebar, items, parts, label) {
    result.push({ value: JSON.stringify({ sidebar, parts }), label });
    items.forEach((item, i) => {
      if (item.type === 'category')
        scan(sidebar, item.items, [...parts, i], label + ' / ' + item.label);
    });
  }
  for (const [sidebar, items] of Object.entries(nav)) scan(sidebar, items, [], sidebar);
  return result;
}
export function NewPage({ onClose, onCreated, onError }) {
  const [collection, setCollection] = useState(session.collections[0]?.id || ''),
    [nav, setNav] = useState(null),
    [title, setTitle] = useState(''),
    [file, setFile] = useState(''),
    [section, setSection] = useState(''),
    [busy, setBusy] = useState(false);
  const chosen = session.collections.find((c) => c.id === collection);
  useEffect(() => {
    setNav(null);
    setSection('');
    api('/navigation?collection=' + encodeURIComponent(collection))
      .then(setNav)
      .catch(() => setNav({ mode: 'none' }));
  }, [collection]);
  return (
    <Dialog title="New page" onClose={onClose}>
      <label>
        Content collection
        <select
          aria-label="Content collection"
          value={collection}
          onChange={(e) => {
            setCollection(e.target.value);
            setFile('');
          }}
        >
          {session.collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {c.root}
            </option>
          ))}
        </select>
      </label>
      <label>
        Page title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Repository path
        <input
          aria-label="New page path"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder={
            (chosen?.root === '.' ? '' : (chosen?.root || 'content') + '/') + 'new-page.md'
          }
        />
      </label>
      {nav?.mode === 'tree' && (
        <label>
          Sidebar section
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">Use folder-based navigation / add menu item later</option>
            {sectionOptions(nav.value).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {nav?.mode === 'source' && (
        <p>
          This sidebar uses executable code. The page can be created now and its menu item added in
          Navigation source.
        </p>
      )}
      <footer>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          disabled={!title.trim() || !file || !chosen || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const target = section ? JSON.parse(section) : {};
              await onCreated(
                await api('/pages', {
                  title,
                  path: file,
                  collection,
                  sidebar: target.sidebar,
                  parent: target.parts,
                  navigation: nav?.descriptor?.id,
                  navigationRevision: nav?.revision,
                }),
              );
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Creating…' : 'Create page'}
        </Button>
      </footer>
    </Dialog>
  );
}
function normalizeNavigation(value) {
  const items = (list) =>
    list.flatMap((item) =>
      typeof item === 'object' && item && !item.type
        ? Object.entries(item).map(([label, children]) => ({
            type: 'category',
            label,
            items: items(children),
          }))
        : item?.type === 'category'
          ? [{ ...item, items: items(item.items) }]
          : [item],
    );
  return Object.fromEntries(Object.entries(value || {}).map(([name, list]) => [name, items(list)]));
}
function FolderSections({ collection, onError, onSaved }) {
  const [sections, setSections] = useState([]),
    [folder, setFolder] = useState(''),
    [title, setTitle] = useState(''),
    [position, setPosition] = useState('');
  const load = () =>
    api('/sections?collection=' + encodeURIComponent(collection))
      .then(setSections)
      .catch(onError);
  useEffect(() => {
    load();
    setFolder('');
    setTitle('');
  }, [collection]);
  const existing = sections.find((s) => s.folder === folder);
  return (
    <section>
      <h3>Folder sections</h3>
      <p className="ce-muted">
        Autogenerated sidebars use folders, page front matter and category metadata.
      </p>
      <label>
        Existing section
        <select
          value={existing?.folder || ''}
          onChange={(e) => {
            const s = sections.find((s) => s.folder === e.target.value);
            setFolder(s?.folder || '');
            setTitle(s?.value.label || '');
            setPosition(s?.value.position ?? '');
          }}
        >
          <option value="">New section</option>
          {sections.map((s) => (
            <option key={s.path} value={s.folder}>
              {s.value.label || s.folder}
            </option>
          ))}
        </select>
      </label>
      <label>
        Folder within collection
        <input
          aria-label="Section folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="guide/new-section"
        />
      </label>
      <label>
        Section title
        <input
          aria-label="Section title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Order
        <input type="number" value={position} onChange={(e) => setPosition(e.target.value)} />
      </label>
      <Button
        disabled={!title.trim() || !folder}
        onClick={async () => {
          try {
            await api('/sections', {
              collection,
              folder,
              title,
              ...(position !== '' ? { position: Number(position) } : {}),
              revision: existing?.revision,
            });
            await load();
            onSaved('Folder section saved.');
          } catch (e) {
            onError(e);
          }
        }}
      >
        Save folder section
      </Button>
    </section>
  );
}
export function SidebarEditor({ pages, onError, onSaved, onDirty }) {
  const [record, setRecord] = useState(null),
    [draft, setDraft] = useState(null),
    [selected, setSelected] = useState(null),
    [modal, setModal] = useState(false),
    [title, setTitle] = useState(''),
    [navigation, setNavigation] = useState(session.navigation[0]?.id || ''),
    [source, setSource] = useState(''),
    [drag, setDrag] = useState(null),
    [drop, setDrop] = useState(null),
    [moveNotice, setMoveNotice] = useState('');
  const dragSource = useRef(null);
  function install(v) {
    const value = normalizeNavigation(v.value);
    setRecord({ ...v, value });
    setDraft(value);
    setSource(v.source || '');
    setSelected(null);
    setMoveNotice('');
  }
  useEffect(() => {
    api('/navigation?navigation=' + encodeURIComponent(navigation))
      .then(install)
      .catch(onError);
  }, [navigation]);
  const dirty =
    !!record &&
    (record.mode === 'source'
      ? source !== record.source
      : JSON.stringify(draft) !== JSON.stringify(record.value));
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty]);
  if (!record) return <p>Loading navigation…</p>;
  const selector = (
    <label>
      Sidebar file
      <select
        aria-label="Sidebar file"
        disabled={dirty}
        value={navigation}
        onChange={(e) => setNavigation(e.target.value)}
      >
        {session.navigation.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} — {n.path || 'Autogenerated'}
          </option>
        ))}
      </select>
    </label>
  );
  const folders = record.descriptor?.collection && (
    <FolderSections collection={record.descriptor.collection} onError={onError} onSaved={onSaved} />
  );
  if (record.mode === 'none')
    return (
      <div className="ce-nav-editor">
        <h2>Navigation</h2>
        <p>
          This project has no documentation sidebar. Its pages are still editable. Navigation links
          can be changed in site settings.
        </p>
      </div>
    );
  if (record.mode === 'automatic')
    return (
      <div className="ce-nav-editor">
        <h2>Navigation</h2>
        {selector}
        {folders}
      </div>
    );
  if (record.mode === 'source')
    return (
      <div className="ce-nav-editor">
        <h2>Navigation source</h2>
        {selector}
        <p>{record.message}</p>
        <textarea
          className="ce-markup"
          aria-label="Sidebar source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <Button
          disabled={!dirty}
          onClick={async () => {
            try {
              install(
                await api('/navigation', { navigation, source, revision: record.revision }, 'PUT'),
              );
              onSaved('Navigation saved.');
            } catch (e) {
              onError(e);
            }
          }}
        >
          Save navigation
        </Button>
      </div>
    );
  const collection = record.descriptor?.collection;
  function at(value, sidebar, parts) {
    let items = value[sidebar];
    for (const p of parts) items = items[p].items;
    return items;
  }
  function change(fn) {
    try {
      const v = structuredClone(draft);
      fn(v);
      setDraft(v);
    } catch (e) {
      onError(e);
    }
  }
  function dropTarget(event, target, isCategory = false) {
    const rect = event.currentTarget.getBoundingClientRect(),
      ratio = (event.clientY - rect.top) / rect.height;
    return {
      ...target,
      where: !target.parts.length
        ? 'inside'
        : isCategory && ratio > 0.3 && ratio < 0.7
          ? 'inside'
          : ratio < 0.5
            ? 'before'
            : 'after',
    };
  }
  function dragOver(event, target, isCategory = false) {
    if (!dragSource.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDrop(dropTarget(event, target, isCategory));
  }
  function finishDrag() {
    dragSource.current = null;
    setDrag(null);
    setDrop(null);
  }
  function performDrop(event, target, isCategory = false) {
    if (!dragSource.current) return;
    event.preventDefault();
    event.stopPropagation();
    const source = dragSource.current,
      destination = dropTarget(event, target, isCategory);
    try {
      setDraft(moveNavigationItem(draft, source, destination));
      setSelected(null);
      setMoveNotice('Moved ' + source.label + '. Save navigation to apply the new order.');
    } catch (error) {
      onError(error);
    } finally {
      finishDrag();
    }
  }
  function tree(items, sidebar, parts = []) {
    return (
      <ul>
        {items.map((item, index) => {
          const here = [...parts, index],
            id = sidebar + ':' + here.join('.'),
            label =
              typeof item === 'string'
                ? pages.find((p) => p.id === item && p.collection === collection)?.title || item
                : item.label || item.id || item.type;
          const isCategory = item.type === 'category',
            target = { sidebar, parts: here },
            hovered = drop?.sidebar === sidebar && drop.parts.join('.') === here.join('.'),
            dragged = drag?.sidebar === sidebar && drag.parts.join('.') === here.join('.');
          return (
            <li key={id}>
              <div
                className={
                  'ce-nav-row ' +
                  (dragged ? 'ce-nav-dragging ' : '') +
                  (hovered ? 'ce-nav-drop-' + drop.where : '')
                }
                draggable
                data-nav-item={JSON.stringify(target)}
                onDragStart={(event) => {
                  const source = { ...target, label };
                  dragSource.current = source;
                  setDrag(source);
                  setMoveNotice('');
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(
                    'application/x-docsite-editor-navigation',
                    JSON.stringify(target),
                  );
                  event.dataTransfer.setData('text/plain', label);
                }}
                onDragEnd={finishDrag}
                onDragOver={(event) => dragOver(event, target, isCategory)}
                onDrop={(event) => performDrop(event, target, isCategory)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    setDrop((value) =>
                      value?.sidebar === sidebar && value.parts.join('.') === here.join('.')
                        ? null
                        : value,
                    );
                }}
              >
                <span className="ce-nav-drag-handle" aria-hidden="true" title="Drag to reorder">
                  ⠿
                </span>
                <button
                  aria-label={label}
                  draggable={false}
                  className={selected?.id === id ? 'ce-active' : ''}
                  onClick={() => {
                    setSelected({ id, sidebar, parts: here });
                    setTitle(label);
                  }}
                >
                  {isCategory ? '▾ ' : ''}
                  {label}
                </button>
              </div>
              {isCategory && tree(item.items, sidebar, here)}
            </li>
          );
        })}
      </ul>
    );
  }

  function selectedParent(v) {
    let p = selected.parts;
    const item = p.length ? at(v, selected.sidebar, p.slice(0, -1))[p.at(-1)] : null;
    if (item && item.type !== 'category') p = p.slice(0, -1);
    return at(v, selected.sidebar, p);
  }
  return (
    <div className="ce-nav-editor">
      <div className="ce-panel-heading">
        <h2>Navigation</h2>
        <Button
          disabled={!dirty}
          onClick={async () => {
            try {
              const v = await api(
                '/navigation',
                { navigation, revision: record.revision, value: draft },
                'PUT',
              );
              install(v);
              onSaved('Navigation saved. The site is updating.');
            } catch (e) {
              onError(e);
            }
          }}
        >
          Save navigation
        </Button>
      </div>
      <p className="ce-muted">
        Drag pages or sections to reorder them. Drop in the centre of a section to move inside it.
        Select an item for keyboard move controls. Removing a menu item keeps its page.
      </p>
      {selector}
      {moveNotice && (
        <p role="status" className="ce-notice">
          {moveNotice}
        </p>
      )}
      <div className="ce-nav-columns">
        <div>
          {Object.entries(draft).map(([name, items]) => (
            <section key={name}>
              <h3
                className={drop?.sidebar === name && !drop.parts.length ? 'ce-nav-drop-inside' : ''}
                data-nav-root={name}
                onDragOver={(event) => dragOver(event, { sidebar: name, parts: [] }, true)}
                onDrop={(event) => performDrop(event, { sidebar: name, parts: [] }, true)}
              >
                <button
                  onClick={() => {
                    setSelected({ id: name, sidebar: name, parts: [] });
                    setTitle(name);
                  }}
                >
                  {name}
                </button>
              </h3>
              {tree(items, name)}
            </section>
          ))}
        </div>
        <div>
          {selected && (
            <>
              <label>
                Label
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <Button
                onClick={() =>
                  change((v) => {
                    if (!selected.parts.length) {
                      if (!/^[\w-]+$/.test(title) || v[title])
                        throw new Error('Choose a unique sidebar name.');
                      v[title] = v[selected.sidebar];
                      delete v[selected.sidebar];
                      setSelected(null);
                      return;
                    }
                    const siblings = at(v, selected.sidebar, selected.parts.slice(0, -1)),
                      i = selected.parts.at(-1),
                      item = siblings[i];
                    siblings[i] =
                      typeof item === 'string'
                        ? { type: 'doc', id: item, label: title }
                        : { ...item, label: title };
                  })
                }
              >
                Apply label
              </Button>
              {!!selected.parts.length && (
                <>
                  <div className="ce-button-row">
                    {[-1, 1].map((d) => (
                      <Button
                        key={d}
                        onClick={() =>
                          change((v) => {
                            const items = at(v, selected.sidebar, selected.parts.slice(0, -1)),
                              from = selected.parts.at(-1),
                              to = from + d;
                            if (to < 0 || to >= items.length) return;
                            [items[from], items[to]] = [items[to], items[from]];
                            setSelected(null);
                          })
                        }
                      >
                        {d < 0 ? '↑ Move up' : '↓ Move down'}
                      </Button>
                    ))}
                  </div>
                  <label>
                    Move into section
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const t = JSON.parse(e.target.value);
                        change((v) => {
                          if (
                            t.sidebar === selected.sidebar &&
                            t.parts.slice(0, selected.parts.length).join('.') ===
                              selected.parts.join('.')
                          )
                            throw new Error('A section cannot contain itself.');
                          const source = at(v, selected.sidebar, selected.parts.slice(0, -1)),
                            dest = at(v, t.sidebar, t.parts),
                            moving = source[selected.parts.at(-1)];
                          source.splice(selected.parts.at(-1), 1);
                          dest.push(moving);
                          setSelected(null);
                        });
                      }}
                    >
                      <option value="">Choose destination…</option>
                      {sectionOptions(draft).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    onClick={() =>
                      change((v) => {
                        at(v, selected.sidebar, selected.parts.slice(0, -1)).splice(
                          selected.parts.at(-1),
                          1,
                        );
                        setSelected(null);
                      })
                    }
                  >
                    Remove menu item
                  </Button>
                </>
              )}
              <Button
                onClick={() => {
                  setTitle('');
                  setModal(true);
                }}
              >
                ＋ Add section here
              </Button>
              <label>
                Add an existing page
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    change((v) => selectedParent(v).push(e.target.value));
                    e.target.value = '';
                  }}
                >
                  <option value="">Choose a page…</option>
                  {pages
                    .filter((p) => p.id && p.collection === collection)
                    .map((p) => (
                      <option key={p.path} value={p.id}>
                        {p.title} — {p.id}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <Button
            onClick={() => {
              setSelected(null);
              setTitle('');
              setModal(true);
            }}
          >
            ＋ Add sidebar
          </Button>
        </div>
      </div>
      {folders}
      {modal && (
        <Dialog title={selected ? 'New section' : 'New sidebar'} onClose={() => setModal(false)}>
          <label>
            Title
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <footer>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button
              disabled={!title.trim()}
              onClick={() => {
                change((v) => {
                  if (!selected) {
                    if (!/^[\w-]+$/.test(title) || v[title])
                      throw new Error('Choose a unique sidebar name.');
                    v[title] = [];
                  } else
                    selectedParent(v).push({
                      type: 'category',
                      label: title,
                      link: { type: 'generated-index' },
                      items: [],
                    });
                });
                setModal(false);
              }}
            >
              Add
            </Button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
export function RuntimePreview({ source, kind, path, onSelect }) {
  const frame = useRef(),
    [ready, setReady] = useState(false),
    serial = useRef(0),
    html = useRef(null),
    rendered = useRef(null),
    select = useRef(onSelect);
  select.current = onSelect;
  if (!html.current) {
    const styles = [...document.styleSheets]
      .map((s) => {
        try {
          return [...s.cssRules].map((r) => r.cssText).join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');
    const imageOrigins = (session.preview?.imageOrigins || [])
      .filter((s) => /^https?:|^https?:\/\//.test(s))
      .join(' ');
    html.current =
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos; &apos;unsafe-eval&apos; ' +
      location.origin +
      '; style-src &apos;unsafe-inline&apos;; img-src ' +
      location.origin +
      ' data: blob: ' +
      imageOrigins +
      '; font-src ' +
      location.origin +
      ' data:"><base href="' +
      location.origin +
      (session.baseUrl || '/') +
      '"><style>' +
      styles.replaceAll('</style', '<\\/style') +
      '.ce-preview-block{display:contents}</style><script src="' +
      location.origin +
      ROOT +
      '/assets/preview.js"></script></head><body><main class="markdown" id="preview-root"></main></body></html>';
  }
  useEffect(() => {
    const h = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'preview-ready') setReady(true);
      else if (
        e.data?.type === 'preview-select' &&
        rendered.current &&
        e.data.renderId === rendered.current.id
      )
        select.current?.({
          ...e.data,
          source: rendered.current.source,
          path: rendered.current.path,
        });
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);
  useEffect(() => {
    if (!ready || !path) return;
    const ticket = ++serial.current;
    const t = setTimeout(async () => {
      try {
        const value = await api('/preview', { source, kind, path });
        if (ticket === serial.current) {
          rendered.current = { id: ticket, source, path };
          frame.current?.contentWindow.postMessage(
            { type: 'render', renderId: ticket, ...value },
            '*',
          );
        }
      } catch (error) {
        if (ticket === serial.current) {
          rendered.current = null;
          frame.current?.contentWindow.postMessage(
            { type: 'render', renderId: ticket, error: error.message },
            '*',
          );
        }
      }
    }, 400);
    return () => {
      clearTimeout(t);
      serial.current++;
    };
  }, [ready, source, kind, path]);
  return (
    <iframe
      ref={frame}
      className="ce-runtime"
      title="Live Docusaurus preview"
      sandbox="allow-scripts"
      srcDoc={html.current}
    />
  );
}
