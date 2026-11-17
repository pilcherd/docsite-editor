import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, session, Dialog, Button } from './ui.jsx';
import {
  buildLinkTree,
  filterLinkTree,
  openLinkBranches,
  pageLabel,
  pageTarget,
  findLinkedPage,
  validateLink,
} from './link-tree.js';
export default function LinkDialog({ pages, initialUrl, onApply, onRemove, onClose }) {
  const [address, setAddress] = useState(initialUrl || ''),
    [query, setQuery] = useState(''),
    [records, setRecords] = useState([]),
    [loading, setLoading] = useState(true),
    [expanded, setExpanded] = useState(new Set()),
    [error, setError] = useState('');
  const treePane = useRef(null);
  const tree = useMemo(() => buildLinkTree(pages, session.collections, records), [pages, records]);
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      (session.navigation || []).map((descriptor) =>
        api('/navigation?navigation=' + encodeURIComponent(descriptor.id)),
      ),
    ).then((results) => {
      if (!cancelled) {
        setRecords(results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const initial = openLinkBranches(tree, address, session.baseUrl);
    setExpanded((value) => new Set([...value, ...initial]));
  }, [tree, address]);
  const selected = findLinkedPage(pages, address, session.baseUrl);
  const shown = filterLinkTree(tree, query);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pane = treePane.current,
        row = pane?.querySelector('.ce-link-selected');
      if (!row?.getClientRects().length) return;
      const bounds = pane.getBoundingClientRect(),
        target = row.getBoundingClientRect();
      if (target.top < bounds.top || target.bottom > bounds.bottom)
        pane.scrollTop += target.top - bounds.top - pane.clientHeight / 2 + target.height / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [tree, address, query, expanded]);
  function choose(page) {
    setAddress(pageTarget(page, session.baseUrl));
    setError('');
  }
  function nodes(list) {
    return (
      <ul>
        {list.map((node) => (
          <li key={node.key}>
            {node.children ? (
              <details open={!!query.trim() || expanded.has(node.key)}>
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    setExpanded((value) => {
                      const next = new Set(value);
                      if (next.has(node.key)) next.delete(node.key);
                      else next.add(node.key);
                      return next;
                    });
                  }}
                >
                  {node.label}
                </summary>
                {nodes(node.children)}
              </details>
            ) : (
              <button
                type="button"
                className={
                  selected &&
                  selected.path === node.page.path &&
                  selected.collection === node.page.collection
                    ? 'ce-link-selected'
                    : ''
                }
                aria-pressed={
                  !!selected &&
                  selected.path === node.page.path &&
                  selected.collection === node.page.collection
                }
                onClick={() => choose(node.page)}
              >
                {node.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Dialog title="Link" onClose={onClose} wide>
      <p className="ce-muted">
        Choose a page from the site, or type an address for any other destination.
      </p>
      <div className="ce-link-layout">
        <section className="ce-link-picker">
          <label>
            Site pages
            <input
              autoFocus
              aria-label="Find a page to link to"
              placeholder="Search page titles or sections…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {loading && (
            <small className="ce-muted" role="status">
              Loading site sections…
            </small>
          )}
          <nav ref={treePane} aria-label="Site page tree" className="ce-link-tree">
            {shown.length ? (
              nodes(shown)
            ) : (
              <p className="ce-muted">
                {query ? 'No matching pages.' : 'No pages are available in this checkout.'}
              </p>
            )}
          </nav>
        </section>
        <section className="ce-link-destination">
          <h3>Destination</h3>
          {selected ? (
            <div className="ce-link-choice">
              <strong>{pageLabel(selected)}</strong>
              <small>Page in this site</small>
            </div>
          ) : (
            <p className="ce-muted">Select a page on the left, or enter a link below.</p>
          )}
          <label>
            Link address
            <input
              aria-label="Link address"
              type="text"
              value={address}
              placeholder="https://example.com, /page, #section or mailto:…"
              onChange={(event) => {
                setAddress(event.target.value);
                setError('');
              }}
            />
          </label>
          <p className="ce-muted">
            The address is filled in when you choose a page. You can also type or edit it directly.
          </p>
          {error && (
            <p className="ce-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      <footer>
        <Button onClick={onRemove}>Remove link</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          className="ce-primary"
          disabled={!address.trim()}
          onClick={() => {
            const message = validateLink(address);
            if (message) {
              setError(message);
              return;
            }
            try {
              onApply({
                href: address.trim(),
                title: selected ? pageLabel(selected) : address.trim(),
              });
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          Apply link
        </Button>
      </footer>
    </Dialog>
  );
}
