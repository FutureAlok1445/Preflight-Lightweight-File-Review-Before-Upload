import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../core/file-analyzer.js";
import "../core/smart-profile.js";
import "../core/image-optimizer.js";
import "../upload/upload-detector.js";

const { detectUploadLimit, LIMIT_PATTERNS } = globalThis.Preflight.uploadDetector;

describe("Upload Detector - Limit Detection (Property 1: Limit Detection Correctness)", () => {
  it("correctly extracts and parses positive sizes with units across patterns", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.constantFrom("kb", "mb"),
        (val, unit) => {
          const parent = document.createElement("div");
          const label = document.createElement("label");
          label.textContent = `Max file size: ${val} ${unit}`;
          const input = document.createElement("input");
          input.type = "file";
          parent.appendChild(label);
          parent.appendChild(input);
          document.body.appendChild(parent);

          const detected = detectUploadLimit(input);
          const expected = Math.round(val * (unit === "mb" ? 1048576 : 1024));

          document.body.removeChild(parent);
          return detected === expected;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("matches all 5 defined regex patterns", () => {
    const testCases = [
      { text: "Maximum file size is 10 MB.", expected: 10 * 1048576 },
      { text: "Files must be under 2 mb", expected: 2 * 1048576 },
      { text: "attachment limit: 512 kb", expected: 512 * 1024 },
      { text: "limit: 4 MB", expected: 4 * 1048576 },
      { text: "25 MB maximum allowed", expected: 25 * 1048576 }
    ];

    testCases.forEach(({ text, expected }) => {
      const parent = document.createElement("div");
      parent.textContent = text;
      const input = document.createElement("input");
      input.type = "file";
      parent.appendChild(input);
      document.body.appendChild(parent);

      const limit = detectUploadLimit(input);
      expect(limit).toBe(expected);

      document.body.removeChild(parent);
    });
  });

  it("reads data-max-size and data-limit attributes from file inputs", () => {
    const input1 = document.createElement("input");
    input1.type = "file";
    input1.setAttribute("data-max-size", "2097152"); // 2 MB in bytes
    expect(detectUploadLimit(input1)).toBe(2097152);

    const input2 = document.createElement("input");
    input2.type = "file";
    input2.setAttribute("data-limit", "500"); // 500 KB
    expect(detectUploadLimit(input2)).toBe(500 * 1024);
  });

  it("resolves aria-describedby references", () => {
    const hint = document.createElement("div");
    hint.id = "uploadHint123";
    hint.textContent = "Upload limit: 1 MB";
    document.body.appendChild(hint);

    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("aria-describedby", "uploadHint123");
    document.body.appendChild(input);

    expect(detectUploadLimit(input)).toBe(1048576);

    document.body.removeChild(hint);
    document.body.removeChild(input);
  });

  it("returns null when no limit is detected or on invalid values", () => {
    const input = document.createElement("input");
    input.type = "file";
    expect(detectUploadLimit(input)).toBeNull();

    const parent = document.createElement("div");
    parent.textContent = "limit: NaN MB";
    parent.appendChild(input);
    expect(detectUploadLimit(input)).toBeNull();
  });
});
