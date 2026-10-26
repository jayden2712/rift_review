import {app, BrowserWindow, Menu, dialog, shell, session} from 'electron';
import {execFile} from 'node:child_process';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeDesktopData, importDesktopConfig} from './config.js';
import {startDesktopServer, isAppUrl} from './runtime.js';

const directory = dirname(fileURLToPath(import.meta.url));
const argument = name => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1);
app.setName('Rift Review');
app.setAppUserModelId('com.riftreview.desktop');
if (argument('--rift-data-dir')) app.setPath('userData', resolve(argument('--rift-data-dir')));
const userData = app.getPath('userData');
let window, backend, appSession;
let quitting = false,
  importing = false;

async function restart() {
  const {response} = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'Khởi động lại Rift Review',
    message: 'Khởi động lại để áp dụng cấu hình?',
    detail: 'Hãy xuất JSON trước nếu muốn giữ lịch sử SR đang xem. Lịch sử Mayhem đã lưu sẽ được khôi phục.',
    buttons: ['Để sau', 'Khởi động lại'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) {
    // Relaunch the portable wrapper, not its temporary extracted executable.
    const portable = process.env.PORTABLE_EXECUTABLE_FILE;
    app.relaunch(portable ? {execPath: portable, args: process.argv.slice(1)} : {});
    app.quit();
  }
}
async function importSettings() {
  if (importing) return;
  importing = true;
  try {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Chọn .env để thay cấu hình desktop (bản cũ sẽ được sao lưu)',
      properties: ['openFile', 'showHiddenFiles'],
    });
    if (selection.canceled) return;
    await importDesktopConfig(selection.filePaths[0], userData, {overwrite: true});
    await restart();
  } catch {
    dialog.showErrorBox(
      'Không nhập được cấu hình',
      'Kiểm tra file .env và quyền đọc dữ liệu. Cấu hình hiện tại chưa được áp dụng lại.',
    );
  } finally {
    importing = false;
  }
}
function setMenu(config) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Ứng dụng',
        submenu: [
          {label: 'Lịch sử trận', click: () => window.loadURL(backend.origin)},
          {type: 'separator'},
          {label: 'Nhập cấu hình .env…', click: importSettings},
          {
            label: 'Chỉnh cấu hình',
            click: () =>
              execFile('notepad.exe', [join(userData, '.env')], {windowsHide: true}, error => {
                if (error)
                  dialog.showErrorBox(
                    'Không mở được cấu hình',
                    'Mở thư mục dữ liệu và chỉnh file .env bằng trình soạn thảo văn bản.',
                  );
              }),
          },
          {label: 'Mở thư mục dữ liệu', click: () => shell.openPath(userData)},
          {label: 'Khởi động lại', click: restart},
          {type: 'separator'},
          {role: 'quit', label: 'Thoát'},
        ],
      },
      {
        label: 'Chỉnh sửa',
        submenu: [
          {role: 'undo'},
          {role: 'redo'},
          {type: 'separator'},
          {role: 'cut'},
          {role: 'copy'},
          {role: 'paste'},
          {role: 'selectAll'},
        ],
      },
      {
        label: 'Hiển thị',
        submenu: [
          {role: 'reload', label: 'Tải lại'},
          {role: 'resetZoom', label: 'Cỡ mặc định'},
          {role: 'zoomIn', label: 'Phóng to'},
          {role: 'zoomOut', label: 'Thu nhỏ'},
          {role: 'togglefullscreen', label: 'Toàn màn hình'},
        ],
      },
      {
        label: 'Trợ giúp',
        submenu: [
          {
            label: 'Về Rift Review',
            click: () =>
              dialog.showMessageBox(window, {
                type: 'info',
                title: 'Rift Review',
                message: `Rift Review ${app.getVersion()}`,
                detail: `Ứng dụng chạy trên máy này.\nLCU: ${config.env.LCU_ENABLED === '1' ? 'bật' : 'tắt'} · AI: ${config.env.AI_ENABLED === '1' ? 'bật' : 'tắt'} · Data Lab: ${config.env.DATA_LAB_ENABLED === '1' ? 'bật' : 'tắt'}\n\nLịch sử lưu trong trình duyệt cũ có thể chuyển bằng Xuất JSON → Nhập lịch sử.\nỨng dụng độc lập, không liên kết với Riot Games.`,
              }),
          },
        ],
      },
    ]),
  );
}

async function start() {
  const config = await initializeDesktopData({
    userData,
    templateFile: join(directory, 'default.env'),
    importFile: argument('--import-config'),
  });
  backend = await startDesktopServer(config);
  appSession = session.fromPartition('persist:rift-review');
  // Only the existing copy-report action needs a browser permission.
  appSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      permission === 'clipboard-sanitized-write' && isAppUrl(origin, backend.origin),
  );
  appSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL(), backend.origin)),
  );
  appSession.on('will-download', (event, item) => {
    item.setSaveDialogOptions({defaultPath: join(app.getPath('downloads'), item.getFilename())});
  });
  window = new BrowserWindow({
    title: 'Rift Review',
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#080e16',
    show: false,
    icon: join(directory, 'assets', 'icon.png'),
    webPreferences: {
      session: appSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, backend.origin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, backend.origin)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  setMenu(config);
  await window.loadURL(backend.origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !backend) return;
    event.preventDefault();
    quitting = true;
    appSession?.flushStorageData();
    backend.close().then(
      () => app.quit(),
      () => app.quit(),
    );
  });
  app
    .whenReady()
    .then(start)
    .catch(error => {
      dialog.showErrorBox(
        'Không mở được Rift Review',
        error.code === 'EADDRINUSE'
          ? 'Cổng desktop đang được dùng. Đóng bản Rift Review khác và mở lại. Không tự kết nối vào chương trình đang chiếm cổng.'
          : 'Không khởi động được ứng dụng. Kiểm tra file .env trong thư mục dữ liệu Rift Review và quyền truy cập.',
      );
      app.quit();
    });
}
