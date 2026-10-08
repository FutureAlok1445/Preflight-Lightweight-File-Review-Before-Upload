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
  const scriptUrl = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : null;

  function getPdfLib() {
    if (typeof PDFLib !== "undefined") return PDFLib;
    if (global.PDFLib) return global.PDFLib;
    if (typeof window !== "undefined" && window.PDFLib) return window.PDFLib;
    if (typeof self !== "undefined" && self.PDFLib) return self.PDFLib;
    throw new Error("PDF processing library is not loaded.");
  }

  async function toArrayBuffer(fileOrBlob) {
    if (fileOrBlob instanceof ArrayBuffer) return fileOrBlob;
    if (ArrayBuffer.isView(fileOrBlob)) return fileOrBlob.buffer.slice(fileOrBlob.byteOffset, fileOrBlob.byteOffset + fileOrBlob.byteLength);
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
    const doc = await loadDocument(buffer);

    return {
      pageCount: doc.getPageCount(),
      title: doc.getTitle() || "",
      author: doc.getAuthor() || "",
      size: buffer.byteLength
    };
  }

  async function loadDocument(buffer) {
    if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("PDFs must be under 100 MB.");
    try {
      return await getPdfLib().PDFDocument.load(buffer, { updateMetadata: false });
    } catch (error) {
      if (/encrypt/i.test(error.message)) throw new Error("Password-protected PDFs are not supported. Unlock a copy first.");
      throw new Error("This PDF could not be read. Open it in a PDF reader and export a valid copy.");
    }
  }

  // Re-encode simple 8-bit RGB/gray JPEG and raw/Flate images. Keep masks,
  // predictors, indexed/CMYK color and custom decode arrays unchanged.
  function compressionProfile(level, strength) {
    const value = strength === undefined ? ({ normal: 35, strong: 65, extreme: 70 }[level] || 35) : Number(strength);
    if (!Number.isFinite(value) || value < 1 || value > 100) throw new Error("Choose PDF compression strength from 1 to 100.");
    const stops = [[0, 95, 4000, 180], [35, 78, 2400, 144], [65, 58, 1600, 108], [100, 25, 800, 72]];
    const upper = stops.findIndex(stop => stop[0] >= value), a = stops[upper - 1], b = stops[upper];
    const t = (value - a[0]) / (b[0] - a[0]);
    return { strength: value, quality: Math.round(a[1] + (b[1] - a[1]) * t) / 100, cap: Math.round(a[2] + (b[2] - a[2]) * t), dpi: Math.round(a[3] + (b[3] - a[3]) * t) };
  }

  function checkCancelled(options) {
    if (options.signal?.aborted) throw new DOMException('Compression cancelled.', 'AbortError');
  }

  async function recompressImages(doc, profile, options, decodedCache) {
    if (typeof createImageBitmap !== "function") return 0;
    const L = getPdfLib();
    const objects = doc.context.enumerateIndirectObjects();
    const masks=new Set();
    for(const [,object] of objects){const dict=object instanceof L.PDFDict?object:object.dict;if(!dict?.get)continue;for(const key of ['SMask','Mask']){const ref=dict.get(L.PDFName.of(key));if(ref instanceof L.PDFRef)masks.add(String(ref));}}
    let count = 0;
    for (let i = 0; i < objects.length; i++) {
      checkCancelled(options);
      const [ref, stream] = objects[i];
      if (!(stream instanceof L.PDFRawStream)) continue;
      if(masks.has(String(ref)))continue;
      const d = stream.dict;
      const filter=String(d.get(L.PDFName.of('Filter'))),color=String(d.get(L.PDFName.of('ColorSpace')));
      if (String(d.get(L.PDFName.of("Subtype"))) !== "/Image" ||
          !['/DCTDecode','/FlateDecode','undefined'].includes(filter) ||
          !['/DeviceRGB','/DeviceGray'].includes(color) ||
          String(d.get(L.PDFName.of("BitsPerComponent"))) !== "8" ||
          ["SMask", "Mask", "Decode", "DecodeParms", "ImageMask"].some(k => d.has(L.PDFName.of(k)))) continue;
      let bitmap;
      try {
        const declaredWidth = Number(String(d.get(L.PDFName.of("Width"))));
        const declaredHeight = Number(String(d.get(L.PDFName.of("Height"))));
        if (declaredWidth * declaredHeight > 32000000) continue;
        bitmap = decodedCache?.get(String(ref));
        if(bitmap) { /* Reuse the original decoded image across target attempts. */ }
        else if(filter==='/DCTDecode')bitmap = await createImageBitmap(new Blob([stream.contents], { type: "image/jpeg" }), { imageOrientation: "none" });
        else {
          const channels=color==='/DeviceGray'?1:3,expected=declaredWidth*declaredHeight*channels;
          const pixels=filter==='/FlateDecode'?L.decodePDFRawStream(stream).getBytes(expected+1):stream.contents;
          if(pixels.length!==expected)continue;
          const decoded=document.createElement('canvas');decoded.width=declaredWidth;decoded.height=declaredHeight;
          const context=decoded.getContext('2d'),data=context.createImageData(declaredWidth,declaredHeight);
          for(let j=0,k=0;j<pixels.length;j+=channels,k+=4){data.data[k]=pixels[j];data.data[k+1]=pixels[j+(channels===1?0:1)];data.data[k+2]=pixels[j+(channels===1?0:2)];data.data[k+3]=255;}
          context.putImageData(data,0,0);bitmap=await createImageBitmap(decoded);decoded.width=decoded.height=1;
        }
        if (bitmap.width * bitmap.height > 32000000) continue;
        if (bitmap.width !== declaredWidth || bitmap.height !== declaredHeight) continue;
        if(decodedCache && !decodedCache.has(String(ref)) && decodedCache.bytes + bitmap.width*bitmap.height*4 <= 32*1024*1024) {
          decodedCache.set(String(ref), bitmap); decodedCache.bytes += bitmap.width*bitmap.height*4;
        }
        checkCancelled(options);
        const scale = Math.min(1, profile.cap / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
        canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
        const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: "image/jpeg", quality: profile.quality }) :
          await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", profile.quality));
        if (!blob || blob.size >= stream.contents.length) continue;
        const dict = d.clone(doc.context);
        dict.set(L.PDFName.of('Filter'),L.PDFName.of('DCTDecode'));
        dict.set(L.PDFName.of('ColorSpace'),L.PDFName.of('DeviceRGB'));
        dict.set(L.PDFName.of("Width"), L.PDFNumber.of(w));
        dict.set(L.PDFName.of("Height"), L.PDFNumber.of(h));
        dict.set(L.PDFName.of("Length"), L.PDFNumber.of(blob.size));
        doc.context.assign(ref, L.PDFRawStream.of(dict, new Uint8Array(await blob.arrayBuffer())));
        count++;
      } catch (error) {
        if(error.name === 'AbortError') throw error;
        // An image that cannot be safely decoded is preserved byte for byte.
      } finally { if (bitmap && decodedCache?.get(String(ref)) !== bitmap) bitmap.close(); }
      options.onProgress?.(`Optimizing PDF images (${count} updated)…`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return count;
  }

  /**
   * Compresses a PDF locally.
   * level: 'extreme' | 'strong' | 'normal' | 'light' (default: 'normal')
   */
  async function compressPdf(fileOrBlob, level = "normal", options = {}) {
    checkCancelled(options);
    const PDFLib = getPdfLib();
    const targetBytes = options.targetBytes == null ? null : Number(options.targetBytes);
    if(targetBytes !== null && (!Number.isFinite(targetBytes)||targetBytes<1024||targetBytes>100*1024*1024))throw new Error('Choose a PDF target between 1 KB and 100 MB.');
    const buffer = await toArrayBuffer(fileOrBlob);
    const originalSize = buffer.byteLength;

    const doc = await loadDocument(buffer);
    if (!["light", "normal", "strong", "custom", "extreme"].includes(level)) throw new Error("Choose a valid PDF compression mode.");
    if (level === "extreme") {
      if (!options.allowFlatten) throw new Error("Scan mode converts pages to images. Confirm the loss of selectable text, links, forms and bookmarks first.");
      return await rasterCompress(buffer, doc, options);
    }
    checkCancelled(options);
    // One document load per request; retries always start from its original streams.
    const originalStreams = doc.context.enumerateIndirectObjects().filter(([, stream]) => stream instanceof PDFLib.PDFRawStream);
    const profiles = level === 'light' ? [null] : targetBytes ? [35,65,85,100].map(strength => {
      const p=compressionProfile('custom',strength);
      return {...p,quality:Math.max(.45,p.quality),cap:Math.max(1200,p.cap)};
    }).filter((p,i,all)=>!all.slice(0,i).some(q=>q.quality===p.quality && q.cap===p.cap)) : [compressionProfile(level,options.strength)];
    const decodedCache = targetBytes ? Object.assign(new Map(), {bytes:0}) : null;
    if (level === 'strong') {
      doc.setProducer(''); doc.setCreator(''); doc.setTitle(''); doc.setAuthor('');
      doc.setSubject(''); doc.setKeywords([]); doc.setModificationDate(new Date());
    } else if (level === 'normal') {
      doc.setProducer(''); doc.setCreator(''); doc.setModificationDate(new Date());
    }
    const originalBlob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([buffer], {type:'application/pdf'});
    let result = null, attempts = 0;
    try {
      for (const profile of profiles) {
        checkCancelled(options);
        if (attempts) for (const [ref,stream] of originalStreams) doc.context.assign(ref,stream);
        const imagesOptimized = profile ? await recompressImages(doc,profile,options,decodedCache) : 0;
        checkCancelled(options);
        const bytes = await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false,objectsPerTick:250});
        attempts++;
        checkCancelled(options);
        const smaller=bytes.byteLength<originalSize;
        const blob=smaller ? new Blob([bytes],{type:'application/pdf'}) : originalBlob;
        const candidate={blob,originalSize,optimizedSize:blob.size,reductionPercent:Math.max(0,1-blob.size/originalSize),alreadyOptimized:!smaller,pageCount:doc.getPageCount(),imagesOptimized:smaller?imagesOptimized:0,flattened:false,profile,level,targetBytes,metTarget:!targetBytes||blob.size<=targetBytes,attempts};
        if(!result || blob.size<result.blob.size) result=candidate;
        // Nothing safely decoded means stronger quality cannot help this document.
        if(result.metTarget || !imagesOptimized) break;
      }
      result.attempts=attempts;
      if(targetBytes && !result.metTarget && level!=='light' && options.allowFlatten) {
        // Release cached bitmaps before rendering pages; cap retained decoded images at 32 MB.
        if(decodedCache){for(const bitmap of decodedCache.values())bitmap.close();decodedCache.clear();}
        const scan=await rasterCompress(buffer,doc,options);
        if(scan.blob.size<result.blob.size)return scan;
      }
      return result;
    } finally { if(decodedCache)for(const bitmap of decodedCache.values())bitmap.close(); }
  }

  async function getRenderer() {
    const renderer = await import("../lib/pdfjs/pdf.mjs");
    renderer.GlobalWorkerOptions.workerSrc = new URL("../lib/pdfjs/pdf.worker.mjs", scriptUrl || new URL("../core/pdf-processor.js", location.href)).href;
    return renderer;
  }

  async function openRenderedPdf(buffer) {
    const renderer = await getRenderer();
    const base = new URL("../lib/pdfjs/", scriptUrl || new URL("../core/pdf-processor.js", location.href));
    return renderer.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false,
      cMapUrl: new URL("cmaps/", base).href, cMapPacked: true,
      standardFontDataUrl: new URL("standard_fonts/", base).href,
      wasmUrl: new URL("wasm/", base).href, useSystemFonts: true }).promise;
  }

  async function rasterCompress(buffer, source, options) {
    const requested=compressionProfile('extreme',options.targetBytes ? 35 : options.strength),targetBytes=options.targetBytes||null;
    // Automatic targets stop at a reading-quality floor instead of destroying small text.
    const readable=p=>targetBytes?{...p,quality:Math.max(.45,p.quality),dpi:Math.max(96,p.dpi),cap:Math.max(1200,p.cap)}:p;
    const initial=readable(requested),profiles=[initial];
    if(targetBytes){
      for(const strength of [65,85,100])if(strength>requested.strength){const p=readable(compressionProfile('extreme',strength));if(!profiles.some(q=>q.quality===p.quality&&q.cap===p.cap&&q.dpi===p.dpi))profiles.push(p);}
    }
    checkCancelled(options);
    const rendered=await openRenderedPdf(buffer);
    let bestBytes=buffer,bestProfile=initial,attempts=0;
    try {
      if(targetBytes && buffer.byteLength<=targetBytes) return {blob:new Blob([buffer],{type:'application/pdf'}),originalSize:buffer.byteLength,optimizedSize:buffer.byteLength,reductionPercent:0,alreadyOptimized:true,pageCount:source.getPageCount(),flattened:false,imagesOptimized:0,level:'extreme',profile:initial,targetBytes,metTarget:true,attempts:0};
      // Render each page once, then resize that surface for the bounded quality candidates.
      const outputs=await Promise.all(profiles.map(()=>getPdfLib().PDFDocument.create()));
      for(let n=1;n<=rendered.numPages;n++) {
        checkCancelled(options);
        options.onProgress?.(`Fitting PDF: page ${n} of ${rendered.numPages}...`);
        const page=await rendered.getPage(n),native=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:Math.min(initial.dpi/72,initial.cap/Math.max(native.width,native.height))});
        const canvas=Object.assign(document.createElement('canvas'),{width:Math.ceil(viewport.width),height:Math.ceil(viewport.height)});
        try {
          await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white',intent:'print'}).promise;
          for(let i=0;i<profiles.length;i++) {
            checkCancelled(options);
            const profile=profiles[i],scale=Math.min(profile.dpi/72,profile.cap/Math.max(native.width,native.height));
            const surface=i===0 ? canvas : Object.assign(document.createElement('canvas'),{width:Math.ceil(native.width*scale),height:Math.ceil(native.height*scale)});
            if(surface!==canvas)surface.getContext('2d').drawImage(canvas,0,0,surface.width,surface.height);
            const blob=await new Promise(resolve=>surface.toBlob(resolve,'image/jpeg',profile.quality));
            if(surface!==canvas)surface.width=surface.height=1;
            if(!blob)throw new Error('Could not encode the scanned page.');
            const image=await outputs[i].embedJpg(await toArrayBuffer(blob));
            outputs[i].addPage([native.width,native.height]).drawImage(image,{x:0,y:0,width:native.width,height:native.height});
          }
        } finally {canvas.width=canvas.height=1;page.cleanup();}
      }
      for(let i=0;i<outputs.length;i++) {
        checkCancelled(options);attempts++;
        const bytes=await outputs[i].save({useObjectStreams:true,objectsPerTick:250});
        if(bytes.byteLength<bestBytes.byteLength){bestBytes=bytes;bestProfile=profiles[i];}
        if(targetBytes&&bestBytes.byteLength<=targetBytes)break;
      }
      const smaller=bestBytes.byteLength<buffer.byteLength,blob=new Blob([bestBytes],{type:'application/pdf'});
      return {blob,originalSize:buffer.byteLength,optimizedSize:blob.size,reductionPercent:Math.max(0,1-blob.size/buffer.byteLength),alreadyOptimized:!smaller,pageCount:source.getPageCount(),flattened:smaller,imagesOptimized:0,level:'extreme',profile:bestProfile,targetBytes,metTarget:!targetBytes||blob.size<=targetBytes,attempts};
    }finally{await rendered.loadingTask.destroy();}
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
      const srcDoc = await loadDocument(buffer);
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
    const srcDoc = await loadDocument(buffer);
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

    const rawLines = String(text || "").replace(/\t/g, "    ").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    try { font.encodeText(rawLines.join("")); } catch (_) {
      throw new Error("Text-to-PDF supports Latin text with this bundled font. For other scripts, print your text to PDF from a document editor.");
    }

    // Word wrap lines to content width without splitting mid-word
    const wrappedLines = [];
    for (const rawLine of rawLines) {
      if (!rawLine.trim()) {
        wrappedLines.push("");
        continue;
      }
      const words = rawLine.split(/\s+/).flatMap(word => {
        const chunks = []; let chunk = "";
        for (const char of word) {
          if (chunk && font.widthOfTextAtSize(chunk + char, fontSize) > contentWidth) { chunks.push(chunk); chunk = ""; }
          chunk += char;
        }
        if (chunk) chunks.push(chunk);
        return chunks;
      });
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
    compressionProfile,
    analyzePdf,
    compressPdf,
    mergePdfs,
    splitPdf,
    textToPdf,
    parsePageRanges
    ,openRenderedPdf
  };
})(typeof window !== "undefined" ? window : globalThis);
