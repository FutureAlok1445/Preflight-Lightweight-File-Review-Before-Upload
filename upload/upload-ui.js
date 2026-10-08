/**
 * upload/upload-ui.js
 * Renders the 2-step PREflight pre-upload confirmation and optimization interface
 * inside an isolated Shadow DOM.
 *
 * Flow:
 *  Step 1 (Decision):
 *    Shows file name, type, size, and detection notes.
 *    Actions: [ Compress / Optimize ], [ Continue with Original ], [ Cancel ]
 *
 *  Step 2 (Result & Next Action):
 *    Shows Original, Optimized, and % Saved.
 *    Actions: [ Continue Upload ], [ Download ], [ Copy ], [ Back ]
 *    (Never uploads automatically -- user must explicitly confirm)
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const { formatBytes, formatPercent } = Preflight.utils;

  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .pf-card {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      background: #ffffff;
      color: #111111;
      border: 1px solid #d4deed;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 13.5px;
      line-height: 1.45;
      padding: 16px 16px 14px;
      animation: pf-in 120ms ease-out;
      -webkit-font-smoothing: antialiased;
    }
    @keyframes pf-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .pf-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 5px; }
    .pf-title { display:flex; align-items:center; gap:7px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #111111; margin: 0; }
    .pf-title::before { content:""; flex-shrink:0; width:22px; height:22px; background:center / contain no-repeat url("${global.chrome?.runtime?.getURL?.('icons/logo.svg') || '../icons/logo.svg'}"); }
    .pf-close-btn { background: none; border: none; font-family: inherit; font-size: 17px; line-height: 1; cursor: pointer; color: #777777; padding: 0 4px; border-radius: 6px; }
    .pf-close-btn:hover { color: #111111; }
    .pf-close-btn:focus-visible { outline: 2px solid #111111; outline-offset: 1px; }
    .pf-name { font-size: 14px; font-weight: 700; margin: 0 0 4px; word-break: break-all; color: #111111; }
    .pf-meta { font-size: 12px; color: #555555; font-style: italic; margin: 0 0 10px; }
    .pf-prompt-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555555; margin: 10px 0 6px; }
    .pf-target-badge { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 6px; padding: 2px 6px; font-size: 11.5px; margin-bottom: 8px; }
    .pf-sizes-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px; padding: 8px 10px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 10px; text-align: center; }
    .pf-size-col { display: flex; flex-direction: column; }
    .pf-size-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #666666; margin-bottom: 2px; }
    .pf-size-val { font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: #111111; }
    .pf-saved-val { color: #14532d; }
    .pf-status-note { font-size: 12px; color: #555555; font-style: italic; margin: 0 0 10px; line-height: 1.35; }
    .pf-controls { margin: 8px 0 12px; padding: 12px; background: #f5f8ff; border: 1px solid #d4deed; border-radius: 10px; }
    .pf-field { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
    .pf-select { display: block; width: 100%; margin-top: 4px; padding: 6px; border: 1px solid #aabbd5; border-radius: 6px; font: inherit; background: white; color: #111; }
    .pf-range { display: block; width: 100%; margin: 8px 0; accent-color: #275cdb; }
    .pf-hint { margin: 4px 0 0; font-size: 12px; color: #555; }
    .pf-check { display: flex; align-items: start; gap: 6px; font-size: 12px; margin-top: 10px; }
    input:focus-visible, select:focus-visible { outline: 2px solid #275cdb; outline-offset: 2px; }
    .pf-btn { width: 100%; font-family: inherit; font-size: 13px; font-weight: 600; border-radius: 10px; padding: 8px 12px; cursor: pointer; margin-bottom: 6px; border: 1px solid #999999; background: #ffffff; color: #111111; transition: background-color 100ms ease, border-color 100ms ease; text-align: center; }
    .pf-btn:last-child { margin-bottom: 0; }
    .pf-btn:hover { background: #f4f4f4; border-color: #555555; }
    .pf-btn:focus-visible { outline: 2px solid #111111; outline-offset: 1px; }
    .pf-btn:disabled { opacity: 0.45; cursor: not-allowed; pointer-events: none; background: #fafafa; border-color: #dcdcdc; color: #777777; }
    .pf-btn-primary { background: #275cdb; border-color: #275cdb; color: #ffffff; }
    .pf-btn-primary:hover { background: #1b49b8; border-color: #1b49b8; color: #ffffff; }
    .pf-btn-ghost { background: transparent; border-color: transparent; color: #666666; font-size: 12px; padding: 5px 8px; }
    .pf-btn-ghost:hover { background: transparent; color: #111111; text-decoration: underline; }
    .pf-btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
    .pf-btn-row .pf-btn { margin-bottom: 0; }
    .pf-error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 6px 8px; font-size: 12px; margin: 0 0 8px; }
    .pf-busy-wrap { display: flex; align-items: center; gap: 8px; padding: 14px 0; justify-content: center; }
    .pf-spinner { width: 16px; height: 16px; border: 2px solid #c0c0c0; border-top-color: #111111; border-radius: 50%; animation: pf-spin 600ms linear infinite; }
    @keyframes pf-spin { to { transform: rotate(360deg); } }
  `;

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        if (key === "className") node.className = props[key];
        else if (key === "textContent") node.textContent = props[key];
        else if (key === "title") node.title = props[key];
        else if (key === "alt") node.alt = props[key];
        else if (key === "placeholder") node.placeholder = props[key];
        else if (key === "id") node.id = props[key];
        else if (key === "type") node.type = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }

  function createHost() {
    const host = document.createElement("div");
    host.id = "preflight-review-host";
    host.setAttribute("data-preflight-host", "true");
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    return { host, shadow };
  }

  function setupEscapeHandler(cleanup, onCancel) {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        cleanup();
        if (onCancel) onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return handleKeyDown;
  }

  function truncate(str, max) {
    if (!str) return "file";
    return str.length > max ? `${str.slice(0, max - 3)}...` : str;
  }

  /**
   * showReviewCard(options) -> handle
   * options: {
   *   fileName, fileSize, fileType, category, targetLimitBytes,
   *   canCompress, canMerge, largeFileWarning,
   *   onProcess(mode, compressionSettings), onContinueOriginal(), onCancel(),
   *   onContinueUpload(processedFile), onDownload(blob, name), onCopy(blob),
   *   onOpenWorkspace()
   * }
   */
  function showReviewCard(options) {
    const { host, shadow } = createHost();
    const compressionSettings = { quality: 75, imagePreset: "balanced", maxDimension: 0, convert: false, format: options.imageDefaultFormat || "image/webp", pdfMode: "normal", pdfStrength: 35, pdfTargetMB: null, pdfTargetInvalid: false, allowFlatten: false, fitSiteLimit: false };
    let revision = 0, timer, closed = false, cached = null, running = false, decision = false, previewUrl = null, previewController = null, previewPromise = null, previewKey = null;
    const settingsKey = () => JSON.stringify(compressionSettings);
    function invalidate() { previewController?.abort(); revision++; clearTimeout(timer); cached = null; }
    function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
    function schedulePreview() {
      invalidate();
      if (!decision || closed) return;
      const label = card.querySelector('#pf-live-size');
      if (!label) return;
      if(compressionSettings.pdfTargetInvalid){label.textContent='Enter a target between 0.001 and 100 MB.';return;}
      label.textContent = 'Updating actual size…';
      card.querySelector('#pf-live-image')?.setAttribute('hidden', '');
      if (compressionSettings.pdfMode === 'extreme' && !compressionSettings.allowFlatten) {
        label.textContent = 'Confirm scan mode above to preview its size.'; return;
      }
      timer = setTimeout(runPreview, 300);
    }
    async function runPreview() {
      if (running || closed || !decision) return;
      if(compressionSettings.pdfTargetInvalid)return;
      if (compressionSettings.pdfMode === 'extreme' && !compressionSettings.allowFlatten) return;
      running = true;
      const version = revision, key = settingsKey(), settings = { ...compressionSettings };
      previewController = new AbortController(); settings.signal = previewController.signal;
      settings.onProgress = text => {if(version===revision && decision && !closed)card.querySelector('#pf-live-size').textContent=text;};
      try {
        previewKey = key; previewPromise = options.onProcess('compress', settings);
        const result = await previewPromise;
        if (version !== revision || closed || !decision) return;
        cached = { key, result };
        const label = card.querySelector('#pf-live-size');
        if (label) label.textContent = `${formatBytes(result.originalSize)} → ${formatBytes(result.optimizedSize)} · ${formatPercent(result.reductionPercent)} saved${result.alreadyOptimized ? ' · original retained' : ''}${options.targetLimitBytes && result.optimizedSize > options.targetLimitBytes ? ' · above site limit' : ''}${compressionSettings.pdfTargetMB ? result.optimizedSize<=compressionSettings.pdfTargetMB*1024*1024 ? ' · target reached' : compressionSettings.allowFlatten || compressionSettings.pdfMode === 'light' ? ' · target not reached; choose a larger target' : ' · target not reached; allow whole-page compression below' : ''}`;
        const image = card.querySelector('#pf-live-image');
        releasePreview();
        if (image && result.blob?.type.startsWith('image/')) { previewUrl = URL.createObjectURL(result.blob); image.src = previewUrl; image.hidden = false; }
      } catch (error) {
        if (version === revision && decision && !closed) card.querySelector('#pf-live-size').textContent = error.message || 'Preview failed. Try different settings.';
      } finally {
        running = false; previewPromise = null; previewKey = null;
        if (version !== revision && decision && !closed) { clearTimeout(timer); timer = setTimeout(runPreview, 300); }
      }
    }

    function cleanup() {
      closed = true; decision = false; invalidate(); releasePreview();
      window.removeEventListener("keydown", handleKeyDown, true);
      host.remove();
    }

    const handleKeyDown = setupEscapeHandler(cleanup, options.onCancel);

    const card = el("div", {
      className: "pf-card",
      role: "dialog",
      "aria-label": "PREflight file review",
      "aria-modal": "false"
    });
    shadow.appendChild(card);
    document.documentElement.appendChild(host);

    renderStep1();

    function renderStep1() {
      decision = true; releasePreview();
      card.innerHTML = "";
      card.removeAttribute("id");

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Optimize before upload" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", "aria-label": "Close", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const name = el("p", { className: "pf-name", textContent: truncate(options.fileName, 38) });
      const meta = el("p", { className: "pf-meta", textContent: `${options.fileType} \u00B7 ${formatBytes(options.fileSize)}` });

      const children = [header, name, meta];

      if (options.largeFileWarning) {
        const warnEl = el("p", {
          className: "pf-error",
          textContent: options.largeFileWarning
        });
        warnEl.style.background = "#fffbeb";
        warnEl.style.color = "#92400e";
        warnEl.style.borderColor = "#fde68a";
        children.push(warnEl);
      }

      if (options.targetLimitBytes) {
        const targetBadge = el("div", {
          className: "pf-target-badge",
          textContent: `Site limit detected: ${formatBytes(options.targetLimitBytes)}`
        });
        children.push(targetBadge);
      }

      const promptLabel = el("div", { className: "pf-prompt-label", textContent: "What would you like to do?" });
      children.push(promptLabel);

      if (options.canCompress) {
        if (options.category === "image") {
          const controls = el("div", { className: "pf-controls" });
          const format = el("select", { id: "pf-image-format", className: "pf-select" }, [
            el("option", { value: "image/webp", textContent: "WebP · smaller files" }),
            el("option", { value: "image/jpeg", textContent: "JPEG · broad compatibility" }),
            el("option", { value: "image/png", textContent: "PNG · lossless quality" })
          ]);
          format.value = compressionSettings.format;
          const readout = el("output", { id: "pf-quality-value", for: "pf-image-quality" });
          const quality = el("input", { id: "pf-image-quality", className: "pf-range", type: "range", min: "10", max: "95", step: "1", value: compressionSettings.quality, "aria-describedby": "pf-quality-hint" });
          const strengthValue = el('output', { id: 'pf-image-strength-value', for: 'pf-image-strength' });
          const imageStrength = el('input', { id: 'pf-image-strength', className: 'pf-range', type: 'range', min: '0', max: '100', value: '24' });
          imageStrength.addEventListener('input', () => { compressionSettings.quality = Number(quality.value = Math.round(95 - Number(imageStrength.value) * .85)); compressionSettings.imagePreset = preset.value = 'custom'; updateQuality(); });
          const preset = el("select", { id: "pf-image-preset", className: "pf-select" }, [el("option", { value: "high", textContent: "High quality" }), el("option", { value: "balanced", textContent: "Balanced" }), el("option", { value: "strong", textContent: "Strong compression" }), el("option", { value: "custom", textContent: "Custom · choose your own quality" })]);
          preset.value = compressionSettings.imagePreset;
          const resize = el("select", { id: "pf-image-resize", className: "pf-select" }, [el("option", { value: "0", textContent: "Keep original dimensions" }), ...[2400, 1600, 800].map(n => el("option", { value: n, textContent: `${n} px longest edge` }))]);
          resize.value = compressionSettings.maxDimension;
          resize.addEventListener("change", () => { compressionSettings.maxDimension = Number(resize.value); });
          const hint = el("p", { id: "pf-quality-hint", className: "pf-hint" });
          function updateQuality() {
            quality.disabled = compressionSettings.format === "image/png" || compressionSettings.fitSiteLimit;
            preset.disabled = quality.disabled;
            imageStrength.disabled = quality.disabled;
            imageStrength.value = Math.round((95 - compressionSettings.quality) / .85);
            strengthValue.textContent = quality.disabled ? 'Automatic / lossless' : `${imageStrength.value}/100`;
            readout.textContent = compressionSettings.fitSiteLimit ? "Automatic" : compressionSettings.format === "image/png" ? "Lossless" : `${compressionSettings.quality}%`;
            hint.textContent = compressionSettings.fitSiteLimit ? "Automatically adjusts quality and dimensions to try to meet the site limit." : compressionSettings.format === "image/png" ? "PNG ignores the quality slider. It may not become smaller." : "Lower quality gives smaller files. Review the result before continuing.";
          }
          quality.addEventListener("input", () => { compressionSettings.quality = Number(quality.value); compressionSettings.imagePreset = preset.value = "custom"; updateQuality(); });
          preset.addEventListener("change", () => { compressionSettings.imagePreset = preset.value; if (preset.value !== "custom") compressionSettings.quality = Number(quality.value = { high: 90, balanced: 75, strong: 25 }[preset.value]); updateQuality(); });
          format.addEventListener("change", () => { compressionSettings.format = format.value; compressionSettings.convert = true; updateQuality(); });
          controls.append(el("label", { className: "pf-field", for: "pf-image-format", textContent: "Output format" }, [format]), el("label", { className: "pf-field", for: "pf-image-preset", textContent: "Starting preset" }, [preset]), el("label", { className: "pf-field", for: "pf-image-quality", textContent: "Image quality: " }, [readout, quality]), hint, el("label", { className: "pf-field", for: "pf-image-resize", textContent: "Resize (optional)" }, [resize]));
          controls.insertBefore(el('label', { className: 'pf-field', for: 'pf-image-strength', textContent: 'Compression strength (linked to quality): ' }, [strengthValue, imageStrength]), hint);
          if (options.targetLimitBytes) {
            const fit = el("input", { type: "checkbox", id: "pf-fit-limit" });
            fit.checked = compressionSettings.fitSiteLimit;
            fit.addEventListener("change", () => { compressionSettings.fitSiteLimit = fit.checked; updateQuality(); });
            controls.append(el("label", { className: "pf-check", for: "pf-fit-limit" }, [fit, el("span", { textContent: "Automatically fit the detected site limit" })]));
          }
          updateQuality();
          children.push(controls);
        } else if (options.category === "pdf") {
          const mode = el("select", { id: "pf-pdf-mode", className: "pf-select" }, [
            el("option", { value: "light", textContent: "Lossless · preserve image quality" }),
            el("option", { value: "normal", textContent: "Balanced · recommended" }),
            el("option", { value: "strong", textContent: "Strong · smaller, softer images" }),
            el("option", { value: "custom", textContent: "Custom · choose your own strength" }),
            el("option", { value: "extreme", textContent: "Smallest · compress all page content" })
          ]);
          mode.value = compressionSettings.pdfMode;
          const readout = el("output", { id: "pf-pdf-strength-value", for: "pf-pdf-strength" });
          const strength = el("input", { id: "pf-pdf-strength", className: "pf-range", type: "range", min: "1", max: "100", step: "1", value: compressionSettings.pdfStrength, "aria-describedby": "pf-pdf-hint" });
          const hint = el("p", { id: "pf-pdf-hint", className: "pf-hint" });
          const target = el('input',{id:'pf-pdf-target',type:'number',className:'pf-select',min:'0.001',max:'100',step:'any',placeholder:'For example, 2'});
          const desiredValue=el('output',{id:'pf-pdf-reduction-value',for:'pf-pdf-reduction'});
          const desired=el('input',{id:'pf-pdf-reduction',type:'range',className:'pf-range',min:'0',max:'99',step:'1',value:'0'});
          function syncDesired(){const value=compressionSettings.pdfTargetMB?Math.max(0,(1-compressionSettings.pdfTargetMB*1024*1024/options.fileSize)*100):0;desired.value=Math.round(Math.min(99,value));desiredValue.textContent=compressionSettings.pdfTargetMB?`${Math.round(value)}% target`:'No target';}
          target.value = compressionSettings.pdfTargetMB ?? '';
          target.addEventListener('input',()=>{compressionSettings.pdfTargetMB=target.value?Number(target.value):null;compressionSettings.pdfTargetInvalid=!target.checkValidity();if(!target.value&&mode.value!=='extreme'){compressionSettings.allowFlatten=false;consent.checked=false;}syncDesired();updatePdfControls();});
          desired.addEventListener('input',()=>{target.value=Number(desired.value)?(options.fileSize*(1-Number(desired.value)/100)/1024/1024).toFixed(6):'';target.dispatchEvent(new Event('input',{bubbles:true}));});syncDesired();
          const consent = el("input", { id: "pf-allow-flatten", type: "checkbox" });
          consent.checked = compressionSettings.allowFlatten;
          const consentLabel = el("label", { className: "pf-check", for: "pf-allow-flatten" }, [consent, el("span", { textContent: "Allow whole-page image compression. Selectable text, links, forms and bookmarks will be removed." })]);
          function updatePdfControls() {
            strength.disabled = compressionSettings.pdfMode === "light" || !!compressionSettings.pdfTargetMB;
            readout.textContent = compressionSettings.pdfMode==='light' ? "Lossless" : compressionSettings.pdfTargetMB ? "Automatic for target" : compressionSettings.pdfStrength===100?'Maximum':`${compressionSettings.pdfStrength}/100`;
            consentLabel.hidden = compressionSettings.pdfMode !== "extreme" && (!compressionSettings.pdfTargetMB || compressionSettings.pdfMode==='light');
            consentLabel.style.display = consentLabel.hidden ? "none" : "flex";
            hint.textContent = strength.disabled ? "Preserves image quality. Already optimized PDFs may not shrink." : compressionSettings.pdfMode === "extreme" ? "Higher strength uses lower resolution and quality for whole pages. Check small text before uploading." : "Strength controls quality, not the percentage saved. This mode preserves text and optimizes supported embedded images. For more savings on other content, choose Smallest or set a target.";
            if(compressionSettings.pdfTargetMB)hint.textContent='Target size adjusts quality and resolution automatically. For much smaller files, allow whole-page compression below. Review small text; the target is not guaranteed.';
          }
          strength.addEventListener("input", () => { compressionSettings.pdfStrength = Number(strength.value); if (["normal", "strong"].includes(mode.value)) compressionSettings.pdfMode = mode.value = "custom"; updatePdfControls(); });
          consent.addEventListener("change", () => { compressionSettings.allowFlatten = consent.checked; });
          mode.addEventListener("change", () => { compressionSettings.pdfMode = mode.value; if (mode.value !== "custom") compressionSettings.pdfStrength = { normal: 35, strong: 65, extreme: 70 }[mode.value] || 35; strength.value = compressionSettings.pdfStrength; compressionSettings.allowFlatten = false; consent.checked = false; updatePdfControls(); });
          updatePdfControls();
          children.push(el("div", { className: "pf-controls" }, [el("label", { className: "pf-field", for: "pf-pdf-mode", textContent: "PDF compression" }, [mode]),el('label',{className:'pf-field',for:'pf-pdf-reduction',textContent:'Desired size reduction: '},[desiredValue,desired]),el('label',{className:'pf-field',for:'pf-pdf-target',textContent:'Target size (MB, optional)'},[target]),el("label", { className: "pf-field", for: "pf-pdf-strength", textContent: "Quality / compression effort: " }, [readout, strength]), hint, consentLabel]));
        }
        if (['image', 'pdf', 'batch-image'].includes(options.category)) {
          children.push(el('div', { className: 'pf-controls' }, [el('strong', { textContent: 'Live result · measured locally' }), el('p', { id: 'pf-live-size', role: 'status', 'aria-live': 'polite', textContent: 'Updating actual size…' }), el('img', { id: 'pf-live-image', alt: 'Compressed image quality preview', hidden: '', style: 'width:100%;max-height:160px;object-fit:contain' }), el('p', { className: 'pf-hint', textContent: 'Changes update automatically after a short pause. Quality and strength control the same tradeoff. Upload still requires your confirmation.' })]));
        }
        const compressBtn = el("button", {
          id: "actionPrimary",
          className: "pf-btn pf-btn-primary",
          type: "button",
          textContent: options.category === "pdf" ? "Compress PDF" : ["text", "csv"].includes(options.category) ? "Clean whitespace" : "Compress image"
        });
        compressBtn.addEventListener("click", () => startProcessing("compress"));
        children.push(compressBtn);
      }

      if (!options.canCompress && !options.canMerge) {
        children.push(el("p", { className: "pf-status-note", textContent: options.processingError || "Compression is available for supported still images and PDF files. This selection can continue unchanged." }));
      }

      if (options.canMerge) {
        const mergeBtn = el("button", {
          className: "pf-btn pf-btn-primary",
          type: "button",
          textContent: "Merge PDFs & Prepare"
        });
        mergeBtn.addEventListener("click", () => startProcessing("merge"));
        children.push(mergeBtn);
      }

      const originalBtn = el("button", {
        className: "pf-btn",
        type: "button",
        textContent: "Continue with Original"
      });
      originalBtn.addEventListener("click", () => {
        cleanup();
        if (options.onContinueOriginal) options.onContinueOriginal();
      });
      children.push(originalBtn);

      if (options.onOpenWorkspace) {
        const workspaceBtn = el("button", {
          className: "pf-btn pf-btn-ghost",
          type: "button",
          textContent: "Open in Full Workspace\u2026"
        });
        workspaceBtn.addEventListener("click", async () => {
          workspaceBtn.disabled = true;
          try { await options.onOpenWorkspace(); }
          catch (error) { workspaceBtn.disabled = false; card.append(el("p", { className: "pf-error", textContent: error.message, role: "alert" })); }
        });
        children.push(workspaceBtn);
      }

      const cancelBtn = el("button", {
        className: "pf-btn pf-btn-ghost",
        type: "button",
        textContent: "Cancel"
      });
      cancelBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      children.push(cancelBtn);

      children.forEach((c) => card.appendChild(c));
      card.oninput = schedulePreview;
      card.onchange = schedulePreview;
      schedulePreview();
    }

    async function startProcessing(mode) {
      const ready = mode === 'compress' && cached?.key === settingsKey() ? cached.result : null;
      const pending = mode === 'compress' && previewKey === settingsKey() && !previewController?.signal.aborted ? previewPromise : null;
      decision = false;
      if(pending){revision++;clearTimeout(timer);cached=null;}else invalidate();
      releasePreview();
      card.innerHTML = "";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Processing locally" });
      const header = el("div", { className: "pf-header-row" }, [title]);

      const name = el("p", { className: "pf-name", textContent: truncate(options.fileName, 38) });
      const busyWrap = el("div", { className: "pf-busy-wrap" }, [
        el("div", { className: "pf-spinner" }),
        el("span", { textContent: "Optimizing in local memory\u2026" })
      ]);

      card.append(header, name, busyWrap);

      try {
        // Wait for an older preview before starting another PDF/offscreen operation.
        while (running && !closed) await new Promise(resolve => setTimeout(resolve, 50));
        if (closed) return;
        const result = ready || (pending ? await pending : await options.onProcess(mode, { ...compressionSettings }));
        if (!closed) renderStep2(result);
      } catch (err) {
        if (!closed) renderStep2Error(err && err.message ? err.message : "Processing failed.");
      }
    }

    function renderStep2(result) {
      card.innerHTML = "";
      card.id = "resultCard";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Ready to upload" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", "aria-label": "Close", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const name = el("p", { className: "pf-name", textContent: truncate(result.name || options.fileName, 38) });

      // 3-column stats grid
      const colOrig = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Original" }),
        el("span", { className: "pf-size-val", textContent: formatBytes(result.originalSize) })
      ]);
      const colOpt = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Optimized" }),
        el("span", { className: "pf-size-val", textContent: formatBytes(result.optimizedSize) })
      ]);
      const colSaved = el("div", { className: "pf-size-col" }, [
        el("span", { className: "pf-size-label", textContent: "Saved" }),
        el("span", { className: "pf-size-val pf-saved-val", textContent: formatPercent(result.reductionPercent) })
      ]);
      const grid = el("div", { className: "pf-sizes-grid" }, [colOrig, colOpt, colSaved]);

      const noReduction = !!result.alreadyOptimized;
      const noteText = (options.targetLimitBytes && result.optimizedSize > options.targetLimitBytes ? "This result still exceeds the detected site limit. " : "") + (noReduction
        ? "No size reduction was achieved. The original file will be used."
        : (result.alreadyOptimized
          ? "File was already optimally sized. Original quality preserved."
          : "Processing complete. Confirm to supply this file to the website.") );

      const note = el("p", {
        className: "pf-status-note",
        textContent: (result.note ? `${result.note} ` : "") + noteText,
        role: "status",
        "aria-live": "polite"
      });

      // Actions: Explicit choice
      const continueUploadBtn = el("button", {
        className: "pf-btn pf-btn-primary",
        type: "button",
        textContent: noReduction ? "Continue with Original File" : "Continue Upload"
      });
      continueUploadBtn.addEventListener("click", () => {
        cleanup();
        if (noReduction) {
          if (options.onContinueOriginal) options.onContinueOriginal();
        } else {
          if (options.onContinueUpload) options.onContinueUpload(result.file);
        }
      });

      const btnRow = el("div", { className: "pf-btn-row" });

      const downloadBtn = el("button", {
        className: "pf-btn",
        type: "button",
        textContent: "Download"
      });
      downloadBtn.disabled = !result.blob;
      downloadBtn.addEventListener("click", () => {
        if (options.onDownload) options.onDownload(result.blob, result.name || options.fileName);
      });
      btnRow.appendChild(downloadBtn);

      if (options.category === "image" && options.onCopy) {
        const copyBtn = el("button", {
          className: "pf-btn",
          type: "button",
          textContent: "Copy"
        });
        copyBtn.addEventListener("click", async () => {
          copyBtn.textContent = "Copying\u2026";
          const res = await options.onCopy(result.blob);
          copyBtn.textContent = res && res.ok ? "\u2713 Copied" : "Copy Failed";
        });
        btnRow.appendChild(copyBtn);
      }

      const backBtn = el("button", {
        className: "pf-btn pf-btn-ghost",
        type: "button",
        textContent: "\u2190 Back"
      });
      backBtn.addEventListener("click", renderStep1);

      card.append(header, name, grid, note, continueUploadBtn, btnRow, backBtn);
    }

    function renderStep2Error(msg) {
      card.innerHTML = "";

      const title = el("div", { className: "pf-title", textContent: "Preflight \u00B7 Notice" });
      const closeBtn = el("button", { className: "pf-close-btn", type: "button", textContent: "\u00D7" });
      closeBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });
      const header = el("div", { className: "pf-header-row" }, [title, closeBtn]);

      const errorEl = el("div", {
        className: "pf-error",
        textContent: msg,
        role: "alert",
        "aria-live": "assertive"
      });

      const continueOriginalBtn = el("button", {
        className: "pf-btn pf-btn-primary",
        type: "button",
        textContent: "Continue with Original File"
      });
      continueOriginalBtn.addEventListener("click", () => {
        cleanup();
        if (options.onContinueOriginal) options.onContinueOriginal();
      });

      const cancelBtn = el("button", { className: "pf-btn pf-btn-ghost", type: "button", textContent: "Cancel" });
      cancelBtn.addEventListener("click", () => {
        cleanup();
        if (options.onCancel) options.onCancel();
      });

      const backBtn = el("button", { className: "pf-btn pf-btn-ghost", type: "button", textContent: "← Back" });
      backBtn.addEventListener("click", renderStep1);
      card.append(header, errorEl, continueOriginalBtn, backBtn, cancelBtn);
    }

    return {
      close() {
        cleanup();
      }
    };
  }

  Preflight.uploadUI = { showReviewCard, truncate };
})(typeof window !== "undefined" ? window : globalThis);
