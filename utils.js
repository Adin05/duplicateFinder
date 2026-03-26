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
const CRC32_TABLE = createCrc32Table();

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

function getFileCrc32(filePath) {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff;
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => {
      crc = updateCrc32(crc, chunk);
    });
    stream.on('end', () => {
      const normalized = (crc ^ 0xffffffff) >>> 0;
      resolve(normalized.toString(16).padStart(8, '0'));
    });
  });
}

async function getZipContentAnalysis(filePath) {
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

    const tailStartOffset = stat.size - tailLength;
    const zipMeta = await resolveZipCentralDirectoryMeta(
      fileHandle,
      tailBuffer,
      eocdOffset,
      tailStartOffset
    );
    const centralDirectorySize = zipMeta.centralDirectorySize;
    const centralDirectoryOffset = zipMeta.centralDirectoryOffset;

    const directoryBuffer = Buffer.alloc(centralDirectorySize);
    await fileHandle.read(directoryBuffer, 0, centralDirectorySize, centralDirectoryOffset);

    const entries = [];
    const entryKeys = [];
    const entryBaseSizeKeys = [];
    const entryNameCounts = new Map();
    const baseNameCounts = new Map();
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

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLength;
      if (nameEnd > directoryBuffer.length) {
        throw new Error('ZIP filename data is truncated');
      }
      const extraStart = nameEnd;
      const extraEnd = extraStart + extraFieldLength;
      if (extraEnd > directoryBuffer.length) {
        throw new Error('ZIP extra field data is truncated');
      }

      const nameBuffer = directoryBuffer.subarray(nameStart, nameEnd);
      const extraBuffer = directoryBuffer.subarray(extraStart, extraEnd);
      const encoding = (flags & 0x0800) !== 0 ? 'utf8' : 'latin1';
      const entryName = nameBuffer.toString(encoding).replace(/\\/g, '/');
      const baseName = path.posix.basename(entryName);
      const resolvedEntry = resolveZip64EntryValues(
        {
          compressedSize,
          localHeaderOffset: directoryBuffer.readUInt32LE(offset + 42),
          uncompressedSize,
        },
        extraBuffer
      );

      if (!entryName.endsWith('/')) {
        entries.push(
          `${entryName}|${resolvedEntry.uncompressedSize}|${crc32.toString(16).padStart(8, '0')}`
        );
        entryKeys.push(
          `${path.posix.basename(entryName).toLowerCase()}|${resolvedEntry.uncompressedSize}|${crc32
            .toString(16)
            .padStart(8, '0')}`
        );
        entryBaseSizeKeys.push(
          `${path.posix.basename(entryName).toLowerCase()}|${resolvedEntry.uncompressedSize}`
        );
        entryNameCounts.set(entryName, (entryNameCounts.get(entryName) || 0) + 1);
        baseNameCounts.set(baseName, (baseNameCounts.get(baseName) || 0) + 1);
      }

      offset = extraEnd + commentLength;
    }

    entries.sort();

    const manifest = entries.join('\n');
    return {
      signature: `contents:${crypto.createHash('md5').update(manifest).digest('hex')}`,
      duplicateBaseNames: collectDuplicateKeys(baseNameCounts),
      duplicateEntryNames: collectDuplicateKeys(entryNameCounts),
      entryBaseSizeKeys,
      entryKeys,
      entryCount: entries.length,
    };
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

async function resolveZipCentralDirectoryMeta(fileHandle, tailBuffer, eocdOffset, tailStartOffset) {
  const standardSize = tailBuffer.readUInt32LE(eocdOffset + 12);
  const standardOffset = tailBuffer.readUInt32LE(eocdOffset + 16);

  if (standardSize !== 0xffffffff && standardOffset !== 0xffffffff) {
    return {
      centralDirectoryOffset: standardOffset,
      centralDirectorySize: standardSize,
    };
  }

  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || tailBuffer.readUInt32LE(locatorOffset) !== 0x07064b50) {
    throw new Error('ZIP64 locator not found');
  }

  const zip64EocdAbsoluteOffset = readUInt64LEAsSafeNumber(tailBuffer, locatorOffset + 8);
  const zip64Header = await readBuffer(fileHandle, 56, zip64EocdAbsoluteOffset);
  if (zip64Header.readUInt32LE(0) !== 0x06064b50) {
    throw new Error('Invalid ZIP64 end of central directory signature');
  }

  const zip64RecordSize = readUInt64LEAsSafeNumber(zip64Header, 4);
  if (zip64RecordSize < 44) {
    throw new Error('Invalid ZIP64 end of central directory size');
  }

  const centralDirectorySize = readUInt64LEAsSafeNumber(zip64Header, 40);
  const centralDirectoryOffset = readUInt64LEAsSafeNumber(zip64Header, 48);

  return {
    centralDirectoryOffset,
    centralDirectorySize,
  };
}

function resolveZip64EntryValues(entry, extraBuffer) {
  const needsZip64 =
    entry.uncompressedSize === 0xffffffff ||
    entry.compressedSize === 0xffffffff ||
    entry.localHeaderOffset === 0xffffffff;

  if (!needsZip64) {
    return {
      compressedSize: entry.compressedSize,
      localHeaderOffset: entry.localHeaderOffset,
      uncompressedSize: entry.uncompressedSize,
    };
  }

  const zip64Field = findExtraField(extraBuffer, 0x0001);
  if (!zip64Field) {
    throw new Error('ZIP64 extra field missing for ZIP64 entry');
  }

  let cursor = 0;
  const resolved = {
    compressedSize: entry.compressedSize,
    localHeaderOffset: entry.localHeaderOffset,
    uncompressedSize: entry.uncompressedSize,
  };

  if (entry.uncompressedSize === 0xffffffff) {
    resolved.uncompressedSize = readUInt64LEAsSafeNumber(zip64Field, cursor);
    cursor += 8;
  }

  if (entry.compressedSize === 0xffffffff) {
    resolved.compressedSize = readUInt64LEAsSafeNumber(zip64Field, cursor);
    cursor += 8;
  }

  if (entry.localHeaderOffset === 0xffffffff) {
    resolved.localHeaderOffset = readUInt64LEAsSafeNumber(zip64Field, cursor);
  }

  return resolved;
}

function findExtraField(extraBuffer, targetHeaderId) {
  let offset = 0;

  while (offset + 4 <= extraBuffer.length) {
    const headerId = extraBuffer.readUInt16LE(offset);
    const dataSize = extraBuffer.readUInt16LE(offset + 2);
    const dataStart = offset + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extraBuffer.length) {
      break;
    }

    if (headerId === targetHeaderId) {
      return extraBuffer.subarray(dataStart, dataEnd);
    }

    offset = dataEnd;
  }

  return null;
}

async function readBuffer(fileHandle, size, position) {
  if (size > Number.MAX_SAFE_INTEGER || position > Number.MAX_SAFE_INTEGER) {
    throw new Error('ZIP offset exceeds supported numeric range');
  }

  const buffer = Buffer.alloc(size);
  const { bytesRead } = await fileHandle.read(buffer, 0, size, position);
  if (bytesRead !== size) {
    throw new Error('Unexpected end of ZIP file');
  }

  return buffer;
}

function readUInt64LEAsSafeNumber(buffer, offset) {
  if (offset + 8 > buffer.length) {
    throw new Error('ZIP64 field is truncated');
  }

  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ZIP64 value exceeds supported numeric range');
  }

  return Number(value);
}

function collectDuplicateKeys(counterMap) {
  const duplicates = [];

  for (const [name, count] of counterMap.entries()) {
    if (count > 1) {
      duplicates.push(name);
    }
  }

  duplicates.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return duplicates;
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function updateCrc32(crc, buffer) {
  let next = crc >>> 0;

  for (let index = 0; index < buffer.length; index += 1) {
    next = CRC32_TABLE[(next ^ buffer[index]) & 0xff] ^ (next >>> 8);
  }

  return next >>> 0;
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
  getFileCrc32,
  getZipContentAnalysis,
  getUniqueDestinationPath,
  hashFile,
  isSamePath,
  moveFileSafely,
  normalizeInputPaths,
  parseArgs,
  shouldSkipDirectory,
};
