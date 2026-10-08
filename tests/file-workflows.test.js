import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import "../core/utils.js";
import "../core/pdf-processor.js";
import "../core/text-processor.js";

const PDFLib = window.PDFLib = new Function("self", readFileSync("lib/pdf-lib.min.js", "utf8") + ";return self.PDFLib;").call(window, window);
const { pdfProcessor: pdf, textProcessor: text } = window.Preflight;
async function bytes(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.onerror = reject; r.readAsArrayBuffer(blob); }); }

describe("Real file workflows", () => {
  it('loads an unsupported-image PDF once for an unreachable target and preserves its pages', async () => {
    const doc=await PDFLib.PDFDocument.create();for(let i=0;i<40;i++)doc.addPage().drawText(`Class notes ${i}`);
    const input=await doc.save(), load=vi.spyOn(PDFLib.PDFDocument,'load');
    try {
      const result=await pdf.compressPdf(input,'custom',{targetBytes:1024});
      expect(load).toHaveBeenCalledTimes(1);expect(result.attempts).toBe(1);
      expect(result.metTarget).toBe(false);expect(result.pageCount).toBe(40);expect(result.flattened).toBe(false);
    } finally {load.mockRestore();}
  });
  it('cancels an obsolete PDF request before doing compression work', async () => {
    const doc=await PDFLib.PDFDocument.create();doc.addPage();const input=await doc.save();
    const controller=new AbortController();controller.abort();
    await expect(pdf.compressPdf(input,'custom',{signal:controller.signal,targetBytes:1024})).rejects.toMatchObject({name:'AbortError'});
  });
  it("maps increasing PDF strength to lower quality and resolution with valid bounds", () => {
    const profiles = [1, 35, 65, 100].map(n => pdf.compressionProfile("normal", n));
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].quality).toBeLessThan(profiles[i - 1].quality);
      expect(profiles[i].cap).toBeLessThan(profiles[i - 1].cap);
      expect(profiles[i].dpi).toBeLessThan(profiles[i - 1].dpi);
    }
    expect(pdf.compressionProfile("strong").strength).toBe(65);
    for (const invalid of [0, 101, NaN, Infinity]) expect(() => pdf.compressionProfile("normal", invalid)).toThrow(/strength/);
  });
  it("compresses a real PDF without enlarging it or losing pages", async () => {
    const doc = await PDFLib.PDFDocument.create();
    for (let n = 0; n < 3; n++) doc.addPage().drawText(`Page ${n + 1}`);
    const input = await doc.save({ useObjectStreams: false });
    const result = await pdf.compressPdf(input, "light");
    expect(result.optimizedSize).toBeLessThanOrEqual(input.length);
    expect((await PDFLib.PDFDocument.load(await bytes(result.blob))).getPageCount()).toBe(3);
  });
  it("extracts requested pages and merges real documents in order", async () => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([100, 200]); doc.addPage([300, 400]); doc.addPage([500, 600]);
    const input = await doc.save();
    const extracted = await pdf.splitPdf(input, "1, 3");
    const check = await PDFLib.PDFDocument.load(await bytes(extracted));
    expect(check.getPages().map(p => p.getWidth())).toEqual([100, 500]);
    const merged = await pdf.mergePdfs([extracted, new Blob([input])]);
    expect((await PDFLib.PDFDocument.load(await bytes(merged))).getPages().map(p => p.getWidth())).toEqual([100, 500, 100, 300, 500]);
  });
  it("respects a typed array's byte offset instead of reading unrelated bytes", async () => {
    const doc = await PDFLib.PDFDocument.create(); doc.addPage();
    const input = await doc.save(); const padded = new Uint8Array(input.length + 24); padded.set(input, 12);
    expect((await pdf.analyzePdf(padded.subarray(12, 12 + input.length))).size).toBe(input.length);
  });
  it("requires explicit consent before flattening a PDF", async () => {
    const doc = await PDFLib.PDFDocument.create(); doc.addPage();
    await expect(pdf.compressPdf(await doc.save(), "extreme")).rejects.toThrow(/Confirm/);
  });
  it('reports an unreachable target honestly without flattening text or dropping pages', async () => {
    const doc=await PDFLib.PDFDocument.create();for(let i=0;i<30;i++)doc.addPage().drawText(`Assignment page ${i+1}`);
    const input=await doc.save();const result=await pdf.compressPdf(input,'custom',{strength:35,targetBytes:1024});
    expect(result.metTarget).toBe(false);expect(result.flattened).toBe(false);expect(result.profile.quality).toBeGreaterThanOrEqual(.45);
    expect((await PDFLib.PDFDocument.load(await bytes(result.blob))).getPageCount()).toBe(30);
    await expect(pdf.compressPdf(input,'custom',{targetBytes:0})).rejects.toThrow(/target/);
  });
  it("wraps long words and reports unsupported PDF text clearly", async () => {
    const blob = await pdf.textToPdf("hello " + "a".repeat(5000));
    expect((await PDFLib.PDFDocument.load(await bytes(blob))).getPageCount()).toBeGreaterThan(1);
    await expect(pdf.textToPdf("हिंदी")).rejects.toThrow(/Latin text/);
  });
  it("preserves quoted multiline CSV data and special column names", async () => {
    const input = new File(['\uFEFF__proto__,note,note,note_2\r\n"safe"," line 1\r\n\r\nline 3 ","a""b",tail\r\n'], "data.csv", { type: "text/csv" });
    const json = JSON.parse(await text.readText(await text.csvToJson(input)));
    expect(Object.keys(json[0])).toEqual(["__proto__", "note", "note_2", "note_2_2"]);
    expect(json[0].__proto__).toBe("safe");
    expect(json[0].note).toBe(" line 1\r\n\r\nline 3 ");
    const cleaned = await text.cleanText(input);
    const roundtrip = JSON.parse(await text.readText(await text.csvToJson(new File([cleaned.blob], "clean.csv", { type: "text/csv" }))));
    expect(roundtrip).toEqual(json);
  });
  it("rejects malformed CSV instead of truncating or dropping values", async () => {
    await expect(text.csvToJson(new File(['a,b\n1,2,3'], "bad.csv"))).rejects.toThrow(/fields/);
    await expect(text.csvToJson(new File(['a,b\n1,"unclosed'], "bad.csv"))).rejects.toThrow(/not closed/);
  });
});
