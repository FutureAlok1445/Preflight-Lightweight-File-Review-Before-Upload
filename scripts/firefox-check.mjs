import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),output=resolve(root,'output/firefox-check');
await mkdir(output,{recursive:true});
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));
const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const driver=spawn(process.env.GECKODRIVER_PATH||resolve(root,'output/tools/geckodriver.exe'),['--port',String(port),'--allow-system-access'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';driver.stdout.on('data',b=>log+=b);driver.stderr.on('data',b=>log+=b);
let session,base, fixture;
const report=[];
async function request(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok||data.value?.error)throw new Error(data.value?.message||JSON.stringify(data));return data.value;
}
const command=(path,body,method)=>request(`/session/${session}${path}`,body,method);
const script=(code,args=[])=>command('/execute/sync',{script:code,args});
const asyncScript=(code,args=[])=>command('/execute/async',{script:`const done=arguments[arguments.length-1];(async()=>{${code}})().then(done,error=>done({error:error.message,stack:error.stack}));`,args}).then(result=>{if(result?.error)throw Error(result.error);return result;});
const check=text=>{report.push(text);console.log(text);};
try {
  for(let i=0;i<100;i++){try{await request('/status');break;}catch(error){if(i===99)throw error;await new Promise(r=>setTimeout(r,100));}}
  const value=await request('/session',{capabilities:{alwaysMatch:{browserName:'firefox','moz:firefoxOptions':{binary:process.env.FIREFOX_PATH||'C:/Program Files/Mozilla Firefox/firefox.exe',args:['-headless']}}}});
  session=value.sessionId;await command('/timeouts',{script:120000,pageLoad:60000,implicit:0});
  const version=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8')).version;
  await command('/moz/addon/install',{path:resolve(root,`dist/preflight-firefox-${version}.zip`),temporary:true});
  await command('/moz/context',{context:'chrome'});
  base=await script(`return ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.GlobalManager.getExtension('preflight@futurealok1445').baseURI.spec;`);
  await command('/moz/context',{context:'content'});
  await command('/url',{url:base+'popup/popup.html'});
  assert.equal(await script("return document.querySelector('.brand-mark').naturalWidth>0"),true);
  const opened=await asyncScript("return await chrome.runtime.sendMessage({type:'OPEN_OPTIMIZER'});");assert.equal(opened.ok,true);
  check(`Firefox ${value.capabilities.browserVersion}: extension installs, popup logo loads and background opens workspace.`);
  await command('/url',{url:base+'optimizer/optimizer.html'});
  const image=await asyncScript("const canvas=Object.assign(document.createElement('canvas'),{width:800,height:500});canvas.getContext('2d').fillRect(0,0,800,500);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const file=new File([blob],'notes.png',{type:'image/png'});const result=await Preflight.imageOptimizer.optimizeImage(file,{format:'image/jpeg',quality:45,convert:true});const copied=await Preflight.clipboard.copyImageToClipboard(result.blob);return {format:result.blob.type,width:result.width,height:result.height,copied:copied.ok};");
  assert.equal(image.format,'image/jpeg');assert.equal(image.width,800);assert.equal(image.copied,true);
  check('Image conversion, custom quality and actual image clipboard writing work.');
  const pdf=await asyncScript("const doc=await PDFLib.PDFDocument.create();doc.addPage().drawText('Class assignment notes');const bytes=await doc.save({useObjectStreams:false});const result=await Preflight.pdfProcessor.compressPdf(bytes,'custom',{targetBytes:1024});const saved=await PDFLib.PDFDocument.load(await result.blob.arrayBuffer());return {pages:saved.getPageCount(),flattened:result.flattened,attempts:result.attempts};");
  assert.equal(pdf.pages,1);assert.equal(pdf.flattened,false);assert.equal(pdf.attempts,1);
  check('Target PDF compression retains pages and avoids repeated document loads.');
  const scan=await asyncScript("const doc=await PDFLib.PDFDocument.create();for(let i=0;i<3;i++)doc.addPage().drawText('Printable notes '+i);const bytes=await doc.save({useObjectStreams:false});const dataUrl=await Preflight.utils.fileToDataUrl(new Blob([bytes],{type:'application/pdf'}));return await chrome.runtime.sendMessage({type:'COMPRESS_SCAN_PDF',dataUrl,strength:65,allowFlatten:true});");
  assert.equal(scan.ok,true);assert.equal(scan.result.pageCount,3);
  check('PDF page rendering runs through Firefox background processing without Chrome offscreen API.');
  const ocr=await asyncScript("const canvas=Object.assign(document.createElement('canvas'),{width:900,height:220});const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,220);ctx.fillStyle='black';ctx.font='48px Arial';ctx.fillText('Student assignment notes',30,100);return await chrome.runtime.sendMessage({type:'EXTRACT_IMAGE_TEXT',dataUrl:canvas.toDataURL('image/png'),language:'eng'});");
  assert.equal(ocr.ok,true);assert.match(ocr.text,/assignment/i);
  check('Local English OCR reads assignment text with bundled WASM and models.');
  fixture=httpServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!path.startsWith(root+sep))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'text/html');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));await command('/url',{url:`http://127.0.0.1:${fixture.address().port}/scripts/upload-fixture.html`});
  // Firefox asks for MV3 site access separately; temporary installs are granted here for testing.
  await command('/moz/context',{context:'chrome'});
  await script(`const {ExtensionPermissions}=ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');return ExtensionPermissions.add('preflight@futurealok1445',{permissions:[],origins:['<all_urls>']});`);
  await command('/moz/context',{context:'content'});await command('/refresh',{});
  await asyncScript("for(let i=0;i<100&&!document.querySelector('#upload');i++)await new Promise(r=>setTimeout(r,50));return true;");
  const upload=await command('/element',{using:'css selector',value:'#upload'});
  await command(`/element/${upload['element-6066-11e4-a52e-4f735466cecf']}/value`,{text:resolve(root,'output/browser-check/fixture.png')});
  const review=await asyncScript("for(let i=0;i<100;i++){const host=document.querySelector('#preflight-review-host');if(host){return {held:document.querySelector('#upload').files.length,title:host.shadowRoot.querySelector('.pf-title').textContent};}await new Promise(r=>setTimeout(r,100));}throw Error('Upload review not shown');");
  assert.equal(review.held,0);assert.match(review.title,/Preflight/i);
  check('Website upload review intercepts selection and holds the file for confirmation.');
  const favicon=await command('/screenshot');await writeFile(resolve(output,'upload.png'),Buffer.from(favicon,'base64'));
  await writeFile(resolve(output,'report.json'),JSON.stringify({browser:value.capabilities.browserVersion,checks:report},null,2));
} finally {
  if(session)await command('',undefined,'DELETE').catch(()=>{});driver.kill();fixture?.close();
  await writeFile(resolve(output,'driver.log'),log);
}
