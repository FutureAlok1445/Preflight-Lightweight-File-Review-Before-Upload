import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd(), output = resolve(root, 'output');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(tmpdir(), 'preflight-benchmark-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless:true, channel:'chromium', args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/optimizer/optimizer.html`);
  if(process.argv.includes('--compare'))await page.evaluate(()=>{globalThis.benchmarkCurrent=Preflight.pdfProcessor;});
  if (process.argv.includes('--before')||process.argv.includes('--compare')) await page.addScriptTag({ url:`chrome-extension://${new URL(worker.url()).host}/output/processor-before.js` });
  if(process.argv.includes('--compare'))await page.evaluate(()=>{globalThis.benchmarkBefore=Preflight.pdfProcessor;Preflight.pdfProcessor=globalThis.benchmarkCurrent;});
  const results = [];
  const fixtures=resolve(output,'compression-fixtures');await mkdir(fixtures,{recursive:true});
  for(const name of ['large-png-pages.pdf','masked-page.pdf']) {
    const target=resolve(fixtures,name);
    if(process.argv.includes('--before'))await copyFile(resolve(output,'browser-check',name),target);
    else {try{await readFile(target);}catch{await copyFile(resolve(output,'browser-check',name),target);}}
  }
  for (const [name, targetRatio, flatten] of [['large-png-pages.pdf', .05, false], ['masked-page.pdf', .2, true]]) {
    const data = (await readFile(resolve(fixtures, name))).toString('base64');
    const variants=process.argv.includes('--compare')?['before','after']:['current'];
    for (let run = process.argv.includes('--compare')?-1:0; run < 3; run++) for(const variant of run%2===0?variants:[...variants].reverse()) {
      const result = await page.evaluate(async ({data, targetRatio, flatten, variant}) => {
        const file = await (await fetch('data:application/pdf;base64,' + data)).blob();
        const load = PDFLib.PDFDocument.load, decode = window.createImageBitmap;
        let loads = 0, decodes = 0;
        PDFLib.PDFDocument.load = function (...args) { loads++; return load.apply(this, args); };
        window.createImageBitmap = function (...args) { decodes++; return decode.apply(this, args); };
        const start = performance.now();
        try {
          const engine=variant==='before'?globalThis.benchmarkBefore:variant==='after'?globalThis.benchmarkCurrent:Preflight.pdfProcessor;
          const result = await engine.compressPdf(file, 'custom', {targetBytes:Math.round(file.size*targetRatio), allowFlatten:flatten});
          return { ms:Math.round(performance.now()-start), loads, decodes, original:file.size, bytes:result.blob.size, metTarget:result.metTarget, flattened:result.flattened, profile:result.profile };
        } finally { PDFLib.PDFDocument.load = load; window.createImageBitmap = decode; }
      }, {data, targetRatio, flatten, variant});
      if(run<0)continue;
      results.push({name, run, variant, ...result}); console.log(JSON.stringify(results.at(-1)));
    }
  }
  await writeFile(resolve(output, process.argv.includes('--compare')?'benchmark-comparison.json':process.argv.includes('--before')?'benchmark-before.json':'benchmark-after.json'), JSON.stringify(results, null, 2));
} finally {
  await context?.close();
  const safe = resolve(profile);
  if (safe.startsWith(resolve(tmpdir())+sep) && safe.includes('preflight-benchmark-')) await rm(safe, {recursive:true, force:true});
}
