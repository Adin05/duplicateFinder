const fs = require('fs/promises');
const path = require('path');

const {
  ensureDirectory,
  getUniqueDestinationPath,
  isSamePath,
  shouldSkipDirectory,
} = require('./utils');

async function collectEmptyDirectories(rootPaths, options) {
  const emptyRoot = path.join(options.outputPath, 'empty-folders');
  await ensureDirectory(emptyRoot);
  const plannedMovedFiles = new Set((options.plannedMovedFiles || []).map((filePath) => path.resolve(filePath)));

  let collectedDirectories = 0;

  for (const rootPath of rootPaths) {
    const rootLabel = sanitizeRootLabel(rootPath);
    const rootDestination = path.join(emptyRoot, rootLabel);
    await ensureDirectory(rootDestination);

    const discovery = await discoverCollectibleEmptyDirectories(rootPath, rootPath, {
      ...options,
      plannedMovedFiles,
    });
    collectedDirectories += await moveCollectedDirectories(
      discovery.candidates,
      rootPath,
      rootDestination,
      options
    );
  }

  return { collectedDirectories };
}

async function discoverCollectibleEmptyDirectories(currentPath, rootPath, options) {
  let entries;

  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    options.logger.warn(
      `Cannot inspect directory for empty-folder collection: ${currentPath} (${error.code || error.message})`
    );
    return { candidates: [], effectivelyEmpty: false };
  }

  let effectivelyEmpty = true;
  let candidates = [];

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isFile()) {
      if (!options.plannedMovedFiles.has(path.resolve(entryPath))) {
        effectivelyEmpty = false;
      }
      continue;
    }

    if (!entry.isDirectory()) {
      effectivelyEmpty = false;
      continue;
    }

    if (shouldSkipDirectory(entryPath, options.excludedPaths || [], options.outputPath)) {
      effectivelyEmpty = false;
      continue;
    }

    const childDiscovery = await discoverCollectibleEmptyDirectories(entryPath, rootPath, options);
    if (!childDiscovery.effectivelyEmpty) {
      effectivelyEmpty = false;
      candidates = candidates.concat(childDiscovery.candidates);
    } else if (!isSamePath(currentPath, rootPath)) {
      candidates = candidates.concat(childDiscovery.candidates);
    } else {
      candidates = candidates.concat(childDiscovery.candidates);
    }
  }

  if (isSamePath(currentPath, rootPath)) {
    return { candidates, effectivelyEmpty: false };
  }

  if (effectivelyEmpty) {
    return {
      candidates: [currentPath],
      effectivelyEmpty: true,
    };
  }

  return {
    candidates,
    effectivelyEmpty: false,
  };
}

async function moveCollectedDirectories(candidates, rootPath, rootDestination, options) {
  let collected = 0;

  for (const currentPath of candidates) {
    const relativePath = path.relative(rootPath, currentPath);
    const relativeParent = path.dirname(relativePath);
    const targetParent =
      relativeParent === '.' ? rootDestination : path.join(rootDestination, relativeParent);
    await ensureDirectory(targetParent);

    const destinationPath = await getUniqueDestinationPath(targetParent, path.basename(currentPath));

    if (options.dryRun) {
      options.logger.info(`[DRY-RUN] Collect empty folder ${currentPath} -> ${destinationPath}`);
    } else {
      await fs.rename(currentPath, destinationPath);
      options.logger.info(`Collected empty folder ${currentPath} -> ${destinationPath}`);
    }

    collected += 1;
  }

  return collected;
}

function sanitizeRootLabel(rootPath) {
  const resolvedPath = path.resolve(rootPath);
  const parsed = path.parse(resolvedPath);
  const driveLabel = parsed.root
    ? parsed.root.replace(/[\\/:]+/g, '').toUpperCase()
    : 'ROOT';
  const relativePart = path
    .relative(parsed.root || resolvedPath, resolvedPath)
    .replace(/[\\/]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!relativePart) {
    return `${driveLabel}_drive`;
  }

  return `${driveLabel}_drive_${relativePart}`;
}

module.exports = {
  collectEmptyDirectories,
};
