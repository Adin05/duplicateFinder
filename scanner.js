const fs = require('fs/promises');
const path = require('path');

const { shouldSkipDirectory } = require('./utils');

async function scanDirectories(rootPaths, options) {
  const files = [];
  const state = {
    discoveryIndex: 0,
    filesScanned: 0,
    skippedDirectories: 0,
    skippedFiles: 0,
  };

  for (const rootPath of rootPaths) {
    await scanDirectory(rootPath, options.outputPath, files, state, options);
  }

  return {
    files,
    ...state,
  };
}

async function scanDirectory(currentPath, outputPath, files, state, options) {
  let entries;

  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    state.skippedDirectories += 1;
    options.logger.warn(`Cannot read directory: ${currentPath} (${error.code || error.message})`);
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (outputPath && isSamePath(entryPath, outputPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entryPath)) {
        state.skippedDirectories += 1;
        options.logger.info(`Skipping system directory: ${entryPath}`);
        continue;
      }

      await scanDirectory(entryPath, outputPath, files, state, options);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    try {
      const stat = await fs.stat(entryPath);
      files.push({
        path: entryPath,
        size: stat.size,
        ext: path.extname(entry.name).toLowerCase(),
        name: entry.name,
        discoveryIndex: state.discoveryIndex,
      });
      state.discoveryIndex += 1;
      state.filesScanned += 1;

      if (options.onProgress) {
        options.onProgress({ filesScanned: state.filesScanned });
      }
    } catch (error) {
      state.skippedFiles += 1;
      options.logger.warn(`Cannot access file: ${entryPath} (${error.code || error.message})`);
    }
  }
}

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

module.exports = {
  scanDirectories,
};
