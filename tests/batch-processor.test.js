import { describe, it, expect, vi } from "vitest";
import "../core/utils.js";
import "../core/batch-processor.js";

const { batchOptimize, CONCURRENCY } = globalThis.Preflight.batchProcessor;

describe("Batch Processor Unit Tests", () => {
  it("strictly bounds concurrency to at most 4 workers simultaneously", async () => {
    let activeWorkers = 0;
    let maxSimultaneous = 0;

    // Mock imageOptimizer.optimizeImage
    globalThis.Preflight.imageOptimizer = {
      optimizeImage: vi.fn(async (file) => {
        activeWorkers++;
        maxSimultaneous = Math.max(maxSimultaneous, activeWorkers);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeWorkers--;
        return { blob: new Blob(["opt"]), format: "image/webp", optimizedSize: 100 };
      })
    };

    const files = Array.from({ length: 16 }, (_, i) => ({
      name: `img-${i}.jpg`,
      size: 5000,
      type: "image/jpeg"
    }));

    const progressEvents = [];
    const results = await batchOptimize(files, {}, (p) => progressEvents.push(p));

    expect(maxSimultaneous).toBeLessThanOrEqual(CONCURRENCY);
    expect(maxSimultaneous).toBeLessThanOrEqual(4);
    expect(results.length).toBe(16);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("isolates failures so one failing file does not abort the batch", async () => {
    globalThis.Preflight.imageOptimizer = {
      optimizeImage: vi.fn(async (file) => {
        if (file.name === "corrupt.png") {
          throw new Error("Corrupted header");
        }
        return { blob: new Blob(["opt"]), format: "image/webp", optimizedSize: 200 };
      })
    };

    const files = [
      { name: "good1.png", size: 500, type: "image/png" },
      { name: "corrupt.png", size: 500, type: "image/png" },
      { name: "good2.png", size: 500, type: "image/png" }
    ];

    const results = await batchOptimize(files, {}, () => {});

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBe("Corrupted header");
    expect(results[2].ok).toBe(true);
  });
});
