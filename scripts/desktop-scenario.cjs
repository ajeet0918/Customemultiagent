const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,win,store,snapshot}) => {
  const js = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { console.error('Failed desktop test expression:', code); throw error; } };
  const wait = async condition => { for(let i=0;i<300;i++){if(await js(condition))return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error(`UI timeout: ${condition}`); };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => js(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
  const change = (selector, value) => js(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));`);
  const submit = selector => js(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
  const screenshot = async name => { await js('document.querySelector("#toast").hidden=true'); await new Promise(r=>setTimeout(r,200));fs.mkdirSync(path.resolve(__dirname,'../docs'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../docs',name),(await win.webContents.capturePage()).toPNG()); };
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('Renderer error:',event.message);}});
  await wait('!!document.querySelector("#agent-select").options.length');
  assert.equal(await js('typeof require'),'undefined');assert.equal(await js('typeof process'),'undefined');
  if(process.env.AGENT_STUDIO_TEST_PHASE==='persistence') {
    const data=await js('window.studio.invoke("state")');
    assert.ok(data.agents.some(a=>a.name==='Test Specialist'));
    assert.ok(data.conversations.some(c=>c.projectId===null && c.messages.some(m=>m.content?.includes('Standalone chat works'))));
    assert.ok(data.conversations.some(c=>c.messages.some(m=>m.content?.includes('Your local agent is working'))));
    assert.equal(fs.readFileSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt'),'utf8'),'Hello from Agent Studio!\n');
    assert.equal(data.settings.theme,'dark');assert.equal(data.settings.chatFontSize,18);assert.equal(data.settings.sendShortcut,'mod-enter');
    assert.equal(data.mcpServers[0].status,'disconnected');
    assert.ok(!JSON.stringify(data).includes('desktop-secret-fixture'));
    assert.equal(await js('document.documentElement.dataset.theme'),'dark');
    console.log('Desktop persistence verified, including settings, standalone conversations and MCP configuration.');app.exit(0);return;
  }
  assert.equal(await js('document.querySelector("#context-select").value'),'');
  assert.equal(await js('document.querySelector("#file-panel").hidden'),true);
  store.data.projects=[{id:'fixture-project',name:'fixture-project',path:process.env.AGENT_STUDIO_FIXTURE_PROJECT}];store.save();
  await js('(async()=>{state=await window.studio.invoke("state");render();})()');
  await click('[data-view=settings]');
  await change('[name=theme]','dark');await change('[name=chatFontSize]','18');await change('[name=codeFontSize]','16');
  assert.equal(await js('getComputedStyle(document.querySelector(".appearance-preview p")).fontSize'),'18px');
  await submit('#settings-form');await wait('document.querySelector("#settings-save-status").textContent === "Saved on this device"');
  const darkContrast=await js(`(()=>{const lum=s=>{const c=s.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722};const a=lum(getComputedStyle(document.querySelector('#settings-view h1')).color),b=lum(getComputedStyle(document.querySelector('main')).backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)})()`);
  assert.ok(darkContrast>=4.5,'Dark theme text must remain readable.');
  await screenshot('settings-preview.png');
  await click('[data-settings-tab=chat]');await change('[name=sendShortcut]','mod-enter');await submit('#settings-form');await wait('document.querySelector("#settings-save-status").textContent === "Saved on this device"');
  await click('[data-view=providers]');await click('#new-model');
  await fill('#provider-form [name=name]','Standalone fixture');await fill('#provider-form [name=baseUrl]',process.env.AGENT_STUDIO_FIXTURE_URL);await fill('#provider-form [name=model]','fixture-single');
  const {dialog}=require('electron');const picker=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.resolve(__dirname,'../assets/icon.png')]});
  await click('#pick-logo');await wait('!!document.querySelector("#connection-logo-preview img")');dialog.showOpenDialog=picker;
  await submit('#provider-form');await wait('!document.querySelector("#modal").open');
  const single=store.data.providers.find(p=>p.name==='Standalone fixture');assert.equal(single.kind,'single');assert.ok(single.logoData.startsWith('data:image/png;'));assert.equal(single.tools,false);
  await click(`[data-use-provider="${single.id}"]`);await fill('#prompt','Tell me something without opening files');
  // With Ctrl+Enter selected, plain Enter must not submit.
  await js('document.querySelector("#prompt").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));');
  assert.equal(store.data.conversations.length,0);
  await submit('#composer');await wait('document.querySelector("#messages").textContent.includes("Standalone chat works") && document.querySelector("#stop").hidden');
  assert.equal(store.data.conversations[0].projectId,null);
  await click('[data-view=agents]');await click('#new-agent');
  await fill('#agent-form [name=name]','Test Specialist');await fill('#agent-form [name=description]','Integration test agent');await fill('#agent-form [name=system]','Build and review code.');await submit('#agent-form');await wait('!document.querySelector("#modal").open');
  await click('[data-view=providers]');await click('#new-provider');
  await fill('#provider-form [name=name]','Local test');await fill('#provider-form [name=baseUrl]',process.env.AGENT_STUDIO_FIXTURE_URL);await submit('#provider-form');await wait('!document.querySelector("#modal").open');
  const gateway=store.data.providers.find(p=>p.name==='Local test');await click(`[data-refresh-provider="${gateway.id}"]`);
  await wait('Array.from(document.querySelector("#model-select").options).some(o=>o.value==="fixture-model")');
  assert.equal(await js('document.querySelector("#model-select").value'),''); // no automatic paid-model choice
  await click('[data-project=fixture-project]');await change('#agent-select','builder');await change('#model-select','fixture-model');
  await fill('#prompt','Create a hello file');await submit('#composer');await wait('!!document.querySelector("#allow-action")');
  assert.ok(!fs.existsSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt')));
  await click('#allow-action');await wait('document.querySelector("#messages").textContent.includes("Your local agent is working") && document.querySelector("#stop").hidden');
  assert.equal(fs.readFileSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt'),'utf8'),'Hello from Agent Studio!\n');
  await click('[data-view=settings]');await click('[data-settings-tab=mcp]');await click('#add-mcp');
  await fill('#mcp-form [name=name]','Desktop MCP fixture');await fill('#mcp-form [name=command]',process.env.AGENT_STUDIO_FIXTURE_NODE);await fill('#mcp-form [name=args]',JSON.stringify([path.resolve(__dirname,'../tests/fixtures/mcp-server.cjs')]));
  const trace=path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'mcp-calls.txt');
  await fill('#mcp-form [name=secret]',JSON.stringify({FIXTURE_TOKEN:'desktop-secret-fixture',TRACE_PATH:trace}));await submit('#mcp-form');await wait('!document.querySelector("#modal").open');
  const mcpId=store.data.mcpServers[0].id;
  assert.equal(snapshot().mcpServers[0].status,'disconnected');
  await click(`[data-connect-mcp="${mcpId}"]`);await click('#confirm-connect-mcp');await wait('document.querySelector(".mcp-card .tag").textContent === "connected"');
  assert.ok(!JSON.stringify(snapshot()).includes('desktop-secret-fixture'));
  for(const approved of [false,true]) {
    await click('#chat-mode');await change('#model-select','fixture-model');assert.equal(await js('document.querySelector("#mcp-enabled").checked'),false);
    await click('#mcp-enabled');await fill('#prompt','Use MCP to echo desktop test');await submit('#composer');await wait('!!document.querySelector("#allow-action")');
    assert.ok((await js('document.querySelector("#modal").textContent')).includes('echo_text'));
    if(!approved)assert.ok(!fs.existsSync(trace));await click(approved?'#allow-action':'#deny-action');
    await wait('document.querySelector("#messages").textContent.includes("External MCP result received") && document.querySelector("#stop").hidden');
    if(!approved)assert.ok(!fs.existsSync(trace));else assert.equal(fs.readFileSync(trace,'utf8'),'echo_text\n');
  }
  await click('[data-view=settings]');await click('[data-settings-tab=mcp]');await click(`[data-disconnect-mcp="${mcpId}"]`);await wait('document.querySelector(".mcp-card .tag").textContent === "disconnected"');
  await click('[data-settings-tab=features]');await screenshot('features-preview.png');
  // Record default, key-free app views with real source files for documentation.
  const originalProjects=store.data.projects;store.data.projects=[{id:'preview',name:'agent-studio',path:path.resolve(__dirname,'..')}];
  await js('(async()=>{state=await window.studio.invoke("state");state.providers=state.providers.filter(p=>p.id==="experiential");state.conversations=[];state.mcpServers=[];state.agents=state.agents.filter(a=>a.name!=="Test Specialist");state.settings={...appearanceDefaults,theme:"light"};projectId="preview";conversationId=null;providerId="experiential";agentId="builder";model="";render();showView("workspace");await loadFiles();document.querySelector("#run-status").textContent="";document.querySelector("#toast").hidden=true;})()');
  await screenshot('desktop-preview.png');await click('#chat-mode');await screenshot('chat-preview.png');
  store.data.projects=originalProjects;assert.deepEqual(errors,[]);
  console.log('Desktop interaction passed: settings, standalone chat/model, logos, approvals, MCP, and source preview.');app.exit(0);
};
