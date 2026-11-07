const path = require('node:path');
const { redact } = require('./security');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function codeWebPreferences({ session, preload } = {}) {
  return { ...(session ? { session } : {}), preload: preload || path.join(__dirname, '..', 'code-preload.js'),
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true };
}

// The harness owns its boot marker and graph. Readiness must not depend on a particular composer layout.
function readCodePageState() {
  const boot = document.querySelector('[data-dsh-boot]');
  if (boot) return document.querySelector('[data-dsh-boot-spinner]')
    ? { state: 'loading' } : { state: 'failed', error: boot.textContent.trim().slice(0, 2000) };
  const graph = window.__DSH_BOOT__;
  const mounted = document.querySelector('button,input,textarea,[contenteditable],[role="button"],[role="textbox"]');
  return { state: Array.isArray(graph?.entries) && graph.entries.length > 0 && mounted ? 'ready' : 'loading' };
}

async function waitForCodePage(contents, { signal, timeoutMs = 60_000 } = {}) {
  let finished = false, timer;
  let rejectFailure;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  const abort = () => rejectFailure(new Error('Code page verification was cancelled'));
  const crashed = (_event, details) => rejectFailure(new Error(`The Code renderer stopped: ${details?.reason || 'crashed'}`));
  const destroyed = () => rejectFailure(new Error('The Code renderer was closed before it was ready'));
  contents.on('render-process-gone', crashed);
  contents.on('destroyed', destroyed);
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => rejectFailure(new Error('The Code UI did not finish rendering before the verification deadline')), timeoutMs);
  const poll = async () => {
    while (!finished) {
      if (signal?.aborted) throw new Error('Code page verification was cancelled');
      const result = await contents.executeJavaScript(`(${readCodePageState.toString()})()`);
      if (result?.state === 'failed') throw new Error(`Harness client failed to load: ${redact(result.error || 'unknown plugin failure')}`);
      if (result?.state === 'ready') return;
      await delay(Math.min(250, timeoutMs));
    }
  };
  try { await Promise.race([poll(), failure]); }
  finally {
    finished = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    contents.removeListener('render-process-gone', crashed);
    contents.removeListener('destroyed', destroyed);
  }
}

async function verifyCodePage(url, signal) {
  const { BrowserWindow, WebContentsView, session } = require('electron');
  const probeWindow = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const view = new WebContentsView({ webPreferences: { ...codeWebPreferences({
    session: session.fromPartition(`deepdeck-check-${Date.now()}`),
  }), backgroundThrottling: false } });
  probeWindow.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  const origin = new URL(url).origin;
  contents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault(); });
  const abort = () => {
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
    if (!probeWindow.isDestroyed()) probeWindow.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  let timer;
  try {
    signal.throwIfAborted();
    await Promise.race([contents.loadURL(url), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The candidate Code page did not load')), 60_000);
    })]);
    await waitForCodePage(contents, { signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    abort();
  }
}
module.exports = { verifyCodePage, waitForCodePage, codeWebPreferences };
