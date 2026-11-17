import React, { useEffect, useState } from 'react';
import { api, Dialog, Button } from './ui.jsx';
export default function GitDialog({ onClose, unsaved, onReverted }) {
  const [record, setRecord] = useState(null),
    [selected, setSelected] = useState([]),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(''),
    [diff, setDiff] = useState(null),
    [confirmRevert, setConfirmRevert] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      setRecord(await api('/git/status'));
      setSelected([]);
      setDiff(null);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  const files = record?.files || [],
    available = files.filter((file) => !file.disabled);

  if (confirmRevert)
    return (
      <Dialog
        title="Revert selected files"
        onClose={() => {
          if (!busy) setConfirmRevert(false);
        }}
        wide
      >
        <p>
          Revert these {selected.length} selected file{selected.length === 1 ? '' : 's'} to the last
          commit?
        </p>
        <ul className="ce-revert-files">
          {selected.map((name) => (
            <li key={name}>
              {name}
              {files.find((file) => file.path === name)?.originalPath && (
                <small>
                  {' '}
                  · Restore original name: {files.find((file) => file.path === name).originalPath}
                </small>
              )}
            </li>
          ))}
        </ul>
        <p>
          Saved edits in these files will be discarded. New files will be removed, and renamed or
          deleted files restored. Other files will stay unchanged.
        </p>
        <p className="ce-muted">
          Recovery copies of the files and their staged versions will be kept locally.
        </p>
        {error && (
          <p role="alert" className="ce-error">
            {error}
          </p>
        )}
        <footer>
          <Button disabled={busy} onClick={() => setConfirmRevert(false)}>
            Keep changes
          </Button>
          <Button
            className="ce-danger"
            disabled={busy || unsaved}
            onClick={async () => {
              setBusy(true);
              setError('');
              setSuccess('');
              try {
                const result = await api('/git/revert', {
                  paths: selected,
                  revision: record.revision,
                  confirmed: true,
                });
                setRecord(result.status);
                setSelected([]);
                setDiff(null);
                setConfirmRevert(false);
                setSuccess(
                  'Reverted ' +
                    result.files.length +
                    ' file' +
                    (result.files.length === 1 ? '' : 's') +
                    '. Recovery copy: ' +
                    result.backup,
                );
                try {
                  await onReverted?.(result);
                } catch (error) {
                  setError(
                    'Files were reverted, but the editor could not refresh. Close and reopen it. ' +
                      error.message,
                  );
                }
              } catch (error) {
                setError(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Reverting…' : 'Revert selected files'}
          </Button>
        </footer>
      </Dialog>
    );
  return (
    <Dialog
      title="Commit changes"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="ce-muted">
        Save your pages, select the files to include, and describe your changes. This creates a
        local commit.
      </p>
      {unsaved && (
        <p className="ce-notice">
          You have unsaved editor changes. Close this dialog and save or discard them before
          committing or reverting.
        </p>
      )}
      {error && (
        <p className="ce-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="ce-notice" role="status">
          {success}
        </p>
      )}
      {!record ? (
        <p>Loading changes…</p>
      ) : !record.available ? (
        <p>{record.message}</p>
      ) : (
        <>
          <div className="ce-git-heading">
            <strong>Branch: {record.branch}</strong>
            <span>
              {selected.length} of {files.length} files selected
            </span>
            <Button
              disabled={busy || unsaved || !selected.length}
              onClick={() => {
                setError('');
                setConfirmRevert(true);
              }}
            >
              Revert
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                setSelected(
                  selected.length === available.length ? [] : available.map((f) => f.path),
                )
              }
            >
              {selected.length === available.length ? 'Deselect all' : 'Select all'}
            </Button>
            <Button disabled={busy} onClick={refresh}>
              Refresh
            </Button>
          </div>
          {!files.length ? (
            <p>No saved changes to commit.</p>
          ) : (
            <div className="ce-git-files">
              {files.map((file) => (
                <div key={file.path} className="ce-git-file">
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy || file.disabled}
                      checked={selected.includes(file.path)}
                      onChange={(event) =>
                        setSelected((value) =>
                          event.target.checked
                            ? [...value, file.path]
                            : value.filter((path) => path !== file.path),
                        )
                      }
                    />
                    <span>
                      <strong>{file.path}</strong>
                      <small>
                        {file.originalPath
                          ? 'Renamed from ' + file.originalPath
                          : file.status === '??'
                            ? 'New file'
                            : file.status.includes('D')
                              ? 'Deleted'
                              : file.status.includes('A')
                                ? 'Added'
                                : 'Modified'}
                        {file.reason ? ' · ' + file.reason : ''}
                      </small>
                    </span>
                  </label>
                  <Button
                    disabled={busy || file.disabled}
                    onClick={async () => {
                      try {
                        setDiff({
                          path: file.path,
                          text: (await api('/git/diff?path=' + encodeURIComponent(file.path))).diff,
                        });
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    View changes
                  </Button>
                </div>
              ))}
            </div>
          )}
          {diff && (
            <details open className="ce-git-diff">
              <summary>{diff.path}</summary>
              <pre>{diff.text}</pre>
            </details>
          )}
          <label>
            Commit message
            <textarea
              aria-label="Commit message"
              rows={3}
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you changed and why…"
            />
          </label>
          <p className="ce-muted">
            All saved changes in the selected files are included. Other files already staged in Git
            are kept out of this commit.
          </p>
        </>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          Close
        </Button>
        <Button
          className="ce-primary"
          disabled={busy || unsaved || !record?.available || !selected.length || !message.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            setSuccess('');
            try {
              const result = await api('/git/commit', {
                paths: selected,
                message,
                revision: record.revision,
              });
              setRecord(result.status);
              setSelected([]);
              setMessage('');
              setDiff(null);
              setSuccess(
                'Committed ' +
                  result.files.length +
                  ' file' +
                  (result.files.length === 1 ? '' : 's') +
                  ' · ' +
                  result.commit.slice(0, 8),
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Working…' : 'Commit selected files'}
        </Button>
      </footer>
    </Dialog>
  );
}
