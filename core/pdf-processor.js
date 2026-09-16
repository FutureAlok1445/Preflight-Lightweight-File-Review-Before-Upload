/**
 * core/pdf-processor.js
 * Local, lightweight PDF manipulation engine powered by pdf-lib.
 * Handles compression (object streams, metadata stripping),
 * merging multiple PDFs, splitting by page ranges, and text-to-PDF conversion.
 * Runs 100% locally in browser memory or service workers with zero network calls.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});

  function getPdfLib() {
    if (typeof PDFLib !== "undefined") return PDFLib;
    if (global.PDFLib) return global.PDFLib;
    if (typeof window !== "undefined" && window.PDFLib) return window.PDFLib;
    if (typeof self !== "undefined" && self.PDFLib) return self.PDFLib;
    throw new Error("PDF processing library is not loaded.");
  }

  async function toArrayBuffer(fileOrBlob) {
    if (fileOrBlob instanceof ArrayBuffer) return fileOrBlob;
    if (ArrayBuffer.isView(fileOrBlob)) return fileOrBlob.buffer;
    if (typeof fileOrBlob.arrayBuffer === "function") {
      return await fileOrBlob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read PDF."));
      reader.readAsArrayBuffer(fileOrBlob);
    });
  }

  /**
   * Analyzes a PDF to extract page count and document metadata.
   */
  async function analyzePdf(fileOrBlob) {
    const PDFLib = getPdfLib();
    const buffer = await toArrayBuffer(fileOrBlob);
    const doc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });

    return {
      pageCount: doc.getPageCount(),
      title: doc.getTitle() || "",
      author: doc.getAuthor() || "",
      size: buffer.byteLength
    };
  }

  /**
   * Compresses a PDF locally.
   * level: 'extreme' | 'strong' | 'normal' | 'light' (default: 'normal')
   */
  async function compressPdf(fileOrBlob, level = "normal") {
    const PDFLib = getPdfLib();
    const buffer = await toArrayBuffer(fileOrBlob);
    const originalSize = buffer.byteLength;

    const doc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });

    // Level-specific optimization
    if (level === "extreme" || level === "strong") {
      doc.setProducer("");
      doc.setCreator("");
      doc.setTitle("");
      doc.setAuthor("");
      doc.setSubject("");
      doc.setKeywords([]);
      doc.setModificationDate(new Date());

      // If extreme, remove document outline/bookmarks to save bytes
      if (level === "extreme") {
        try {
          const catalog = doc.catalog;
          if (catalog.has(PDFLib.PDFName.of("Outlines"))) {
            catalog.delete(PDFLib.PDFName.of("Outlines"));
          }
          if (catalog.has(PDFLib.PDFName.of("PieceInfo"))) {
            catalog.delete(PDFLib.PDFName.of("PieceInfo"));
          }
        } catch (_) {}
      }
    } else if (level === "normal") {
      doc.setProducer("");
      doc.setCreator("");
      doc.setModificationDate(new Date());
    }

    // Save with cross-reference object stream compression
    const saveOptions = {
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50
    };

    const optimizedBytes = await doc.save(saveOptions);

    const optimizedBlob = new Blob([optimizedBytes], { type: "application/pdf" });
    const optimizedSize = optimizedBlob.size;
    const isSmaller = optimizedSize < originalSize;
    const finalBlob = isSmaller ? optimizedBlob : (fileOrBlob instanceof Blob ? fileOrBlob : new Blob([buffer], { type: "application/pdf" }));

    return {
      blob: finalBlob,
      originalSize,
      optimizedSize: finalBlob.size,
      reductionPercent: originalSize > 0 ? Math.max(0, (originalSize - finalBlob.size) / originalSize) : 0,
      alreadyOptimized: !isSmaller,
      pageCount: doc.getPageCount(),
      level
    };
  }

  /**
   * Merges multiple PDF files in the provided order into a single PDF.
   * fileList: array of File or Blob objects
   */
  async function mergePdfs(fileList) {
    if (!Array.isArray(fileList) || fileList.length < 2) {
      throw new Error("At least two PDF files are required for merging.");
    }

    const PDFLib = getPdfLib();
    const mergedDoc = await PDFLib.PDFDocument.create();

    for (const file of fileList) {
      const buffer = await toArrayBuffer(file);
      const srcDoc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
      const indices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, indices);
      copiedPages.forEach((page) => mergedDoc.addPage(page));
    }

    const mergedBytes = await mergedDoc.save({ useObjectStreams: true });
    return new Blob([mergedBytes], { type: "application/pdf" });
  }

  /**
   * Extracts specified page ranges into a new standalone PDF.
   * pageRangeStr: e.g. "1-3, 5, 8-10" (1-indexed for users)
   */
  async function splitPdf(fileOrBlob, pageRangeStr) {
    const PDFLib = getPdfLib();
    const buffer = await toArrayBuffer(fileOrBlob);
    const srcDoc = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();

    const targetIndices = parsePageRanges(pageRangeStr, totalPages);
    if (targetIndices.length === 0) {
      throw new Error("No valid pages specified for extraction.");
    }

    const splitDoc = await PDFLib.PDFDocument.create();
    const copiedPages = await splitDoc.copyPages(srcDoc, targetIndices);
    copiedPages.forEach((page) => splitDoc.addPage(page));

    const splitBytes = await splitDoc.save({ useObjectStreams: true });
    return new Blob([splitBytes], { type: "application/pdf" });
  }

  /**
   * Converts plain text into a paginated, formatted PDF document.
   */
  async function textToPdf(text, options) {
    const PDFLib = getPdfLib();
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

    const opts = options || {};
    const fontSize = Math.max(8, Math.min(16, Number(opts.fontSize) || 10));
    const lineHeight = Math.round(fontSize * 1.4);

    // Page size
    const isLetter = (opts.pageSize || "").toLowerCase() === "letter";
    const pageWidth = isLetter ? 612 : 595.28;
    const pageHeight = isLetter ? 792 : 841.89;

    // Margins (clamped between 10mm and 50mm, default ~14mm)
    const marginMm = Math.max(10, Math.min(50, Number(opts.marginMm) || 14));
    const marginPt = marginMm * 2.8346;

    const contentWidth = pageWidth - marginPt * 2;
    const linesPerPage = Math.max(1, Math.floor((pageHeight - marginPt * 2) / lineHeight));

    const title = String(opts.title || "Document").slice(0, 100);
    doc.setTitle(title);
    doc.setProducer("");
    doc.setCreator("");

    const rawLines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    // Word wrap lines to content width without splitting mid-word
    const wrappedLines = [];
    for (const rawLine of rawLines) {
      if (!rawLine.trim()) {
        wrappedLines.push("");
        continue;
      }
      const words = rawLine.split(/\s+/);
      let currentLine = "";
      for (const word of words) {
        if (!word) continue;
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > contentWidth && currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    }

    // Draw lines onto pages
    for (let i = 0; i < wrappedLines.length; i += linesPerPage) {
      const page = doc.addPage([pageWidth, pageHeight]);
      const chunk = wrappedLines.slice(i, i + linesPerPage);
      let y = pageHeight - marginPt;

      for (const line of chunk) {
        if (line) {
          page.drawText(line, {
            x: marginPt,
            y: y - fontSize,
            size: fontSize,
            font,
            color: PDFLib.rgb(0.1, 0.1, 0.1)
          });
        }
        y -= lineHeight;
      }
    }

    if (wrappedLines.length === 0) {
      doc.addPage([pageWidth, pageHeight]);
    }

    const pdfBytes = await doc.save({ useObjectStreams: true });
    return new Blob([pdfBytes], { type: "application/pdf" });
  }

  /**
   * Helper: parses "1-3, 5, 8-10" into 0-indexed integer array
   */
  function parsePageRanges(rangeStr, totalPages) {
    if (!rangeStr || !rangeStr.trim()) {
      throw new Error("No page numbers specified.");
    }

    const maxPages = Number(totalPages) || 1;
    const indices = new Set();
    const parts = rangeStr.split(/[,;\s]+/);

    for (const part of parts) {
      if (!part) continue;
      if (part.includes("-")) {
        const bounds = part.split("-");
        if (bounds.length !== 2) {
          throw new Error(`Invalid page range: '${part}'.`);
        }
        const startStr = bounds[0].trim();
        const endStr = bounds[1].trim();
        if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
          throw new Error(`Invalid page number: '${part}'.`);
        }
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (start < 1 || start > maxPages) {
          throw new Error(`Page ${start} is out of range (document has ${maxPages} pages).`);
        }
        if (end < 1 || end > maxPages) {
          throw new Error(`Page ${end} is out of range (document has ${maxPages} pages).`);
        }
        const s = Math.min(start, end);
        const e = Math.max(start, end);
        for (let p = s; p <= e; p++) {
          indices.add(p - 1);
        }
      } else {
        const trimmed = part.trim();
        if (!/^\d+$/.test(trimmed)) {
          throw new Error(`Invalid page number: '${part}'.`);
        }
        const num = parseInt(trimmed, 10);
        if (num < 1 || num > maxPages) {
          throw new Error(`Page ${num} is out of range (document has ${maxPages} pages).`);
        }
        indices.add(num - 1);
      }
    }

    const result = Array.from(indices).sort((a, b) => a - b);
    if (result.length === 0) {
      throw new Error("No valid pages were specified.");
    }
    return result;
  }

  Preflight.pdfProcessor = {
    analyzePdf,
    compressPdf,
    mergePdfs,
    splitPdf,
    textToPdf,
    parsePageRanges
  };
})(typeof window !== "undefined" ? window : globalThis);
