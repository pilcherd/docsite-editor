import { installPreviewBridge } from './preview-bridge.js';
let renderId = null;
window.addEventListener('message', (event) => {
  if (event.source !== parent || event.data?.type !== 'render') return;
  try {
    renderId = event.data.renderId;
    if (event.data.error) throw new Error(event.data.error);
    let style = document.getElementById('adapter-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'adapter-styles';
      document.head.append(style);
    }
    style.textContent = event.data.css || '';
    new Function(event.data.code)();
  } catch (error) {
    window.__ceUnmount?.();
    window.__ceUnmount = null;
    document.getElementById('preview-root').textContent = 'Preview: ' + error.message;
  }
});
function ready() {
  installPreviewBridge(document.getElementById('preview-root'), () => renderId);
  parent.postMessage({ type: 'preview-ready' }, '*');
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', ready, { once: true });
else ready();
