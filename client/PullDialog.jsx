import React, { useEffect, useState } from 'react';
import { api, Dialog, Button } from './ui.jsx';

export default function PullDialog({ onClose, onPulled, unsaved }) {
  const [record, setRecord] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setRecord(await api('/git/status'));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  return (
    <Dialog
      title="Pull from Git"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {!record ? (
        <p>Checking the checkout…</p>
      ) : !record.available ? (
        <p>{record.message}</p>
      ) : (
        <>
          <p>
            Pull updates from <strong>{record.pull?.upstream || 'the tracking branch'}</strong> into
            this local checkout?
          </p>
          <p>
            Saved local edits are allowed. Git will stop if incoming changes would overwrite them.
            No files are automatically stashed or discarded.
          </p>
          {unsaved && (
            <p className="ce-notice">
              Your unsaved editor drafts will stay open. If the same file changes on disk, review
              those changes before saving your draft.
            </p>
          )}
          <p className="ce-muted">
            This uses fast-forward only and does not push or create a merge commit. Local merge
            hooks are disabled. Resolve conflicts or diverged branches outside this editor.
          </p>
          {record.pull?.reason && (
            <p role="alert" className="ce-error">
              {record.pull.reason}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="ce-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="ce-notice">
          {success}
        </p>
      )}
      <footer>
        <Button disabled={busy} onClick={onClose}>
          Close
        </Button>
        <Button disabled={busy} onClick={refresh}>
          Refresh
        </Button>
        <Button
          className="ce-primary"
          disabled={busy || !record?.pull?.available}
          onClick={async () => {
            setBusy(true);
            setError('');
            setSuccess('');
            try {
              const result = await api('/git/pull', { confirmed: true, revision: record.revision });
              setRecord(result.status);
              setSuccess(
                result.updated
                  ? 'Pulled updates from ' + result.upstream + '.'
                  : 'Already up to date.',
              );
              if (result.updated) {
                try {
                  await onPulled?.(result);
                } catch (error) {
                  setError(
                    'Git updated the checkout, but the editor could not refresh. Your drafts are still open. ' +
                      error.message,
                  );
                }
              }
            } catch (error) {
              setError(error.message);
              // A failed fetch can update tracking refs. Use a fresh review for the next attempt.
              try {
                setRecord(await api('/git/status'));
              } catch {}
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Pulling…' : 'Pull updates'}
        </Button>
      </footer>
    </Dialog>
  );
}
