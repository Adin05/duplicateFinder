const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const { runDuplicateFinder } = require('../engine');

let mainWindow = null;
let isRunning = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#101d18',
    title: 'Duplicate Finder Studio',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('dialog:pick-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('scan:start', async (_event, payload) => {
  if (isRunning) {
    throw new Error('A scan is already running.');
  }

  isRunning = true;

  try {
    const summary = await runDuplicateFinder(normalizeUiPayload(payload), {
      onHashProgress: (stats) => {
        mainWindow.webContents.send('scan:progress', {
          current: stats.hashedFiles,
          phase: 'hash',
          total: stats.totalHashCandidates,
        });
      },
      onLog: (entry) => {
        mainWindow.webContents.send('scan:log', entry);
      },
      onScanProgress: (stats) => {
        mainWindow.webContents.send('scan:progress', {
          current: stats.filesScanned,
          phase: 'scan',
          total: 0,
        });
      },
    });

    return { summary };
  } finally {
    isRunning = false;
  }
});

function normalizeUiPayload(payload) {
  return {
    collectEmptyDirs: Boolean(payload.collectEmptyDirs),
    concurrency: Math.max(1, Number.parseInt(payload.concurrency, 10) || 4),
    dryRun: Boolean(payload.dryRun),
    emptyDirOnly: Boolean(payload.emptyDirOnly),
    exclude: Array.isArray(payload.excludePaths) ? payload.excludePaths.join(',') : '',
    output: payload.outputPath || '',
    paths: Array.isArray(payload.scanPaths) ? payload.scanPaths.join(',') : '',
    zipMode: payload.zipMode === 'contents' ? 'contents' : 'file',
  };
}
