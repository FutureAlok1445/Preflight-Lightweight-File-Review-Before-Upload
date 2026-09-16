/**
 * core/text-processor.js
 * Local analysis and cleaning for Text and CSV files.
 * Provides delimiter detection, structure stats, whitespace minification,
 * CSV-to-JSON conversion, and export to PDF.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const MAX_TEXT_BYTES = 5 * 1024 * 1024; // 5 MB ceiling

  async function readText(fileOrBlob) {
    if (typeof fileOrBlob.text === "function") {
      return await fileOrBlob.text();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read text file."));
      reader.readAsText(fileOrBlob, "utf-8");
    });
  }

  /**
   * Parses a single CSV line according to RFC 4180 rules using a state machine.
   * Handles quoted fields containing delimiters, escaped quotes (""), and empty values.
   */
  function parseCSVLine(line, delim) {
    const d = delim || ",";
    const fields = [];
    let current = "";
    let inQuote = false;
    let i = 0;
    const len = line.length;

    while (i < len) {
      const char = line[i];
      if (inQuote) {
        if (char === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            current += '"';
            i += 2;
            continue;
          } else {
            inQuote = false;
            i++;
            continue;
          }
        } else {
          current += char;
          i++;
        }
      } else {
        if (char === '"') {
          inQuote = true;
          i++;
        } else if (char === d) {
          fields.push(current.trim());
          current = "";
          i++;
        } else {
          current += char;
          i++;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  /**
   * Counts unquoted occurrences of delim in line.
   */
  function countUnquotedDelimiters(line, delim) {
    let count = 0;
    let inQuote = false;
    let i = 0;
    const len = line.length;

    while (i < len) {
      const char = line[i];
      if (inQuote) {
        if (char === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            i += 2;
            continue;
          }
          inQuote = false;
        }
      } else {
        if (char === '"') {
          inQuote = true;
        } else if (char === delim) {
          count++;
        }
      }
      i++;
    }
    return count;
  }

  /**
   * Disambiguates duplicate column headers by appending _2, _3, etc.
   */
  function disambiguateHeaders(rawHeaders) {
    const seen = Object.create(null);
    return (rawHeaders || []).map((header, idx) => {
      const name = String(header || "").trim() || `col_${idx + 1}`;
      if (!seen[name]) {
        seen[name] = 1;
        return name;
      }
      seen[name] += 1;
      return `${name}_${seen[name]}`;
    });
  }

  /**
   * Detects CSV delimiter and consistency.
   */
  function detectCsvStructure(lines) {
    const candidateDelimiters = [",", ";", "\t", "|"];
    const nonEmptyLines = (lines || []).filter((l) => l && l.trim().length > 0);
    const sample = nonEmptyLines.slice(0, 100);

    if (sample.length === 0) {
      return { delimiter: ",", delimiterName: "Comma (,)", rowCount: 0, colCount: 1, ambiguous: false };
    }

    const scores = {};
    for (const d of candidateDelimiters) {
      const counts = sample.map((line) => countUnquotedDelimiters(line, d));
      const firstCount = counts[0];
      if (firstCount > 0 && counts.every((c) => c === firstCount)) {
        scores[d] = firstCount * sample.length;
      } else {
        scores[d] = 0;
      }
    }

    let bestDelim = ",";
    let highestScore = -1;
    let tieCount = 0;

    for (const d of candidateDelimiters) {
      const s = scores[d] || 0;
      if (s > highestScore) {
        highestScore = s;
        bestDelim = d;
        tieCount = 1;
      } else if (s === highestScore && s > 0) {
        tieCount++;
      }
    }

    const ambiguous = highestScore > 0 && tieCount > 1;
    const delimNames = { ",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab", "|": "Pipe (|)" };
    const colCount = highestScore > 0 ? (scores[bestDelim] / sample.length) + 1 : 1;

    return {
      delimiter: bestDelim,
      delimiterName: delimNames[bestDelim] || bestDelim,
      rowCount: nonEmptyLines.length,
      colCount,
      ambiguous
    };
  }

  function detectIsCsv(filename, content) {
    if (filename.toLowerCase().endsWith(".csv")) return true;
    const firstFewLines = content.slice(0, 1000);
    return /[,;\t|]/.test(firstFewLines) && firstFewLines.includes("\n");
  }

  /**
   * Analyzes text or CSV file structure.
   */
  async function analyzeText(fileOrBlob) {
    if (fileOrBlob.size > MAX_TEXT_BYTES) {
      throw new Error("File exceeds the 5 MB limit for text analysis.");
    }
    const content = await readText(fileOrBlob);
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rawLines = normalized.split("\n");
    const lineCount = normalized.endsWith("\n") && rawLines.length > 1 ? rawLines.length - 1 : rawLines.length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const charCount = content.length;

    const isCsv = detectIsCsv(fileOrBlob.name || "", content);
    let csvDetails = null;

    if (isCsv) {
      csvDetails = detectCsvStructure(rawLines);
    }

    return {
      size: fileOrBlob.size,
      lineCount,
      lines: lineCount,
      wordCount,
      words: wordCount,
      charCount,
      characters: charCount,
      isCsv,
      csvDetails,
      delimiter: csvDetails ? csvDetails.delimiter : null,
      ambiguous: csvDetails ? csvDetails.ambiguous : false
    };
  }

  /**
   * Cleans text/CSV: strips trailing spaces, removes lines consisting purely of whitespace,
   * normalizes all line endings to LF. Idempotent.
   */
  async function cleanText(fileOrBlob) {
    if (fileOrBlob.size > MAX_TEXT_BYTES) {
      throw new Error("File exceeds the 5 MB limit for text analysis.");
    }
    const raw = await readText(fileOrBlob);
    const originalSize = fileOrBlob.size;

    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const cleanedLines = [];
    let linesRemoved = 0;

    for (const line of lines) {
      const stripped = line.replace(/[ \t\r]+$/, "");
      if (stripped.trim().length === 0) {
        linesRemoved++;
      } else {
        cleanedLines.push(stripped);
      }
    }

    const cleanedText = cleanedLines.length > 0 ? cleanedLines.join("\n") + "\n" : "";
    const blob = new Blob([cleanedText], { type: fileOrBlob.type || "text/plain" });
    const bytesRemoved = Math.max(0, originalSize - blob.size);
    const identical = raw === cleanedText;

    return {
      blob,
      originalSize,
      optimizedSize: blob.size,
      reductionPercent: originalSize > 0 ? Math.max(0, (originalSize - blob.size) / originalSize) : 0,
      alreadyOptimized: identical || (bytesRemoved === 0 && linesRemoved === 0),
      linesRemoved,
      bytesRemoved,
      lineCount: cleanedLines.length
    };
  }

  /**
   * Converts CSV text to JSON array with header deduplication.
   */
  async function csvToJson(fileOrBlob) {
    if (fileOrBlob.size > MAX_TEXT_BYTES) {
      throw new Error("File exceeds the 5 MB limit for text analysis.");
    }
    const content = await readText(fileOrBlob);
    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return new Blob(["[]"], { type: "application/json" });

    const structure = detectCsvStructure(lines);
    const delim = structure.delimiter;

    const rawHeaders = parseCSVLine(lines[0], delim);
    const headers = disambiguateHeaders(rawHeaders);
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], delim);
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] !== undefined ? cols[idx] : "";
      });
      data.push(row);
    }

    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }

  Preflight.textProcessor = {
    readText,
    analyzeText,
    cleanText,
    csvToJson,
    parseCSVLine,
    countUnquotedDelimiters,
    detectCsvStructure,
    disambiguateHeaders,
    MAX_TEXT_BYTES
  };
})(typeof window !== "undefined" ? window : globalThis);
