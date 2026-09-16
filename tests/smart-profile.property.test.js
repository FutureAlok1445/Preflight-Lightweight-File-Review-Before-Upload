import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../core/smart-profile.js";

const { isMeaningfulReduction, determineStrategy } = globalThis.Preflight.smartProfile;

describe("Smart Profile (Property 3: Meaningful Reduction)", () => {
  it("never considers opt >= orig as a meaningful reduction", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (orig, opt) => {
        if (opt >= orig) {
          return !isMeaningfulReduction(orig, opt);
        }
        return true;
      }),
      { numRuns: 500 }
    );
  });

  it("strictly enforces the 8% minimum threshold for meaningful reduction", () => {
    expect(isMeaningfulReduction(1000, 1000)).toBe(false);
    expect(isMeaningfulReduction(1000, 950)).toBe(false); // 5% < 8%
    expect(isMeaningfulReduction(1000, 920)).toBe(true);  // 8% == 8%
    expect(isMeaningfulReduction(1000, 900)).toBe(true);  // 10% >= 8%
  });

  it("determines sensible strategies for transparent vs photographic images", () => {
    const photoMeta = { width: 1920, height: 1080, hasAlpha: false, size: 2000000 };
    const photoStrategy = determineStrategy(photoMeta, { contentHint: "photo" });
    expect(["image/webp", "image/jpeg"]).toContain(photoStrategy.format);

    const iconMeta = { width: 256, height: 256, hasAlpha: true, size: 50000 };
    const iconStrategy = determineStrategy(iconMeta, { contentHint: "graphic" });
    expect(["image/webp", "image/png"]).toContain(iconStrategy.format);
  });
});
