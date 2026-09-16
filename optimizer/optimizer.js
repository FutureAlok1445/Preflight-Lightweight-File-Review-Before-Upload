/**
 * optimizer/optimizer.js
 * Comprehensive Preflight File Preparation Workspace (SPA v2).
 * Handles Images (presets, target size, slider, batch), PDFs (compress, split, merge),
 * Text & CSV (clean whitespace, text-to-pdf, csv-to-json), Screenshots, and Document verification.
 * Runs 100% locally in-memory with zero network transmission.
 */
(function () {
  "use strict";

  const P = window.Preflight || {};
  const { formatBytes, formatPercent, isSupportedImageFile } = P.utils || {};
  const { buildOutputFilename } = P.resultModel || P.utils || {};
  const { analyzeFile, analyzeImage } = P.fileAnalyzer || {};
  const { determineStrategy, isMeaningfulReduction } = P.smartProfile || {};
  const { optimizeImage, sampleContentHint } = P.imageOptimizer || {};
  const { copyImageToClipboard } = P.clipboard || {};
  const { downloadFile } = P.downloader || {};
  const pdfProcessor = P.pdfProcessor;
  const textProcessor = P.textProcessor;
  const batchProcessor = P.batchProcessor;
  const recentHistory = P.recentHistory;
  const ComparisonSlider = (P.comparisonSlider && P.comparisonSlider.ComparisonSlider) || null;

  const SETTINGS_KEY = "preflight:settings";

  const PRESETS = {
    light: { quality: 90, format: "auto", resize: 0, label: "Light" },
    balanced: { quality: 75, format: "auto", resize: 0, label: "Balanced" },
    strong: { quality: 50, format: "auto", resize: 0, label: "Strong" },
    target: { quality: null, format: "auto", resize: 0, label: "Target Size" }
  };

  const PANEL_IDS = {
    home: "panel-home",
    screenshot: "panel-screenshot",
    image: "imagePanel",
    pdf: "pdfPanel",
    text: "textPanel",
    files: "docPanel",
    recent: "panel-recent"
  };

  const state = {
    activePanel: "home",
    originalFile: null,
    fileInfo: null,
    category: "image", // 'image' | 'pdf' | 'text' | 'csv' | 'document' | 'other'

    // Image-specific
    imageMeta: null,
    contentHint: "unknown",
    activePreset: "balanced",
    selectedFormat: "auto",
    selectedQuality: 75,
    selectedResize: 0,
    targetBytes: null,
    imageResult: null,
    originalUrl: null,
    optimizedUrl: null,
    activePreviewTab: "after",
    processing: false,

    // PDF-specific
    pdfActiveSubView: "compress", // 'compress' | 'split' | 'merge'
    pdfPageCount: 1,
    pdfCompressedResult: null,
    pdfSplitResult: null,
    pdfMergeQueue: [],
    pdfMergedResult: null,

    // Text-specific
    textAnalysis: null,
    textCleanedResult: null,

    // Batch mode
    batchFiles: [],
    batchItems: []
  };

  let currentOptimizationId = 0;
  let currentPdfOpId = 0;
  let pendingReoptimize = false;
  let slider = null;

  const els = collectEls();

  init();

  async function init() {
    // Prevent accidental browser navigation on drop outside dropzone
    window.addEventListener("dragover", (e) => e.preventDefault(), false);
    window.addEventListener("drop", (e) => e.preventDefault(), false);

    wireNavigation();
    wireHomeAndEmptyState();
    wireScreenshotPanel();
    wireRecentPanel();
    wireHeaderActions();
    wirePresets();
    wireImageControls();
    wireImageActions();
    wirePdfControls();
    wireTextControls();
    wireDocumentControls();
    wireBatchControls();

    const settings = await loadSettings();
    applySettingsToState(settings);

    // Check if a file was passed via storage bridge (with 2s timeout per Task 2.3)
    const pending = await Promise.race([
      consumePending(),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);

    if (pending) {
      await loadFile(pending);
    } else {
      showPanel("home");
    }
  }

  function collectEls() {
    return {
      mainNav: document.getElementById("mainNav"),
      navButtons: Array.from(document.querySelectorAll(".nav-btn")),

      // Panels
      panelHome: document.getElementById("panel-home"),
      panelScreenshot: document.getElementById("panel-screenshot"),
      panelRecent: document.getElementById("panel-recent"),
      workState: document.getElementById("workState"),

      // Home & Empty State
      homeTagline: document.querySelector(".home-tagline"),
      emptySelectBtn: document.getElementById("emptySelectBtn"),
      emptyPasteBtn: document.getElementById("emptyPasteBtn"),
      emptyFileInput: document.getElementById("emptyFileInput"),
      emptyDropZone: document.getElementById("emptyDropZone"),
      qaCards: Array.from(document.querySelectorAll(".qa-card")),

      // Screenshot Panel
      screenshotAreaBtn: document.getElementById("screenshotAreaBtn"),
      screenshotTabBtn: document.getElementById("screenshotTabBtn"),
      screenshotStatus: document.getElementById("screenshotStatus"),

      // Recent Panel
      historyList: document.getElementById("historyList"),
      clearHistoryBtn: document.getElementById("clearHistoryBtn"),

      // Work Header
      fileName: document.getElementById("fileName"),
      fileMetaBadge: document.getElementById("fileMetaBadge"),
      newFileBtn: document.getElementById("newFileBtn"),

      workError: document.getElementById("workError"),
      processingNotice: document.getElementById("processingNotice"),
      actionStatus: document.getElementById("actionStatus"),

      // Main File Panels
      imagePanel: document.getElementById("imagePanel"),
      pdfPanel: document.getElementById("pdfPanel"),
      textPanel: document.getElementById("textPanel"),
      docPanel: document.getElementById("docPanel"),

      // Image Workspace
      originalSize: document.getElementById("originalSize"),
      originalDims: document.getElementById("originalDims"),
      optimizedSize: document.getElementById("optimizedSize"),
      optimizedDims: document.getElementById("optimizedDims"),
      reductionValue: document.getElementById("reductionValue"),
      noopNotice: document.getElementById("noopNotice"),
      tabBefore: document.getElementById("tabBefore"),
      tabAfter: document.getElementById("tabAfter"),
      previewImage: document.getElementById("previewImage"),
      sliderContainer: document.getElementById("sliderContainer"),

      singleFileControls: document.getElementById("singleFileControls"),
      presetBar: document.getElementById("presetBar"),
      presetButtons: Array.from(document.querySelectorAll(".preset-btn")),
      presetLabel: document.getElementById("presetLabel"),

      qualitySliderSection: document.getElementById("qualitySliderSection"),
      qualitySlider: document.getElementById("qualitySlider"),
      qualityValue: document.getElementById("qualityValue"),

      targetSizeRow: document.getElementById("targetSizeRow"),
      targetSizePreset: document.getElementById("targetSizePreset"),
      customTargetRow: document.getElementById("customTargetRow"),
      customTargetInput: document.getElementById("customTargetInput"),
      customTargetUnit: document.getElementById("customTargetUnit"),
      customTargetError: document.getElementById("customTargetError"),

      formatButtons: Array.from(document.querySelectorAll(".segmented-btn")),
      resizeSelect: document.getElementById("resizeSelect"),
      reoptimizeBtn: document.getElementById("reoptimizeBtn"),
      prepareForUploadBtn: document.getElementById("prepareForUploadBtn"),
      copyBtn: document.getElementById("copyBtn"),
      downloadBtn: document.getElementById("downloadBtn"),
      downloadOriginalBtn: document.getElementById("downloadOriginalBtn"),

      // Batch Controls
      batchContainer: document.getElementById("batchContainer"),
      batchFileList: document.getElementById("batchFileList"),
      batchSummary: document.getElementById("batchSummary"),
      batchStartBtn: document.getElementById("batchStartBtn"),
      batchDownloadAllBtn: document.getElementById("batchDownloadAllBtn"),

      // PDF Workspace
      pdfTabCompress: document.getElementById("pdfTabCompress"),
      pdfTabSplit: document.getElementById("pdfTabSplit"),
      pdfTabMerge: document.getElementById("pdfTabMerge"),
      pdfCompressView: document.getElementById("pdfCompressView"),
      pdfSplitView: document.getElementById("pdfSplitView"),
      pdfMergeView: document.getElementById("pdfMergeView"),

      pdfOrigSize: document.getElementById("pdfOrigSize"),
      pdfOptSize: document.getElementById("pdfOptSize"),
      pdfReductionVal: document.getElementById("pdfReductionVal"),
      runPdfCompressBtn: document.getElementById("runPdfCompressBtn"),
      downloadPdfCompressedBtn: document.getElementById("downloadPdfCompressedBtn"),

      pdfSplitRangeInput: document.getElementById("pdfSplitRangeInput"),
      pdfSplitRangeHint: document.getElementById("pdfSplitRangeHint"),
      runPdfSplitBtn: document.getElementById("runPdfSplitBtn"),
      downloadPdfSplitBtn: document.getElementById("downloadPdfSplitBtn"),

      pdfQueueList: document.getElementById("pdfQueueList"),
      addPdfToQueueBtn: document.getElementById("addPdfToQueueBtn"),
      pdfQueueInput: document.getElementById("pdfQueueInput"),
      runPdfMergeBtn: document.getElementById("runPdfMergeBtn"),
      downloadPdfMergedBtn: document.getElementById("downloadPdfMergedBtn"),

      // Text / CSV Workspace
      textLinesVal: document.getElementById("textLinesVal"),
      textWordsVal: document.getElementById("textWordsVal"),
      textCharsVal: document.getElementById("textCharsVal"),
      csvDelimItem: document.getElementById("csvDelimItem"),
      csvDelimVal: document.getElementById("csvDelimVal"),
      cleanTextBtn: document.getElementById("cleanTextBtn"),
      textToPdfBtn: document.getElementById("textToPdfBtn"),
      csvToJsonBtn: document.getElementById("csvToJsonBtn"),
      downloadTextBtn: document.getElementById("downloadTextBtn"),

      // Doc / Other Workspace
      docNotice: document.getElementById("docNotice"),
      downloadDocBtn: document.getElementById("downloadDocBtn")
    };
  }

  // ========================================================
  // SPA NAVIGATION & PANELS
  // ========================================================

  function wireNavigation() {
    els.navButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = btn.dataset.panel;
        showPanel(panel);
      });
    });

    els.qaCards.forEach((card) => {
      card.addEventListener("click", () => {
        const panel = card.dataset.panel;
        showPanel(panel);
      });
    });
  }

  function showPanel(name) {
    state.activePanel = name;

    // Update nav buttons
    els.navButtons.forEach((btn) => {
      const isActive = btn.dataset.panel === name;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });

    // Hide top-level panels
    if (els.panelHome) els.panelHome.hidden = true;
    if (els.panelScreenshot) els.panelScreenshot.hidden = true;
    if (els.panelRecent) els.panelRecent.hidden = true;

    hideAllFilePanels();

    let targetEl = null;

    if (name === "home") {
      els.workState.hidden = true;
      if (els.panelHome) {
        els.panelHome.hidden = false;
        targetEl = els.panelHome;
      }
    } else if (name === "screenshot") {
      els.workState.hidden = true;
      if (els.panelScreenshot) {
        els.panelScreenshot.hidden = false;
        targetEl = els.panelScreenshot;
      }
    } else if (name === "recent") {
      els.workState.hidden = true;
      if (els.panelRecent) {
        els.panelRecent.hidden = false;
        targetEl = els.panelRecent;
      }
      renderRecentPanel();
    } else {
      // Work panels: image, pdf, text, files
      els.workState.hidden = false;
      const filePanelId = PANEL_IDS[name];
      if (filePanelId) {
        const p = document.getElementById(filePanelId);
        if (p) {
          p.hidden = false;
          targetEl = p;
        }
      }
    }

    // Accessibility: focus first interactive element
    if (targetEl) {
      const focusable = targetEl.querySelector("button, input, select, [tabindex='0']");
      if (focusable && typeof focusable.focus === "function") {
        focusable.focus();
      }
    }
  }

  function hideAllFilePanels() {
    if (els.imagePanel) els.imagePanel.hidden = true;
    if (els.pdfPanel) els.pdfPanel.hidden = true;
    if (els.textPanel) els.textPanel.hidden = true;
    if (els.docPanel) els.docPanel.hidden = true;
  }

  // ========================================================
  // SETTINGS & STORAGE
  // ========================================================

  async function consumePending() {
    if (P.storageBridge && P.storageBridge.getPending) {
      return await P.storageBridge.getPending();
    }
    return null;
  }

  async function loadSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get(SETTINGS_KEY);
        if (store && store[SETTINGS_KEY]) return store[SETTINGS_KEY];
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {
      setActionStatus("Settings could not be loaded. Using defaults.", "error");
      setTimeout(() => clearActionStatus(), 3000);
    }
    return {
      defaultMode: "smart",
      preferredFormat: "auto",
      rememberQuality: true,
      lastQuality: 75,
      lastTargetSize: 512,
      lastPreset: "balanced",
      uploadOptimizerEnabled: true
    };
  }

  function applySettingsToState(settings) {
    if (settings.preferredFormat && settings.preferredFormat !== "auto") {
      state.selectedFormat = settings.preferredFormat;
    }
    if (settings.rememberQuality && settings.lastQuality) {
      state.selectedQuality = settings.lastQuality;
      if (els.qualitySlider) els.qualitySlider.value = String(settings.lastQuality);
      if (els.qualityValue) els.qualityValue.textContent = String(settings.lastQuality);
    }
    if (settings.lastPreset && PRESETS[settings.lastPreset]) {
      applyPreset(settings.lastPreset, false);
    }
    syncFormatButtons();
  }

  async function saveSettings(partial) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const store = await chrome.storage.local.get(SETTINGS_KEY);
        const current = store[SETTINGS_KEY] || {};
        const merged = Object.assign({}, current, partial);
        await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
      } else if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(SETTINGS_KEY);
        const current = saved ? JSON.parse(saved) : {};
        const merged = Object.assign({}, current, partial);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      }
    } catch (e) {
      setActionStatus("Settings could not be saved.", "error");
      setTimeout(() => clearActionStatus(), 3000);
    }
  }

  async function persistLastQuality(quality) {
    await saveSettings({ lastQuality: quality });
  }

  // ========================================================
  // HOME / EMPTY STATE & MULTI-FILE IMPORT
  // ========================================================

  function wireHomeAndEmptyState() {
    els.emptySelectBtn.addEventListener("click", () => els.emptyFileInput.click());

    els.emptyFileInput.addEventListener("change", async () => {
      const files = Array.from(els.emptyFileInput.files || []);
      els.emptyFileInput.value = "";
      if (files.length === 0) return;

      if (files.length > 1 && files.every(isSupportedImageFile)) {
        await enterBatchMode(files);
      } else {
        await loadFile(files[0]);
      }
    });

    els.emptyPasteBtn.addEventListener("click", () => {
      els.emptyDropZone.focus();
      setActionStatus("Press Control+V to paste an image from your clipboard.", null);
      setTimeout(() => clearActionStatus(), 4000);
    });

    document.addEventListener("paste", async (event) => {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      let found = false;
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            found = true;
            const finalFile = file.name
              ? file
              : new File([file], `clipboard-${Date.now()}.${file.type.split("/")[1] || "png"}`, { type: file.type });
            await loadFile(finalFile);
            return;
          }
        }
      }
      if (!found && document.activeElement && (document.activeElement === els.emptyDropZone || document.activeElement === els.emptyPasteBtn)) {
        showError("No supported image data was found in the clipboard.");
      }
    });

    ["dragenter", "dragover"].forEach((evt) => {
      els.emptyDropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.emptyDropZone.classList.add("is-active");
      });
    });

    ["dragleave", "dragend", "drop"].forEach((evt) => {
      els.emptyDropZone.addEventListener(evt, () => els.emptyDropZone.classList.remove("is-active"));
    });

    els.emptyDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;

      if (files.length > 1 && files.every(isSupportedImageFile)) {
        await enterBatchMode(files);
      } else {
        await loadFile(files[0]);
      }
    });

    els.emptyDropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") els.emptyFileInput.click();
    });
  }

  function wireHeaderActions() {
    els.newFileBtn.addEventListener("click", resetToEmptyState);
  }

  function resetToEmptyState() {
    revokeUrls();
    state.originalFile = null;
    state.fileInfo = null;
    state.imageMeta = null;
    state.imageResult = null;
    state.pdfCompressedResult = null;
    state.pdfSplitResult = null;
    state.pdfMergeQueue = [];
    state.pdfMergedResult = null;
    state.textAnalysis = null;
    state.textCleanedResult = null;
    state.batchFiles = [];
    state.batchItems = [];

    if (slider) slider.hide();
    if (els.prepareForUploadBtn) {
      els.prepareForUploadBtn.disabled = true;
      els.prepareForUploadBtn.title = "Load a file first";
    }

    els.singleFileControls.hidden = false;
    els.batchContainer.hidden = true;

    clearError();
    clearActionStatus();
    showPanel("home");
  }

  // ========================================================
  // UNIFIED FILE LOADING & 45 MB GUARD
  // ========================================================

  async function loadFile(file) {
    clearError();
    clearActionStatus();

    // 45 MB guard per Requirement 3.3 & Task 5.1
    if (file.size > 45 * 1024 * 1024) {
      showError(`File exceeds the 45 MB size limit (${formatBytes(file.size)}). Please choose a smaller file.`);
      return;
    }

    try {
      setProcessing(true, "Analyzing file…");
      const info = await analyzeFile(file);
      state.originalFile = file;
      state.fileInfo = info;
      state.category = info.category;

      // SECURITY: textContent only — no innerHTML with external data
      els.fileName.textContent = file.name;
      els.fileMetaBadge.textContent = `${info.label} · ${formatBytes(file.size)}`;

      const panelMap = {
        image: "image",
        pdf: "pdf",
        text: "text",
        csv: "text",
        document: "files",
        other: "files"
      };

      const targetPanel = panelMap[info.category] || "files";
      showPanel(targetPanel);

      if (info.category === "image") {
        await activateImageWorkspace(file, info);
      } else if (info.category === "pdf") {
        await activatePdfWorkspace(file, info);
      } else if (info.category === "text" || info.category === "csv") {
        await activateTextWorkspace(file, info);
      } else {
        await activateDocumentWorkspace(file, info);
      }
    } catch (err) {
      showError(err && err.message ? err.message : "Could not load file.");
    } finally {
      setProcessing(false);
    }
  }

  // ========================================================
  // PANEL: SCREENSHOT WORKSPACE
  // ========================================================

  function wireScreenshotPanel() {
    if (!els.screenshotAreaBtn || !els.screenshotTabBtn) return;

    els.screenshotAreaBtn.addEventListener("click", async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          els.screenshotStatus.textContent = "Selecting snip area on current tab…";
          const res = await chrome.runtime.sendMessage({ type: "TRIGGER_AREA_SNIP" });
          if (res && !res.ok) {
            els.screenshotStatus.textContent = res.error || "Snip not available on this tab.";
          }
        } else {
          els.screenshotStatus.textContent = "Area snip requires Chrome extension runtime.";
        }
      } catch (err) {
        els.screenshotStatus.textContent = "Snip error: " + (err.message || err);
      }
    });

    els.screenshotTabBtn.addEventListener("click", async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          els.screenshotStatus.textContent = "Capturing visible tab…";
          const res = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
          if (res && res.ok && res.dataUrl) {
            const resp = await fetch(res.dataUrl);
            const blob = await resp.blob();
            const file = new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
            els.screenshotStatus.textContent = "";
            await loadFile(file);
          } else {
            els.screenshotStatus.textContent = (res && res.error) || "Capture restricted on browser system pages.";
          }
        } else {
          els.screenshotStatus.textContent = "Tab capture requires Chrome extension runtime.";
        }
      } catch (err) {
        els.screenshotStatus.textContent = "Capture failed: " + (err.message || err);
      }
    });
  }

  // ========================================================
  // PANEL: RECENT HISTORY WORKSPACE
  // ========================================================

  function wireRecentPanel() {
    if (!els.clearHistoryBtn) return;
    els.clearHistoryBtn.addEventListener("click", async () => {
      if (confirm("Clear all history entries for this session?")) {
        if (recentHistory) await recentHistory.clearAll();
        await renderRecentPanel();
      }
    });
  }

  async function renderRecentPanel() {
    if (!els.historyList) return;
    // SECURITY: textContent only — no innerHTML with external data
    els.historyList.textContent = "";

    const entries = recentHistory ? await recentHistory.getAll() : [];
    if (!entries || entries.length === 0) {
      const emptyNote = document.createElement("p");
      emptyNote.className = "tool-explainer";
      emptyNote.textContent = "No recent results this session.";
      els.historyList.appendChild(emptyNote);
      return;
    }

    entries.forEach((item) => {
      const row = document.createElement("div");
      row.className = "history-row";

      const name = document.createElement("span");
      name.className = "history-name";
      name.textContent = item.filename;

      const meta = document.createElement("span");
      meta.className = "history-meta";
      const dt = item.timestamp ? item.timestamp.replace("T", " ").substring(0, 19) : "";
      meta.textContent = `${formatBytes(item.originalSize)} → ${formatBytes(item.outputSize)} (${item.savedPercent}%) · ${dt}`;

      const badge = document.createElement("span");
      badge.className = `history-badge ${item.status === "Success" ? "history-badge-success" : "history-badge-failed"}`;
      badge.textContent = item.status;

      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(badge);
      els.historyList.appendChild(row);
    });
  }

  async function recordHistory(file, optBlob, status = "Success") {
    if (!recentHistory || !file || !optBlob) return;
    const origSize = file.size || 0;
    const optSize = optBlob.size || 0;
    const saved = Math.max(0, origSize - optSize);
    const pct = origSize > 0 ? ((saved / origSize) * 100).toFixed(1) : "0.0";
    await recentHistory.addEntry({
      filename: file.name,
      format: optBlob.type || "unknown",
      originalSize: origSize,
      outputSize: optSize,
      savedPercent: pct,
      status: status
    });
  }

  // ========================================================
  // PANEL 1: IMAGE WORKSPACE & PRESETS
  // ========================================================

  async function activateImageWorkspace(file, info) {
    els.singleFileControls.hidden = false;
    els.batchContainer.hidden = true;

    if (els.prepareForUploadBtn) {
      els.prepareForUploadBtn.disabled = false;
      els.prepareForUploadBtn.title = "Optimize with Balanced preset for upload";
    }

    const meta = await analyzeImage(file);
    state.imageMeta = meta;

    revokeUrls();
    state.originalUrl = URL.createObjectURL(file);

    els.originalSize.textContent = formatBytes(meta.size);
    els.originalDims.textContent = `${meta.width} × ${meta.height}`;

    state.contentHint = await sampleHint(file);

    // Initialize Comparison Slider
    if (!slider && ComparisonSlider && els.sliderContainer) {
      slider = new ComparisonSlider(els.sliderContainer);
    }
    if (slider) {
      slider.reset();
      slider.hide();
    }

    applyPreset(state.activePreset, false);
    await runImageOptimization();
  }

  async function sampleHint(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const hint = await sampleContentHint(bitmap);
      bitmap.close();
      return hint;
    } catch (err) {
      return "unknown";
    }
  }

  function wirePresets() {
    els.presetButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.preset;
        applyPreset(name, true);
      });
    });
  }

  function applyPreset(name, triggerReoptimize = true) {
    const config = PRESETS[name];
    if (!config) return;

    state.activePreset = name;
    persistLastPreset(name);

    els.presetButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.preset === name);
    });
    if (els.presetLabel) els.presetLabel.textContent = config.label;

    if (name === "target") {
      if (els.qualitySliderSection) els.qualitySliderSection.hidden = true;
      if (els.targetSizeRow) els.targetSizeRow.hidden = false;
      syncTargetSizeInputs();
    } else {
      if (els.qualitySliderSection) els.qualitySliderSection.hidden = false;
      if (els.targetSizeRow) els.targetSizeRow.hidden = true;
      if (els.customTargetRow) els.customTargetRow.hidden = true;

      state.targetBytes = null;
      state.selectedQuality = config.quality;
      if (els.qualitySlider) els.qualitySlider.value = String(config.quality);
      if (els.qualityValue) els.qualityValue.textContent = String(config.quality);
    }

    if (triggerReoptimize && state.originalFile && state.category === "image") {
      runImageOptimization();
    }
  }

  async function persistLastPreset(preset) {
    await saveSettings({ lastPreset: preset });
  }

  function markPresetCustom() {
    state.activePreset = "custom";
    els.presetButtons.forEach((btn) => btn.classList.remove("is-active"));
    if (els.presetLabel) els.presetLabel.textContent = "Custom";
  }

  function syncTargetSizeInputs() {
    const val = els.targetSizePreset.value;
    if (val === "custom") {
      els.customTargetRow.hidden = false;
      validateCustomTarget();
    } else {
      els.customTargetRow.hidden = true;
      els.customTargetError.hidden = true;
      state.targetBytes = parseInt(val, 10);
      els.reoptimizeBtn.disabled = false;
    }
  }

  function validateCustomTarget() {
    const rawVal = els.customTargetInput.value.trim();
    const num = Number(rawVal);
    const unit = els.customTargetUnit.value;

    if (!rawVal || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 999999) {
      els.customTargetError.hidden = false;
      els.customTargetError.textContent = "Enter a value between 1 and 999,999.";
      state.targetBytes = null;
      els.reoptimizeBtn.disabled = true;
      return false;
    }

    els.customTargetError.hidden = true;
    state.targetBytes = num * (unit === "mb" ? 1048576 : 1024);
    els.reoptimizeBtn.disabled = false;
    return true;
  }

  function wireImageControls() {
    els.qualitySlider.addEventListener("input", () => {
      els.qualityValue.textContent = els.qualitySlider.value;
      markPresetCustom();
    });

    els.qualitySlider.addEventListener("change", () => {
      state.selectedQuality = Number(els.qualitySlider.value);
      persistLastQuality(state.selectedQuality);
      runImageOptimization();
    });

    els.targetSizePreset.addEventListener("change", () => {
      syncTargetSizeInputs();
      if (state.targetBytes) runImageOptimization();
    });

    els.customTargetInput.addEventListener("input", () => {
      if (validateCustomTarget()) {
        // Can re-optimize
      }
    });

    els.customTargetUnit.addEventListener("change", () => {
      if (validateCustomTarget()) {
        // Can re-optimize
      }
    });

    els.formatButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedFormat = btn.dataset.format;
        syncFormatButtons();
        markPresetCustom();
        runImageOptimization();
      });
    });

    els.resizeSelect.addEventListener("change", () => {
      state.selectedResize = Number(els.resizeSelect.value) || 0;
      markPresetCustom();
      runImageOptimization();
    });

    els.reoptimizeBtn.addEventListener("click", () => runImageOptimization());

    els.tabBefore.addEventListener("click", () => setActivePreviewTab("before"));
    els.tabAfter.addEventListener("click", () => setActivePreviewTab("after"));
  }

  function syncFormatButtons() {
    els.formatButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.format === state.selectedFormat);
    });
    if (els.qualitySlider) {
      els.qualitySlider.disabled = state.selectedFormat === "image/png";
    }
  }

  function setActivePreviewTab(tab) {
    state.activePreviewTab = tab;
    els.tabBefore.classList.toggle("is-active", tab === "before");
    els.tabAfter.classList.toggle("is-active", tab === "after");
    els.tabBefore.setAttribute("aria-selected", String(tab === "before"));
    els.tabAfter.setAttribute("aria-selected", String(tab === "after"));
    updatePreviewImage();
  }

  function updatePreviewImage() {
    if (state.activePreviewTab === "before" && state.originalUrl) {
      els.previewImage.src = state.originalUrl;
    } else if (state.optimizedUrl) {
      els.previewImage.src = state.optimizedUrl;
    } else if (state.originalUrl) {
      els.previewImage.src = state.originalUrl;
    }
  }

  function resolveTargetFormat() {
    if (state.selectedFormat !== "auto") return state.selectedFormat;
    const strategy = determineStrategy(state.imageMeta, { contentHint: state.contentHint });
    return strategy.format;
  }

  async function runImageOptimization() {
    if (!state.originalFile || state.category !== "image") return;
    if (state.processing) {
      pendingReoptimize = true;
      return;
    }

    // Dimension clamp notification per Task 7.3
    if (state.imageMeta && (state.imageMeta.width > 8000 || state.imageMeta.height > 8000 || state.selectedResize > 8000)) {
      setActionStatus("Dimension clamped to 8000 px (maximum safe canvas size).", null);
    }

    state.processing = true;
    pendingReoptimize = false;
    setProcessing(true, "Optimizing image locally…");
    clearError();

    const thisId = ++currentOptimizationId;

    try {
      const format = resolveTargetFormat();
      const maxDimension = state.selectedResize || null;

      const result = await optimizeImage(state.originalFile, {
        format,
        quality: state.selectedQuality,
        maxDimension,
        targetBytes: state.targetBytes
      });

      if (thisId !== currentOptimizationId) return;

      state.imageResult = result;
      renderImageResult(result);
      await recordHistory(state.originalFile, result.blob, "Success");

      if (P.storageBridge && P.storageBridge.saveLastResult) {
        await P.storageBridge.saveLastResult(result, state.originalFile);
      }
    } catch (err) {
      if (thisId === currentOptimizationId) {
        showError(err && err.message ? err.message : "Optimization failed. Your original file is unchanged.");
        await recordHistory(state.originalFile, state.originalFile, "Failed");
      }
    } finally {
      if (thisId === currentOptimizationId) {
        state.processing = false;
        setProcessing(false);
        if (pendingReoptimize) {
          pendingReoptimize = false;
          runImageOptimization();
        }
      }
    }
  }

  function renderImageResult(result) {
    if (state.optimizedUrl) URL.revokeObjectURL(state.optimizedUrl);
    state.optimizedUrl = URL.createObjectURL(result.blob);

    els.optimizedSize.textContent = formatBytes(result.optimizedSize);
    els.optimizedDims.textContent = `${result.width} × ${result.height}`;

    // Honest reporting per Task 7.4 & Requirements 1.3, 10.4
    if (result.alreadyOptimized) {
      els.reductionValue.textContent = "0%";
      els.noopNotice.hidden = false;
      setActionStatus("✓ Image is already optimally sized. Original file preserved.", "success");
      if (slider) slider.hide();
    } else {
      els.noopNotice.hidden = true;
      els.reductionValue.textContent = formatPercent(result.reductionPercent);

      if (result.metTarget === false) {
        if (result.timedOut) {
          setActionStatus(`Time limit reached. Best size achieved: ${formatBytes(result.optimizedSize)}.`, null);
        } else {
          setActionStatus(`Target not reached. Best achieved: ${formatBytes(result.optimizedSize)} (${result.attempts} attempts).`, null);
        }
      } else {
        clearActionStatus();
      }

      if (slider) {
        slider.updateImages(state.originalUrl, state.optimizedUrl);
        slider.show();
      }
    }

    updatePreviewImage();
  }

  function wireImageActions() {
    els.prepareForUploadBtn.addEventListener("click", async () => {
      applyPreset("balanced", true);
    });

    els.copyBtn.addEventListener("click", async () => {
      if (!state.imageResult) return;
      setActionStatus("Copying image to clipboard…", null);
      const result = await copyImageToClipboard(state.imageResult.blob);

      if (result.ok) {
        setActionStatus(result.message, "success");
        setTimeout(() => clearActionStatus(), 3000);
      } else {
        setActionStatus(result.message, "error");
        if (result.fallbackToDownload) {
          els.downloadBtn.classList.add("btn-primary");
          els.downloadBtn.title = "Clipboard unavailable — download instead";
        }
      }
    });

    els.downloadBtn.addEventListener("click", () => {
      if (!state.imageResult) return;
      const name = state.imageResult.alreadyOptimized
        ? state.originalFile.name
        : buildOutputFilename(state.originalFile.name, state.imageResult.format, "image");
      downloadFile(state.imageResult.blob, name);
      setActionStatus(`Downloaded ${name}`, "success");
      setTimeout(() => clearActionStatus(), 4000);
    });

    els.downloadOriginalBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded original ${state.originalFile.name}`, "success");
      setTimeout(() => clearActionStatus(), 4000);
    });
  }

  // ========================================================
  // BATCH IMAGE PROCESSING (PHASE 10)
  // ========================================================

  function wireBatchControls() {
    if (!els.batchStartBtn) return;

    els.batchStartBtn.addEventListener("click", async () => {
      if (!batchProcessor || state.batchFiles.length === 0) return;

      els.batchStartBtn.disabled = true;
      els.batchDownloadAllBtn.disabled = true;

      const opts = {
        format: resolveTargetFormat(),
        quality: state.selectedQuality,
        maxDimension: state.selectedResize || null
      };

      const results = await batchProcessor.batchOptimize(state.batchFiles, opts, (prog) => {
        const item = state.batchItems[prog.index];
        if (item) {
          item.status = prog.status;
          item.result = prog.result || null;
          item.error = prog.error || null;
          renderBatchList(state.batchItems);
          renderBatchSummary(state.batchItems);
        }
      });

      els.batchStartBtn.disabled = false;
      const hasDone = state.batchItems.some((it) => it.status === "done");
      els.batchDownloadAllBtn.disabled = !hasDone;
    });

    els.batchDownloadAllBtn.addEventListener("click", async () => {
      const doneItems = state.batchItems.filter((it) => it.status === "done" && it.result);
      for (const item of doneItems) {
        const name = buildOutputFilename(item.file.name, item.result.format, "image");
        downloadFile(item.result.blob, name);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setActionStatus(`Downloaded ${doneItems.length} optimized images.`, "success");
    });
  }

  async function enterBatchMode(files) {
    showPanel("image");
    els.singleFileControls.hidden = true;
    els.batchContainer.hidden = false;

    state.batchFiles = files;
    state.batchItems = files.map((file, index) => ({
      file,
      index,
      status: "queued",
      result: null,
      error: null
    }));

    // SECURITY: textContent only
    els.fileName.textContent = `Batch (${files.length} images)`;
    els.fileMetaBadge.textContent = `${files.length} files queued`;

    renderBatchList(state.batchItems);
    els.batchSummary.hidden = true;
    els.batchDownloadAllBtn.disabled = true;
  }

  function renderBatchList(items) {
    // SECURITY: textContent only — no innerHTML with external data
    els.batchFileList.textContent = "";

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "batch-row";

      const name = document.createElement("span");
      name.className = "batch-name";
      name.textContent = item.file.name;

      const size = document.createElement("span");
      size.className = "batch-size";
      size.textContent = formatBytes(item.file.size);

      const status = document.createElement("span");
      status.className = `batch-status batch-status-${item.status}`;
      status.textContent = item.status;

      const resultCol = document.createElement("span");
      if (item.status === "done" && item.result) {
        resultCol.className = "batch-saved";
        resultCol.textContent = formatPercent(item.result.reductionPercent);
      } else if (item.status === "failed") {
        resultCol.className = "batch-error";
        resultCol.textContent = item.error || "Failed";
      } else {
        resultCol.textContent = "—";
      }

      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(status);
      row.appendChild(resultCol);
      els.batchFileList.appendChild(row);
    });
  }

  function renderBatchSummary(items) {
    const doneItems = items.filter((it) => it.status === "done" && it.result);
    if (doneItems.length === 0) return;

    let origTotal = 0;
    let optTotal = 0;
    doneItems.forEach((it) => {
      origTotal += it.file.size;
      optTotal += it.result.optimizedSize;
    });

    const saved = Math.max(0, origTotal - optTotal);
    const pct = origTotal > 0 ? ((saved / origTotal) * 100).toFixed(1) : "0.0";

    els.batchSummary.hidden = false;
    // SECURITY: textContent only
    els.batchSummary.textContent = `Completed ${doneItems.length} of ${items.length} files · Saved ${formatBytes(saved)} (${pct}% net reduction)`;
  }

  // ========================================================
  // PANEL 2: PDF WORKSPACE & MULTI-STAGE NOTICES
  // ========================================================

  async function activatePdfWorkspace(file, info) {
    setPdfSubView("compress");

    els.pdfOrigSize.textContent = formatBytes(file.size);
    els.pdfOptSize.textContent = "—";
    els.pdfReductionVal.textContent = "—";
    els.downloadPdfCompressedBtn.disabled = true;

    if (pdfProcessor) {
      try {
        const analysis = await pdfProcessor.analyzePdf(file);
        state.pdfPageCount = analysis.pageCount || 1;
        els.pdfSplitRangeHint.textContent = `Document has ${state.pdfPageCount} page${state.pdfPageCount > 1 ? "s" : ""}.`;
      } catch (e) {
        state.pdfPageCount = 1;
        els.pdfSplitRangeHint.textContent = "Page count unavailable.";
      }
    }

    state.pdfMergeQueue = [file];
    renderPdfQueue();
  }

  function wirePdfControls() {
    els.pdfTabCompress.addEventListener("click", () => setPdfSubView("compress"));
    els.pdfTabSplit.addEventListener("click", () => setPdfSubView("split"));
    els.pdfTabMerge.addEventListener("click", () => setPdfSubView("merge"));

    // Subview 1: Compress with Multi-stage notice
    els.runPdfCompressBtn.addEventListener("click", async () => {
      if (!pdfProcessor || !state.originalFile) return;
      const opId = ++currentPdfOpId;
      try {
        setProcessing(true, "Loading PDF document…");
        await new Promise((r) => setTimeout(r, 60));
        if (opId !== currentPdfOpId) return;

        setProcessing(true, "Compressing object streams and removing redundant dictionaries…");
        clearError();

        const result = await pdfProcessor.compressPdf(state.originalFile);
        if (opId !== currentPdfOpId) return;

        setProcessing(true, "Finalizing compressed output…");
        await new Promise((r) => setTimeout(r, 40));

        state.pdfCompressedResult = result;
        els.pdfOptSize.textContent = formatBytes(result.optimizedSize);
        els.pdfReductionVal.textContent = result.alreadyOptimized ? "0%" : formatPercent(result.reductionPercent);
        els.downloadPdfCompressedBtn.disabled = false;

        await recordHistory(state.originalFile, result.blob, "Success");

        setActionStatus(
          result.alreadyOptimized
            ? "PDF is already optimally compressed. Original preserved."
            : `PDF compressed! Saved ${formatPercent(result.reductionPercent)}.`,
          "success"
        );
      } catch (err) {
        if (opId === currentPdfOpId) {
          showError("PDF compression failed: " + (err.message || err));
        }
      } finally {
        if (opId === currentPdfOpId) setProcessing(false);
      }
    });

    els.downloadPdfCompressedBtn.addEventListener("click", () => {
      if (!state.pdfCompressedResult) return;
      const name = buildOutputFilename(state.originalFile.name, "application/pdf", "pdfCompress");
      downloadFile(state.pdfCompressedResult.blob, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });

    // Subview 2: Split with Multi-stage notice
    els.runPdfSplitBtn.addEventListener("click", async () => {
      if (!pdfProcessor || !state.originalFile) return;
      const range = els.pdfSplitRangeInput.value.trim();
      if (!range) {
        showError("Please specify page numbers or ranges to extract (e.g. 1-2, 4).");
        return;
      }
      const opId = ++currentPdfOpId;
      try {
        setProcessing(true, "Parsing page ranges…");
        await new Promise((r) => setTimeout(r, 40));
        if (opId !== currentPdfOpId) return;

        setProcessing(true, "Extracting pages into standalone PDF…");
        clearError();

        const splitBlob = await pdfProcessor.splitPdf(state.originalFile, range);
        if (opId !== currentPdfOpId) return;

        state.pdfSplitResult = splitBlob;
        els.downloadPdfSplitBtn.disabled = false;
        await recordHistory(state.originalFile, splitBlob, "Success");

        setActionStatus(`Extracted pages into a new PDF (${formatBytes(splitBlob.size)}).`, "success");
      } catch (err) {
        if (opId === currentPdfOpId) {
          showError("Failed to extract pages: " + (err.message || err));
        }
      } finally {
        if (opId === currentPdfOpId) setProcessing(false);
      }
    });

    els.downloadPdfSplitBtn.addEventListener("click", () => {
      if (!state.pdfSplitResult) return;
      const name = buildOutputFilename(state.originalFile.name, "application/pdf", "pdfSplit");
      downloadFile(state.pdfSplitResult, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });

    // Subview 3: Merge with Drag-and-Drop & Multi-stage notice
    els.addPdfToQueueBtn.addEventListener("click", () => els.pdfQueueInput.click());
    els.pdfQueueInput.addEventListener("change", () => {
      const files = Array.from(els.pdfQueueInput.files || []);
      els.pdfQueueInput.value = "";
      if (files.length > 0) {
        state.pdfMergeQueue.push(...files);
        renderPdfQueue();
      }
    });

    els.runPdfMergeBtn.addEventListener("click", async () => {
      if (!pdfProcessor || state.pdfMergeQueue.length < 2) return;
      const opId = ++currentPdfOpId;
      try {
        setProcessing(true, "Reading PDFs from queue…");
        await new Promise((r) => setTimeout(r, 40));
        if (opId !== currentPdfOpId) return;

        setProcessing(true, `Merging ${state.pdfMergeQueue.length} documents…`);
        clearError();

        const mergedBlob = await pdfProcessor.mergePdfs(state.pdfMergeQueue);
        if (opId !== currentPdfOpId) return;

        state.pdfMergedResult = mergedBlob;
        els.downloadPdfMergedBtn.disabled = false;

        const fakeMergedFile = { name: "merged.pdf", size: mergedBlob.size };
        await recordHistory(fakeMergedFile, mergedBlob, "Success");

        setActionStatus(`Successfully merged ${state.pdfMergeQueue.length} PDFs (${formatBytes(mergedBlob.size)})!`, "success");
      } catch (err) {
        if (opId === currentPdfOpId) {
          showError("Merge failed: " + (err.message || err));
        }
      } finally {
        if (opId === currentPdfOpId) setProcessing(false);
      }
    });

    els.downloadPdfMergedBtn.addEventListener("click", () => {
      if (!state.pdfMergedResult) return;
      const name = buildOutputFilename("merged.pdf", "application/pdf", "pdfMerge");
      downloadFile(state.pdfMergedResult, name);
      setActionStatus(`Downloaded ${name}`, "success");
    });
  }

  function setPdfSubView(view) {
    state.pdfActiveSubView = view;
    els.pdfTabCompress.classList.toggle("is-active", view === "compress");
    els.pdfTabSplit.classList.toggle("is-active", view === "split");
    els.pdfTabMerge.classList.toggle("is-active", view === "merge");

    els.pdfCompressView.hidden = view !== "compress";
    els.pdfSplitView.hidden = view !== "split";
    els.pdfMergeView.hidden = view !== "merge";
  }

  function renderPdfQueue() {
    // SECURITY: textContent only — no innerHTML with external data
    els.pdfQueueList.textContent = "";

    state.pdfMergeQueue.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "pdf-queue-item";
      item.setAttribute("draggable", "true");

      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(index));
        item.classList.add("is-dragging");
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(fromIndex) && fromIndex !== index) {
          const moved = state.pdfMergeQueue.splice(fromIndex, 1)[0];
          state.pdfMergeQueue.splice(index, 0, moved);
          renderPdfQueue();
        }
      });

      const title = document.createElement("span");
      title.className = "pdf-queue-name";
      title.textContent = `${index + 1}. ${file.name} (${formatBytes(file.size)})`;

      const controls = document.createElement("div");
      controls.className = "pdf-queue-actions";

      const upBtn = document.createElement("button");
      upBtn.className = "btn-icon";
      upBtn.type = "button";
      upBtn.textContent = "↑";
      upBtn.setAttribute("aria-label", `Move ${file.name} up`);
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => {
        if (index > 0) {
          const temp = state.pdfMergeQueue[index - 1];
          state.pdfMergeQueue[index - 1] = state.pdfMergeQueue[index];
          state.pdfMergeQueue[index] = temp;
          renderPdfQueue();
        }
      });
      controls.appendChild(upBtn);

      const downBtn = document.createElement("button");
      downBtn.className = "btn-icon";
      downBtn.type = "button";
      downBtn.textContent = "↓";
      downBtn.setAttribute("aria-label", `Move ${file.name} down`);
      downBtn.disabled = index === state.pdfMergeQueue.length - 1;
      downBtn.addEventListener("click", () => {
        if (index < state.pdfMergeQueue.length - 1) {
          const temp = state.pdfMergeQueue[index + 1];
          state.pdfMergeQueue[index + 1] = state.pdfMergeQueue[index];
          state.pdfMergeQueue[index] = temp;
          renderPdfQueue();
        }
      });
      controls.appendChild(downBtn);

      if (state.pdfMergeQueue.length > 1) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-icon";
        removeBtn.type = "button";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
        removeBtn.addEventListener("click", () => {
          state.pdfMergeQueue.splice(index, 1);
          renderPdfQueue();
        });
        controls.appendChild(removeBtn);
      }

      item.appendChild(title);
      item.appendChild(controls);
      els.pdfQueueList.appendChild(item);
    });

    els.runPdfMergeBtn.disabled = state.pdfMergeQueue.length < 2;
  }

  // ========================================================
  // PANEL 3: TEXT & CSV WORKSPACE
  // ========================================================

  async function activateTextWorkspace(file, info) {
    const isCsv = info.category === "csv";
    els.csvDelimItem.hidden = !isCsv;
    els.csvToJsonBtn.hidden = !isCsv;

    if (textProcessor) {
      try {
        const stats = await textProcessor.analyzeText(file);
        state.textAnalysis = stats;
        els.textLinesVal.textContent = stats.lines.toLocaleString();
        els.textWordsVal.textContent = stats.words.toLocaleString();
        els.textCharsVal.textContent = stats.characters.toLocaleString();

        if (isCsv && stats.delimiter) {
          const delimDisplay = stats.delimiter === "\t" ? "Tab" : `"${stats.delimiter}"`;
          els.csvDelimVal.textContent = delimDisplay + (stats.ambiguous ? " (Ambiguous)" : "");
        }
      } catch (e) {
        els.textLinesVal.textContent = "—";
        els.textWordsVal.textContent = "—";
        els.textCharsVal.textContent = "—";
      }
    }
  }

  function wireTextControls() {
    els.cleanTextBtn.addEventListener("click", async () => {
      if (!textProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Cleaning whitespace and empty lines…");
        clearError();
        const res = await textProcessor.cleanText(state.originalFile);
        state.textCleanedResult = res;

        if (res.alreadyOptimized) {
          setActionStatus("No changes needed. File is already clean.", "success");
        } else {
          setActionStatus(`Removed ${res.linesRemoved} blank lines, saved ${formatBytes(res.bytesRemoved)}.`, "success");
          const outName = buildOutputFilename(state.originalFile.name, state.originalFile.type || "text/plain", "textClean");
          downloadFile(res.blob, outName);
          await recordHistory(state.originalFile, res.blob, "Success");
        }
      } catch (err) {
        showError("Clean failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.textToPdfBtn.addEventListener("click", async () => {
      if (!textProcessor || !pdfProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Generating formatted PDF…");
        clearError();
        const textContent = await textProcessor.readText(state.originalFile);
        const pdfBlob = await pdfProcessor.textToPdf(textContent, { title: state.originalFile.name });
        const outName = buildOutputFilename(state.originalFile.name, "application/pdf", "textToPdf");
        downloadFile(pdfBlob, outName);
        await recordHistory(state.originalFile, pdfBlob, "Success");
        setActionStatus(`Converted to PDF: ${outName}`, "success");
      } catch (err) {
        showError("PDF conversion failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.csvToJsonBtn.addEventListener("click", async () => {
      if (!textProcessor || !state.originalFile) return;
      try {
        setProcessing(true, "Exporting CSV to JSON…");
        clearError();
        const jsonBlob = await textProcessor.csvToJson(state.originalFile);
        const outName = state.originalFile.name.replace(/\.csv$/i, "") + ".json";
        downloadFile(jsonBlob, outName);
        await recordHistory(state.originalFile, jsonBlob, "Success");
        setActionStatus(`Exported to ${outName}`, "success");
      } catch (err) {
        showError("CSV conversion failed: " + (err.message || err));
      } finally {
        setProcessing(false);
      }
    });

    els.downloadTextBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded ${state.originalFile.name}`, "success");
    });
  }

  // ========================================================
  // PANEL 4: DOCUMENT & OTHER WORKSPACE
  // ========================================================

  async function activateDocumentWorkspace(file, info) {
    els.docNotice.textContent = `"${file.name}" is recognized as a ${info.label} archive (${formatBytes(file.size)}). Document packages maintain internal XML schemas and zip compression. PREflight validates its integrity and preserves your file intact for upload.`;
  }

  function wireDocumentControls() {
    els.downloadDocBtn.addEventListener("click", () => {
      if (!state.originalFile) return;
      downloadFile(state.originalFile, state.originalFile.name);
      setActionStatus(`Downloaded ${state.originalFile.name}`, "success");
    });
  }

  // ========================================================
  // SHARED UI HELPERS & MEMORY CLEANUP
  // ========================================================

  function setProcessing(isProcessing, message) {
    els.processingNotice.hidden = !isProcessing;
    if (message) els.processingNotice.textContent = message;

    const btns = [
      els.reoptimizeBtn,
      els.prepareForUploadBtn,
      els.copyBtn,
      els.downloadBtn,
      els.runPdfCompressBtn,
      els.runPdfSplitBtn,
      els.runPdfMergeBtn,
      els.cleanTextBtn,
      els.textToPdfBtn,
      els.csvToJsonBtn
    ];
    btns.forEach((el) => {
      if (el) el.disabled = isProcessing;
    });
  }

  function showError(message) {
    els.workError.textContent = message;
    els.workError.hidden = false;
  }

  function clearError() {
    els.workError.hidden = true;
    els.workError.textContent = "";
  }

  function setActionStatus(message, kind) {
    els.actionStatus.textContent = message || "";
    els.actionStatus.classList.remove("is-error", "is-success");
    if (kind) els.actionStatus.classList.add(kind === "error" ? "is-error" : "is-success");
  }

  function clearActionStatus() {
    els.actionStatus.textContent = "";
    els.actionStatus.classList.remove("is-error", "is-success");
  }

  function revokeUrls() {
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    if (state.optimizedUrl) URL.revokeObjectURL(state.optimizedUrl);
    state.originalUrl = null;
    state.optimizedUrl = null;
    if (els.previewImage) els.previewImage.removeAttribute("src");
  }

  window.addEventListener("beforeunload", revokeUrls);
})();
