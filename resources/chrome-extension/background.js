let socket;
let heartbeat;
let chain = Promise.resolve();
const attached = new Map();
const cancelled = new Set();
const command = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function tabFor(id) {
  if (!Number.isSafeInteger(id)) throw new Error('Choose an existing tab from chrome_tabs.');
  const tab = await chrome.tabs.get(id);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Chrome use is limited to HTTP and HTTPS tabs.');
  return tab;
}
async function attach(tabId, sessionId) {
  if (cancelled.has(tabId)) throw new Error('Chrome control was stopped. Select the tab again with human approval before continuing.');
  const owner = attached.get(tabId);
  if (owner && owner.sessionId !== sessionId) throw new Error('This tab is being controlled by another chat.');
  if (!owner) { await chrome.debugger.attach({ tabId }, '1.3'); attached.set(tabId, { sessionId, updated: Date.now() }); }
  else owner.updated = Date.now();
}
async function evaluate(tabId, func, value) {
  const result = await command(tabId, 'Runtime.evaluate', { expression: `(${func.toString()})(${JSON.stringify(value)})`, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('Could not inspect this tab. The page may have navigated.');
  return result.result?.value;
}
async function pointer(tabId, point) {
  await evaluate(tabId, async point => {
    const id = '__pixelcrew_control__';
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div'); host.id = id;
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      const shadow = host.attachShadow({mode:'open'});
      shadow.innerHTML = '<style>:host{pointer-events:none}.shade{position:fixed;inset:0;background:#00000010;box-shadow:inset 0 0 0 3px #e8bc72,inset 0 0 45px #e8bc7224}.arrow{position:fixed;width:22px;height:24px;filter:drop-shadow(0 0 3px #f4d99f) drop-shadow(0 0 8px #e8bc72);transition:left .16s linear,top .16s linear}.label{position:fixed;top:8px;right:8px;background:#25251fe8;color:#fff1cf;font:12px system-ui;padding:6px 10px;border-radius:5px}</style><div class="shade"></div><div class="label">PixelCrew is controlling this tab</div><svg class="arrow" viewBox="0 0 22 24"><path d="M4 3 Q2 2 3 5 L7 20 Q8 22 9 19 L12 13 L18 10 Q21 9 18 8 Z" fill="#25251f" stroke="#fff1cf" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      document.documentElement.append(host);
    }
    const arrow = host.shadowRoot.querySelector('.arrow');
    arrow.style.left = `${point.x ?? innerWidth / 2}px`; arrow.style.top = `${point.y ?? innerHeight / 2}px`;
    host.style.display = '';
    clearTimeout(host._idle); host._idle = setTimeout(() => host.remove(), 15000);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, point);
}
async function release(tabId) {
  if (!attached.has(tabId)) return;
  try { await evaluate(tabId, () => document.getElementById('__pixelcrew_control__')?.remove()); } catch {}
  attached.delete(tabId); try { await chrome.debugger.detach({tabId}); } catch {}
}
async function snapshot(tabId) {
  const tab = await tabFor(tabId);
  const page = await evaluate(tabId, () => ({title:document.title,url:location.href,text:(document.body?.innerText || '').slice(0,18000),width:innerWidth,height:innerHeight}));
  const screenshot = await command(tabId, 'Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  return { id:tab.id, ...page, image:screenshot.data };
}
function point(args, x = 'x', y = 'y') {
  if (!Number.isFinite(args[x]) || !Number.isFinite(args[y]) || args[x] < 0 || args[y] < 0) throw new Error('Coordinates must be finite viewport pixels.');
  return { x:args[x], y:args[y] };
}
async function execute(action, args) {
  if (action === 'tabs') return (await chrome.tabs.query({})).filter(tab => /^https?:\/\//.test(tab.url || '')).map(tab => ({id:tab.id,title:tab.title,url:tab.url,active:tab.active,windowId:tab.windowId}));
  const tab = await tabFor(args.tabId);
  if (action === 'release') { if (attached.get(tab.id)?.sessionId === args.sessionId) await release(tab.id); return {released:true}; }
  if (action === 'select_tab') cancelled.delete(tab.id);
  await attach(tab.id, args.sessionId);
  if (action === 'select_tab') { await chrome.tabs.update(tab.id,{active:true}); await chrome.windows.update(tab.windowId,{focused:true}); }
  if (action === 'snapshot') return snapshot(tab.id);
  const location = ['click','hover','scroll'].includes(action) ? point(args) : action === 'drag' ? point(args,'fromX','fromY') : {};
  await pointer(tab.id, location);
  if (action === 'click' || action === 'hover') {
    await command(tab.id,'Input.dispatchMouseEvent',{type:'mouseMoved',...location});
    if (action === 'click') {
      await command(tab.id,'Input.dispatchMouseEvent',{type:'mousePressed',...location,button:'left',clickCount:1});
      await command(tab.id,'Input.dispatchMouseEvent',{type:'mouseReleased',...location,button:'left',clickCount:1});
    }
  } else if (action === 'type') {
    if (typeof args.text !== 'string' || args.text.length > 10000) throw new Error('Text exceeds the 10,000 character limit.');
    await command(tab.id,'Input.insertText',{text:args.text});
  } else if (action === 'press_key') {
    const parts=String(args.key).split('+'); let modifiers=0;
    for (const modifier of parts.slice(0,-1)) { const flag={control:2,ctrl:2,control_l:2,shift:8,shift_l:8,alt:1,alt_l:1,meta:4}[modifier.toLowerCase()]; if (!flag) throw new Error('Unsupported key modifier.'); modifiers|=flag; }
    const input=parts.at(-1); const keys={Return:['Enter',13],Enter:['Enter',13],Tab:['Tab',9],Escape:['Escape',27],Backspace:['Backspace',8],Delete:['Delete',46],Up:['ArrowUp',38],Down:['ArrowDown',40],Left:['ArrowLeft',37],Right:['ArrowRight',39],Home:['Home',36],End:['End',35],space:[' ',32]};
    const spec=keys[input] || (input.length === 1 ? [input,input.toUpperCase().charCodeAt(0)] : null);
    if (!spec) throw new Error('Unsupported key. Use a named navigation key or a single character.');
    const params={key:spec[0],windowsVirtualKeyCode:spec[1],modifiers};
    await command(tab.id,'Input.dispatchKeyEvent',{type:'keyDown',...params});
    if (input.length === 1 && !modifiers) await command(tab.id,'Input.insertText',{text:input});
    await command(tab.id,'Input.dispatchKeyEvent',{type:'keyUp',...params});
  } else if (action === 'scroll') {
    if (!Number.isFinite(args.scrollY) || !Number.isFinite(args.scrollX ?? 0)) throw new Error('Scroll deltas must be finite.');
    await command(tab.id,'Input.dispatchMouseEvent',{type:'mouseWheel',...location,deltaX:args.scrollX || 0,deltaY:args.scrollY});
  } else if (action === 'drag') {
    const end=point(args,'toX','toY');
    await command(tab.id,'Input.dispatchMouseEvent',{type:'mousePressed',...location,button:'left',clickCount:1});
    try { for(let step=1;step<=10;step++) { const p={x:location.x+(end.x-location.x)*step/10,y:location.y+(end.y-location.y)*step/10}; await pointer(tab.id,p); await command(tab.id,'Input.dispatchMouseEvent',{type:'mouseMoved',...p,button:'left',buttons:1}); } }
    finally { await command(tab.id,'Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1}); }
  } else if (action !== 'select_tab') throw new Error('Unsupported tab action.');
  return snapshot(tab.id);
}
async function connect() {
  if (socket && socket.readyState <= 1) return;
  const state=await chrome.storage.local.get(['token','clientId']); if (!state.token) return;
  const clientId=state.clientId || crypto.randomUUID(); await chrome.storage.local.set({clientId});
  const ws=socket=new WebSocket('ws://127.0.0.1:4318/api/chrome/connect');
  ws.onopen=()=>{ ws.send(JSON.stringify({type:'hello',token:state.token,clientId})); heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'ping'}));},20000); };
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if (message.type==='connected') { void chrome.storage.local.set({status:'Connected to PixelCrew'}); return; }
    if (!message.id) return;
    chain=chain.then(async()=>{ try {const result=await execute(message.action,message.args || {}); if(ws.readyState===1)ws.send(JSON.stringify({id:message.id,result}));} catch(error){if(ws.readyState===1)ws.send(JSON.stringify({id:message.id,error:error.message}));} });
  };
  ws.onclose=()=>{clearInterval(heartbeat);if(socket===ws)socket=null;void chrome.storage.local.set({status:'Disconnected — check PixelCrew and your connection key'}); for(const id of attached.keys()) void release(id);};
}
chrome.debugger.onDetach.addListener(source=>{attached.delete(source.tabId);cancelled.add(source.tabId);});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{ if(message.type==='disconnect'){socket?.close();respond({ok:true});}else if(message.type==='connect'){void connect().then(()=>respond({ok:true}));return true;} });
chrome.runtime.onStartup.addListener(()=>void connect());
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('reconnect',{periodInMinutes:0.5});void connect();});
chrome.alarms.onAlarm.addListener(()=>void connect());
setInterval(()=>{for(const [id,owner] of attached)if(Date.now()-owner.updated>120000)void release(id);},20000);
void connect();
