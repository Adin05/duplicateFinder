const path = require('path');

const {
  getFileCrc32,
  getFileMd5,
  getZipContentAnalysis,
  getZipEntryMd5,
  hashFile,
} = require('./utils');

async function findDuplicateGroups(files, options) {
  const zipMode = options.zipMode || 'file';
  const nonZipFiles = [];
  const zipFiles = [];

  for (const file of files) {
    if (file.ext === '.zip') {
      zipFiles.push(file);
    } else {
      nonZipFiles.push(file);
    }
  }

  if (zipMode === 'contents') {
    return findCombinedContentDuplicateGroups(nonZipFiles, zipFiles, options);
  }

  const groups = [];
  let totalHashCandidates = 0;
  let potentialSavedBytes = 0;

  const standardResult = await findStandardDuplicateGroups(nonZipFiles, options);
  groups.push(...standardResult.groups);
  totalHashCandidates += standardResult.totalHashCandidates;
  potentialSavedBytes += standardResult.potentialSavedBytes;

  const zipResult = await findStandardDuplicateGroups(zipFiles, options);

  groups.push(...zipResult.groups);
  totalHashCandidates += zipResult.totalHashCandidates;
  potentialSavedBytes += zipResult.potentialSavedBytes;

  groups.sort((left, right) => left[0].discoveryIndex - right[0].discoveryIndex);

  return {
    groups,
    totalHashCandidates,
    potentialSavedBytes,
  };
}

async function findStandardDuplicateGroups(files, options) {
  const bySize = new Map();

  for (const file of files) {
    const key = String(file.size);
    if (!bySize.has(key)) {
      bySize.set(key, []);
    }
    bySize.get(key).push(file);
  }

  const hashCandidates = [];
  for (const group of bySize.values()) {
    if (group.length > 1) {
      hashCandidates.push(...group);
    }
  }

  const totalHashCandidates = hashCandidates.length;
  let hashedFiles = 0;

  const hashedEntries = await runWithConcurrency(
    hashCandidates,
    options.concurrency || 4,
    async (file) => {
      try {
        const hash = await hashFile(file.path);
        hashedFiles += 1;
        if (options.onHashProgress) {
          options.onHashProgress({ hashedFiles, totalHashCandidates });
        }

        return { ...file, hash };
      } catch (error) {
        options.logger.warn(`Hash failed: ${file.path} (${error.code || error.message})`);
        return null;
      }
    }
  );

  const byHash = new Map();
  for (const file of hashedEntries) {
    if (!file) {
      continue;
    }

    const key = `${file.size}:${file.hash}`;
    if (!byHash.has(key)) {
      byHash.set(key, []);
    }
    byHash.get(key).push(file);
  }

  const groups = [];
  let potentialSavedBytes = 0;

  for (const group of byHash.values()) {
    if (group.length <= 1) {
      continue;
    }

    group.sort((left, right) => left.discoveryIndex - right.discoveryIndex);

    groups.push(group);
    potentialSavedBytes += calculatePotentialSavedBytes(group);
  }

  return {
    groups,
    totalHashCandidates,
    potentialSavedBytes,
  };
}

async function findZipContentDuplicateGroups(files, options) {
  const totalHashCandidates = files.length;
  let hashedFiles = 0;

  const signatureEntries = await runWithConcurrency(
    files,
    options.concurrency || 4,
    async (file) => {
      try {
        const zipContent = await getZipContentAnalysis(file.path);
        hashedFiles += 1;
        if (options.onHashProgress) {
          options.onHashProgress({ hashedFiles, totalHashCandidates });
        }

        logZipInternalNameDuplicates(file.path, zipContent, options.logger);

        return {
          ...file,
          zipEntryBaseSizeKeys: zipContent.entryBaseSizeKeys,
          zipEntryKeys: zipContent.entryKeys,
          zipEntryRecords: zipContent.entryRecords,
          zipSignature: zipContent.signature,
        };
      } catch (error) {
        options.logger.warn(
          `ZIP content analysis failed, falling back to file hash: ${file.path} (${error.message})`
        );

        try {
          const fallbackHash = await hashFile(file.path);
          hashedFiles += 1;
          if (options.onHashProgress) {
            options.onHashProgress({ hashedFiles, totalHashCandidates });
          }

          return {
            ...file,
            zipSignature: `fallback:${fallbackHash}`,
          };
        } catch (hashError) {
          options.logger.warn(
            `ZIP fallback hash failed: ${file.path} (${hashError.code || hashError.message})`
          );
          return null;
        }
      }
    }
  );

  const validEntries = signatureEntries.filter(Boolean);
  const groups = buildZipDuplicateGroups(validEntries);
  let potentialSavedBytes = 0;

  for (const group of groups) {
    group.sort((left, right) => left.discoveryIndex - right.discoveryIndex);
    potentialSavedBytes += calculatePotentialSavedBytes(group);
  }

  return {
    entries: validEntries,
    groups,
    totalHashCandidates,
    potentialSavedBytes,
  };
}

async function findCombinedContentDuplicateGroups(nonZipFiles, zipFiles, options) {
  const standardResult = await findStandardDuplicateGroups(nonZipFiles, options);
  const zipResult = await findZipContentDuplicateGroups(zipFiles, options);
  const regularFileMatches = await findRegularFilesMatchingZipEntries(
    nonZipFiles,
    zipResult.entries,
    options
  );

  const allFiles = [...nonZipFiles, ...zipResult.entries];
  const parents = allFiles.map((_, index) => index);
  const indexByPath = new Map(allFiles.map((file, index) => [file.path, index]));

  for (const group of standardResult.groups) {
    unionFileGroup(group, indexByPath, parents);
  }

  for (const group of zipResult.groups) {
    unionFileGroup(group, indexByPath, parents);
  }

  const zipIndexesByEntryKey = new Map();
  for (const zipFile of zipResult.entries) {
    const fileIndex = indexByPath.get(zipFile.path);
    for (const entryKey of zipFile.zipEntryKeys || []) {
      if (!zipIndexesByEntryKey.has(entryKey)) {
        zipIndexesByEntryKey.set(entryKey, []);
      }
      zipIndexesByEntryKey.get(entryKey).push(fileIndex);
    }
  }

  const strongZipMatches = await buildStrongZipRegularMatches(
    regularFileMatches.entries,
    zipResult.entries,
    options
  );

  for (const regularFile of regularFileMatches.entries) {
    const regularIndex = indexByPath.get(regularFile.path);
    const matchingZipPaths = strongZipMatches.get(regularFile.path) || [];
    if (matchingZipPaths.length === 0) {
      continue;
    }

    const matchingZipIndexes = matchingZipPaths
      .map((zipPath) => indexByPath.get(zipPath))
      .filter((zipIndex) => Number.isInteger(zipIndex));

    for (const zipIndex of matchingZipIndexes) {
      unionRoots(regularIndex, zipIndex, parents);
    }

    logZipVsRegularMatch(regularFile, matchingZipIndexes, allFiles, options.logger);
  }

  const groupsByRoot = new Map();
  for (let index = 0; index < allFiles.length; index += 1) {
    const root = findRoot(index, parents);
    if (!groupsByRoot.has(root)) {
      groupsByRoot.set(root, []);
    }
    groupsByRoot.get(root).push(allFiles[index]);
  }

  const groups = [];
  let potentialSavedBytes = 0;

  for (const group of groupsByRoot.values()) {
    if (group.length <= 1) {
      continue;
    }

    group.sort((left, right) => left.discoveryIndex - right.discoveryIndex);
    groups.push(group);
    potentialSavedBytes += calculatePotentialSavedBytes(group);
  }

  groups.sort((left, right) => left[0].discoveryIndex - right[0].discoveryIndex);

  return {
    groups,
    totalHashCandidates:
      standardResult.totalHashCandidates +
      zipResult.totalHashCandidates +
      regularFileMatches.totalHashCandidates +
      strongZipMatches.hashOperations,
    potentialSavedBytes,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeConcurrency, items.length || safeConcurrency) },
    () => consume()
  );

  await Promise.all(workers);
  return results;
}

function calculatePotentialSavedBytes(group) {
  const nonZipFiles = group.filter((file) => file.ext !== '.zip');
  const zipFiles = group.filter((file) => file.ext === '.zip');
  let total = 0;

  if (nonZipFiles.length > 0) {
    total += nonZipFiles
      .slice(1)
      .reduce((sum, file) => sum + file.size, 0);
  } else if (zipFiles.length > 0) {
    total += zipFiles
      .slice(1)
      .reduce((sum, file) => sum + file.size, 0);
  }

  return total;
}

function buildZipDuplicateGroups(entries) {
  if (entries.length <= 1) {
    return [];
  }

  const indexBySignature = new Map();
  const indexByEntryKey = new Map();
  const parents = entries.map((_, index) => index);

  for (let index = 0; index < entries.length; index += 1) {
    const file = entries[index];

    if (!indexBySignature.has(file.zipSignature)) {
      indexBySignature.set(file.zipSignature, []);
    }
    indexBySignature.get(file.zipSignature).push(index);

    for (const entryKey of file.zipEntryKeys || []) {
      if (!indexByEntryKey.has(entryKey)) {
        indexByEntryKey.set(entryKey, []);
      }
      indexByEntryKey.get(entryKey).push(index);
    }
  }

  for (const indexes of indexBySignature.values()) {
    unionIndexes(indexes, parents);
  }

  for (const indexes of indexByEntryKey.values()) {
    if (indexes.length > 1) {
      unionIndexes(indexes, parents);
    }
  }

  const groupsByRoot = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const root = findRoot(index, parents);
    if (!groupsByRoot.has(root)) {
      groupsByRoot.set(root, []);
    }
    groupsByRoot.get(root).push(entries[index]);
  }

  const groups = [];
  for (const group of groupsByRoot.values()) {
    if (group.length > 1) {
      groups.push(group);
    }
  }

  return groups;
}

function unionIndexes(indexes, parents) {
  const [first, ...rest] = indexes;
  for (const index of rest) {
    unionRoots(first, index, parents);
  }
}

function unionFileGroup(group, indexByPath, parents) {
  const indexes = group
    .map((file) => indexByPath.get(file.path))
    .filter((index) => Number.isInteger(index));

  if (indexes.length > 1) {
    unionIndexes(indexes, parents);
  }
}

function unionRoots(left, right, parents) {
  const leftRoot = findRoot(left, parents);
  const rightRoot = findRoot(right, parents);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

function findRoot(index, parents) {
  let cursor = index;
  while (parents[cursor] !== cursor) {
    parents[cursor] = parents[parents[cursor]];
    cursor = parents[cursor];
  }
  return cursor;
}

function logZipInternalNameDuplicates(zipPath, zipContent, logger) {
  if (zipContent.duplicateEntryNames.length > 0) {
    logger.warn(
      `ZIP contains duplicate internal entry paths: ${zipPath} (${formatListPreview(
        zipContent.duplicateEntryNames
      )})`
    );
  }

  if (zipContent.duplicateBaseNames.length > 0) {
    logger.warn(
      `ZIP contains repeated file names in different folders: ${zipPath} (${formatListPreview(
        zipContent.duplicateBaseNames
      )})`
    );
  }
}

async function findRegularFilesMatchingZipEntries(nonZipFiles, zipEntries, options) {
  const zipBaseSizeKeys = new Set();
  for (const zipFile of zipEntries) {
    for (const entryBaseSizeKey of zipFile.zipEntryBaseSizeKeys || []) {
      zipBaseSizeKeys.add(entryBaseSizeKey);
    }
  }

  const candidates = nonZipFiles.filter((file) =>
    zipBaseSizeKeys.has(`${path.basename(file.path).toLowerCase()}|${file.size}`)
  );

  const totalHashCandidates = candidates.length;
  let hashedFiles = 0;

  const entries = await runWithConcurrency(
    candidates,
    options.concurrency || 4,
    async (file) => {
      try {
        const crc32 = await getFileCrc32(file.path);
        hashedFiles += 1;
        if (options.onHashProgress) {
          options.onHashProgress({
            hashedFiles,
            totalHashCandidates,
          });
        }

        return {
          ...file,
          zipEntryKey: `${path.basename(file.path).toLowerCase()}|${file.size}|${crc32}`,
        };
      } catch (error) {
        options.logger.warn(
          `CRC32 analysis failed for ZIP comparison: ${file.path} (${error.code || error.message})`
        );
        return null;
      }
    }
  );

  return {
    entries: entries.filter(Boolean),
    totalHashCandidates,
  };
}

async function buildStrongZipRegularMatches(regularFiles, zipEntries, options) {
  const matches = new Map();
  const zipEntriesByKey = new Map();
  const regularFileMd5Cache = new Map();
  const zipEntryMd5Cache = new Map();
  let hashOperations = 0;

  for (const zipFile of zipEntries) {
    for (const entryRecord of zipFile.zipEntryRecords || []) {
      const entryKey = `${entryRecord.baseName}|${entryRecord.size}|${entryRecord.crc32}`;
      if (!zipEntriesByKey.has(entryKey)) {
        zipEntriesByKey.set(entryKey, []);
      }
      zipEntriesByKey.get(entryKey).push({
        entryRecord,
        zipPath: zipFile.path,
      });
    }
  }

  for (const regularFile of regularFiles) {
    const candidateEntries = zipEntriesByKey.get(regularFile.zipEntryKey) || [];
    if (candidateEntries.length === 0) {
      continue;
    }

    const regularMd5 = await getCachedRegularMd5(regularFile, regularFileMd5Cache);
    hashOperations += regularMd5.wasComputed ? 1 : 0;

    for (const candidateEntry of candidateEntries) {
      const zipMd5 = await getCachedZipEntryMd5(candidateEntry, zipEntryMd5Cache);
      hashOperations += zipMd5.wasComputed ? 1 : 0;

      if (regularMd5.value !== zipMd5.value) {
        continue;
      }

      if (!matches.has(regularFile.path)) {
        matches.set(regularFile.path, []);
      }

      const zipIndexes = matches.get(regularFile.path);
      zipIndexes.push(candidateEntry.zipPath);
      options.logger.info(
        `Verified ZIP contents match file by MD5: ${regularFile.path} <-> ${candidateEntry.zipPath} (${candidateEntry.entryRecord.entryName})`
      );
    }
  }

  const resolvedMatches = new Map();
  for (const [regularPath, zipPaths] of matches.entries()) {
    resolvedMatches.set(regularPath, Array.from(new Set(zipPaths)));
  }

  resolvedMatches.hashOperations = hashOperations;
  return resolvedMatches;
}

async function getCachedRegularMd5(file, cache) {
  if (cache.has(file.path)) {
    return {
      value: cache.get(file.path),
      wasComputed: false,
    };
  }

  const value = await getFileMd5(file.path);
  cache.set(file.path, value);
  return {
    value,
    wasComputed: true,
  };
}

async function getCachedZipEntryMd5(candidateEntry, cache) {
  const cacheKey = `${candidateEntry.zipPath}::${candidateEntry.entryRecord.entryName}`;
  if (cache.has(cacheKey)) {
    return {
      value: cache.get(cacheKey),
      wasComputed: false,
    };
  }

  const value = await getZipEntryMd5(candidateEntry.entryRecord);
  cache.set(cacheKey, value);
  return {
    value,
    wasComputed: true,
  };
}

function logZipVsRegularMatch(regularFile, matchingZipIndexes, allFiles, logger) {
  const zipPaths = matchingZipIndexes
    .map((index) => allFiles[index].path)
    .slice(0, 3);
  const suffix =
    matchingZipIndexes.length > 3 ? ` ... +${matchingZipIndexes.length - 3} more` : '';

  logger.info(
    `ZIP contents match unzipped file: ${regularFile.path} <-> ${zipPaths.join(', ')}${suffix}`
  );
}

function formatListPreview(items) {
  const preview = items.slice(0, 5);
  if (items.length <= 5) {
    return preview.join(', ');
  }

  return `${preview.join(', ')} ... +${items.length - 5} more`;
}

module.exports = {
  findDuplicateGroups,
};
