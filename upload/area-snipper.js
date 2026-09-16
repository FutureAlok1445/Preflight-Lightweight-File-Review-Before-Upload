/**
 * upload/area-snipper.js
 * Interactive Custom-Size Area Screenshot selection tool.
 * Provides a Lightshot / Windows Snipping Tool-style screen overlay:
 *  - Dimmed backdrop with crosshair cursor
 *  - Interactive click-and-drag bounding box with live pixel dimensions
 *  - Corner handles and floating confirm/cancel toolbar
 *  - Viewport-aware cropping with high-DPI (Retina) scaling
 *  - Direct handoff into the PREflight local workspace
 */
(function (global) {
  "use strict";

  if (global.__preflightAreaSnipperInstalled) return;
  global.__preflightAreaSnipperInstalled = true;

  const Preflight = global.Preflight || (global.Preflight = {});

  const SNIPPER_STYLE = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
      -webkit-user-select: none;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .pf-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
    }
    .pf-selection {
      position: absolute;
      border: 1px dashed #ffffff;
      box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 0, 0, 0.3);
      cursor: move;
      display: none;
    }
    .pf-dims-badge {
      position: absolute;
      top: -26px;
      left: 0;
      background: #111111;
      color: #ffffff;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11.5px;
      font-weight: 700;
      padding: 3px 7px;
      border-radius: 2px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .pf-toolbar {
      position: absolute;
      bottom: -48px;
      right: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      background: #ffffff;
      padding: 5px 8px;
      border: 1px solid #111111;
      border-radius: 3px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.28);
      pointer-events: auto;
      font-family: "Times New Roman", Times, Georgia, serif;
      z-index: 100;
    }
    .pf-toolbar-group {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-right: 6px;
      border-right: 1px solid #dddddd;
    }
    .pf-toolbar-btn {
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid #111111;
      border-radius: 2px;
      padding: 4px 9px;
      cursor: pointer;
      background: #ffffff;
      color: #111111;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 100ms ease;
      white-space: nowrap;
    }
    .pf-toolbar-btn:hover {
      background: #f0f0f0;
    }
    .pf-toolbar-btn.is-active {
      background: #111111;
      color: #ffffff;
    }
    .pf-toolbar-btn-primary {
      background: #111111;
      color: #ffffff;
    }
    .pf-toolbar-btn-primary:hover {
      background: #2e2e2e;
    }
    .pf-toolbar-select {
      font-family: inherit;
      font-size: 11px;
      border: 1px solid #111111;
      border-radius: 2px;
      padding: 3px 4px;
      background: #ffffff;
      color: #111111;
      cursor: pointer;
    }
    .pf-color-picker {
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid #111111;
      border-radius: 2px;
      cursor: pointer;
      background: none;
    }
    .pf-canvas-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      cursor: crosshair;
      z-index: 10;
    }
    .pf-text-box {
      position: absolute;
      background: transparent;
      border: 1px dashed #ffffff;
      outline: none;
      min-width: 80px;
      min-height: 24px;
      color: #ff2222;
      font-weight: bold;
      z-index: 20;
      padding: 2px 4px;
      cursor: text;
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .pf-handle {
      position: absolute;
      width: 10px;
      height: 10px;
      background: #ffffff;
      border: 1px solid #111111;
      border-radius: 2px;
      z-index: 5;
    }
    .pf-handle-tl { top: -5px; left: -5px; cursor: nwse-resize; }
    .pf-handle-tr { top: -5px; right: -5px; cursor: nesw-resize; }
    .pf-handle-bl { bottom: -5px; left: -5px; cursor: nesw-resize; }
    .pf-handle-br { bottom: -5px; right: -5px; cursor: nwse-resize; }
    .pf-instruction {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #111111;
      color: #ffffff;
      padding: 7px 16px;
      border-radius: 3px;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 13px;
      font-style: italic;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 10;
    }
  `;

  let activeSession = null;

  function startAreaSnipper() {
    if (activeSession) activeSession.teardown();

    const host = document.createElement("div");
    host.id = "preflight-snipper-host";
    const shadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = SNIPPER_STYLE;
    shadow.appendChild(styleEl);

    const backdrop = document.createElement("div");
    backdrop.className = "pf-backdrop";

    const instruction = document.createElement("div");
    instruction.className = "pf-instruction";
    instruction.textContent = "Drag to select an area · Add annotations · Click Copy or Save";

    const selectionBox = document.createElement("div");
    selectionBox.className = "pf-selection";

    const annotationCanvas = document.createElement("canvas");
    annotationCanvas.className = "pf-canvas-overlay";
    const annotCtx = annotationCanvas.getContext("2d");

    // Persistent offscreen canvas to preserve drawings when resizing/moving
    const memCanvas = document.createElement("canvas");
    const memCtx = memCanvas.getContext("2d");

    const dimsBadge = document.createElement("div");
    dimsBadge.className = "pf-dims-badge";
    dimsBadge.textContent = "0 \u00D7 0 px";

    const toolbar = document.createElement("div");
    toolbar.className = "pf-toolbar";

    // Group 1: Tools (Pen, Text, Eraser/Clear)
    const toolGroup = document.createElement("div");
    toolGroup.className = "pf-toolbar-group";

    const penBtn = document.createElement("button");
    penBtn.className = "pf-toolbar-btn";
    penBtn.type = "button";
    penBtn.title = "Draw with Freehand Pen";
    penBtn.textContent = "✏️ Pen";

    const textBtn = document.createElement("button");
    textBtn.className = "pf-toolbar-btn";
    textBtn.type = "button";
    textBtn.title = "Click anywhere inside box to add Canva-like Text";
    textBtn.textContent = "🔤 Text";

    const clearBtn = document.createElement("button");
    clearBtn.className = "pf-toolbar-btn";
    clearBtn.type = "button";
    clearBtn.title = "Clear all pen drawings and text";
    clearBtn.textContent = "🧹 Clear";

    toolGroup.append(penBtn, textBtn, clearBtn);

    // Group 2: Font Family, Font Size & Color
    const styleGroup = document.createElement("div");
    styleGroup.className = "pf-toolbar-group";

    const fontSelect = document.createElement("select");
    fontSelect.className = "pf-toolbar-select";
    fontSelect.title = "Text Font Family";
    [
      { label: "Times New Roman", val: "'Times New Roman', Georgia, serif" },
      { label: "Arial / Sans", val: "Arial, Helvetica, sans-serif" },
      { label: "Impact", val: "Impact, Charcoal, sans-serif" },
      { label: "Courier (Mono)", val: "'Courier New', Courier, monospace" },
      { label: "Georgia", val: "Georgia, serif" }
    ].forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.val;
      opt.textContent = f.label;
      fontSelect.appendChild(opt);
    });

    const sizeSelect = document.createElement("select");
    sizeSelect.className = "pf-toolbar-select";
    sizeSelect.title = "Text Font Size";
    [14, 18, 24, 32, 40].forEach((sz) => {
      const opt = document.createElement("option");
      opt.value = sz;
      opt.textContent = `${sz}px`;
      if (sz === 24) opt.selected = true;
      sizeSelect.appendChild(opt);
    });

    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.className = "pf-color-picker";
    colorPicker.value = "#ff2222";
    colorPicker.title = "Pen & Text Color";

    styleGroup.append(fontSelect, sizeSelect, colorPicker);

    // Group 3: Primary Actions (Copy, Save, PREflight, Cancel)
    const actionGroup = document.createElement("div");
    actionGroup.style.display = "flex";
    actionGroup.style.alignItems = "center";
    actionGroup.style.gap = "4px";

    const copyBtn = document.createElement("button");
    copyBtn.className = "pf-toolbar-btn pf-toolbar-btn-primary";
    copyBtn.type = "button";
    copyBtn.title = "Copy screenshot to Clipboard";
    copyBtn.textContent = "📋 Copy";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "pf-toolbar-btn";
    downloadBtn.type = "button";
    downloadBtn.title = "Save screenshot as PNG to your computer";
    downloadBtn.textContent = "💾 Save";

    const preflightBtn = document.createElement("button");
    preflightBtn.className = "pf-toolbar-btn";
    preflightBtn.type = "button";
    preflightBtn.title = "Open in PREflight Workspace for compression/editing";
    preflightBtn.textContent = "✈️ PREflight";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "pf-toolbar-btn";
    cancelBtn.type = "button";
    cancelBtn.title = "Cancel Snipping";
    cancelBtn.textContent = "✕ Cancel";

    actionGroup.append(copyBtn, downloadBtn, preflightBtn, cancelBtn);

    toolbar.append(toolGroup, styleGroup, actionGroup);

    const hTL = document.createElement("div"); hTL.className = "pf-handle pf-handle-tl";
    const hTR = document.createElement("div"); hTR.className = "pf-handle pf-handle-tr";
    const hBL = document.createElement("div"); hBL.className = "pf-handle pf-handle-bl";
    const hBR = document.createElement("div"); hBR.className = "pf-handle pf-handle-br";

    selectionBox.append(annotationCanvas, dimsBadge, toolbar, hTL, hTR, hBL, hBR);
    shadow.append(backdrop, instruction, selectionBox);
    document.documentElement.appendChild(host);

    let mode = "idle"; // "idle" | "drawing" | "moving" | "resizing"
    let resizeHandle = null; // "tl" | "tr" | "bl" | "br"
    let startX = 0;
    let startY = 0;
    let rect = { x: 0, y: 0, w: 0, h: 0 };
    let initialRect = { x: 0, y: 0, w: 0, h: 0 };

    let activeTool = null; // null | "pen" | "text"
    let isPenPainting = false;

    // --- Tool Switching ---
    penBtn.addEventListener("click", () => {
      commitActiveTextBox();
      if (activeTool === "pen") {
        setTool(null);
      } else {
        setTool("pen");
      }
    });

    textBtn.addEventListener("click", () => {
      if (activeTool === "text") {
        setTool(null);
      } else {
        setTool("text");
      }
    });

    clearBtn.addEventListener("click", () => {
      commitActiveTextBox();
      annotCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      memCtx.clearRect(0, 0, memCanvas.width, memCanvas.height);
      const existingBoxes = selectionBox.querySelectorAll(".pf-text-box");
      existingBoxes.forEach((b) => b.remove());
    });

    function setTool(tool) {
      activeTool = tool;
      penBtn.classList.toggle("is-active", tool === "pen");
      textBtn.classList.toggle("is-active", tool === "text");

      if (tool === "pen") {
        annotationCanvas.style.pointerEvents = "auto";
        selectionBox.style.cursor = "crosshair";
      } else if (tool === "text") {
        annotationCanvas.style.pointerEvents = "none";
        selectionBox.style.cursor = "text";
      } else {
        annotationCanvas.style.pointerEvents = "none";
        selectionBox.style.cursor = "move";
      }
    }

    // --- Canva-like Textbox Placement ---
    let currentEditingBox = null;

    function commitActiveTextBox() {
      if (currentEditingBox) {
        const text = currentEditingBox.innerText.trim();
        if (text) {
          const b = currentEditingBox.getBoundingClientRect();
          const parentB = selectionBox.getBoundingClientRect();
          const relX = b.left - parentB.left;
          const relY = b.top - parentB.top;

          annotCtx.font = `bold ${sizeSelect.value}px ${fontSelect.value}`;
          annotCtx.fillStyle = colorPicker.value;
          annotCtx.shadowColor = "rgba(0,0,0,0.8)";
          annotCtx.shadowBlur = 4;
          annotCtx.fillText(text, relX + 4, relY + parseInt(sizeSelect.value, 10));
          annotCtx.shadowBlur = 0;

          // Save to persistent buffer
          syncToMemCanvas();
        }
        currentEditingBox.remove();
        currentEditingBox = null;
      }
    }

    function createTextBox(clickX, clickY) {
      commitActiveTextBox();
      const parentB = selectionBox.getBoundingClientRect();
      const x = Math.max(10, Math.min(rect.w - 120, clickX - parentB.left));
      const y = Math.max(10, Math.min(rect.h - 40, clickY - parentB.top));

      const box = document.createElement("div");
      box.className = "pf-text-box";
      box.contentEditable = "true";
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.color = colorPicker.value;
      box.style.fontFamily = fontSelect.value;
      box.style.fontSize = `${sizeSelect.value}px`;
      box.textContent = "Type here…";

      selectionBox.appendChild(box);
      currentEditingBox = box;

      setTimeout(() => {
        box.focus();
        document.execCommand("selectAll", false, null);
      }, 50);

      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commitActiveTextBox();
          setTool(null);
        }
      });
    }

    // --- Freehand Pen Painting with Persistent Memory ---
    annotationCanvas.addEventListener("mousedown", (e) => {
      if (activeTool !== "pen") return;
      isPenPainting = true;
      const b = annotationCanvas.getBoundingClientRect();
      annotCtx.beginPath();
      annotCtx.moveTo(e.clientX - b.left, e.clientY - b.top);
      annotCtx.strokeStyle = colorPicker.value;
      annotCtx.lineWidth = 3;
      annotCtx.lineCap = "round";
      annotCtx.lineJoin = "round";
    });

    annotationCanvas.addEventListener("mousemove", (e) => {
      if (!isPenPainting || activeTool !== "pen") return;
      const b = annotationCanvas.getBoundingClientRect();
      annotCtx.lineTo(e.clientX - b.left, e.clientY - b.top);
      annotCtx.stroke();
    });

    window.addEventListener("mouseup", () => {
      if (isPenPainting) {
        isPenPainting = false;
        syncToMemCanvas();
      }
    });

    function syncToMemCanvas() {
      if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
        memCanvas.width = annotationCanvas.width;
        memCanvas.height = annotationCanvas.height;
        memCtx.clearRect(0, 0, memCanvas.width, memCanvas.height);
        memCtx.drawImage(annotationCanvas, 0, 0);
      }
    }

    function restoreFromMemCanvas() {
      if (memCanvas.width > 0 && memCanvas.height > 0) {
        annotCtx.drawImage(memCanvas, 0, 0);
      }
    }

    // --- Main Mouse Interaction (Drag, Move, Resize, Click Text) ---
    function onMouseDown(e) {
      const path = e.composedPath ? e.composedPath() : [];
      if (toolbar.contains(e.target) || path.includes(toolbar)) return;
      if (currentEditingBox && (currentEditingBox === e.target || path.includes(currentEditingBox))) return;

      // Handle Text Tool Placement Click
      if (activeTool === "text" && selectionBox.style.display === "block") {
        if (
          e.clientX >= rect.x &&
          e.clientX <= rect.x + rect.w &&
          e.clientY >= rect.y &&
          e.clientY <= rect.y + rect.h
        ) {
          createTextBox(e.clientX, e.clientY);
          return;
        }
      }

      commitActiveTextBox();

      // If Pen tool is active inside selection, let annotationCanvas do its drawing
      if (activeTool === "pen") return;

      // Check if clicking on resize handles
      const isHandle = (h) => e.target === h || path.includes(h);
      if (isHandle(hTL) || isHandle(hTR) || isHandle(hBL) || isHandle(hBR)) {
        mode = "resizing";
        if (isHandle(hTL)) resizeHandle = "tl";
        else if (isHandle(hTR)) resizeHandle = "tr";
        else if (isHandle(hBL)) resizeHandle = "bl";
        else if (isHandle(hBR)) resizeHandle = "br";
        startX = e.clientX;
        startY = e.clientY;
        initialRect = { ...rect };
        toolbar.style.display = "none";
        return;
      }

      // Check if clicking inside the existing selection box to MOVE it
      if (selectionBox.style.display === "block" && rect.w >= 10 && rect.h >= 10) {
        if (
          e.clientX >= rect.x &&
          e.clientX <= rect.x + rect.w &&
          e.clientY >= rect.y &&
          e.clientY <= rect.y + rect.h
        ) {
          mode = "moving";
          startX = e.clientX;
          startY = e.clientY;
          initialRect = { ...rect };
          toolbar.style.display = "none";
          return;
        }
      }

      // Otherwise, draw a fresh selection box
      mode = "drawing";
      startX = e.clientX;
      startY = e.clientY;
      rect = { x: startX, y: startY, w: 0, h: 0 };
      updateBox();
      selectionBox.style.display = "block";
      toolbar.style.display = "none";
    }

    function onMouseMove(e) {
      if (mode === "idle") return;

      if (mode === "drawing") {
        const currentX = e.clientX;
        const currentY = e.clientY;
        rect.x = Math.min(startX, currentX);
        rect.y = Math.min(startY, currentY);
        rect.w = Math.abs(currentX - startX);
        rect.h = Math.abs(currentY - startY);
        updateBox();
      } else if (mode === "moving") {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxX = window.innerWidth - rect.w;
        const maxY = window.innerHeight - rect.h;
        rect.x = Math.max(0, Math.min(maxX, initialRect.x + dx));
        rect.y = Math.max(0, Math.min(maxY, initialRect.y + dy));
        updateBox();
      } else if (mode === "resizing") {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newX = initialRect.x;
        let newY = initialRect.y;
        let newW = initialRect.w;
        let newH = initialRect.h;

        if (resizeHandle === "br") {
          newW = Math.max(10, initialRect.w + dx);
          newH = Math.max(10, initialRect.h + dy);
        } else if (resizeHandle === "bl") {
          const rawW = initialRect.w - dx;
          if (rawW >= 10) {
            newX = initialRect.x + dx;
            newW = rawW;
          }
          newH = Math.max(10, initialRect.h + dy);
        } else if (resizeHandle === "tr") {
          newW = Math.max(10, initialRect.w + dx);
          const rawH = initialRect.h - dy;
          if (rawH >= 10) {
            newY = initialRect.y + dy;
            newH = rawH;
          }
        } else if (resizeHandle === "tl") {
          const rawW = initialRect.w - dx;
          if (rawW >= 10) {
            newX = initialRect.x + dx;
            newW = rawW;
          }
          const rawH = initialRect.h - dy;
          if (rawH >= 10) {
            newY = initialRect.y + dy;
            newH = rawH;
          }
        }

        rect.x = Math.max(0, newX);
        rect.y = Math.max(0, newY);
        rect.w = newW;
        rect.h = newH;
        updateBox();
      }
    }

    function onMouseUp(e) {
      if (mode === "idle") return;
      mode = "idle";
      resizeHandle = null;

      if (rect.w < 10 || rect.h < 10) {
        selectionBox.style.display = "none";
        return;
      }
      toolbar.style.display = "flex";
      // Ensure toolbar doesn't go below viewport
      if (rect.y + rect.h + 55 > window.innerHeight) {
        toolbar.style.bottom = "8px";
        toolbar.style.right = "8px";
      } else {
        toolbar.style.bottom = "-48px";
        toolbar.style.right = "0";
      }
    }

    function updateBox() {
      selectionBox.style.left = `${rect.x}px`;
      selectionBox.style.top = `${rect.y}px`;
      selectionBox.style.width = `${rect.w}px`;
      selectionBox.style.height = `${rect.h}px`;
      dimsBadge.textContent = `${rect.w} \u00D7 ${rect.h} px`;

      if (annotationCanvas.width !== rect.w || annotationCanvas.height !== rect.h) {
        annotationCanvas.width = Math.max(1, rect.w);
        annotationCanvas.height = Math.max(1, rect.h);
        restoreFromMemCanvas();
      }
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        teardown();
      }
    }

    // --- Screen Capture & Flattening ---
    async function generateCroppedBlob() {
      commitActiveTextBox();
      if (rect.w < 10 || rect.h < 10) return null;
      host.style.display = "none";

      try {
        const dpr = window.devicePixelRatio || 1;
        const crop = {
          x: Math.round(rect.x * dpr),
          y: Math.round(rect.y * dpr),
          w: Math.round(rect.w * dpr),
          h: Math.round(rect.h * dpr),
          dpr
        };

        const response = await chrome.runtime.sendMessage({
          type: "CAPTURE_VISIBLE_TAB",
          crop
        });

        if (!response || !response.ok || !response.dataUrl) {
          throw new Error((response && response.error) || "Capture failed");
        }

        const img = new Image();
        img.src = response.dataUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const imgNatW = img.naturalWidth || img.width;
        const imgNatH = img.naturalHeight || img.height;
        const clampedX = Math.max(0, Math.min(crop.x, imgNatW - 1));
        const clampedY = Math.max(0, Math.min(crop.y, imgNatH - 1));
        const clampedW = Math.min(crop.w, imgNatW - clampedX);
        const clampedH = Math.min(crop.h, imgNatH - clampedY);

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, rect.w);
        canvas.height = Math.max(1, rect.h);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, clampedX, clampedY, clampedW, clampedH, 0, 0, rect.w, rect.h);

        // Merge user drawings / annotations
        if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
          ctx.drawImage(annotationCanvas, 0, 0);
        }

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return blob;
      } finally {
        host.style.display = "";
      }
    }

    // --- Action Handlers ---
    copyBtn.addEventListener("click", async () => {
      copyBtn.disabled = true;
      copyBtn.textContent = "Copying…";
      try {
        const blob = await generateCroppedBlob();
        if (!blob) return;
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        copyBtn.textContent = "✓ Copied!";
        setTimeout(() => teardown(), 500);
      } catch (err) {
        alert("Could not copy: " + (err && err.message ? err.message : err));
        copyBtn.disabled = false;
        copyBtn.textContent = "📋 Copy";
      }
    });

    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "Saving…";
      try {
        const blob = await generateCroppedBlob();
        if (!blob) return;
        const filename = `snip-${timestampForFilename()}.png`;
        if (Preflight.downloader && Preflight.downloader.downloadFile) {
          Preflight.downloader.downloadFile(blob, filename);
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          (document.body || document.documentElement).appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
        teardown();
      } catch (err) {
        alert("Failed to download: " + (err && err.message ? err.message : err));
        downloadBtn.disabled = false;
        downloadBtn.textContent = "💾 Save";
      }
    });

    preflightBtn.addEventListener("click", async () => {
      preflightBtn.disabled = true;
      preflightBtn.textContent = "Opening…";
      try {
        const blob = await generateCroppedBlob();
        if (!blob) return;
        const filename = `snip-${timestampForFilename()}.png`;
        await Preflight.storageBridge.savePending(blob, filename, "image/png", "capture");
        await chrome.runtime.sendMessage({ type: "OPEN_OPTIMIZER" });
        teardown();
      } catch (err) {
        console.error("Handoff failed:", err);
        preflightBtn.disabled = false;
        preflightBtn.textContent = "✈️ PREflight";
      }
    });

    function teardown() {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      host.remove();
      activeSession = null;
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);

    cancelBtn.addEventListener("click", teardown);

    activeSession = { teardown };
  }

  function timestampForFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // Listen for trigger from popup
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === "START_AREA_SCREENSHOT") {
        startAreaSnipper();
        sendResponse({ ok: true });
        return false;
      }
    });
  }

  Preflight.areaSnipper = {
    start: startAreaSnipper,
    startAreaSnipper,
    startAreaSelection: startAreaSnipper
  };
})(typeof window !== "undefined" ? window : globalThis);
