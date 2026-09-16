/**
 * core/batch-processor.js
 * Concurrency-bounded batch image optimization processor.
 * Processes multiple images with a 4-worker pool, providing per-item progress reporting.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const CONCURRENCY = 4; // Bounded concurrency for local canvas operations

  /**
   * batchOptimize(files, opts, onProgress)
   * files: File[]
   * opts: { format, quality, maxDimension, targetBytes }
   * onProgress: ({ index, total, status: "queued"|"processing"|"done"|"failed", result?, error? }) => void
   */
  async function batchOptimize(files, opts, onProgress) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const progress = typeof onProgress === "function" ? onProgress : () => {};
    const results = new Array(files.length).fill(null);
    let nextIndex = 0;

    // Initial queued status for all files
    files.forEach((_, i) => {
      progress({ index: i, total: files.length, status: "queued" });
    });

    async function worker() {
      while (nextIndex < files.length) {
        const i = nextIndex++;
        const file = files[i];
        progress({ index: i, total: files.length, status: "processing" });

        try {
          const optimizer = Preflight.imageOptimizer;
          if (!optimizer || typeof optimizer.optimizeImage !== "function") {
            throw new Error("Image optimizer engine is not loaded.");
          }
          const result = await optimizer.optimizeImage(file, opts);
          results[i] = { ok: true, result, file };
          progress({ index: i, total: files.length, status: "done", result });
        } catch (err) {
          const errorMsg = err && err.message ? err.message : "Optimization failed.";
          results[i] = { ok: false, error: errorMsg, file };
          progress({ index: i, total: files.length, status: "failed", error: errorMsg });
        }
      }
    }

    const workerCount = Math.min(CONCURRENCY, files.length);
    const workers = Array.from({ length: workerCount }, worker);
    await Promise.all(workers);

    return results;
  }

  Preflight.batchProcessor = {
    batchOptimize,
    CONCURRENCY
  };
})(typeof window !== "undefined" ? window : globalThis);
