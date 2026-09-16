import { describe, it, expect } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../core/text-processor.js";

const {
  parseCSVLine,
  detectCsvStructure,
  disambiguateHeaders,
  cleanText,
  readText
} = globalThis.Preflight.textProcessor;

describe("Text & CSV Processor Property-Based Tests", () => {
  it("CSV round-trip property for simple non-quoted values", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ maxLength: 20 }).filter((s) => !s.includes('"') && !s.includes(",") && !s.includes("\n") && !s.includes("\r")),
          { minLength: 1, maxLength: 8 }
        ),
        (fields) => {
          const trimmed = fields.map((f) => f.trim());
          const line = trimmed.join(",");
          const parsed = parseCSVLine(line, ",");
          expect(parsed).toEqual(trimmed);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("handles RFC 4180 quoted fields with embedded commas and quotes", () => {
    const line1 = 'a,"b,c",d';
    expect(parseCSVLine(line1, ",")).toEqual(["a", "b,c", "d"]);

    const line2 = 'a,"b""c",d';
    expect(parseCSVLine(line2, ",")).toEqual(["a", 'b"c', "d"]);

    const line3 = '"Smith, Jr.","42","New York"';
    expect(parseCSVLine(line3, ",")).toEqual(["Smith, Jr.", "42", "New York"]);
  });

  it("delimiter detection consistency property", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(",", ";", "\t", "|"),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 2, max: 10 }),
        (delim, cols, rows) => {
          const lines = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => "val").join(delim)
          );
          const result = detectCsvStructure(lines);
          return result.delimiter === delim && !result.ambiguous;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("header disambiguation uniqueness property", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 20 }),
        (headers) => {
          const result = disambiguateHeaders(headers);
          expect(new Set(result).size).toBe(result.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("disambiguates duplicate headers with expected suffix patterns", () => {
    expect(disambiguateHeaders(["a", "b", "a", "a"])).toEqual(["a", "b", "a_2", "a_3"]);
    expect(disambiguateHeaders(["id", "name", "id", "id"])).toEqual(["id", "name", "id_2", "id_3"]);
  });

  it("text cleaning idempotence property", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        const b1 = new Blob([s]);
        const r1 = await cleanText(b1);
        const r2 = await cleanText(r1.blob);
        const t1 = await readText(r1.blob);
        const t2 = await readText(r2.blob);
        return t1 === t2;
      }),
      { numRuns: 100 }
    );
  });
});
