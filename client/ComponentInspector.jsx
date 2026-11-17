import React, { useEffect, useState } from 'react';
import { api } from './ui.jsx';
export default function ComponentInspector({ node, editor, onError }) {
  const [fields, setFields] = useState([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api('/component', { source: node.attrs.raw })
      .then((v) => {
        if (active) setFields(v.fields);
      })
      .catch(onError);
    return () => {
      active = false;
    };
  }, [node.attrs.raw]);
  return (
    <section>
      <h3>MDX component</h3>
      {fields.map((field) => (
        <label key={field.key + field.value}>
          {field.label}
          <input
            defaultValue={field.value}
            disabled={busy}
            onBlur={async (event) => {
              if (event.target.value === field.value) return;
              setBusy(true);
              try {
                const value = await api('/component/update', {
                  source: node.attrs.raw,
                  key: field.key,
                  value: event.target.value,
                });
                editor.commands.updateAttributes('sourceBlock', { raw: value.source });
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      ))}
      <details>
        <summary>Component source</summary>
        <label>
          Markup
          <textarea
            aria-label="Selected MDX component markup"
            rows={14}
            value={node.attrs.raw}
            onChange={(e) =>
              editor.commands.updateAttributes('sourceBlock', { raw: e.target.value })
            }
          />
        </label>
      </details>
      <p className="ce-muted">Live preview includes this page’s component code.</p>
    </section>
  );
}
