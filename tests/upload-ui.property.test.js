import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import "../core/utils.js";
import "../upload/upload-ui.js";

const { truncate } = globalThis.Preflight.uploadUI;

describe("Upload compression choices", () => {
  let handle;
  afterEach(() => handle?.close());
  function review(category, extras = {}) {
    const onProcess = vi.fn().mockResolvedValue({ name: "smaller.webp", originalSize: 1000, optimizedSize: 500, reductionPercent: .5, file: { name: "smaller.webp" } });
    const onContinueUpload = vi.fn();
    handle = Preflight.uploadUI.showReviewCard({ fileName: "file", fileSize: 1000, fileType: category, category, canCompress: true, onProcess, onContinueUpload, ...extras });
    return { root: document.querySelector("#preflight-review-host").shadowRoot, onProcess, onContinueUpload };
  }
  it("applies manual quality and format only after processing, preserves choices on Back, and requires upload confirmation", async () => {
    const { root, onProcess, onContinueUpload } = review("image");
    const slider = root.querySelector("input[type=range]");
    slider.value = "45"; slider.dispatchEvent(new Event("input"));
    const format = root.querySelector("select"); format.value = "image/jpeg"; format.dispatchEvent(new Event("change"));
    expect(root.querySelector("output").textContent).toBe("45%");
    root.querySelector("#actionPrimary").click();
    await vi.waitFor(() => expect(root.querySelector("#resultCard")).not.toBeNull());
    expect(onProcess).toHaveBeenCalledWith("compress", expect.objectContaining({ quality: 45, format: "image/jpeg", fitSiteLimit: false }));
    expect(onContinueUpload).not.toHaveBeenCalled();
    [...root.querySelectorAll("button")].find(b => b.textContent === "← Back").click();
    expect(root.querySelector("input[type=range]").value).toBe("45");
    expect(root.querySelector("select").value).toBe("image/jpeg");
    root.querySelector("#actionPrimary").click();
    await vi.waitFor(() => expect(root.querySelector("#resultCard")).not.toBeNull());
    [...root.querySelectorAll("button")].find(b => b.textContent === "Continue Upload").click();
    expect(onContinueUpload).toHaveBeenCalledWith({ name: "smaller.webp" });
  });
  it("disables manual quality for lossless PNG and automatic target mode", () => {
    const { root } = review("image", { targetLimitBytes: 1024 });
    const format = root.querySelector("select"), slider = root.querySelector("input[type=range]");
    format.value = "image/png"; format.dispatchEvent(new Event("change"));
    expect(slider.disabled).toBe(true); expect(root.querySelector("output").textContent).toBe("Lossless");
    format.value = "image/webp"; format.dispatchEvent(new Event("change"));
    expect(slider.disabled).toBe(false);
    root.querySelector("input[type=checkbox]").click();
    expect(slider.disabled).toBe(true); expect(root.querySelector("output").textContent).toBe("Automatic");
    root.querySelector("input[type=checkbox]").click(); expect(slider.disabled).toBe(false);
  });
  it('discards an outdated preview, measures the latest slider choice and reuses it without uploading', async () => {
    let finishFirst;
    const first = new Promise(resolve => { finishFirst = resolve; });
    const makeResult = size => ({ originalSize: 1000, optimizedSize: size, reductionPercent: (1000 - size) / 1000, file: { name: 'preview.webp' } });
    const onProcess = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(makeResult(200));
    const { root, onContinueUpload } = review('image', { onProcess });
    await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(1), { timeout: 1500 });
    const slider = root.querySelector('#pf-image-strength'); slider.value = '100'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('#pf-image-quality').value).toBe('10');
    finishFirst(makeResult(800));
    await vi.waitFor(() => expect(onProcess).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await vi.waitFor(() => expect(root.querySelector('#pf-live-size').textContent).toContain('200 B'));
    expect(root.querySelector('#pf-live-size').textContent).not.toContain('800 B');
    expect(onContinueUpload).not.toHaveBeenCalled();
    root.querySelector('#actionPrimary').click();
    await vi.waitFor(() => expect(root.querySelector('#resultCard')).not.toBeNull());
    expect(onProcess).toHaveBeenCalledTimes(2);
    expect(onContinueUpload).not.toHaveBeenCalled();
  });
  it('waits for explicit scan consent before generating a live PDF preview', async () => {
    const { root, onProcess } = review('pdf');
    const mode = root.querySelector('#pf-pdf-mode'); mode.value = 'extreme'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(onProcess).not.toHaveBeenCalled();
    root.querySelector('#pf-allow-flatten').click();
    await vi.waitFor(() => expect(onProcess).toHaveBeenCalledWith('compress', expect.objectContaining({ allowFlatten: true, pdfMode: 'extreme' })), { timeout: 1500 });
  });
  it('reuses an in-flight current preview when Compress is clicked instead of starting it again', async () => {
    let finish;
    const onProcess=vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const {root,onContinueUpload}=review('pdf',{onProcess});
    await vi.waitFor(()=>expect(onProcess).toHaveBeenCalledTimes(1),{timeout:1500});
    const signal=onProcess.mock.calls[0][1].signal;
    root.querySelector('#actionPrimary').click();
    expect(signal.aborted).toBe(false);
    finish({originalSize:1000,optimizedSize:300,reductionPercent:.7,file:{name:'ready.pdf'}});
    await vi.waitFor(()=>expect(root.querySelector('#resultCard')).not.toBeNull());
    expect(onProcess).toHaveBeenCalledTimes(1);expect(onContinueUpload).not.toHaveBeenCalled();
  });
  it("forwards the selected PDF compression level", async () => {
    const { root, onProcess } = review("pdf");
    const mode = root.querySelector("select"); mode.value = "strong"; mode.dispatchEvent(new Event("change"));
    const strength = root.querySelector("#pf-pdf-strength"); strength.value = "100"; strength.dispatchEvent(new Event("input"));
    root.querySelector("#actionPrimary").click();
    await vi.waitFor(() => expect(onProcess).toHaveBeenCalledWith("compress", expect.objectContaining({ pdfMode: "custom", pdfStrength: 100 })));
  });
  it('turns a desired reduction percentage into an actual byte target without allowing flattening automatically', async () => {
    const {root,onProcess}=review('pdf',{fileSize:10*1024*1024});
    const slider=root.querySelector('#pf-pdf-reduction');slider.value='95';slider.dispatchEvent(new Event('input',{bubbles:true}));
    expect(Number(root.querySelector('#pf-pdf-target').value)).toBe(.5);
    expect(root.querySelector('#pf-pdf-reduction-value').textContent).toBe('95% target');
    expect(root.querySelector('#pf-pdf-strength').disabled).toBe(true);
    expect(root.querySelector('#pf-allow-flatten').checked).toBe(false);
    await vi.waitFor(()=>expect(onProcess).toHaveBeenCalledWith('compress',expect.objectContaining({pdfTargetMB:.5,allowFlatten:false})),{timeout:1500});
  });
  it("keeps scan consent explicit and disables strength for lossless PDFs", () => {
    const { root } = review("pdf");
    const mode = root.querySelector("select"), strength = root.querySelector("#pf-pdf-strength"), consent = root.querySelector("#pf-allow-flatten");
    mode.value = "extreme"; mode.dispatchEvent(new Event("change"));
    expect(consent.checked).toBe(false); expect(consent.parentElement.hidden).toBe(false);
    consent.click();
    mode.value = "light"; mode.dispatchEvent(new Event("change"));
    expect(consent.checked).toBe(false); expect(consent.parentElement.hidden).toBe(true); expect(strength.disabled).toBe(true);
  });
  it("does not offer compression for unsupported files", () => {
    const { root } = review("other", { canCompress: false });
    expect(root.querySelector("#actionPrimary")).toBeNull();
    expect(root.querySelector("input[type=range]")).toBeNull();
    expect(root.textContent).toContain("continue unchanged");
  });
});

describe("Upload UI - Truncation (Property 10)", () => {
  it("never exceeds max length + 3 chars (truncation bound)", () => {
    fc.assert(
      fc.property(fc.unicodeString(), (s) => {
        const result = truncate(s, 38);
        return result.length <= 41;
      }),
      { numRuns: 300 }
    );
  });

  it("preserves short strings identically (identity for <= max)", () => {
    fc.assert(
      fc.property(fc.unicodeString({ maxLength: 38 }), (s) => {
        if (!s) return truncate(s, 38) === "file";
        return truncate(s, 38) === s;
      }),
      { numRuns: 300 }
    );
  });

  it("handles known edge cases", () => {
    expect(truncate("Hello World", 38)).toBe("Hello World");
    const longName = "a".repeat(50);
    const res = truncate(longName, 38);
    expect(res.endsWith("...")).toBe(true);
    expect(res.length).toBeLessThanOrEqual(41);
    expect(truncate("", 38)).toBe("file");
    expect(truncate(null, 38)).toBe("file");
  });
});
