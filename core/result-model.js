/**
 * core/result-model.js
 * Uniform Result object constructor and predictable, non-compounding
 * download filename builder across all Preflight operations.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const utils = Preflight.utils || {};

  const KNOWN_SUFFIXES = ["-prepared", "-compressed", "-extracted", "-clean", "-optimized"];

  function stripExtension(name) {
    if (!name) return "";
    const idx = name.lastIndexOf(".");
    return idx > 0 ? name.slice(0, idx) : name;
  }

  function extensionForMime(mime) {
    if (utils.extensionForMime) return utils.extensionForMime(mime);
    if (!mime) return "bin";
    const m = mime.toLowerCase().trim();
    if (m.includes("webp")) return "webp";
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
    if (m.includes("png")) return "png";
    if (m.includes("pdf")) return "pdf";
    if (m.includes("json")) return "json";
    if (m.includes("csv")) return "csv";
    if (m.includes("javascript") || m.includes("/js")) return "js";
    if (m.includes("text/plain") || m.includes("txt")) return "txt";
    return "bin";
  }

  function sanitizeFilename(name) {
    if (utils.sanitizeFilename) return utils.sanitizeFilename(name);
    return String(name || "").replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 100) || "file";
  }

  /**
   * Builds an output filename following predictable conventions without compounding suffixes.
   * e.g., photo.png -> photo-prepared.webp
   *       photo-prepared.webp -> photo-prepared.webp (anti-compounding)
   */
  function buildOutputFilename(originalName, outputMime, operationType) {
    const rawName = String(originalName || "file").trim();
    let ext = extensionForMime(outputMime);
    let base = sanitizeFilename(stripExtension(rawName));

    // Strip any trailing known suffix (outermost match)
    for (const suffix of KNOWN_SUFFIXES) {
      if (base.toLowerCase().endsWith(suffix.toLowerCase())) {
        base = base.slice(0, -suffix.length);
        break;
      }
    }
    base = base || "file";

    switch (operationType) {
      case "pdfMerge":
        return "merged.pdf";
      case "pdfCompress":
        return `${base}-compressed.pdf`;
      case "pdfSplit":
        return `${base}-extracted.pdf`;
      case "textToPdf":
        return `${base}.pdf`;
      case "textClean":
        return `${base}-clean.${ext}`;
      case "image":
      default:
        return `${base}-prepared.${ext}`;
    }
  }

  /**
   * Constructs a uniform Result object.
   */
  function createResult(originalFile, outputBlob, operationType, extra) {
    const origSize = originalFile ? originalFile.size : 0;
    const outSize = outputBlob ? outputBlob.size : 0;
    const savedBytes = Math.max(0, origSize - outSize);
    const savedPercent = origSize > 0 ? (savedBytes / origSize) * 100 : 0;

    let status = "optimized";
    if (extra && extra.status) {
      status = extra.status;
    } else if (savedPercent < 8) {
      status = "already_optimal";
    }

    const outputName = buildOutputFilename(
      originalFile ? originalFile.name : "file",
      outputBlob ? outputBlob.type : "",
      operationType
    );

    const outputFile = outputBlob instanceof File
      ? outputBlob
      : new File([outputBlob], outputName, { type: (outputBlob && outputBlob.type) || "" });

    return {
      originalFile,
      outputFile,
      originalSize: origSize,
      outputSize: outSize,
      savedBytes,
      savedPercent: Number(savedPercent.toFixed(1)),
      status,
      metadata: {
        outputMime: (outputBlob && outputBlob.type) || "",
        operationType: operationType || "unknown",
        ...(extra && extra.metadata)
      }
    };
  }

  Preflight.resultModel = {
    buildOutputFilename,
    createResult,
    KNOWN_SUFFIXES
  };
})(typeof window !== "undefined" ? window : globalThis);
