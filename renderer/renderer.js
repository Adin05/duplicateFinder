const state = {
  excludePaths: [],
  isRunning: false,
  outputPath: null,
  scanPaths: [],
  summary: {
    collectedDirectories: 0,
    duplicateGroups: 0,
    movedFiles: 0,
    savedBytes: 0,
    totalFilesScanned: 0,
  },
};

const elements = {
  addExcludePath: document.getElementById('add-exclude-path'),
  addScanPath: document.getElementById('add-scan-path'),
  clearExcludePaths: document.getElementById('clear-exclude-paths'),
  clearLog: document.getElementById('clear-log'),
  clearScanPaths: document.getElementById('clear-scan-paths'),
  collectEmptyDirs: document.getElementById('collect-empty-dirs'),
  concurrency: document.getElementById('concurrency'),
  dryRun: document.getElementById('dry-run'),
  emptyDirOnly: document.getElementById('empty-dir-only'),
  excludePaths: document.getElementById('exclude-paths'),
  logView: document.getElementById('log-view'),
  metricMode: document.getElementById('metric-mode'),
  metricProgress: document.getElementById('metric-progress'),
  metricSaved: document.getElementById('metric-saved'),
  outputPath: document.getElementById('output-path'),
  pickOutputPath: document.getElementById('pick-output-path'),
  progressBar: document.getElementById('progress-bar'),
  progressDetail: document.getElementById('progress-detail'),
  progressPhase: document.getElementById('progress-phase'),
  runButton: document.getElementById('run-button'),
  scanPaths: document.getElementById('scan-paths'),
  summaryEmpty: document.getElementById('summary-empty'),
  summaryFiles: document.getElementById('summary-files'),
  summaryGroups: document.getElementById('summary-groups'),
  summaryMoved: document.getElementById('summary-moved'),
  zipMode: document.getElementById('zip-mode'),
};

bootstrap();

function bootstrap() {
  elements.outputPath.readOnly = true;
  renderPathList(elements.scanPaths, state.scanPaths, 'No scan paths selected yet.');
  renderPathList(elements.excludePaths, state.excludePaths, 'No excluded paths.');
  renderSummary();
  setProgress('Idle', 'Waiting for configuration', 0);
  appendLog('INFO', 'Desktop app ready. Add folders, choose output, then start.');

  elements.addScanPath.addEventListener('click', async () => {
    const selected = await window.duplicateFinderApi.pickDirectory();
    if (selected && !state.scanPaths.some((entry) => entry.token === selected.token)) {
      state.scanPaths.push(selected);
      renderPathList(elements.scanPaths, state.scanPaths, 'No scan paths selected yet.');
    }
  });

  elements.addExcludePath.addEventListener('click', async () => {
    const selected = await window.duplicateFinderApi.pickDirectory();
    if (selected && !state.excludePaths.some((entry) => entry.token === selected.token)) {
      state.excludePaths.push(selected);
      renderPathList(elements.excludePaths, state.excludePaths, 'No excluded paths.');
    }
  });

  elements.pickOutputPath.addEventListener('click', async () => {
    const selected = await window.duplicateFinderApi.pickDirectory();
    if (selected) {
      state.outputPath = selected;
      elements.outputPath.value = selected.path;
    }
  });

  elements.clearScanPaths.addEventListener('click', () => {
    state.scanPaths = [];
    renderPathList(elements.scanPaths, state.scanPaths, 'No scan paths selected yet.');
  });

  elements.clearExcludePaths.addEventListener('click', () => {
    state.excludePaths = [];
    renderPathList(elements.excludePaths, state.excludePaths, 'No excluded paths.');
  });

  elements.clearLog.addEventListener('click', () => {
    elements.logView.innerHTML = '';
  });

  elements.emptyDirOnly.addEventListener('change', () => {
    const disabled = elements.emptyDirOnly.checked;
    elements.zipMode.disabled = disabled;
    elements.concurrency.disabled = disabled;
    elements.collectEmptyDirs.disabled = disabled;
  });

  elements.runButton.addEventListener('click', runScan);

  window.duplicateFinderApi.onLog((entry) => {
    appendLog(entry.level, entry.message);
  });

  window.duplicateFinderApi.onProgress((progress) => {
    handleProgress(progress);
  });
}

async function runScan() {
  if (state.isRunning) {
    return;
  }

  if (state.scanPaths.length === 0) {
    appendLog('ERROR', 'Please add at least one scan path.');
    return;
  }

  if (!state.outputPath) {
    appendLog('ERROR', 'Please choose an output folder.');
    return;
  }

  setRunning(true);
  setProgress('Preparing', 'Validating configuration', 6);
  appendLog('INFO', 'Starting desktop scan...');

  try {
    const result = await window.duplicateFinderApi.startScan({
      collectEmptyDirs: elements.collectEmptyDirs.checked,
      concurrency: elements.concurrency.value,
      dryRun: elements.dryRun.checked,
      emptyDirOnly: elements.emptyDirOnly.checked,
      excludePathTokens: state.excludePaths.map((entry) => entry.token),
      outputPathToken: state.outputPath.token,
      scanPathTokens: state.scanPaths.map((entry) => entry.token),
      zipMode: elements.zipMode.value,
    });

    state.summary = result.summary;
    renderSummary();
    setProgress(
      'Completed',
      result.summary.dryRun ? 'Dry run finished successfully' : 'Move operation finished successfully',
      100
    );
    elements.metricMode.textContent = result.summary.dryRun ? 'Preview' : 'Applied';
    elements.metricSaved.textContent = formatBytes(result.summary.savedBytes);
    appendLog('INFO', 'Scan completed.');
  } catch (error) {
    setProgress('Failed', error.message, 100);
    elements.metricMode.textContent = 'Failed';
    appendLog('ERROR', error.message);
  } finally {
    setRunning(false);
  }
}

function handleProgress(progress) {
  if (progress.phase === 'scan') {
    elements.metricMode.textContent = 'Scanning';
    elements.metricProgress.textContent = String(progress.current);
    setProgress('Scanning Files', `${progress.current} file(s) discovered`, 20);
    return;
  }

  const percent = progress.total > 0 ? Math.max(24, Math.round((progress.current / progress.total) * 100)) : 24;
  elements.metricMode.textContent = 'Hashing';
  elements.metricProgress.textContent = `${progress.current}/${progress.total}`;
  setProgress('Hashing Candidates', `${progress.current} of ${progress.total} candidate(s) processed`, percent);
}

function renderPathList(container, items, emptyText) {
  container.innerHTML = '';

  if (items.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = emptyText;
    container.appendChild(emptyState);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'path-item';

    const code = document.createElement('code');
    code.textContent = item.path;

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      const nextItems =
        container === elements.scanPaths
          ? state.scanPaths.filter((entry) => entry.token !== item.token)
          : state.excludePaths.filter((entry) => entry.token !== item.token);

      if (container === elements.scanPaths) {
        state.scanPaths = nextItems;
        renderPathList(elements.scanPaths, state.scanPaths, 'No scan paths selected yet.');
      } else {
        state.excludePaths = nextItems;
        renderPathList(elements.excludePaths, state.excludePaths, 'No excluded paths.');
      }
    });

    row.appendChild(code);
    row.appendChild(removeButton);
    container.appendChild(row);
  });
}

function renderSummary() {
  elements.summaryFiles.textContent = String(state.summary.totalFilesScanned || 0);
  elements.summaryGroups.textContent = String(state.summary.duplicateGroups || 0);
  elements.summaryMoved.textContent = String(state.summary.movedFiles || 0);
  elements.summaryEmpty.textContent = String(state.summary.collectedDirectories || 0);
  elements.metricSaved.textContent = formatBytes(state.summary.savedBytes || 0);
}

function setProgress(phase, detail, percent) {
  elements.progressPhase.textContent = phase;
  elements.progressDetail.textContent = detail;
  elements.progressBar.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
}

function appendLog(level, message) {
  const line = document.createElement('div');
  line.className = `log-line ${level.toLowerCase()}`;
  line.textContent = `[${level}] ${message}`;
  elements.logView.appendChild(line);
  elements.logView.scrollTop = elements.logView.scrollHeight;
}

function setRunning(isRunning) {
  state.isRunning = isRunning;
  elements.runButton.disabled = isRunning;
  elements.runButton.textContent = isRunning ? 'Running...' : 'Start Scan';
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}
