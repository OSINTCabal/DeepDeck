const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

class View {
  constructor() {
    this.visible = false;
    const contents = this.webContents = new EventEmitter();
    contents.isDestroyed = () => Boolean(contents.closed);
    contents.close = () => { contents.closed = true; contents.emit('destroyed'); };
    contents.setWindowOpenHandler = () => {};
    contents.loadURL = async () => {};
    contents.focus = () => {};
    contents.executeJavaScript = async () => ({ state: 'ready' });
  }
  setBounds() {}
  setVisible(value) { this.visible = value; }
  setBackgroundColor() {}
}

const originalLoad = Module._load;
let createViewManager;
try {
  Module._load = function(name, ...args) {
    return name === 'electron' ? { WebContentsView: View } : originalLoad.call(this, name, ...args);
  };
  ({ createViewManager } = require('../lib/views'));
} finally { Module._load = originalLoad; }

test('Code stays behind the startup panel until mounted, and crashes reveal the panel again', async () => {
  const window = { isDestroyed: () => false, getContentSize: () => [1280, 900],
    webContents: { getZoomFactor: () => 1 }, contentView: { addChildView() {}, removeChildView() {} } };
  let clears = 0;
  const manager = createViewManager({ getWindow: () => window,
    codeSession: { async clearCache() { clears++; } } });
  manager.setMode('code');
  const view = manager.createCode('http://127.0.0.1:9999/');
  assert.equal(view.visible, false, 'the unmounted native view must not cover startup diagnostics');
  view.webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.state().code.state, 'ready');
  assert.equal(view.visible, true);
  view.webContents.emit('did-start-loading');
  assert.equal(view.visible, false, 'reload must reveal loading progress');
  view.webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.visible, true);
  view.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(manager.state().code.state, 'error');
  assert.equal(view.visible, false, 'renderer errors must remain visible in the shell');
  await manager.resetCodeCache();
  assert.equal(view.webContents.closed, true);
  assert.equal(clears, 1);
});
