const { getZipContentSignature, hashFile } = require('./utils');

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

  const groups = [];
  let totalHashCandidates = 0;
  let potentialSavedBytes = 0;

  const standardResult = await findStandardDuplicateGroups(nonZipFiles, options);
  groups.push(...standardResult.groups);
  totalHashCandidates += standardResult.totalHashCandidates;
  potentialSavedBytes += standardResult.potentialSavedBytes;

  const zipResult =
    zipMode === 'contents'
      ? await findZipContentDuplicateGroups(zipFiles, options)
      : await findStandardDuplicateGroups(zipFiles, options);

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
        const signature = await getZipContentSignature(file.path);
        hashedFiles += 1;
        if (options.onHashProgress) {
          options.onHashProgress({ hashedFiles, totalHashCandidates });
        }

        return {
          ...file,
          zipSignature: signature,
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

  const bySignature = new Map();
  for (const file of signatureEntries) {
    if (!file) {
      continue;
    }

    if (!bySignature.has(file.zipSignature)) {
      bySignature.set(file.zipSignature, []);
    }
    bySignature.get(file.zipSignature).push(file);
  }

  const groups = [];
  let potentialSavedBytes = 0;

  for (const group of bySignature.values()) {
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
  return group.slice(1).reduce((total, file) => total + file.size, 0);
}

module.exports = {
  findDuplicateGroups,
};
