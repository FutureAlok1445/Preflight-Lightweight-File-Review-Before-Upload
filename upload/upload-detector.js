/**
 * upload/upload-detector.js
 * Watches for file selection on standard <input type="file"> elements on ANY website.
 * Activates the 2-step PREflight Review and Preparation interface before upload proceeds.
 *
 * Supported workflows:
 *  - Images (PNG, JPEG, WebP): dynamic local compression, format conversion, resize.
 *  - PDFs: local stream compression and multi-PDF merging.
 *  - Text & CSV: structure analysis, empty line / trailing whitespace cleaning.
 *  - Other files: verified file review gate (name, type, size).
 *  - Never auto-uploads -- requires explicit user confirmation.
 */
(function (global) {
  "use strict";

  if (global.__preflightUploadDetectorInstalled) return;
  global.__preflightUploadDetectorInstalled = true;

  const Preflight = global.Preflight;
  const { isSupportedImageFile, buildOutputFilename, formatBytes } = Preflight.utils;
  const { analyzeFile } = Preflight.fileAnalyzer;
  const { optimizeImage } = Preflight.imageOptimizer;

  const LIMIT_PATTERNS = [
    /max(?:imum)?\s*(?:file\s*)?size[^\n\d]{0,15}(\d+(?:\.\d+)?)\s*(kb|mb)\b/i,
    /files?\s+(?:must\s+be|should\s+be|up\s+to|under|below|no\s+(?:larger|bigger)\s+than)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(kb|mb)\b/i,
    /(?:upload|attachment)\s+limit[^\d]{0,10}(\d+(?:\.\d+)?)\s*(kb|mb)\b/i,
    /limit[:\s]+(\d+(?:\.\d+)?)\s*(kb|mb)\b/i,
    /(\d+(?:\.\d+)?)\s*(kb|mb)\s+(?:max|limit|maximum)/i
  ];

  let settingsCache = { uploadOptimizerEnabled: true };
  const openOverlays = new WeakMap();
  const heldFiles = new Map();
  const bypassInputs = new WeakSet();
  const selectionVersions = new WeakMap();

  init();

  function init() {
    document.addEventListener("change", handleChange, true);
    document.addEventListener("input", handleChange, true);
    document.addEventListener("submit", event => {
      if ([...heldFiles.keys()].some(input => input.form === event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);

    safeGetSettings().then((settings) => {
      settingsCache = settings;
    });

    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["preflight:settings"]) {
          settingsCache = Object.assign({}, settingsCache, changes["preflight:settings"].newValue);
        }
      });
    }
  }

  async function safeGetSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get("preflight:settings");
        return store["preflight:settings"] || { uploadOptimizerEnabled: true };
      }
    } catch (err) {}
    return { uploadOptimizerEnabled: true };
  }

  function handleChange(event) {
    if (settingsCache && settingsCache.uploadOptimizerEnabled === false) return;

    const input = (event.composedPath && event.composedPath()[0]) || event.target;
    if (!input || (input.tagName !== "INPUT" && !(input instanceof HTMLInputElement)) || (input.type || "").toLowerCase() !== "file") return;

    if (bypassInputs.has(input) || input.dataset.preflightBypass === "1") {
      return;
    }

    const fileList = input.files;
    if (!fileList || fileList.length === 0) {
      if (heldFiles.has(input)) event.stopImmediatePropagation();
      return;
    }

    const files = Array.from(fileList);
    event.stopImmediatePropagation();
    heldFiles.set(input, files);
    input.value = "";
    const version = (selectionVersions.get(input) || 0) + 1;
    selectionVersions.set(input, version);

    handleSelection(input, files, version).catch((err) => {
      if (selectionVersions.get(input) !== version) return;
      console.error("PREFLIGHT SELECTION ERR:", err);
      heldFiles.delete(input);
      input.value = "";
    });
  }

  async function handleSelection(input, files, version) {
    const existing = openOverlays.get(input);
    if (existing) existing.close();

    const limitBytes = detectUploadLimit(input);
    const largeFileWarning = files.some((f) => f && f.size > 100 * 1024 * 1024)
      ? "One or more files exceed 100 MB. Processing may be slow or limited."
      : null;

    if (files.length === 1) {
      const file = files[0];
      const fileInfo = await analyzeFile(file);
      if (selectionVersions.get(input) !== version) return;

      const canCompress = fileInfo.supportedActions.includes("compress") || fileInfo.supportedActions.includes("clean");

      const overlay = Preflight.uploadUI.showReviewCard({
        fileName: file.name,
        fileSize: file.size,
        fileType: fileInfo.label,
        category: fileInfo.category,
        imageDefaultFormat: fileInfo.type === "image/jpeg" ? "image/jpeg" : "image/webp",
        targetLimitBytes: limitBytes,
        largeFileWarning,
        canCompress,
        processingError: fileInfo.processingError,
        canMerge: false,
        onProcess: async (mode, compressionSettings) => {
          return await processSingleFile(file, fileInfo, limitBytes, compressionSettings);
        },
        onContinueOriginal: () => {
          openOverlays.delete(input);
          releaseOriginal(input);
        },
        onContinueUpload: (processedFile) => {
          openOverlays.delete(input);
          replaceInputFile(input, processedFile || file);
        },
        onCancel: () => cancelSelection(input, overlay),
        onDownload: (blob, name) => {
          if (Preflight.downloader) Preflight.downloader.downloadFile(blob, name);
        },
        onCopy: async (blob) => {
          if (Preflight.clipboard) return await Preflight.clipboard.copyImageToClipboard(blob);
          return { ok: false };
        },
        onOpenWorkspace: async () => {
          try {
            await Preflight.storageBridge.savePending(file, file.name, file.type, "upload");
            const response = await chrome.runtime.sendMessage({ type: "OPEN_OPTIMIZER" });
            if (!response?.ok) throw new Error(response?.error || "Could not open workspace.");
          } catch (e) { throw new Error(e.message || "Could not transfer file."); }
          overlay.close();
          openOverlays.delete(input);
          heldFiles.delete(input);
          input.value = "";
        }
      });

      openOverlays.set(input, overlay);
      return;
    }

    // Multiple files
    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const allPdfs = files.every((f) => f.type === "application/pdf" || (f.name || "").toLowerCase().endsWith(".pdf"));
    const allImages = files.every((f) => isSupportedImageFile(f));

    const overlay = Preflight.uploadUI.showReviewCard({
      fileName: `${files.length} files selected`,
      fileSize: totalBytes,
      fileType: "Batch Upload",
      category: allPdfs ? "pdf" : allImages ? "image" : "other",
      targetLimitBytes: limitBytes,
      largeFileWarning,
      canCompress: allImages,
      canMerge: allPdfs,
      onProcess: async (mode, compressionSettings) => {
        if (allPdfs && mode === "merge") {
          const proc = await ensurePdfProcessor();
          const mergedBlob = await proc.mergePdfs(files);
          const mergedName = `merged-${Date.now()}.pdf`;
          const mergedFile = new File([mergedBlob], mergedName, { type: "application/pdf" });
          return {
            name: mergedName,
            originalSize: totalBytes,
            optimizedSize: mergedBlob.size,
            reductionPercent: totalBytes > 0 ? Math.max(0, (totalBytes - mergedBlob.size) / totalBytes) : 0,
            blob: mergedBlob,
            file: mergedFile,
            alreadyOptimized: false
          };
        }

        if (allImages) {
          return await batchOptimizeImages(files, limitBytes, compressionSettings);
        }

        throw new Error("No multi-file processing available for this selection.");
      },
      onContinueOriginal: () => {
        openOverlays.delete(input);
        releaseOriginal(input);
      },
      onContinueUpload: (processedFile) => {
        openOverlays.delete(input);
        if (processedFile && processedFile instanceof File) {
          replaceInputFile(input, processedFile);
        } else if (Array.isArray(processedFile)) {
          replaceInputFiles(input, processedFile);
        } else {
          releaseOriginal(input);
        }
      },
      onCancel: () => cancelSelection(input, overlay),
      onDownload: (blob, name) => {
        if (Preflight.downloader) Preflight.downloader.downloadFile(blob, name);
      }
    });

    openOverlays.set(input, overlay);
  }

  async function processSingleFile(file, fileInfo, limitBytes, compressionSettings = {}) {
    if (fileInfo.category === "image") {
      const result = await optimizeImage(file, {
        format: compressionSettings.format || "image/webp",
        quality: compressionSettings.quality || 82,
        maxDimension: compressionSettings.maxDimension || null,
        convert: compressionSettings.convert,
        targetBytes: compressionSettings.fitSiteLimit ? limitBytes : null
      });

      const outputName = result.alreadyOptimized ? file.name : buildOutputFilename(file.name, result.format);
      const outputBlob = result.blob;
      const finalFile = new File([outputBlob], outputName, { type: result.format });

      return {
        name: outputName,
        originalSize: file.size,
        optimizedSize: outputBlob.size,
        reductionPercent: result.reductionPercent,
        blob: outputBlob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized,
        note: result.alreadyOptimized ? null : `${result.width} × ${result.height} · ${result.format.replace("image/", "").toUpperCase()}${result.quality ? ` · ${result.quality}% quality.` : " · lossless quality."}`
      };
    }

    if (fileInfo.category === "pdf") {
      const mode = compressionSettings.pdfMode || "normal";
      if(compressionSettings.pdfTargetInvalid)throw new Error('Enter a PDF target between 0.001 and 100 MB.');
      const targetBytes=compressionSettings.pdfTargetMB ? Math.round(compressionSettings.pdfTargetMB*1024*1024) : null;
      let result;
      if(mode!=='extreme') {
        const proc=await ensurePdfProcessor();result=await proc.compressPdf(file,mode,{signal:compressionSettings.signal,onProgress:compressionSettings.onProgress,strength:compressionSettings.pdfStrength,targetBytes});
      }
      if (mode === "extreme" || targetBytes && compressionSettings.allowFlatten && mode!=='light' && result.optimizedSize>targetBytes) {
        if(compressionSettings.signal?.aborted)throw new DOMException('Compression cancelled.','AbortError');
        if (!compressionSettings.allowFlatten) throw new Error("Confirm scan mode removes selectable text, links, forms and bookmarks before compressing.");
        if (file.size > 48 * 1024 * 1024 - 128) throw new Error("Scan upload processing supports files up to 48 MB. Open larger PDFs directly in the workspace.");
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
        // Normalize the MIME prefix for PDFs selected by extension rather than MIME.
        const response = await chrome.runtime.sendMessage({ type: "COMPRESS_SCAN_PDF", dataUrl: "data:application/pdf;base64," + dataUrl.split(",")[1], strength: compressionSettings.pdfStrength, targetBytes, allowFlatten: true });
        if (!response?.ok) throw new Error(response?.error || "Scan compression failed.");
        const scan = response.result;
        scan.blob = await (await fetch(scan.dataUrl)).blob();
        if(!result||scan.blob.size<result.blob.size)result=scan;
      }
      const outputName = result.alreadyOptimized ? file.name : buildOutputFilename(file.name, "pdf");
      const finalFile = new File([result.blob], outputName, { type: "application/pdf" });

      return {
        name: outputName,
        originalSize: result.originalSize,
        optimizedSize: result.optimizedSize,
        reductionPercent: result.reductionPercent,
        blob: result.blob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized,
        metTarget: (!limitBytes || result.optimizedSize <= limitBytes) && (!targetBytes || result.optimizedSize<=targetBytes),
        note: (targetBytes ? (result.optimizedSize<=targetBytes ? "Target size reached. " : "Target not reached. Allow whole-page compression or choose a larger target. ") : "") + (result.flattened ? "Pages are images. Selectable text, links, forms and bookmarks have been removed." : mode === "light" ? "Lossless compression." : `${result.imagesOptimized} embedded images optimized at strength ${result.profile.strength}/100. Increase strength or try scan mode for more compression. Savings depend on the file.`)
      };
    }

    if ((fileInfo.category === "text" || fileInfo.category === "csv") && Preflight.textProcessor) {
      const result = await Preflight.textProcessor.cleanText(file);
      const finalFile = new File([result.blob], file.name, { type: file.type });

      return {
        name: file.name,
        originalSize: result.originalSize,
        optimizedSize: result.optimizedSize,
        reductionPercent: result.reductionPercent,
        blob: result.blob,
        file: finalFile,
        alreadyOptimized: result.alreadyOptimized
      };
    }

    // Default passthrough
    return {
      name: file.name,
      originalSize: file.size,
      optimizedSize: file.size,
      reductionPercent: 0,
      blob: file,
      file: file,
      alreadyOptimized: true
    };
  }

  async function batchOptimizeImages(files, limitBytes, compressionSettings = {}) {
    const optimizedFiles = [];
    let totalOptimized = 0;
    const totalOriginal = files.reduce((acc, f) => acc + f.size, 0);

    for (const f of files) {
      try {
        const res = await optimizeImage(f, {
          format: compressionSettings.format || "image/webp",
          quality: compressionSettings.quality || 82,
          maxDimension: compressionSettings.maxDimension || null,
          convert: compressionSettings.convert,
          targetBytes: compressionSettings.fitSiteLimit ? limitBytes : null
        });
        const outName = res.alreadyOptimized ? f.name : buildOutputFilename(f.name, res.format);
        const optFile = new File([res.blob], outName, { type: res.format });
        optimizedFiles.push(optFile);
        totalOptimized += res.blob.size;
      } catch (e) {
        optimizedFiles.push(f);
        totalOptimized += f.size;
      }
    }

    return {
      name: `${files.length} Optimized Images`,
      originalSize: totalOriginal,
      optimizedSize: totalOptimized,
      reductionPercent: totalOriginal > 0 ? Math.max(0, (totalOriginal - totalOptimized) / totalOriginal) : 0,
      file: optimizedFiles,
      alreadyOptimized: totalOptimized >= totalOriginal
    };
  }

  function replaceInputFile(input, file) {
    heldFiles.delete(input);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.dataset.preflightBypass = "1";
    input.files = dt.files;
    redispatch(input);
  }

  function replaceInputFiles(input, fileArray) {
    heldFiles.delete(input);
    const dt = new DataTransfer();
    fileArray.forEach((f) => dt.items.add(f));
    input.dataset.preflightBypass = "1";
    input.files = dt.files;
    redispatch(input);
  }

  function releaseOriginal(input) {
    const originals = heldFiles.get(input);
    if (originals) replaceInputFiles(input, originals);
  }

  function cancelSelection(input, overlay) {
    overlay.close();
    openOverlays.delete(input);
    heldFiles.delete(input);
    input.value = "";
    try {
      input.dispatchEvent(new Event("cancel", { bubbles: true }));
    } catch (e) {}
  }

  async function ensurePdfProcessor() {
    if (Preflight.pdfProcessor) return Preflight.pdfProcessor;
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
        if (Preflight.pdfProcessor) return resolve(Preflight.pdfProcessor);
        return reject(new Error("PDF processor is not available in this context."));
      }
      chrome.runtime.sendMessage({ type: "ENSURE_PDF_LIB" }, (resp) => {
        if (resp && resp.ok && Preflight.pdfProcessor) {
          resolve(Preflight.pdfProcessor);
        } else {
          reject(new Error((resp && resp.error) || "Could not initialize PDF engine."));
        }
      });
    });
  }

  function redispatch(input) {
    bypassInputs.add(input);
    try {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    } finally { bypassInputs.delete(input); delete input.dataset.preflightBypass; }
  }

  function detectUploadLimit(input) {
    if (!input) return null;

    // 1. Direct data attribute check
    const dataAttrs = ["data-max-size", "data-file-size", "data-limit", "data-max-file-size"];
    for (const attr of dataAttrs) {
      const val = input.getAttribute(attr);
      if (val) {
        const parsed = parseFloat(val);
        if (Number.isFinite(parsed) && parsed > 0) {
          // If > 10000 assume bytes, else assume KB
          return Math.round(parsed > 10000 ? parsed : parsed * 1024);
        }
      }
    }

    // 2. DOM text scopes including aria-describedby
    const scopes = [];
    if (input.form) scopes.push(input.form);

    const ariaDescribedBy = input.getAttribute("aria-describedby");
    if (ariaDescribedBy) {
      ariaDescribedBy.split(/\s+/).forEach((id) => {
        const el = document.getElementById(id);
        if (el) scopes.push(el);
      });
    }

    let node = input;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      node = node.parentElement;
      scopes.push(node);
    }
    if (scopes.length < 2 && input.getRootNode && input.getRootNode().host) {
      scopes.push(input.getRootNode().host);
    }

    for (const scope of scopes) {
      if (!scope) continue;
      const text = (scope.textContent || "").slice(0, 4000);
      for (const pattern of LIMIT_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          const value = parseFloat(match[1]);
          const unit = (match[2] || "").toLowerCase();
          if (Number.isFinite(value) && value > 0) {
            return Math.round(value * (unit === "mb" ? 1024 * 1024 : 1024));
          }
        }
      }
    }
    return null;
  }

  Preflight.uploadDetector = {
    detectUploadLimit,
    LIMIT_PATTERNS
  };
})(typeof window !== "undefined" ? window : globalThis);
