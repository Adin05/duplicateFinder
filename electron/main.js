const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, dialog, ipcMain, nativeImage } = require('electron');

const { runDuplicateFinder } = require('../engine');

let mainWindow = null;
let isRunning = false;
const approvedDirectoryTokens = new Map();
const rendererUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString();
const iconPath = process.platform === 'win32'
  ? path.join(__dirname, '../build/icon.ico')
  : path.join(__dirname, '../build/icon.png');

function createWindow() {
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#101d18',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    title: 'Duplicate Finder Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      webSecurity: true,
    },
  });

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(rendererUrl);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.personalproject.duplicatefinder');
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

  return registerApprovedDirectory(result.filePaths[0]);
});

ipcMain.handle('scan:start', async (event, payload) => {
  if (event.senderFrame.url !== rendererUrl) {
    throw new Error('Untrusted renderer origin.');
  }

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
  const scanPaths = resolveApprovedDirectories(payload.scanPathTokens, true);
  const excludePaths = resolveApprovedDirectories(payload.excludePathTokens, false);
  const outputPath = resolveApprovedDirectory(payload.outputPathToken);

  return {
    collectEmptyDirs: Boolean(payload.collectEmptyDirs),
    concurrency: Math.max(1, Number.parseInt(payload.concurrency, 10) || 4),
    dryRun: Boolean(payload.dryRun),
    emptyDirOnly: Boolean(payload.emptyDirOnly),
    exclude: excludePaths.join(','),
    output: outputPath,
    paths: scanPaths.join(','),
    zipMode: payload.zipMode === 'contents' ? 'contents' : 'file',
  };
}

function registerApprovedDirectory(directoryPath) {
  const normalizedPath = path.resolve(directoryPath);
  const token = crypto.randomUUID();
  approvedDirectoryTokens.set(token, normalizedPath);
  return {
    path: normalizedPath,
    token,
  };
}

function resolveApprovedDirectories(tokens, required) {
  const normalizedTokens = Array.isArray(tokens) ? tokens : [];
  const resolvedPaths = normalizedTokens.map(resolveApprovedDirectory).filter(Boolean);

  if (required && resolvedPaths.length === 0) {
    throw new Error('No approved scan directories were provided.');
  }

  return resolvedPaths;
}

function resolveApprovedDirectory(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Missing approved directory token.');
  }

  const resolvedPath = approvedDirectoryTokens.get(token);
  if (!resolvedPath) {
    throw new Error('Directory token is not approved by the main process.');
  }

  return resolvedPath;
}
