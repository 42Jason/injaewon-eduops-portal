import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb, getDbPath } from './db';
import { seedIfEmpty } from './seed';
import { registerIpc } from './ipc';
import { initAutoUpdater, registerUpdaterIpc, setUpdaterWindow } from './updater';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

/**
 * Crash log — v0.1.12 에서 "창이 1초 후 닫힘" 증상이 보고되었으나 로그가 남지
 * 않아 원인 진단이 불가능했다. userData 아래에 누적 기록해 다음 릴리스부터는
 * 사용자에게 파일을 보내달라고 요청할 수 있게 한다.
 */
function crashLogPath(): string {
  try {
    const dir = app.getPath('userData');
    return path.join(dir, 'crash.log');
  } catch {
    return path.join(process.cwd(), 'crash.log');
  }
}

function writeCrashLog(stage: string, err: unknown) {
  try {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const line = `[${new Date().toISOString()}] [${stage}] ${msg}\n`;
    const p = crashLogPath();
    // v0.1.13 에서는 userData 디렉터리가 없을 때 `appendFileSync` 가 조용히
    // 실패해 crash.log 가 아예 생기지 않았다 (첫 실행이거나 앞선 크래시로
    // openDb 가 `mkdirSync` 에 도달하지 못한 경우). 여기서 한 번 더 만들어준다.
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
    } catch {
      /* noop */
    }
    fs.appendFileSync(p, line, { encoding: 'utf8' });
  } catch {
    // last-resort silent — we never want logging itself to kill the app.
  }
}

/**
 * Node 기본 동작은 `--unhandled-rejections=throw` — 메인 프로세스에서 처리되지
 * 않은 Promise 가 하나라도 생기면 앱이 즉시 종료된다. Electron 에서 이게
 * 트리거되면 BrowserWindow 가 `window-all-closed` 경로로 날아가 "창이 열렸다가
 * 닫힘" 으로 보인다.
 *
 * 이 핸들러가 있으면:
 *   1) 에러는 크래시 로그에 남기고
 *   2) 프로세스는 계속 살려둬 사용자가 어떤 화면에서든 오류 다이얼로그를 본다.
 *   3) 다이얼로그가 닫히면 비로소 앱을 종료 → "언제 왜 죽었는지" 가 투명해진다.
 */
process.on('uncaughtException', (err) => {
  writeCrashLog('uncaughtException', err);
  console.error('[main] uncaughtException:', err);
  try {
    dialog.showErrorBox(
      'EduOps 포털 오류',
      '치명적 오류가 발생했습니다.\n\n' +
        `경로: ${crashLogPath()}\n` +
        '위 파일을 개발팀에 전달하면 원인 분석에 도움이 됩니다.\n\n' +
        String(err instanceof Error ? err.message : err),
    );
  } catch {
    /* dialog 자체가 죽을 수 있음 — 로그만 남기고 넘어간다 */
  }
});

process.on('unhandledRejection', (reason) => {
  writeCrashLog('unhandledRejection', reason);
  console.error('[main] unhandledRejection:', reason);
});

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
    try {
      const protocol = new URL(url).protocol;
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(url);
      } else {
        console.warn('[main] blocked external URL protocol:', protocol);
      }
    } catch {
      console.warn('[main] blocked invalid external URL:', url);
    }
    return { action: 'deny' };
  });

  // 렌더러 프로세스가 죽으면(예: OOM, native crash, 우리 코드의 uncaught error
  // 중 Electron 이 killing 으로 분류한 것) 기본적으로 창이 회색으로 변한 뒤
  // Electron 이 자동 종료 경로를 탈 수 있다. 로그에 남기고, 사용자에게 왜
  // 종료됐는지 알려준 뒤에 종료한다.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeCrashLog('render-process-gone', `reason=${details.reason} exitCode=${details.exitCode}`);
    try {
      dialog.showErrorBox(
        '렌더러 프로세스 종료',
        `렌더러가 '${details.reason}' 이유로 종료됐습니다 (exitCode=${details.exitCode}).\n` +
          `크래시 로그: ${crashLogPath()}`,
      );
    } catch {
      /* noop */
    }
  });

  // 페이지 로드 실패(예: dist/index.html 경로가 깨짐)도 잡는다.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    writeCrashLog('did-fail-load', `code=${code} desc=${desc} url=${url}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // 1) DB bootstrap — 실패해도 창은 띄운다 (최소한 에러 메시지라도 보여줄 수 있게)
  try {
    const db = openDb();
    seedIfEmpty(db);
    console.log(`[main] DB ready at ${getDbPath()}`);
  } catch (err) {
    writeCrashLog('db-bootstrap', err);
    console.error('[main] DB bootstrap failed:', err);
  }

  // 2) IPC / updater 등록 — 각 단계가 독립적으로 방어된다
  try {
    registerIpc({
      version: app.getVersion(),
      platform: process.platform,
      isDev,
    });
  } catch (err) {
    writeCrashLog('registerIpc', err);
    console.error('[main] registerIpc failed:', err);
  }

  try {
    registerUpdaterIpc();
  } catch (err) {
    writeCrashLog('registerUpdaterIpc', err);
    console.error('[main] registerUpdaterIpc failed:', err);
  }

  // 3) Window creation — 실패하면 에러 다이얼로그만이라도 띄운다
  try {
    createWindow();
  } catch (err) {
    writeCrashLog('createWindow', err);
    try {
      dialog.showErrorBox(
        'EduOps 포털 시작 실패',
        `창을 만들 수 없습니다.\n\n${String(err)}\n\n크래시 로그: ${crashLogPath()}`,
      );
    } catch { /* noop */ }
    app.quit();
    return;
  }

  if (mainWindow) setUpdaterWindow(mainWindow);

  // 4) Auto-updater — 여기서 던지는 에러가 제일 무서운 원흉 후보. 창 생성 이후
  //    실행되므로 여기서 터져도 창은 살아있다.
  try {
    initAutoUpdater();
  } catch (err) {
    writeCrashLog('initAutoUpdater', err);
    console.error('[main] initAutoUpdater failed:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createWindow();
        if (mainWindow) setUpdaterWindow(mainWindow);
      } catch (err) {
        writeCrashLog('createWindow(activate)', err);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  closeDb();
});
