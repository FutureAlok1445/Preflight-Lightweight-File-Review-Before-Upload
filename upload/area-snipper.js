/* Manual area selection with direct movement and resize handles. */
(() => {
  if (globalThis.__preflightAreaSnipperInstalled) return;
  globalThis.__preflightAreaSnipperInstalled = true;
  const P = globalThis.Preflight || (globalThis.Preflight = {});
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  let session = null;
  function start() {
    session?.close();
    const host = document.createElement('div'); host.id = 'preflight-snipper-host';
    const root = host.attachShadow({mode:'open'});
    root.innerHTML = `<style>:host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;cursor:crosshair!important}*{box-sizing:border-box}.surface{position:absolute;inset:0;touch-action:none}.selection{display:none;position:absolute;border:1px solid #49cca5;box-shadow:0 0 0 9999px #18354d55;cursor:grab;touch-action:none}.badge{position:absolute;top:-25px;left:-1px;background:#18354d;color:white;padding:3px 7px;font:11px Arial;white-space:nowrap;border-radius:4px}.handle{display:none;position:absolute;width:10px;height:10px;background:white;border:1px solid #275cdb;touch-action:none}.help{position:absolute;top:20px;left:50%;transform:translateX(-50%);font:13px 'Segoe UI',Arial;background:white;color:#18354d;border-radius:8px;padding:9px 14px;pointer-events:none}.toolbar{display:none;position:absolute;width:max-content;max-width:calc(100vw - 16px);padding:5px;background:white;border:1px solid #cad7e2;border-radius:9px;box-shadow:0 3px 14px #18354d20;gap:3px;flex-wrap:wrap;font:12px 'Segoe UI',Arial;color:#18354d}.toolbar button{font:inherit;padding:6px 8px;border:1px solid #cad7e2;border-radius:6px;background:white;color:inherit;cursor:pointer}.toolbar button:focus-visible{outline:2px solid #275cdb}</style><div class="surface"></div><div class="selection"><span class="badge"></span></div><div class="help" role="status">Select an area. Escape cancels.</div><nav id="snip-actions" class="toolbar" aria-label="Capture actions"></nav>`;
    document.documentElement.append(host);
    const surface=root.querySelector('.surface'),box=root.querySelector('.selection'),badge=root.querySelector('.badge'),help=root.querySelector('.help'),toolbar=root.querySelector('.toolbar');
    let initial=null,rect=null,working=false,cancelled=false;
    const handles=[];
    for(const edge of ['nw','n','ne','e','se','s','sw','w']) {
      const h=document.createElement('div');h.className='handle';h.dataset.edge=edge;h.style.cursor=edge+'-resize';h.setAttribute('aria-label','Resize selection '+edge);h.onpointerdown=e=>adjust(e,edge);root.append(h);handles.push(h);
    }
    for(const [action,label] of [['text','Text'],['pen','Pen'],['extract','Extract text'],['copy','Copy'],['save','Save'],['studio','Full studio'],['cancel','×']]) {
      const b=document.createElement('button');b.dataset.action=action;b.textContent=label;if(action==='cancel')b.setAttribute('aria-label','Cancel capture');b.onclick=()=>action==='cancel'?close():capture(action);toolbar.append(b);
    }
    const point=e=>({x:clamp(e.clientX,0,innerWidth),y:clamp(e.clientY,0,innerHeight)});
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}};
    function close(){cancelled=true;host.remove();window.removeEventListener('keydown',key,true);if(session?.host===host)session=null;}
    window.addEventListener('keydown',key,true);
    function paint() {
      Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});badge.textContent=`${Math.round(rect.w)} × ${Math.round(rect.h)} px`;
      handles.forEach(h=>{const e=h.dataset.edge,x=e.includes('w')?rect.x:e.includes('e')?rect.x+rect.w:rect.x+rect.w/2,y=e.includes('n')?rect.y:e.includes('s')?rect.y+rect.h:rect.y+rect.h/2;Object.assign(h.style,{display:initial?'none':'block',left:x-5+'px',top:y-5+'px'});});
      const top=rect.y+rect.h+toolbar.offsetHeight+16<=innerHeight?rect.y+rect.h+8:Math.max(8,rect.y-toolbar.offsetHeight-8);
      Object.assign(toolbar.style,{left:clamp(rect.x,8,Math.max(8,innerWidth-toolbar.offsetWidth-8))+'px',top:top+'px'});
    }
    function adjust(e,edge) {
      if(working||!rect)return;e.preventDefault();const target=e.currentTarget,start=point(e),before={...rect};target.setPointerCapture(e.pointerId);
      target.onpointermove=event=>{
        const p=point(event),dx=p.x-start.x,dy=p.y-start.y;
        if(edge==='move')rect={...before,x:clamp(before.x+dx,0,innerWidth-before.w),y:clamp(before.y+dy,0,innerHeight-before.h)};
        else {let x=before.x,y=before.y,right=x+before.w,bottom=y+before.h;if(edge.includes('w'))x=clamp(x+dx,0,right-10);if(edge.includes('e'))right=clamp(right+dx,x+10,innerWidth);if(edge.includes('n'))y=clamp(y+dy,0,bottom-10);if(edge.includes('s'))bottom=clamp(bottom+dy,y+10,innerHeight);rect={x,y,w:right-x,h:bottom-y};}paint();
      };
      const finish=()=>{target.onpointermove=null;target.onpointerup=null;target.onpointercancel=null;};target.onpointerup=finish;target.onpointercancel=finish;
    }
    box.onpointerdown=e=>adjust(e,'move');
    surface.onpointerdown=e=>{if(working)return;rect=null;handles.forEach(h=>h.style.display='none');toolbar.style.display='none';initial=point(e);surface.setPointerCapture(e.pointerId);box.style.display='block';};
    surface.onpointermove=e=>{if(!initial)return;const p=point(e);rect={x:Math.min(initial.x,p.x),y:Math.min(initial.y,p.y),w:Math.abs(p.x-initial.x),h:Math.abs(p.y-initial.y)};paint();};
    surface.onpointercancel=()=>{initial=null;};
    surface.onpointerup=()=>{initial=null;if(!rect||rect.w<10||rect.h<10)return;toolbar.style.display='flex';help.style.display='none';paint();};
    async function capture(action) {
      if(working||!rect||rect.w<10||rect.h<10)return;working=true;host.remove();
      try {
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        let response=await chrome.runtime.sendMessage({type:'CAPTURE_VISIBLE_TAB'});
        if(!response?.ok&&/quota|MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(response?.error||'')){await new Promise(resolve=>setTimeout(resolve,1100));if(cancelled)return;response=await chrome.runtime.sendMessage({type:'CAPTURE_VISIBLE_TAB'});}
        if(!response?.ok)throw new Error(response?.error||'Capture failed.');
        const fullBlob=await(await fetch(response.dataUrl)).blob(),bitmap=await createImageBitmap(fullBlob);
        const captureScale={x:bitmap.width/innerWidth,y:bitmap.height/innerHeight};
        const crop={x:Math.round(rect.x*captureScale.x),y:Math.round(rect.y*captureScale.y),w:Math.round(rect.w*captureScale.x),h:Math.round(rect.h*captureScale.y)};
        let blob;
        try {const canvas=document.createElement('canvas');canvas.width=Math.min(crop.w,bitmap.width-crop.x);canvas.height=Math.min(crop.h,bitmap.height-crop.y);canvas.getContext('2d').drawImage(bitmap,crop.x,crop.y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));}finally{bitmap.close();}
        if(cancelled)return;const name=`snip-${Date.now()}.png`;
        if(action==='save'){P.downloader.downloadFile(blob,name);close();return;}
        if(action==='copy'){await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);close();return;}
        const editor=await P.annotationEditor.open({blob:fullBlob,project:{baseBlob:fullBlob,objects:[],crop},captureScale,ocrOnly:action==='extract',name,inlineRect:action==='studio'?null:rect,initialTool:['text','pen'].includes(action)?action:null,onSession:editor=>{session=editor;},onClose:()=>{session=null;}});
        close();session=editor;if(action==='extract')document.querySelector('#preflight-editor-host').shadowRoot.getElementById('extract').click();
      }catch(error){if(cancelled)return;document.documentElement.append(host);help.style.display='block';help.textContent=error.message;working=false;}
    }
    session={close,host};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message?.type==='START_AREA_SCREENSHOT'){start();respond({ok:true});}return false;});
  P.areaSnipper={start,startAreaSnipper:start,startAreaSelection:start};
})();
