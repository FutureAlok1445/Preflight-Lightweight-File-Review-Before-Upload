chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["RENDER_SCAN_PDF", "RECOGNIZE_IMAGE_TEXT"].includes(message?.type) || sender.id !== chrome.runtime.id) return false;
  (async () => {
    try {
      const file = await (await fetch(message.dataUrl)).blob();
      if (message.type === "RECOGNIZE_IMAGE_TEXT") {
        let worker, bitmap;
        try {
          bitmap = await createImageBitmap(file);
          if (bitmap.width * bitmap.height > 32000000) throw new Error("Resize images above 32 megapixels before extracting text.");
          const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          worker = await Tesseract.createWorker(message.language, 1, { workerPath: chrome.runtime.getURL("lib/ocr/worker.min.js"), corePath: chrome.runtime.getURL("lib/ocr"), langPath: chrome.runtime.getURL("lib/ocr/lang"), workerBlobURL: false, gzip: false, cacheMethod: "none", logger: () => { chrome.runtime.sendMessage({ type: "OCR_PROGRESS" }).catch(() => {}); } });
          const { data } = await worker.recognize(canvas);
          sendResponse({ ok: true, text: data.text, confidence: data.confidence });
        } finally { if (bitmap) bitmap.close(); if (worker) await worker.terminate(); }
        return;
      }
      const result = await Preflight.pdfProcessor.compressPdf(file, "extreme", { allowFlatten: true, strength: message.strength, targetBytes: message.targetBytes, onProgress: () => { chrome.runtime.sendMessage({ type: "PDF_SCAN_PROGRESS" }).catch(() => {}); } });
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(result.blob); });
      sendResponse({ ok: true, result: { ...result, blob: undefined, dataUrl } });
    } catch (error) { sendResponse({ ok: false, error: error.message }); }
  })();
  return true;
});
