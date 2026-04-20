import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { openDb, closeDb, getDbPath } from './db';
import { seedIfEmpty } from './seed';
import { registerIpc } from './ipc';
import { initAutoUpdater, registerUpdaterIpc, setUpdaterWindow } from './updater';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#0b0d10',
    title: 'EduOps Employee Portal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Kill DevTools entirely in production. F12 / Ctrl+Shift+I / menu —
      // nothing opens it. In dev we still want full debugging.
      devTools: isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Belt-and-suspenders: even if something tries to force-open DevTools
  // in production, slam it shut immediately.
  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Bootstrap DB first so IPC handlers can rely on it
  try {
    const db = openDb();
    seedIfEmpty(db);
    console.log(`[main] DB ready at ${getDbPath()}`);
  } catch (err) {
    console.error('[main] DB bootstrap failed:', err);
  }

  registerIpc({
    version: app.getVersion(),
    platform: process.platform,
    isDev,
  });

  registerUpdaterIpc();

  createWindow();
  if (mainWindow) setUpdaterWindow(mainWindow);
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) setUpdaterWindow(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  closeDb();
});
