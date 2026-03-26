const fs = require('fs/promises');
const path = require('path');

const { scanDirectories } = require('./scanner');
const { findDuplicateGroups } = require('./hasher');
const { moveDuplicateGroups } = require('./mover');
const { collectEmptyDirectories } = require('./collector');
const {
  createLogger,
  ensureDirectory,
  normalizeInputPaths,
} = require('./utils');

async function runDuplicateFinder(rawArgs, hooks = {}) {
  const inputPaths = normalizeInputPaths(rawArgs.paths);
  const excludedPaths = normalizeInputPaths(rawArgs.exclude);

  if (inputPaths.length === 0) {
    throw new Error('No valid scan paths were provided.');
  }

  const outputPath = path.resolve(rawArgs.output);
  await ensureDirectory(outputPath);

  const logger = createForwardingLogger(outputPath, rawArgs.dryRun, hooks.onLog);

  logger.info('Starting duplicate scan');
  logger.info(`Scan paths: ${inputPaths.join(', ')}`);
  logger.info(`Output folder: ${outputPath}`);
  logger.info(`Dry run: ${rawArgs.dryRun ? 'enabled' : 'disabled'}`);
  logger.info(`ZIP mode: ${rawArgs.zipMode}`);
  logger.info(`Collect empty dirs: ${rawArgs.collectEmptyDirs ? 'enabled' : 'disabled'}`);
  logger.info(`Empty-dir-only mode: ${rawArgs.emptyDirOnly ? 'enabled' : 'disabled'}`);
  logger.info(
    `Excluded paths: ${excludedPaths.length > 0 ? excludedPaths.join(', ') : '(none)'}`
  );

  const validScanPaths = [];
  for (const scanPath of inputPaths) {
    try {
      const stat = await fs.stat(scanPath);
      if (!stat.isDirectory()) {
        logger.warn(`Skipping non-directory path: ${scanPath}`);
        continue;
      }

      validScanPaths.push(scanPath);
    } catch (error) {
      logger.warn(`Skipping inaccessible path: ${scanPath} (${error.message})`);
    }
  }

  if (validScanPaths.length === 0) {
    throw new Error('No readable directories were available to scan.');
  }

  if (rawArgs.emptyDirOnly) {
    const emptyDirectoryResult = await collectEmptyDirectories(validScanPaths, {
      dryRun: rawArgs.dryRun,
      excludedPaths,
      logger,
      outputPath,
      plannedMovedFiles: [],
    });

    const summary = {
      totalFilesScanned: 0,
      duplicateGroups: 0,
      duplicateFiles: 0,
      movedFiles: 0,
      collectedDirectories: emptyDirectoryResult.collectedDirectories,
      savedBytes: 0,
      dryRun: rawArgs.dryRun,
      outputPath,
    };

    hooks.onSummary?.(summary);
    return summary;
  }

  const scanResult = await scanDirectories(validScanPaths, {
    excludedPaths,
    logger,
    onProgress: (stats) => hooks.onScanProgress?.(stats),
    outputPath,
  });

  logger.info(`Finished scanning ${scanResult.filesScanned} files.`);
  logger.info(`Skipped directories: ${scanResult.skippedDirectories}`);
  logger.info(`Skipped files: ${scanResult.skippedFiles}`);

  const duplicateResult = await findDuplicateGroups(scanResult.files, {
    logger,
    concurrency: rawArgs.concurrency,
    zipMode: rawArgs.zipMode,
    onHashProgress: (stats) => hooks.onHashProgress?.(stats),
  });

  const moveResult = await moveDuplicateGroups(duplicateResult.groups, {
    outputPath,
    dryRun: rawArgs.dryRun,
    logger,
  });

  let emptyDirectoryResult = { collectedDirectories: 0 };
  if (rawArgs.collectEmptyDirs) {
    emptyDirectoryResult = await collectEmptyDirectories(validScanPaths, {
      dryRun: rawArgs.dryRun,
      excludedPaths,
      logger,
      outputPath,
      plannedMovedFiles: moveResult.movedSourcePaths,
    });
  }

  const summary = {
    totalFilesScanned: scanResult.filesScanned,
    duplicateGroups: duplicateResult.groups.length,
    duplicateFiles: moveResult.duplicateFiles,
    movedFiles: moveResult.movedFiles,
    collectedDirectories: emptyDirectoryResult.collectedDirectories,
    savedBytes: duplicateResult.potentialSavedBytes,
    dryRun: rawArgs.dryRun,
    outputPath,
  };

  hooks.onSummary?.(summary);
  return summary;
}

function createForwardingLogger(outputPath, dryRun, onLog) {
  const baseLogger = createLogger(outputPath, dryRun);

  return {
    error(message) {
      onLog?.({ level: 'ERROR', message });
      baseLogger.error(message);
    },
    info(message) {
      onLog?.({ level: 'INFO', message });
      baseLogger.info(message);
    },
    warn(message) {
      onLog?.({ level: 'WARN', message });
      baseLogger.warn(message);
    },
  };
}

module.exports = {
  runDuplicateFinder,
};
