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
const DUPLICATE_OUTPUT_DIR_PATTERN = /^duplicates(?:[_ -].+)?$/i;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    concurrency: 4,
    help: false,
    collectEmptyDirs: false,
    emptyDirOnly: false,
    zipMode: 'file',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (token === '--collect-empty-dirs') {
      args.collectEmptyDirs = true;
      continue;
    }

    if (token === '--empty-dir-only') {
      args.emptyDirOnly = true;
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

    if (token === '--exclude') {
      args.exclude = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === '--concurrency') {
      args.concurrency = Math.max(1, Number.parseInt(argv[index + 1], 10) || 4);
      index += 1;
      continue;
    }

    if (token === '--zip-mode') {
      const value = String(argv[index + 1] || '').toLowerCase();
      args.zipMode = value === 'contents' ? 'contents' : 'file';
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

function shouldSkipDirectory(directoryPath, excludedPaths = [], outputPath) {
  const resolvedPath = path.resolve(directoryPath);
  const parts = path.resolve(directoryPath).split(path.sep).filter(Boolean);
  if (parts.some((part) => SKIP_DIRECTORY_NAMES.has(part.toLowerCase()))) {
    return true;
  }

  if (outputPath && isSamePath(resolvedPath, outputPath)) {
    return true;
  }

  if (excludedPaths.some((excludedPath) => isSamePath(resolvedPath, excludedPath))) {
    return true;
  }

  const directoryName = path.basename(resolvedPath);
  return DUPLICATE_OUTPUT_DIR_PATTERN.test(directoryName);
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

async function getZipContentSignature(filePath) {
  const fileHandle = await fsp.open(filePath, 'r');

  try {
    const stat = await fileHandle.stat();
    const tailLength = Math.min(stat.size, 22 + 0xffff);
    const tailBuffer = Buffer.alloc(tailLength);

    await fileHandle.read(tailBuffer, 0, tailLength, stat.size - tailLength);

    const eocdOffset = findEndOfCentralDirectory(tailBuffer);
    if (eocdOffset === -1) {
      throw new Error('End of central directory record not found');
    }

    const centralDirectorySize = tailBuffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = tailBuffer.readUInt32LE(eocdOffset + 16);

    if (
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new Error('ZIP64 archives are not supported for content mode');
    }

    const directoryBuffer = Buffer.alloc(centralDirectorySize);
    await fileHandle.read(directoryBuffer, 0, centralDirectorySize, centralDirectoryOffset);

    const entries = [];
    let offset = 0;

    while (offset < directoryBuffer.length) {
      if (offset + 46 > directoryBuffer.length) {
        throw new Error('Central directory entry is truncated');
      }

      const signature = directoryBuffer.readUInt32LE(offset);
      if (signature !== 0x02014b50) {
        throw new Error('Invalid central directory header signature');
      }

      const flags = directoryBuffer.readUInt16LE(offset + 8);
      const crc32 = directoryBuffer.readUInt32LE(offset + 16);
      const compressedSize = directoryBuffer.readUInt32LE(offset + 20);
      const uncompressedSize = directoryBuffer.readUInt32LE(offset + 24);
      const fileNameLength = directoryBuffer.readUInt16LE(offset + 28);
      const extraFieldLength = directoryBuffer.readUInt16LE(offset + 30);
      const commentLength = directoryBuffer.readUInt16LE(offset + 32);
      const localHeaderOffset = directoryBuffer.readUInt32LE(offset + 42);

      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        throw new Error('ZIP64 entries are not supported for content mode');
      }

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLength;
      if (nameEnd > directoryBuffer.length) {
        throw new Error('ZIP filename data is truncated');
      }

      const nameBuffer = directoryBuffer.subarray(nameStart, nameEnd);
      const encoding = (flags & 0x0800) !== 0 ? 'utf8' : 'latin1';
      const entryName = nameBuffer.toString(encoding).replace(/\\/g, '/');

      if (!entryName.endsWith('/')) {
        entries.push(`${entryName}|${uncompressedSize}|${crc32.toString(16).padStart(8, '0')}`);
      }

      offset = nameEnd + extraFieldLength + commentLength;
    }

    entries.sort();

    const manifest = entries.join('\n');
    return `contents:${crypto.createHash('md5').update(manifest).digest('hex')}`;
  } finally {
    await fileHandle.close();
  }
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
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

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

module.exports = {
  categorizeExtension,
  createLogger,
  ensureDirectory,
  formatBytes,
  getUniqueDestinationPath,
  getZipContentSignature,
  hashFile,
  isSamePath,
  moveFileSafely,
  normalizeInputPaths,
  parseArgs,
  shouldSkipDirectory,
};
