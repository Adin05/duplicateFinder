const { runDuplicateFinder } = require('./engine');
const { formatBytes, parseArgs } = require('./utils');

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

  let sawScanProgress = false;
  let sawHashProgress = false;

  const summary = await runDuplicateFinder(args, {
    onHashProgress: (stats) => {
      sawHashProgress = true;
      process.stdout.write(
        `\rHashing candidates: ${stats.hashedFiles}/${stats.totalHashCandidates}`
      );
    },
    onScanProgress: (stats) => {
      sawScanProgress = true;
      process.stdout.write(`\rScanned files: ${stats.filesScanned}`);
    },
  });

  if (sawScanProgress || sawHashProgress) {
    process.stdout.write('\n');
  }

  printSummary(summary);
}

function printHelp(errorMessage) {
  if (errorMessage) {
    console.error(errorMessage);
    console.error('');
  }

  console.log(`Usage:
  node app.js --paths "D:\\,E:\\" --output "D:\\DUPLICATES" [--dry-run] [--concurrency 4] [--zip-mode file|contents] [--exclude "D:\\OLD_DUPLICATES"] [--collect-empty-dirs]
  node app.js --paths "D:\\,E:\\" --output "D:\\DUPLICATES" [--dry-run] --empty-dir-only

Arguments:
  --paths         Comma-separated directories to scan
  --output        Destination folder for moved duplicates
  --dry-run       Preview actions without moving files
  --concurrency   Max concurrent hashing streams (default: 4)
  --zip-mode      ZIP duplicate strategy: "file" or "contents" (default: file)
  --exclude       Comma-separated folders to skip during scanning
  --collect-empty-dirs
                  Move empty folders into OUTPUT\\empty-folders after file moves
  --empty-dir-only
                  Only collect already-empty folders without scanning file duplicates
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
  console.log(
    `${summary.dryRun ? 'Empty folders that would be collected' : 'Empty folders collected'}: ${summary.collectedDirectories}`
  );
  console.log(`Total size that could be saved: ${formatBytes(summary.savedBytes)}`);
}

main().catch((error) => {
  console.error('');
  console.error(`Fatal error: ${error.stack || error.message}`);
  process.exitCode = 1;
});
