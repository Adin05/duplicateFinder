const { hashFile } = require('./utils');

async function findDuplicateGroups(files, options) {
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
    potentialSavedBytes += group[0].size * (group.length - 1);
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

module.exports = {
  findDuplicateGroups,
};
