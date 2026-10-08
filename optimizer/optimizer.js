/* Preflight workspace: explicit operations, one active job, local processing. */
(() => {
  "use strict";
  const P = window.Preflight;
  const $ = id => document.getElementById(id);
  const { formatBytes, formatPercent, buildOutputFilename, isSupportedImageFile } = P.utils;
  let tool = "home", file = null, category = null, result = null, busy = false, importQueued = false;
  let source = null, sourceUrl = null, originalUrl = null, resultUrl = null, pdfQueue = [], batchFiles = [];
  let pdfView = "compress", editing = false;
  let textSource = "", textEdited = false, editorProject = null, editorSession = null;
  const titles = { home: "Overview", image: "Images", pdf: "PDF tools", capture: "Screenshots", text: "Text & CSV", recent: "Recent activity" };
  const descriptions = { image: "Compress, resize or convert still PNG, JPEG, WebP, BMP, GIF and browser-supported AVIF images. Select several for a batch. Animated images remain unchanged.", pdf: "Compress a PDF, extract pages, or choose several PDFs to merge.", text: "Edit UTF-8 text, clean whitespace, convert CSV to JSON, or export Latin text as a PDF." };
  const accepts = { image: ".png,.jpg,.jpeg,.webp,.bmp,.gif,.avif", pdf: ".pdf,application/pdf", text: ".txt,.csv,text/plain,text/csv" };
  const status = (message = "", kind = "") => { $("status").textContent = message; $("status").className = `status ${kind}`; };
  const isPdf = f => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const node = (tag, text, className) => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
  for (const [id, button] of [['imageLive', 'runImage'], ['pdfLive', 'runPdfCompress'], ['batchLive', 'runBatch']]) {
    const label = node('p', 'Live size appears here after choosing a file.', 'hint'); label.id = id; label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite'); $(button).before(label);
  }
  const strengthLabel = node('label', 'Compression strength (linked to quality)'); strengthLabel.htmlFor = 'imageStrength';
  const imageStrength = document.createElement('input'); imageStrength.id = 'imageStrength'; imageStrength.type = 'range'; imageStrength.min = '0'; imageStrength.max = '100'; imageStrength.value = '24';
  const strengthValue = node('output', '24/100'); strengthValue.id = 'imageStrengthValue'; strengthValue.htmlFor = 'imageStrength';
  $('qualityHint').before(strengthLabel, strengthValue, imageStrength);
  const batchStrengthLabel = node('label', 'Compression strength (linked to quality)'); batchStrengthLabel.htmlFor = 'batchStrength';
  const batchStrength = document.createElement('input'); batchStrength.id = 'batchStrength'; batchStrength.type = 'range'; batchStrength.min = '0'; batchStrength.max = '100'; batchStrength.value = '24';
  const batchStrengthValue = node('output', '24/100'); batchStrengthValue.htmlFor = 'batchStrength';
  $('batchQuality').after(batchStrengthLabel, batchStrengthValue, batchStrength);
  const pdfTargetLabel=node('label','Target size (MB, optional)');pdfTargetLabel.htmlFor='pdfTarget';
  const pdfTarget=document.createElement('input');pdfTarget.id='pdfTarget';pdfTarget.type='number';pdfTarget.min='0.001';pdfTarget.max='100';pdfTarget.step='any';pdfTarget.placeholder='For example, 2';$('flattenLabel').before(pdfTargetLabel,pdfTarget);
  const pdfGoalLabel=node('label','Desired size reduction');pdfGoalLabel.htmlFor='pdfReduction';
  const pdfGoal=document.createElement('input');pdfGoal.id='pdfReduction';pdfGoal.type='range';pdfGoal.min='0';pdfGoal.max='99';pdfGoal.step='1';pdfGoal.value='0';
  const pdfGoalValue=node('output','No target');pdfGoalValue.id='pdfReductionValue';pdfGoalValue.htmlFor='pdfReduction';pdfTargetLabel.before(pdfGoalLabel,pdfGoalValue,pdfGoal);
  $('pdfMode').querySelector('[value="extreme"]').textContent='Smallest · compress all page content';
  $('flattenLabel').lastChild.textContent='Allow whole-page image compression. Selectable text, links, forms and bookmarks will be removed.';
  let liveVersion = 0, liveTimer, liveTask = null, liveCache = null, liveUrl = null, liveController = null;
  function liveKey() { return JSON.stringify(category === 'batch' ? ['batch', $('batchFormat').value, $('batchQuality').value, $('batchResize').value] : category === 'image' ? ['image', $('imageFormat').value, $('imageQuality').value, $('imageResize').value, $('imageTarget').value] : ['pdf', $('pdfMode').value, $('pdfStrength').value, $('allowFlatten').checked, pdfTarget.value]); }
  async function measure(input, kind, signal, onProgress) {
    if (kind === 'batch') return P.batchProcessor.batchOptimize(input, { format: $('batchFormat').value, quality: Number($('batchQuality').value), maxDimension: Number($('batchResize').value) || null });
    if (kind === 'image') {
      const target = $('imageTarget').value.trim();
      if (target && !$('imageTarget').checkValidity()) throw new Error('Enter a target between 1 and 46,080 KB.');
      return P.imageOptimizer.optimizeImage(input, { format: $('imageFormat').value === 'auto' ? 'image/webp' : $('imageFormat').value, convert: $('imageFormat').value !== 'auto', quality: Number($('imageQuality').value), maxDimension: Number($('imageResize').value) || null, targetBytes: target ? Math.round(Number(target) * 1024) : null });
    }
    if(!pdfTarget.checkValidity())throw new Error('Enter a PDF target between 0.001 and 100 MB.');
    return P.pdfProcessor.compressPdf(input, $('pdfMode').value, { signal, onProgress, strength: Number($('pdfStrength').value), targetBytes:pdfTarget.value?Math.round(Number(pdfTarget.value)*1024*1024):null, allowFlatten: $('allowFlatten').checked });
  }
  function scheduleLive() {
    liveController?.abort();
    liveVersion++; clearTimeout(liveTimer); liveCache = null;
    if (liveUrl) URL.revokeObjectURL(liveUrl); liveUrl = null;
    if (category === 'image' && sourceUrl) $('previewImage').src = sourceUrl;
    if (!file || !['image', 'pdf', 'batch'].includes(category) || category === 'pdf' && pdfView !== 'compress' || editing) return;
    if (category === 'batch') renderBatch();
    const label = $(category === 'batch' ? 'batchLive' : category === 'image' ? 'imageLive' : 'pdfLive');
    label.textContent = 'Updating actual size…';
    if (category === 'pdf' && $('pdfMode').value === 'extreme' && !$('allowFlatten').checked) { label.textContent = 'Confirm scan mode to preview its size.'; return; }
    liveTimer = setTimeout(runLive, 300);
  }
  async function runLive() {
    if (liveTask || busy || editing) return;
    if (!file || !['image', 'pdf', 'batch'].includes(category) || category === 'pdf' && (pdfView !== 'compress' || $('pdfMode').value === 'extreme' && !$('allowFlatten').checked)) return;
    const version = liveVersion, input = category === 'batch' ? batchFiles : category === 'image' ? source : file, kind = category, key = liveKey(), label = $(kind === 'batch' ? 'batchLive' : kind === 'image' ? 'imageLive' : 'pdfLive');
    liveController = new AbortController();
    liveTask = measure(input, kind, liveController.signal, text => {if(version===liveVersion && !busy && !editing)label.textContent=text;});
    try {
      const res = await liveTask;
      if (version !== liveVersion || input !== (kind === 'batch' ? batchFiles : kind === 'image' ? source : file) || category !== kind || editing) return;
      liveCache = { input, key, res };
      if (busy) return;
      if (kind === 'batch') {
        const original = input.reduce((sum, f) => sum + f.size, 0), size = res.reduce((sum, item) => sum + (item.ok ? item.result.blob.size : item.file.size), 0), failed = res.filter(item => !item.ok).length;
        label.textContent = `Live batch total: ${formatBytes(original)} → ${formatBytes(size)} · ${formatPercent(Math.max(0, 1 - size / original))} saved${failed ? ` · ${failed} failed; originals retained` : ''}`; return;
      }
      label.textContent = `Live result: ${formatBytes(input.size)} → ${formatBytes(res.blob.size)} · ${formatPercent(Math.max(0, 1 - res.blob.size / input.size))} saved${res.alreadyOptimized ? ' · original retained' : ''}`;
      if(kind==='pdf'&&pdfTarget.value)label.textContent+=res.metTarget?' · target reached':$('allowFlatten').checked || $('pdfMode').value==='light' ? ' · target not reached; choose a larger target' : ' · target not reached; allow whole-page compression';
      if (kind === 'image') { liveUrl = URL.createObjectURL(res.blob); $('previewImage').src = liveUrl; }
    } catch (error) { if (version === liveVersion) label.textContent = error.message || 'Preview failed.'; }
    finally { liveTask = null; if (version !== liveVersion && !busy && !editing) { clearTimeout(liveTimer); liveTimer = setTimeout(runLive, 300); } }
  }
  async function measuredResult(input) {
    clearTimeout(liveTimer);
    if (liveTask) await liveTask.catch(() => {});
    return liveCache?.input === input && liveCache.key === liveKey() ? liveCache.res : measure(input, category);
  }

  async function job(message, action) {
    if (busy) return;
    busy = true; status(message, "busy");
    const disabled = new Map();
    document.querySelectorAll("button,input,select,textarea").forEach(el => { disabled.set(el, el.disabled); el.disabled = true; });
    try { await action(); if ($("status").classList.contains("busy")) status("Ready. Review your result before downloading.", "success"); }
    catch (error) { status(error.message || "This file could not be processed.", "error"); }
    finally {
      busy = false;
      disabled.forEach((value, el) => { if (el.isConnected) el.disabled = value; });
      $("runPdfMerge").disabled = pdfQueue.length < 2;
      $("copyResult").disabled = !result || !result.blob.type.startsWith("image/");
      $("downloadResult").disabled = !result;
      if (category === "image") ["runImage", "beforeBtn", "afterBtn"].forEach(id => $(id).disabled = editing);
      if (editing) { $("downloadResult").disabled = true; $("copyResult").disabled = true; }
      if (importQueued) { importQueued = false; await consumePending(); }
    }
  }
  function pick(activeTool = tool) { $("fileInput").accept = accepts[activeTool] || accepts.image + ",.pdf,.txt,.csv"; $("fileInput").click(); }
  function navigate(next) {
    if (busy || editing) { status(editing ? "Apply or cancel image edits first." : "Wait for the current operation to finish."); return; }
    tool = next;
    status();
    document.querySelectorAll(".nav-item").forEach(btn => { btn.classList.toggle("active", btn.dataset.tool === next); btn.setAttribute("aria-current", btn.dataset.tool === next ? "page" : "false"); });
    $("breadcrumb").textContent = titles[next];
    ["homeView", "captureView", "recentView", "emptyView", "workView"].forEach(id => $(id).hidden = true);
    if (["home", "capture", "recent"].includes(next)) { $(`${next}View`).hidden = false; if (next === "recent") renderHistory(); return; }
    if (file && (category === next || (category === "batch" && next === "image"))) {
      $("workView").hidden = false;
      ["imageView", "pdfView", "textView", "batchView"].forEach(id => $(id).hidden = true);
      $(`${category === "batch" ? "batch" : next}View`).hidden = false;
    } else {
      $("emptyView").hidden = false; $("emptyTitle").textContent = titles[next]; $("emptyDescription").textContent = descriptions[next]; $("textScratch").hidden = next !== "text";
    }
  }
  function clearResult() {
    result = null; $("resultBar").hidden = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = null;
  }
  async function publish(blob, name, originalSize, note = "") {
    clearResult(); result = { blob, name, originalSize };
    $("resultOriginal").textContent = formatBytes(originalSize); $("resultSize").textContent = formatBytes(blob.size);
    $("resultChangeLabel").textContent = blob.size > originalSize ? "Larger by" : "Saved";
    $("resultSaved").textContent = originalSize ? formatPercent(Math.abs(originalSize - blob.size) / originalSize) : "—";
    $("resultNote").textContent = note; $("resultBar").hidden = false;
    $("copyResult").hidden = !blob.type.startsWith("image/");
    $("copyResult").disabled = false; $("downloadResult").disabled = false;
    if (category === "image") { resultUrl = URL.createObjectURL(blob); showPreview(false); }
    await P.recentHistory.addEntry({ filename: name, format: blob.type, originalSize, outputSize: blob.size, savedPercent: originalSize ? Math.max(0, (1 - blob.size / originalSize) * 100) : 0, status: "Success" });
    if (blob.type.startsWith("image/")) await P.storageBridge.saveLastResult({ blob, name, format: blob.type, optimizedSize: blob.size, reductionPercent: originalSize ? Math.max(0, 1 - blob.size / originalSize) : 0, alreadyOptimized: name === file.name }, file);
  }
  function resetFile() {
    liveVersion++; clearTimeout(liveTimer); liveCache = null; if (liveUrl) URL.revokeObjectURL(liveUrl); liveUrl = null;
    clearResult(); editorProject = null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = null;
    if (originalUrl) URL.revokeObjectURL(originalUrl); originalUrl = null;
    file = source = null; category = null; pdfQueue = []; batchFiles = []; editorProject = null;
    $("previewImage").removeAttribute("src");
    $("pdfPreview").width = $("pdfPreview").height = 1;
    $("textEditor").value = "";
    editing = false; $("previewImage").hidden = false;
  }
  async function openFiles(files) {
    if (!files.length) return;
    if (busy || editing) { status("Finish the current operation or image edits before opening another file.", "error"); return; }
    const allImages = files.every(isSupportedImageFile), allPdfs = files.every(isPdf);
    if (files.length > 1 && !allImages && !allPdfs) { status("Choose images together for a batch, or PDFs together for a merge. Open other files one at a time.", "error"); return; }
    const f = files[0];
    let next = allImages ? "image" : allPdfs ? "pdf" : /\.(txt|csv)$/i.test(f.name) || ["text/plain", "text/csv"].includes(f.type) ? "text" : null;
    if (!next) { status("Supported files: still PNG, JPEG, WebP, BMP, GIF, browser-supported AVIF, PDF, TXT and CSV. HEIC, TIFF, SVG and animated image compression are not available here.", "error"); return; }
    if (next === "text" && f.size > P.textProcessor.MAX_TEXT_BYTES) { status("Text files must be under 5 MB.", "error"); return; }
    resetFile(); file = source = f; category = files.length > 1 && allImages ? "batch" : next;
    $("fileName").textContent = files.length > 1 ? `${files.length} ${allImages ? "images" : "PDFs"}` : f.name;
    $("fileMeta").textContent = `${formatBytes(files.reduce((n, item) => n + item.size, 0))} · ${titles[next]}`;
    $("downloadOriginal").hidden = files.length > 1;
    $("copyOriginal").hidden = category !== "image";
    navigate(next);
    await job("Reading your file…", async () => {
      if (category === "batch") { batchFiles = files; renderBatch(); return; }
      if (next === "image") {
        const metadata = await P.fileAnalyzer.analyzeImage(f);
        sourceUrl = URL.createObjectURL(f); originalUrl = URL.createObjectURL(f); showPreview(true);
        $("fileMeta").textContent += ` · ${metadata.width} × ${metadata.height} px`;
        status("Choose your settings, then apply compression.");
      } else if (next === "pdf") {
        const metadata = await P.pdfProcessor.analyzePdf(f);
        $("pdfPages").textContent = `${metadata.pageCount} page${metadata.pageCount === 1 ? "" : "s"}`;
        $("pdfRangeHint").textContent = `Pages 1–${metadata.pageCount}. Ranges are exported in document order.`;
        $("pdfRange").value = ""; $("allowFlatten").checked = false;
        syncPdfGoal(); pdfQueue = files; renderQueue(); switchPdf(files.length > 1 ? "merge" : "compress");
        await previewPdf(f);
      } else {
        textSource = await P.textProcessor.readText(f); textEdited = false; $("textEditor").value = textSource;
        $("csvJson").hidden = !/\.csv$/i.test(f.name) && f.type !== "text/csv";
        $("textHint").textContent = /\.csv$/i.test(f.name) ? "CSV cleaning preserves quoted fields, including multiline text. JSON conversion checks row lengths." : "Cleaning removes blank lines and trailing spaces. Review the result before saving.";
        updateTextStats();
      }
    });
    scheduleLive();
  }
  function showPreview(original) { $("previewImage").src = original ? originalUrl : resultUrl || liveUrl || sourceUrl; $("beforeBtn").classList.toggle("active", original); $("afterBtn").classList.toggle("active", !original); }
  async function previewPdf(blob) {
    let doc;
    try {
      doc = await P.pdfProcessor.openRenderedPdf(await blob.arrayBuffer());
      const page = await doc.getPage(1); const native = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.5, 900 / Math.max(native.width, native.height)) });
      const canvas = $("pdfPreview"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    } catch (error) { status(`PDF tools are ready, but preview failed: ${error.message}`, "error"); }
    finally { if (doc) await doc.loadingTask.destroy(); }
  }
  function switchPdf(next) { pdfView = next; clearResult(); ["compress", "split", "merge"].forEach(name => { $(`pdf${name[0].toUpperCase()}${name.slice(1)}`).hidden = name !== next; }); document.querySelectorAll("[data-pdf]").forEach(btn => btn.classList.toggle("active", btn.dataset.pdf === next)); }
  function renderQueue() {
    $("pdfQueue").replaceChildren(); clearResult();
    pdfQueue.forEach((f, index) => {
      const row = node("div", "", "queue-item"); row.append(node("span", `${index + 1}. ${f.name} · ${formatBytes(f.size)}`));
      const actions = node("div", "", "queue-controls");
      [["↑", -1, "Move up"], ["↓", 1, "Move down"], ["×", 0, "Remove PDF"]].forEach(([text, offset, label]) => {
        const button = node("button", text); button.setAttribute("aria-label", `${label}: ${f.name}`);
        button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= pdfQueue.length);
        button.onclick = () => { if (busy) return; if (offset) [pdfQueue[index], pdfQueue[index + offset]] = [pdfQueue[index + offset], pdfQueue[index]]; else pdfQueue.splice(index, 1); renderQueue(); };
        actions.append(button);
      }); row.append(actions); $("pdfQueue").append(row);
    }); $("runPdfMerge").disabled = pdfQueue.length < 2;
  }
  function modeHint() {
    const mode = $("pdfMode").value;
    if (mode !== "custom") $("pdfStrength").value = { normal: 35, strong: 65, extreme: 70 }[mode] || 35;
    $("flattenLabel").hidden = mode !== "extreme"; $("allowFlatten").checked = false;
    strengthHint();
  }
  function strengthHint() {
    $('flattenLabel').hidden = $('pdfMode').value!=='extreme' && (!pdfTarget.value || $('pdfMode').value==='light');
    const mode = $("pdfMode").value, strength = Number($("pdfStrength").value);
    $("pdfStrength").disabled = mode === "light" || !!pdfTarget.value;
    $("pdfStrengthValue").textContent = mode === "light" ? "Lossless" : pdfTarget.value ? "Automatic for target" : strength===100?'Maximum':`${strength}/100`;
    if (mode === "light") $("pdfModeHint").textContent = "Rewrites object streams without changing image quality. Efficient PDFs may not shrink.";
    else {
      const profile = P.pdfProcessor.compressionProfile(mode, strength);
      $("pdfModeHint").textContent = mode === "extreme" ? `Whole pages become JPEG images at ${Math.round(profile.quality * 100)}% quality, up to ${profile.dpi} DPI and ${profile.cap} px. Higher strength means smaller files and softer text.` : `Supported RGB / grayscale images: ${Math.round(profile.quality * 100)}% quality, up to ${profile.cap} px. Higher strength means smaller, softer images. Text stays selectable. Other image codecs are preserved; try scan mode for more compression.`;
    }
    if(pdfTarget.value && mode!=='light') $('pdfModeHint').textContent='Automatically adjusts supported image quality and resolution toward your target. Whole-page compression requires the checkbox below. Actual savings depend on the content; check small text in the result.';
    clearResult();
  }
  const editedTextFile = () => new File([textEdited ? $("textEditor").value : textSource], file.name, { type: /\.csv$/i.test(file.name) ? "text/csv" : "text/plain" });
  function updateTextStats() { const text = $("textEditor").value; $("textStats").textContent = `${text ? text.split(/\r\n|\n|\r/).length : 0} lines · ${text.trim() ? text.trim().split(/\s+/).length : 0} words · ${text.length} characters`; }
  function renderBatch(items = []) {
    $("batchList").replaceChildren();
    batchFiles.forEach((f, i) => {
      const row = node("div", "", "batch-item"); row.append(node("span", f.name));
      const item = items[i]; row.append(node("span", item ? (item.ok ? `${formatBytes(f.size)} → ${formatBytes(item.result.blob.size)}` : item.error) : `${formatBytes(f.size)} · Ready`));
      if (item?.ok) { const download = node("button", "Download", "button secondary small"); download.onclick = () => P.downloader.downloadFile(item.result.blob, item.result.file.name); row.append(download); }
      $("batchList").append(row);
    });
  }
  async function renderHistory() {
    const entries = await P.recentHistory.getAll(); $("historyList").replaceChildren();
    if (!entries.length) { $("historyList").append(node("p", "Your next finished file will appear here.", "hint")); return; }
    entries.forEach(item => { const row = node("div", "", "history-item"); const details = node("div", ""); details.append(node("strong", item.filename), node("p", `${formatBytes(item.originalSize)} → ${formatBytes(item.outputSize)}`)); row.append(details, node("time", new Date(item.timestamp).toLocaleString())); $("historyList").append(row); });
  }
  async function startEditor(ocrOnly = false) {
    if (busy || editing) return;
    editing = true;
    try {
      editorSession = await P.annotationEditor.open({
        ocrOnly, blob: result?.blob || source, project: editorProject, name: file.name.replace(/\.[^.]+$/, '') + '-edited.png',
        onApply: async (blob, project) => {
          editorProject = project;
          await job('Applying your edits…', async () => {
            const edited = new File([blob], file.name.replace(/\.[^.]+$/, '') + '-edited.png', { type: 'image/png' });
            source = edited;
            if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = URL.createObjectURL(source);
            await publish(blob, edited.name, file.size, 'Your text and shapes stay editable while this file is open. Choose Edit image to adjust them again.');
          });
        },
        onClose: () => { editing = false; editorSession = null; ['runImage', 'beforeBtn', 'afterBtn'].forEach(id => $(id).disabled = false); $('downloadResult').disabled = !result; $('copyResult').disabled = !result; if (importQueued) setTimeout(consumePending, 0); }
      });
      if(ocrOnly)editorSession.extractText();
    } catch (error) { editing = false; status(error.message, 'error'); }
  }
  document.querySelectorAll("[data-tool]").forEach(btn => btn.onclick = () => navigate(btn.dataset.tool));
  document.querySelector(".brand").onclick = e => { e.preventDefault(); navigate("home"); };
  $("addFile").onclick = () => pick("home"); $("chooseToolFile").onclick = () => pick(); $("importScreenshot").onclick = () => pick("image");
  $("fileInput").onchange = async e => { const files = Array.from(e.target.files); e.target.value = ""; await openFiles(files); };
  $("closeFile").onclick = () => { if (editing) { status("Apply or cancel your edits before closing."); return; } resetFile(); navigate(tool); };
  $("dropZone").onclick = () => pick("home"); $("dropZone").onkeydown = e => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); pick("home"); } };
  document.addEventListener("dragover", e => { e.preventDefault(); $("dropZone").classList.add("dragover"); });
  document.addEventListener("dragleave", e => { if (!e.relatedTarget) $("dropZone").classList.remove("dragover"); });
  document.addEventListener("drop", e => { e.preventDefault(); $("dropZone").classList.remove("dragover"); openFiles(Array.from(e.dataTransfer.files)); });
  document.addEventListener("paste", e => { if (e.target.closest("input,textarea,[contenteditable]")) return; const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); openFiles(files); } });
  $("createText").onclick = () => { const text = $("scratchText").value; if (!text.trim()) { status("Enter some text first.", "error"); return; } openFiles([new File([text], "document.txt", { type: "text/plain" })]); };
  $("imageQuality").oninput = () => { $("imagePreset").value = "custom"; $("qualityValue").textContent = `${$("imageQuality").value}%`; clearResult(); };
  $("imagePreset").onchange = () => { if ($("imagePreset").value !== "custom") $("imageQuality").value = { high: 90, balanced: 75, strong: 25 }[$("imagePreset").value]; $("qualityValue").textContent = `${$("imageQuality").value}%`; clearResult(); };
  $("imageQuality").onchange = async () => {
    try {
      if (globalThis.chrome?.storage?.local) {
        const saved = (await chrome.storage.local.get("preflight:settings"))["preflight:settings"] || {};
        if (saved.rememberQuality !== false) await chrome.storage.local.set({ "preflight:settings": { ...saved, lastQuality: Number($("imageQuality").value) } });
      }
    } catch (_) { status("Could not save your quality preference. Current settings still apply."); }
  };
  $("imageFormat").onchange = () => { const png = $("imageFormat").value === "image/png", target = !!$("imageTarget").value; $("imageQuality").disabled = $("imagePreset").disabled = png || target; $("qualityValue").textContent = target ? "Automatic" : png ? "Lossless" : `${$("imageQuality").value}%`; $("qualityHint").textContent = target ? "Target size automatically adjusts quality and dimensions. Clear the target to use your custom quality." : png ? "PNG is lossless. Quality has no effect; reduce dimensions to make it smaller." : "Lower quality makes a smaller file. JPEG uses a white background for transparency."; };
  $("imageTarget").oninput = () => { $("imageFormat").onchange(); clearResult(); };
  $("beforeBtn").onclick = () => showPreview(true); $("afterBtn").onclick = () => showPreview(false);
  $("runImage").onclick = () => job("Compressing your image…", async () => {
    if (!file || category !== "image") return;
    const target = $("imageTarget").value.trim();
    if (target && (!$("imageTarget").checkValidity() || Number(target) <= 0)) throw new Error("Enter a target between 1 and 46,080 KB.");
    const res = await measuredResult(source);
    const note = `${res.width} × ${res.height} px. ${res.alreadyOptimized ? "Compression did not help; the input image is preserved." : "Review the result for image quality."}${target ? res.metTarget ? " Target size reached." : " Target size could not be reached." : ""}`;
    await publish(res.blob, res.file.name, file.size, note);
  });
  document.querySelectorAll("[data-pdf]").forEach(btn => btn.onclick = () => switchPdf(btn.dataset.pdf));
  $("pdfMode").onchange = modeHint; modeHint();
  $("pdfStrength").oninput = () => { if (["normal", "strong"].includes($("pdfMode").value)) $("pdfMode").value = "custom"; strengthHint(); };
  function syncPdfGoal(){const value=file&&pdfTarget.value?Math.max(0,(1-Number(pdfTarget.value)*1024*1024/file.size)*100):0;pdfGoal.value=Math.min(99,Math.round(value));pdfGoalValue.textContent=pdfTarget.value?`${Math.round(value)}% target`:'No target';}
  pdfTarget.oninput=()=>{if(!pdfTarget.value&&$('pdfMode').value!=='extreme')$('allowFlatten').checked=false;syncPdfGoal();strengthHint();};
  pdfGoal.oninput=()=>{if(!file)return;pdfTarget.value=Number(pdfGoal.value)?(file.size*(1-Number(pdfGoal.value)/100)/1024/1024).toFixed(6):'';pdfTarget.dispatchEvent(new Event('input',{bubbles:true}));};
  $("runPdfCompress").onclick = () => job("Compressing your PDF…", async () => {
    clearResult(); const mode = $("pdfMode").value;
    const res = await measuredResult(file);
    const note = res.alreadyOptimized ? "No smaller result was found. Your original PDF is preserved. Try higher strength or scan mode; some PDFs are already compact." : res.flattened ? `Scan strength ${res.profile.strength}/100: pages are images. Selectable text, links, forms and bookmarks are removed. Check small text in the downloaded PDF.` : `${res.imagesOptimized} embedded images optimized${res.profile ? ` at strength ${res.profile.strength}/100` : ""}. Text and vector graphics preserved. For more savings, increase strength or try scan mode.`;
    await publish(res.blob, res.alreadyOptimized ? file.name : buildOutputFilename(file.name, "application/pdf"), file.size, note+(pdfTarget.value?(res.metTarget?' Target size reached.':' Target size could not be reached.'):''));
    await previewPdf(res.blob);
  });
  $("pdfRange").oninput = clearResult;
  $("runPdfSplit").onclick = () => job("Extracting pages…", async () => { clearResult(); const blob = await P.pdfProcessor.splitPdf(file, $("pdfRange").value); await publish(blob, file.name.replace(/\.pdf$/i, "") + "-extracted.pdf", file.size, "Contains only the selected pages, in document order."); });
  $("addPdf").onclick = () => $("pdfQueueInput").click();
  $("pdfQueueInput").onchange = e => { const files = Array.from(e.target.files); e.target.value = ""; if (files.some(f => !isPdf(f))) { status("Choose PDF files only.", "error"); return; } pdfQueue.push(...files); renderQueue(); };
  $("runPdfMerge").onclick = () => job("Merging PDFs in queue order…", async () => { clearResult(); const blob = await P.pdfProcessor.mergePdfs(pdfQueue); await publish(blob, "merged.pdf", pdfQueue.reduce((n, f) => n + f.size, 0), `${pdfQueue.length} PDFs combined in the order shown.`); });
  $("textEditor").oninput = () => { textEdited = true; clearResult(); updateTextStats(); };
  $("saveText").onclick = () => job("Preparing your text…", () => publish(editedTextFile(), file.name.replace(/\.(txt|csv)$/i, "-edited.$1"), file.size, "Your current editor contents, encoded as UTF-8."));
  $("cleanText").onclick = () => job("Cleaning whitespace…", async () => { const res = await P.textProcessor.cleanText(editedTextFile()); textSource = await P.textProcessor.readText(res.blob); textEdited = false; $("textEditor").value = textSource; updateTextStats(); await publish(res.blob, file.name.replace(/\.(txt|csv)$/i, "-cleaned.$1"), file.size, "Review cleaned text before downloading."); });
  $("textPdf").onclick = () => job("Creating a paginated PDF…", async () => { clearResult(); const blob = await P.pdfProcessor.textToPdf($("textEditor").value, { title: file.name }); await publish(blob, file.name.replace(/\.[^.]+$/, "") + ".pdf", file.size, "A4 pages. This bundled PDF font supports Latin text."); });
  $("csvJson").onclick = () => job("Converting CSV to JSON…", async () => { clearResult(); const blob = await P.textProcessor.csvToJson(editedTextFile()); await publish(blob, file.name.replace(/\.csv$/i, ".json"), file.size, "Quoted and multiline CSV values preserved. Duplicate headers receive unique names."); });
  $("downloadResult").onclick = () => { if (result && !editing) P.downloader.downloadFile(result.blob, result.name); };
  $("downloadOriginal").onclick = () => { if (file) P.downloader.downloadFile(file, file.name); };
  $("copyOriginal").onclick = async () => { if (file) { const copied = await P.clipboard.copyImageToClipboard(file); status(copied.message, copied.ok ? "success" : "error"); } };
  $("copyResult").onclick = async () => { if (result && !editing) { const copied = await P.clipboard.copyImageToClipboard(result.blob); status(copied.message, copied.ok ? "success" : "error"); } };
  $("batchQuality").oninput = () => { $("batchPreset").value = "custom"; $("batchQualityValue").textContent = `${$("batchQuality").value}%`; };
  $("batchPreset").onchange = () => { if ($("batchPreset").value !== "custom") $("batchQuality").value = { high: 90, balanced: 75, strong: 25 }[$("batchPreset").value]; $("batchQualityValue").textContent = `${$("batchQuality").value}%`; };
  $("batchFormat").onchange = () => { const png = $("batchFormat").value === "image/png"; $("batchQuality").disabled = $("batchPreset").disabled = png; $("batchQualityValue").textContent = png ? "Lossless" : `${$("batchQuality").value}%`; };
  $("runBatch").onclick = () => job("Compressing your image batch…", async () => { const items = await measuredResult(batchFiles); renderBatch(items); for (const item of items) if (item.ok) await P.recentHistory.addEntry({ filename: item.result.file.name, format: item.result.format, originalSize: item.file.size, outputSize: item.result.blob.size, savedPercent: item.result.reductionPercent * 100 }); });
  $("clearHistory").onclick = async () => { await P.recentHistory.clearAll(); await renderHistory(); };
  async function capture(area) {
    await job(area ? "Opening the area selector on your web tab…" : "Capturing your visible web page…", async () => {
      if (!globalThis.chrome?.runtime?.id) throw new Error("Capture is available when Preflight is loaded as a browser extension.");
      const response = await chrome.runtime.sendMessage({ type: area ? "TRIGGER_AREA_SNIP" : "CAPTURE_VISIBLE_TAB" });
      if (!response?.ok) throw new Error(response?.error || "Capture failed.");
      if (area) { status("Select an area on the web page, then open it in Preflight."); return; }
      const captureFile = await P.utils.dataUrlToFile(response.dataUrl, `screenshot-${Date.now()}.png`, "image/png");
      await P.storageBridge.savePending(captureFile, captureFile.name, captureFile.type, "capture"); importQueued = true;
    });
  }
  $("captureArea").onclick = () => capture(true); $("captureVisible").onclick = () => capture(false);
  $("editImage").textContent = "Edit image"; $("editImage").onclick = () => startEditor();
  const extractImage = node("button", "Extract text", "button secondary small"); extractImage.id="extractImage"; extractImage.onclick=()=>startEditor(true); $("editImage").after(extractImage);
  function syncImageStrength() { imageStrength.disabled = $('imageQuality').disabled; imageStrength.value = Math.round((95 - Number($('imageQuality').value)) / .85); strengthValue.textContent = imageStrength.disabled ? 'Automatic / lossless' : `${imageStrength.value}/100`; batchStrength.disabled = $('batchQuality').disabled; batchStrength.value = Math.round((95 - Number($('batchQuality').value)) / .85); batchStrengthValue.textContent = batchStrength.disabled ? 'Lossless' : `${batchStrength.value}/100`; }
  imageStrength.oninput = () => { $('imageQuality').value = Math.round(95 - Number(imageStrength.value) * .85); $('imageQuality').oninput(); syncImageStrength(); scheduleLive(); };
  batchStrength.oninput = () => { $('batchQuality').value = Math.round(95 - Number(batchStrength.value) * .85); $('batchQuality').oninput(); syncImageStrength(); scheduleLive(); };
  for (const id of ['imageQuality', 'imagePreset', 'imageFormat', 'imageResize', 'imageTarget', 'pdfMode', 'pdfStrength', 'allowFlatten', 'pdfTarget', 'batchQuality', 'batchPreset', 'batchFormat', 'batchResize']) {
    for (const event of ['input', 'change']) $(id).addEventListener(event, () => { syncImageStrength(); clearResult(); scheduleLive(); });
  }
  syncImageStrength();
  let consuming = false;
  async function consumePending() {
    if (busy || editing) { importQueued = true; return; }
    if (consuming) return; consuming = true;
    try { const pending = await P.storageBridge.getPending(); if (pending) await openFiles([pending]); }
    catch (error) { status(`Could not load the transferred file: ${error.message}`, "error"); }
    finally { consuming = false; }
  }
  if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, respond) => { if (message.type === "WORKSPACE_IMPORT") { consumePending().then(() => respond({ ok: true })); return true; } });
  window.addEventListener("focus", () => { if (importQueued && !editing) consumePending(); });
  window.addEventListener("beforeunload", () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); if (originalUrl) URL.revokeObjectURL(originalUrl); if (resultUrl) URL.revokeObjectURL(resultUrl); editorSession?.close(); });
  (async () => { try { if (globalThis.chrome?.storage?.local) { const saved = (await chrome.storage.local.get("preflight:settings"))["preflight:settings"] || {}; if (saved.preferredFormat) $("imageFormat").value = saved.preferredFormat; if (saved.rememberQuality && saved.lastQuality) { $("imageQuality").value = saved.lastQuality; $("qualityValue").textContent = `${saved.lastQuality}%`; } } } catch (_) {} $("imageFormat").onchange(); navigate("home"); await consumePending(); })();
})();
