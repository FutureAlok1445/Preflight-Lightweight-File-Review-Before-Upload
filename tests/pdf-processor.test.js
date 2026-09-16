import { describe, it, expect } from "vitest";
import "../core/utils.js";
import "../core/pdf-processor.js";

const { parsePageRanges } = globalThis.Preflight.pdfProcessor;

describe("PDF Processor - parsePageRanges Unit Tests", () => {
  it("parses valid single pages and ranges into 0-indexed sorted arrays", () => {
    expect(parsePageRanges("1-3, 5", 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges("1, 3-5, 8", 10)).toEqual([0, 2, 3, 4, 7]);
    expect(parsePageRanges("5-3", 10)).toEqual([2, 3, 4]); // reversed range supported
    expect(parsePageRanges("1, 1, 2", 10)).toEqual([0, 1]); // deduplicated
  });

  it("throws when range string is empty or whitespace", () => {
    expect(() => parsePageRanges("", 5)).toThrow(/No page numbers specified/);
    expect(() => parsePageRanges("   ", 5)).toThrow(/No page numbers specified/);
  });

  it("throws when page numbers are out of range", () => {
    expect(() => parsePageRanges("6", 5)).toThrow(/out of range/);
    expect(() => parsePageRanges("0", 5)).toThrow(/out of range/);
    expect(() => parsePageRanges("1-10", 5)).toThrow(/out of range/);
  });

  it("throws when invalid non-integer tokens are passed", () => {
    expect(() => parsePageRanges("2.5", 5)).toThrow(/Invalid page number/);
    expect(() => parsePageRanges("abc", 5)).toThrow(/Invalid page number/);
    expect(() => parsePageRanges("1-xyz", 5)).toThrow(/Invalid page number/);
  });
});
