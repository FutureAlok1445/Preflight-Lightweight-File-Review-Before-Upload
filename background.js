/**
 * background.js
 * Service worker managing extension lifecycle, tab capture,
 * area screenshot coordination, and tab opening.
 */

import "./core/utils.js";

const DEFAULT_SETTINGS = {
  defaultMode: "smart", // 'smart' | 'manual'
  preferredFormat: "auto", // 'auto' | 'image/webp' | 'image/jpeg' | 'image/png'
  rememberQuality: true,
  lastQuality: 75,
  lastTargetSize: 512,
  lastPreset: "balanced",
  uploadOptimizerEnabled: true
};

const ALLOWED_MESSAGES = new Set([
  "OPEN_OPTIMIZER",
  "SAVE_PENDING",
  "COMPRESS_SCAN_PDF",
  "EXTRACT_IMAGE_TEXT",
  "CAPTURE_VISIBLE_TAB",
  "TRIGGER_AREA_SNIP",
  "ENSURE_PDF_LIB",
  "START_AREA_SCREENSHOT"
]);

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get("preflight:settings");
    const merged = Object.assign({}, DEFAULT_SETTINGS, existing["preflight:settings"] || {});
    await chrome.storage.local.set({ "preflight:settings": merged });
  } catch (err) {
    // Fail-safe initialization
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    const stored = await chrome.storage.session.get("preflight:workspaceWindowId");
    if (stored && stored["preflight:workspaceWindowId"] === windowId) {
      await chrome.storage.session.remove("preflight:workspaceWindowId");
    }
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type || !ALLOWED_MESSAGES.has(message.type)) return false;
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (["COMPRESS_SCAN_PDF", "EXTRACT_IMAGE_TEXT"].includes(message.type)) {
    scanQueue = scanQueue.catch(() => {}).then(async () => {
      try {
        const ocr = message.type === "EXTRACT_IMAGE_TEXT";
        if (!ocr && !message.allowFlatten) throw new Error("Confirm scan mode before compression.");
        const prefix = ocr ? /^data:image\/(png|jpeg|webp);base64,/ : /^data:application\/pdf;base64,/;
        if (typeof message.dataUrl !== "string" || !prefix.test(message.dataUrl) || message.dataUrl.length > 64 * 1024 * 1024) throw new Error("File is too large to transfer. Resize an image or open a larger PDF directly in the workspace.");
        if (ocr && !["eng", "eng+hin"].includes(message.language)) throw new Error("Choose English or English + Hindi for text extraction.");
        const closeProcessor = await openLocalProcessor();
        try {
          const response = await chrome.runtime.sendMessage({ type: ocr ? "RECOGNIZE_IMAGE_TEXT" : "RENDER_SCAN_PDF", dataUrl: message.dataUrl, strength: message.strength, targetBytes: message.targetBytes, language: message.language });
          sendResponse(response);
        } finally { await closeProcessor(); }
      } catch (error) { sendResponse({ ok: false, error: error.message }); }
    });
    return true;
  }
  if (message.type === "SAVE_PENDING") {
    (async () => {
      try {
        if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:") || message.dataUrl.length > 64 * 1024 * 1024) throw new Error("File is too large to transfer. Open it directly in the workspace.");
        const file = await globalThis.Preflight.utils.dataUrlToFile(message.dataUrl, message.name, message.mime);
        await globalThis.Preflight.storageBridge.savePending(file, file.name, file.type, message.source);
        sendResponse({ ok: true });
      } catch (error) { sendResponse({ ok: false, error: error.message }); }
    })();
    return true;
  }

  if (message.type === "OPEN_OPTIMIZER") {
    (async () => {
      try {
        const stored = await chrome.storage.session.get("preflight:workspaceWindowId");
        const existingId = stored ? stored["preflight:workspaceWindowId"] : null;
        if (existingId) {
          try {
            await chrome.windows.get(existingId);
            await chrome.windows.update(existingId, { focused: true });
            try { await chrome.runtime.sendMessage({ type: "WORKSPACE_IMPORT" }); } catch (_) {}
            sendResponse({ ok: true, reused: true });
            return;
          } catch (_) {
            // window is closed/gone — fall through to create
          }
        }
        const win = await chrome.windows.create({
          type: "popup",
          url: chrome.runtime.getURL("optimizer/optimizer.html"),
          width: 960,
          height: 680
        });
        await chrome.storage.session.set({ "preflight:workspaceWindowId": win.id });
        sendResponse({ ok: true, windowId: win.id });
      } catch (err) {
        sendResponse({ ok: false, error: err && err.message ? err.message : "Could not open workspace window." });
      }
    })();
    return true; // async response
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    resolveCaptureTab(sender).then(async tab => {
      await chrome.windows.update(tab.windowId, { focused: true });
      if (chrome.tabs.update) await chrome.tabs.update(tab.id, { active: true });
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    })
      .then((dataUrl) => {
        sendResponse({ ok: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err && err.message ? err.message : "Capture failed" });
      });
    return true; // async response
  }

  if (message.type === "TRIGGER_AREA_SNIP") {
    resolveCaptureTab(sender)
      .then(async (tab) => {
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: "No active tab found" });
          return;
        }
        await chrome.windows.update(tab.windowId, { focused: true });
        if (chrome.tabs.update) await chrome.tabs.update(tab.id, { active: true });
        // Only the top frame owns the viewport capture overlay.
        chrome.tabs.sendMessage(tab.id, { type: "START_AREA_SCREENSHOT" }, { frameId: 0 }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: "Cannot capture area on this page (system/store page)." });
          } else {
            sendResponse({ ok: true });
          }
        });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "ENSURE_PDF_LIB") {
    if (!sender.tab || !sender.tab.id) {
      sendResponse({ ok: false, error: "No sender tab context" });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] },
      files: ["lib/pdf-lib.min.js", "core/pdf-processor.js"]
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : "Failed to load PDF engine." }));
    return true;
  }

  return false;
});

let scanQueue = Promise.resolve();

async function openLocalProcessor() {
  const url = chrome.runtime.getURL('compression/offscreen.html');
  if (chrome.offscreen?.createDocument) {
    await chrome.offscreen.createDocument({url:'compression/offscreen.html',reasons:['WORKERS'],justification:'Process PDFs and extract image text locally using bundled workers.'});
    return async () => { try { await chrome.offscreen.closeDocument(); } catch (_) {} };
  }
  // Firefox's background document can host a local, hidden processing frame.
  if (typeof document !== 'undefined') {
    const frame = document.createElement('iframe'); frame.hidden = true;
    try {
      await new Promise((resolve,reject) => {
        const timeout=setTimeout(()=>reject(new Error('Local processor did not load.')),15000);
        frame.onload=()=>{clearTimeout(timeout);resolve();};
        frame.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not open the local processor.'));};
        frame.src=url; document.body.append(frame);
      });
    } catch (error) { frame.remove(); throw error; }
    return async () => frame.remove();
  }
  // Other Chromium browsers may omit offscreen; use one inactive extension tab.
  const tab=await chrome.tabs.create({url,active:false});
  try {
    await new Promise((resolve,reject) => {
      const cleanup=()=>{clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(onUpdated);};
      const timeout=setTimeout(()=>{cleanup();reject(new Error('Local processor did not load.'));},15000);
      const onUpdated=(id,change)=>{if(id===tab.id && change.status==='complete'){cleanup();resolve();}};
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tab.id).then(current=>{if(current.status==='complete'){cleanup();resolve();}},error=>{cleanup();reject(error);});
    });
  } catch(error) { await chrome.tabs.remove(tab.id);throw error; }
  return async () => { try { await chrome.tabs.remove(tab.id); } catch (_) {} };
}

async function resolveCaptureTab(sender) {
  if (sender.tab && sender.tab.id && /^https?:|^file:/i.test(sender.tab.url || "")) return sender.tab;
  const tabs = await chrome.tabs.query({ active: true });
  const candidates = tabs.filter(tab => /^https?:|^file:/i.test(tab.url || ""));
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  if (!candidates.length) throw new Error("Open a normal web page in your browser, then try capture again.");
  return candidates[0];
}
