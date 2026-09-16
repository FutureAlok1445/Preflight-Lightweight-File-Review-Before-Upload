import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";

const { formatBytes, sanitizeFilename } = globalThis.Preflight.utils;

describe("Utils Properties (formatBytes coverage & sanitizeFilename length)", () => {
  it("formatBytes returns a valid pattern for any natural byte count", () => {
    fc.assert(
      fc.property(fc.nat(), (n) => {
        const str = formatBytes(n);
        return /^\d+(\.\d{1,2})? (B|KB|MB|GB)$/.test(str);
      }),
      { numRuns: 500 }
    );
  });

  it("sanitizeFilename always returns a string with length <= 100 characters", () => {
    fc.assert(
      fc.property(fc.unicodeString(), (s) => {
        const r = sanitizeFilename(s);
        return r.length <= 100 && r.length > 0;
      }),
      { numRuns: 500 }
    );
  });

  it("formats specific boundary bytes accurately", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1048576)).toBe("1.00 MB");
    expect(formatBytes(1073741824)).toBe("1.00 GB");
  });
});
