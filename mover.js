const fs = require('fs/promises');
const path = require('path');

const {
  categorizeExtension,
  ensureDirectory,
  formatBytes,
  getUniqueDestinationPath,
  moveFileSafely,
} = require('./utils');

async function moveDuplicateGroups(groups, options) {
  const result = {
    duplicateFiles: 0,
    movedFiles: 0,
    movedSourcePaths: [],
  };

  const categoryDirs = ['images', 'videos', 'documents', 'others', 'zip'];
  for (const category of categoryDirs) {
    await ensureDirectory(path.join(options.outputPath, category));
  }

  let zipGroupIndex = 0;

  for (const group of groups) {
    result.duplicateFiles += group.length;

    const zipFiles = group.filter((file) => file.ext === '.zip');
    const normalFiles = group.filter((file) => file.ext !== '.zip');
    const hasZipFiles = zipFiles.length > 0;
    const hasOnlyZipFiles = hasZipFiles && normalFiles.length === 0;
    const zipGroupFolderName = hasZipFiles
      ? `group-${String(zipGroupIndex + 1).padStart(3, '0')}`
      : null;

    if (hasZipFiles) {
      zipGroupIndex += 1;
      options.logger.info(
        `ZIP duplicate group destination: ${path.join(options.outputPath, 'zip', zipGroupFolderName)}`
      );
    }

    if (normalFiles.length > 0) {
      options.logger.info(`Keeping original: ${normalFiles[0].path}`);
    }

    const filesToMove = [];
    if (hasOnlyZipFiles) {
      filesToMove.push(...zipFiles);
    } else {
      filesToMove.push(...normalFiles.slice(1));
      filesToMove.push(...zipFiles);
    }

    for (const file of filesToMove) {
      const destinationDir = file.ext === '.zip'
        ? path.join(options.outputPath, 'zip', zipGroupFolderName)
        : path.join(options.outputPath, categorizeExtension(file.ext));
      const destinationPath = await getUniqueDestinationPath(destinationDir, file.name);

      if (options.dryRun) {
        options.logger.info(
          `[DRY-RUN] Move ${file.path} -> ${destinationPath} (${formatBytes(file.size)})`
        );
      } else {
        await moveFileSafely(file.path, destinationPath);
        options.logger.info(`Moved ${file.path} -> ${destinationPath} (${formatBytes(file.size)})`);
      }

      result.movedFiles += 1;
      result.movedSourcePaths.push(file.path);
    }
  }

  return result;
}

module.exports = {
  moveDuplicateGroups,
};
