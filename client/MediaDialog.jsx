import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ROOT, Dialog, Button } from './ui.jsx';
import ImageSizeControls from './ImageSizeControls.jsx';
import { sizeOnly } from './image-size.js';
import { buildMediaTree, folderAncestors, visibleMedia, folderOf } from './media-tree.js';
export default function MediaDialog({
  folder,
  documentPath,
  imageAttributes = {},
  onChoose,
  onClose,
}) {
  const [library, setLibrary] = useState([]),
    [roots, setRoots] = useState([]),
    [folders, setFolders] = useState([]),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState(null),
    [target, setTarget] = useState(folder || ''),
    [all, setAll] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [expanded, setExpanded] = useState(new Set(folderAncestors(folder))),
    [size, setSize] = useState(sizeOnly(imageAttributes)),
    [natural, setNatural] = useState(null);
  const input = useRef(),
    treePane = useRef();
  useEffect(() => {
    let cancelled = false;
    api('/media?document=' + encodeURIComponent(documentPath || ''))
      .then((value) => {
        if (cancelled) return;
        setLibrary(value.files);
        setRoots(value.roots);
        setFolders(value.folders || []);
        const current = value.files.find(
          (file) => imageAttributes.src && file.url === imageAttributes.src,
        );
        if (current) setSelected(current);
        const initial =
          current?.folder ||
          (value.roots.some((root) => root.path === folder || folder?.startsWith(root.path + '/'))
            ? folder
            : null) ||
          value.roots.find((root) => root.uploadPath)?.uploadPath ||
          value.roots[0]?.path ||
          '';
        setTarget(initial);
        setExpanded(new Set(folderAncestors(initial)));
        setLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const tree = useMemo(
    () => buildMediaTree(roots, folders, library, target),
    [roots, folders, library, target],
  );
  const files = visibleMedia(library, target, search, all),
    searching = !!search.trim();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pane = treePane.current,
        row = pane?.querySelector('.ce-folder-current');
      if (!row?.getClientRects().length) return;
      const a = pane.getBoundingClientRect(),
        b = row.getBoundingClientRect();
      if (b.top < a.top || b.bottom > a.bottom)
        pane.scrollTop += b.top - a.top - pane.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [tree, target, expanded]);
  function chooseFolder(path) {
    setSelected(null);
    setNatural(null);
    setTarget(path);
    setAll(false);
    setExpanded((value) => new Set([...value, ...folderAncestors(path)]));
  }
  async function upload(file) {
    if (!file || !target) return;
    if (file.size > 12 * 1024 * 1024) {
      setError('Choose an image smaller than 12 MB.');
      return;
    }
    setBusy(true);
    setError('');
    const uploadFolder = target;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const name = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
      const saved = await api('/media', {
        folder: uploadFolder,
        name,
        data: btoa(binary),
        document: documentPath,
      });
      const item = { ...saved, name, folder: uploadFolder };
      setLibrary((value) => [...value, item]);
      setSelected(item);
      setNatural(null);
      // Reveal a successful upload immediately, even if its name does not match the current global search.
      setSearch('');
      setTarget(uploadFolder);
      setAll(false);
      setFolders((value) => [...new Set([...value, uploadFolder])]);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
      input.current.value = '';
    }
  }
  function branches(nodes) {
    return (
      <ul>
        {nodes.map((node) => (
          <li key={node.path}>
            <div
              className={
                'ce-folder-row ' + (!all && target === node.path ? 'ce-folder-current' : '')
              }
            >
              {node.children.length ? (
                <Button
                  className="ce-folder-toggle"
                  aria-label={
                    (expanded.has(node.path) ? 'Collapse folder ' : 'Expand folder ') + node.path
                  }
                  aria-expanded={expanded.has(node.path)}
                  onClick={() =>
                    setExpanded((value) => {
                      const next = new Set(value);
                      if (next.has(node.path)) next.delete(node.path);
                      else next.add(node.path);
                      return next;
                    })
                  }
                >
                  {expanded.has(node.path) ? '▾' : '▸'}
                </Button>
              ) : (
                <span className="ce-folder-spacer" />
              )}
              <button
                type="button"
                className="ce-folder-name"
                aria-label={'View folder ' + node.path}
                aria-pressed={!all && target === node.path}
                title={node.path}
                onClick={() => chooseFolder(node.path)}
              >
                <span>{node.label}</span>
                {!!node.count && <small>{node.count}</small>}
              </button>
            </div>
            {node.children.length > 0 && expanded.has(node.path) && branches(node.children)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Dialog
      title="Image library"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="ce-media-dialog"
    >
      <div className="ce-media-controls">
        <input
          autoFocus
          aria-label="Search images"
          type="search"
          placeholder="Search images in all folders…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button onClick={() => input.current.click()} disabled={busy || !target || loading}>
          {busy ? 'Uploading…' : 'Upload image'}
        </Button>
        <input
          ref={input}
          hidden
          type="file"
          accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.avif"
          onChange={(event) => upload(event.target.files[0])}
        />
      </div>
      <div className="ce-media-upload-target">
        Upload folder: <strong>{target || 'Choose a folder'}</strong>
      </div>
      {error && (
        <p role="alert" className="ce-error">
          {error}
        </p>
      )}
      <div className="ce-media-workspace">
        <nav aria-label="Image folders" className="ce-media-folders" ref={treePane}>
          <strong>Folders</strong>
          <Button
            className={all ? 'ce-active' : ''}
            onClick={() => setAll(true)}
            aria-pressed={all}
          >
            All images
          </Button>
          {branches(tree)}
        </nav>
        <section className="ce-media-content">
          <p className="ce-media-result-summary">
            {loading
              ? 'Loading images…'
              : files.length +
                ' image' +
                (files.length === 1 ? '' : 's') +
                (searching ? ' · Searching all folders' : all ? ' · All folders' : ' · ' + target)}
          </p>
          <div className="ce-media-grid">
            {files.map((file) => (
              <button
                className={selected?.path === file.path ? 'ce-active' : ''}
                key={file.path}
                aria-pressed={selected?.path === file.path}
                onClick={() => {
                  setSelected(file);
                  setNatural(null);
                }}
              >
                <img
                  loading="lazy"
                  src={ROOT + '/media/file?path=' + encodeURIComponent(file.path)}
                  alt={file.name}
                />
                <span>{file.name}</span>
                {(searching || all) && <small>{folderOf(file)}</small>}
              </button>
            ))}
            {!loading && !files.length && (
              <p className="ce-media-empty">
                {searching
                  ? 'No images match your search.'
                  : 'This folder has no images. You can upload one here.'}
              </p>
            )}
          </div>
          {selected && (
            <section className="ce-media-selection">
              <div className="ce-media-selected-preview">
                <img
                  key={selected.path}
                  src={ROOT + '/media/file?path=' + encodeURIComponent(selected.path)}
                  alt={selected.name}
                  onLoad={(event) =>
                    setNatural({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
              </div>
              <div className="ce-media-selected-properties">
                <strong>{selected.name}</strong>
                <small>
                  {selected.folder}
                  {natural ? ' · ' + natural.width + ' × ' + natural.height + ' px' : ''}
                </small>
                <ImageSizeControls
                  attributes={size}
                  onChange={(value) => setSize(sizeOnly(value))}
                  imageKey={selected.path}
                />
                <p className="ce-muted">
                  Set the size shown on this page. The original image file stays unchanged.
                </p>
              </div>
            </section>
          )}
        </section>
      </div>
      <footer>
        <span>{selected?.path || 'Choose an existing image or upload one.'}</span>
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!selected?.url || busy}
          onClick={() => onChoose({ ...selected, dimensions: size })}
          className="ce-primary"
        >
          Use image
        </Button>
      </footer>
    </Dialog>
  );
}
