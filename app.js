const fs = require('fs/promises');
const path = require('path');

const { scanDirectories } = require('./scanner');
const { findDuplicateGroups } = require('./hasher');
const { moveDuplicateGroups } = require('./mover');
const {
  createLogger,
  ensureDirectory,
  formatBytes,
  normalizeInputPaths,
  parseArgs,
} = require('./utils');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.paths || !args.output) {
    printHelp('Missing required arguments: --paths and --output');
    process.exitCode = 1;
    return;
  }

  const inputPaths = normalizeInputPaths(args.paths);

  if (inputPaths.length === 0) {
    console.error('No valid scan paths were provided.');
    process.exitCode = 1;
    return;
  }

  const outputPath = path.resolve(args.output);
  await ensureDirectory(outputPath);

  const logger = createLogger(outputPath, args.dryRun);

  logger.info('Starting duplicate scan');
  logger.info(`Scan paths: ${inputPaths.join(', ')}`);
  logger.info(`Output folder: ${outputPath}`);
  logger.info(`Dry run: ${args.dryRun ? 'enabled' : 'disabled'}`);

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
    logger.error('No readable directories were available to scan.');
    process.exitCode = 1;
    return;
  }

  const scanResult = await scanDirectories(validScanPaths, {
    logger,
    onProgress: (stats) => {
      process.stdout.write(`\rScanned files: ${stats.filesScanned}`);
    },
    outputPath,
  });

  process.stdout.write('\n');

  logger.info(`Finished scanning ${scanResult.filesScanned} files.`);
  logger.info(`Skipped directories: ${scanResult.skippedDirectories}`);
  logger.info(`Skipped files: ${scanResult.skippedFiles}`);

  const duplicateResult = await findDuplicateGroups(scanResult.files, {
    logger,
    concurrency: args.concurrency,
    onHashProgress: (stats) => {
      process.stdout.write(
        `\rHashing candidates: ${stats.hashedFiles}/${stats.totalHashCandidates}`
      );
    },
  });

  if (duplicateResult.totalHashCandidates > 0) {
    process.stdout.write('\n');
  }

  const moveResult = await moveDuplicateGroups(duplicateResult.groups, {
    outputPath,
    dryRun: args.dryRun,
    logger,
  });

  printSummary({
    totalFilesScanned: scanResult.filesScanned,
    duplicateGroups: duplicateResult.groups.length,
    duplicateFiles: moveResult.duplicateFiles,
    movedFiles: moveResult.movedFiles,
    savedBytes: duplicateResult.potentialSavedBytes,
    dryRun: args.dryRun,
  });
}

function printHelp(errorMessage) {
  if (errorMessage) {
    console.error(errorMessage);
    console.error('');
  }

  console.log(`Usage:
  node app.js --paths "D:\\,E:\\" --output "D:\\DUPLICATES" [--dry-run] [--concurrency 4]

Arguments:
  --paths         Comma-separated directories to scan
  --output        Destination folder for moved duplicates
  --dry-run       Preview actions without moving files
  --concurrency   Max concurrent hashing streams (default: 4)
  --help          Show this help message
`);
}

function printSummary(summary) {
  console.log('');
  console.log('Scan Summary');
  console.log(`Total files scanned: ${summary.totalFilesScanned}`);
  console.log(`Duplicate groups found: ${summary.duplicateGroups}`);
  console.log(`Duplicate files found: ${summary.duplicateFiles}`);
  console.log(
    `${summary.dryRun ? 'Files that would be moved' : 'Files moved'}: ${summary.movedFiles}`
  );
  console.log(`Total size that could be saved: ${formatBytes(summary.savedBytes)}`);
}

main().catch((error) => {
  console.error('');
  console.error(`Fatal error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
