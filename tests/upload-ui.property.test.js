import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../upload/upload-ui.js";

const { truncate } = globalThis.Preflight.uploadUI;

describe("Upload UI - Truncation (Property 10)", () => {
  it("never exceeds max length + 3 chars (truncation bound)", () => {
    fc.assert(
      fc.property(fc.unicodeString(), (s) => {
        const result = truncate(s, 38);
        return result.length <= 41;
      }),
      { numRuns: 300 }
    );
  });

  it("preserves short strings identically (identity for <= max)", () => {
    fc.assert(
      fc.property(fc.unicodeString({ maxLength: 38 }), (s) => {
        if (!s) return truncate(s, 38) === "file";
        return truncate(s, 38) === s;
      }),
      { numRuns: 300 }
    );
  });

  it("handles known edge cases", () => {
    expect(truncate("Hello World", 38)).toBe("Hello World");
    const longName = "a".repeat(50);
    const res = truncate(longName, 38);
    expect(res.endsWith("...")).toBe(true);
    expect(res.length).toBeLessThanOrEqual(41);
    expect(truncate("", 38)).toBe("file");
    expect(truncate(null, 38)).toBe("file");
  });
});
