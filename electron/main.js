/* ============================================================
   Sukot AI Bot — Electron main process (Windows desktop app)
   Streams AI responses via Node fetch (no CORS limitations).
   ============================================================ */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
const streams = new Map();

function resolveIndex() {
  const candidates = [
    path.join(__dirname, 'web', 'index.html'),      // packaged build
    path.join(__dirname, '..', 'web', 'index.html') // repository layout
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 460,
    minHeight: 500,
    show: false,
    backgroundColor: '#12091f',
    autoHideMenuBar: true,
    title: 'سوکوت AI — دستیار هوشمند فارسی',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(resolveIndex());
  win.once('ready-to-show', () => win.show());

  /* external links (e.g. Telegram channel) always open in the default browser */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---- streaming AI bridge (POST) + one-shot GET (web search) ---- */
ipcMain.on('ai:request', async (event, { id, url, headers, body }) => {
  const ctrl = new AbortController();
  streams.set(id, ctrl);
  try {
    const isGet = body === null || body === undefined;
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers: headers,
      body: isGet ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let t = '';
      try { t = await res.text(); } catch (e) {}
      if (streams.has(id)) { streams.delete(id); event.sender.send('ai:done', id, res.status + '||' + t); }
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !streams.has(id)) break;
      event.sender.send('ai:chunk', id, dec.decode(value, { stream: true }));
    }
    if (streams.has(id)) { streams.delete(id); event.sender.send('ai:done', id, null); }
  } catch (err) {
    if (streams.has(id)) {
      streams.delete(id);
      event.sender.send('ai:done', id, err && err.name === 'AbortError' ? null : '000||خطای شبکه: ' + (err && err.message));
    }
  }
});

ipcMain.on('ai:cancel', (event, id) => {
  const c = streams.get(id);
  if (c) { streams.delete(id); try { c.abort(); } catch (e) {} }
});

/* open a link in the system browser (renderer asks via preload) */
ipcMain.on('open-external', (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ---- v1.5.0: save a generated image (data URL) into Downloads ---- */
ipcMain.handle('save-image', async (event, { name, dataUrl }) => {
  try {
    const b64 = String(dataUrl || '').split(',')[1] || '';
    if (!b64) return '';
    const buf = Buffer.from(b64, 'base64');
    const dir = app.getPath('downloads');
    const file = path.join(dir, name || ('sukot-image-' + Date.now() + '.jpg'));
    fs.writeFileSync(file, buf);
    return file;
  } catch (e) {
    return '';
  }
});
