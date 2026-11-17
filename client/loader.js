if (typeof window !== 'undefined') {
  const existingEntry = () => {
    const button = document.getElementById('docsite-editor-entry');
    if (button) {
      button.textContent = '✎ Edit page';
      button.setAttribute('aria-label', 'Edit page');
    }
    return button;
  };
  const loadEditor = () => {
    if (existingEntry()) return;
    fetch('/__site_editor/session')
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (!session || existingEntry()) return;
        window.__docusaurusSiteEditorSession = session;
        const button = document.createElement('button');
        button.id = 'docsite-editor-entry';
        button.type = 'button';
        button.textContent = '✎ Edit page';
        button.setAttribute('aria-label', 'Edit page');
        Object.assign(button.style, {
          position: 'fixed',
          bottom: '20px',
          right: '24px',
          zIndex: 2000,
          padding: '10px 18px',
          background: '#ff6200',
          color: '#151719',
          border: '1px solid #b94800',
          borderRadius: '6px',
          font: '600 15px Arial',
          cursor: 'pointer',
        });
        document.body.append(button);
        button.onclick = () => {
          if (window.DocusaurusSiteEditor) return window.DocusaurusSiteEditor.open(session);
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = '/__site_editor/assets/editor.css';
          document.head.append(css);
          const script = document.createElement('script');
          script.src = '/__site_editor/assets/editor.js';
          script.onload = () => window.DocusaurusSiteEditor.open(session);
          script.onerror = () => {
            button.textContent = 'Editor failed to load — retry';
          };
          document.head.append(script);
        };
      })
      .catch(() => {});
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', loadEditor, { once: true });
  else loadEditor();
}
