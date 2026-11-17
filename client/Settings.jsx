import React, { useEffect, useState } from 'react';
import { api, Button } from './ui.jsx';
export default function SiteSettings({ onError, onSaved, onDirty }) {
  const [record, setRecord] = useState(null),
    [values, setValues] = useState({}),
    [css, setCss] = useState(''),
    [search, setSearch] = useState(''),
    [advanced, setAdvanced] = useState(false),
    [configMode, setConfigMode] = useState(false),
    [configSource, setConfigSource] = useState('');
  function install(value) {
    setRecord(value);
    setValues(Object.fromEntries(value.fields.map((f) => [f.key, f.value])));
    setCss(value.css);
    setConfigSource(value.configSource);
    setConfigMode(!!value.configMessage);
  }
  useEffect(() => {
    api('/settings').then(install).catch(onError);
  }, []);
  const changed =
    !!record &&
    (css !== record.css ||
      (configMode
        ? configSource !== record.configSource
        : record.fields.some((field) => values[field.key] !== field.value)));
  useEffect(() => {
    onDirty?.(changed);
    return () => onDirty?.(false);
  }, [changed]);
  if (!record) return <p>Loading site settings…</p>;
  const names = {
    title: 'Site title',
    tagline: 'Tagline',
    url: 'Public site URL',
    'themeConfig.navbar.title': 'Header title',
    'themeConfig.navbar.logo.alt': 'Logo description',
    'themeConfig.navbar.logo.src': 'Light-mode logo',
    'themeConfig.navbar.logo.srcDark': 'Dark-mode logo',
    'themeConfig.footer.style': 'Footer style',
  };
  const dirty =
    css !== record.css ||
    (configMode
      ? configSource !== record.configSource
      : record.fields.some((field) => values[field.key] !== field.value));
  const colors = [...css.matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})\s*;/g)].filter(
    (match, index, list) => list.findIndex((x) => x[1] === match[1]) === index,
  );
  return (
    <div className="ce-settings-editor">
      <div className="ce-panel-heading">
        <h2>Site settings and styles</h2>
        <Button
          disabled={!dirty}
          onClick={async () => {
            try {
              const saved = await api(
                '/settings',
                {
                  ...(configMode ? { configSource } : { values }),
                  revision: record.revision,
                  stylesheet: record.cssPath,
                  css,
                  cssRevision: record.cssRevision,
                },
                'PUT',
              );
              install(saved);
              onSaved('Site settings saved. The site is reloading its configuration.');
            } catch (error) {
              onError(error);
            }
          }}
        >
          Save site settings
        </Button>
      </div>
      <p className="ce-muted">
        Edit the site header, footer, links and shared styles. Existing dynamic configuration is
        preserved.
      </p>
      <input
        aria-label="Find site setting"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Find header, footer, link or setting…"
      />
      {record.configMessage && <p className="ce-notice">{record.configMessage}</p>}
      <Button disabled={dirty} onClick={() => setConfigMode(!configMode)}>
        {configMode ? 'Literal fields' : 'Configuration source'}
      </Button>
      <div className="ce-settings-grid">
        <section>
          {configMode ? (
            <label>
              {record.configPath}
              <textarea
                className="ce-markup"
                aria-label="Configuration source"
                value={configSource}
                onChange={(e) => setConfigSource(e.target.value)}
              />
            </label>
          ) : (
            record.fields
              .filter((field) => field.key.toLowerCase().includes(search.toLowerCase()))
              .map((field) => (
                <label key={field.key}>
                  {names[field.key] || field.key.replace('themeConfig.', '').replaceAll('.', ' › ')}
                  {field.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={values[field.key]}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.checked })}
                    />
                  ) : (
                    <input
                      value={values[field.key]}
                      type={field.type === 'number' ? 'number' : 'text'}
                      onChange={(e) =>
                        setValues({
                          ...values,
                          [field.key]:
                            field.type === 'number' ? Number(e.target.value) : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))
          )}
        </section>
        <section>
          <label>
            Stylesheet
            <select
              aria-label="Stylesheet file"
              disabled={dirty}
              value={record.cssPath || ''}
              onChange={(e) =>
                api('/settings?stylesheet=' + encodeURIComponent(e.target.value))
                  .then(install)
                  .catch(onError)
              }
            >
              {record.stylesheets.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </label>
          {!record.cssPath && (
            <p>
              No editable stylesheet is configured. Set the plugin's stylesheets option to add one.
            </p>
          )}
          <h3>Theme colors</h3>
          {colors.map((match) => (
            <label key={match[1]}>
              {match[1]}
              <input
                type="color"
                value={match[2]}
                onInput={(e) => {
                  const name = match[1].replace(/[.*+?^$()|[\]\\]/g, '\\$&');
                  setCss(
                    css.replace(
                      new RegExp('(' + name + ':\\s*)#[\\da-fA-F]{6}'),
                      (_, prefix) => prefix + e.target.value,
                    ),
                  );
                }}
              />
            </label>
          ))}
          <Button disabled={!record.cssPath} onClick={() => setAdvanced(!advanced)}>
            {advanced ? 'Hide stylesheet' : 'Edit full stylesheet'}
          </Button>
          {advanced && (
            <label>
              Shared stylesheet
              <textarea
                aria-label="Site stylesheet"
                rows={30}
                value={css}
                onChange={(e) => setCss(e.target.value)}
              />
            </label>
          )}
        </section>
      </div>
    </div>
  );
}
