import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../core/result-model.js";

const { buildOutputFilename, createResult } = globalThis.Preflight.resultModel;

describe("Result Model - buildOutputFilename (Property 4: Non-compounding)", () => {
  it("never compounds suffixes across any string and operation", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom("image", "pdfCompress", "pdfMerge", "pdfSplit", "textToPdf", "textClean"),
        (name, op) => {
          const once = buildOutputFilename(name, "image/webp", op);
          const twice = buildOutputFilename(once, "image/webp", op);
          return once === twice;
        }
      ),
      { numRuns: 200 }
    );
  });

  it("handles specific anti-compounding test cases correctly", () => {
    expect(buildOutputFilename("photo-prepared.webp", "image/webp", "image")).toBe("photo-prepared.webp");
    expect(buildOutputFilename("data.csv", "application/pdf", "textToPdf")).toBe("data.pdf");
    expect(buildOutputFilename("doc-compressed.pdf", "application/pdf", "pdfCompress")).toBe("doc-compressed.pdf");
    expect(buildOutputFilename("report-extracted.pdf", "application/pdf", "pdfSplit")).toBe("report-extracted.pdf");
    expect(buildOutputFilename("script-clean.js", "application/javascript", "textClean")).toBe("script-clean.js");
    expect(buildOutputFilename("any.pdf", "application/pdf", "pdfMerge")).toBe("merged.pdf");
  });

  it("createResult correctly computes savings and assigns status", () => {
    const origFile = new File(["1234567890"], "sample.png", { type: "image/png" });
    const optBlob = new Blob(["12345"], { type: "image/webp" });
    const result = createResult(origFile, optBlob, "image");

    expect(result.originalSize).toBe(10);
    expect(result.outputSize).toBe(5);
    expect(result.savedBytes).toBe(5);
    expect(result.savedPercent).toBe(50);
    expect(result.status).toBe("optimized");
    expect(result.outputFile.name).toBe("sample-prepared.webp");
  });
});
