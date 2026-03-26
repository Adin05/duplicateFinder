const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.txt']);
const SKIP_DIRECTORY_NAMES = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'appdata',
  '$recycle.bin',
  'system volume information',
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    concurrency: 4,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--paths') {
      args.paths = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--output') {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--concurrency') {
      args.concurrency = Math.max(1, Number.parseInt(argv[index + 1], 10) || 4);
      index += 1;
    }
  }

  return args;
}

function normalizeInputPaths(value) {
  return String(value || '')
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => path.resolve(segment));
}

function shouldSkipDirectory(directoryPath) {
  const parts = path.resolve(directoryPath).split(path.sep).filter(Boolean);
  return parts.some((part) => SKIP_DIRECTORY_NAMES.has(part.toLowerCase()));
}

function categorizeExtension(extension) {
  const ext = extension.toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'images';
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'videos';
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return 'documents';
  }

  return 'others';
}

async function ensureDirectory(directoryPath) {
  await fsp.mkdir(directoryPath, { recursive: true });
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    hash.on('error', reject);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

async function getUniqueDestinationPath(directoryPath, filename) {
  const parsed = path.parse(filename);
  let attempt = 0;

  while (true) {
    const candidateName =
      attempt === 0 ? filename : `${parsed.name} (${attempt})${parsed.ext}`;
    const candidatePath = path.join(directoryPath, candidateName);

    try {
      await fsp.access(candidatePath);
      attempt += 1;
    } catch (error) {
      return candidatePath;
    }
  }
}

async function moveFileSafely(sourcePath, destinationPath) {
  await ensureDirectory(path.dirname(destinationPath));

  try {
    await fsp.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(sourcePath);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function createLogger(outputPath, dryRun) {
  const logPath = path.join(outputPath, dryRun ? 'duplicate-finder-dry-run.log' : 'duplicate-finder.log');

  function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    console.log(line);

    try {
      fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    } catch (error) {
      console.error(`[LOGGER] Failed to write log file: ${error.message}`);
    }
  }

  return {
    info(message) {
      return write('INFO', message);
    },
    warn(message) {
      return write('WARN', message);
    },
    error(message) {
      return write('ERROR', message);
    },
  };
}

module.exports = {
  categorizeExtension,
  createLogger,
  ensureDirectory,
  formatBytes,
  getUniqueDestinationPath,
  hashFile,
  moveFileSafely,
  normalizeInputPaths,
  parseArgs,
  shouldSkipDirectory,
};
