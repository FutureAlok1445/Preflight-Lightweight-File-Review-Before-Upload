import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../core/smart-profile.js";
import "../core/image-optimizer.js";

const { targetSizeSearch, MAX_ENCODE_ATTEMPTS, OptimizationError, optimizeImage } =
  globalThis.Preflight.imageOptimizer;

describe("Image Optimizer Property-Based Tests", () => {
  it("targetSizeSearch never exceeds MAX_ENCODE_ATTEMPTS (12) attempts for any target", async () => {
    // Mock HTMLCanvasElement.getContext and toBlob in jsdom
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        fillStyle: "",
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) })
      };
    };
    HTMLCanvasElement.prototype.toBlob = function (callback, mimeType, quality) {
      // Simulate blob size scaling with quality
      const simulatedSize = Math.round(50000 * (quality || 0.8));
      callback(new Blob(["x".repeat(simulatedSize)], { type: mimeType }));
    };

    const mockBitmap = {
      width: 400,
      height: 300,
      close: vi.fn()
    };

    try {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 1024 * 1024 }), async (targetBytes) => {
          const res = await targetSizeSearch(mockBitmap, {
            width: 400,
            height: 300,
            format: "image/webp",
            hasAlpha: false,
            targetBytes
          });
          expect(res.attempts).toBeLessThanOrEqual(MAX_ENCODE_ATTEMPTS);
          expect(res.attempts).toBeLessThanOrEqual(12);
        }),
        { numRuns: 100 }
      );
    } finally {
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  it("throws OptimizationError when image file exceeds 45 MB", async () => {
    const hugeFile = {
      name: "huge.jpg",
      size: 46 * 1024 * 1024,
      type: "image/jpeg"
    };

    await expect(optimizeImage(hugeFile, {})).rejects.toThrow(OptimizationError);
    await expect(optimizeImage(hugeFile, {})).rejects.toThrow(/45 MB/);
  });
});
