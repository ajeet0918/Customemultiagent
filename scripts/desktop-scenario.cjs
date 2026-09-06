const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,win,store,snapshot}) => {
  const js = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { console.error('Failed desktop test expression:', code); throw error; } };
  const wait = async condition => { for(let i=0;i<200;i++){if(await js(condition))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(`UI timeout: ${condition}`); };
  const errors=[]; win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('Renderer error:',event.message);}});
  await wait('!!document.querySelector("#agent-select").options.length');
  assert.equal(await js('typeof require'),'undefined'); assert.equal(await js('typeof process'),'undefined');
  if(process.env.AGENT_STUDIO_TEST_PHASE==='persistence') {
    const data=await js('window.studio.invoke("state")');assert.ok(data.agents.some(a=>a.name==='Test Specialist'));assert.ok(data.conversations[0].messages.some(m=>m.content?.includes('Your local agent is working')));assert.equal(fs.readFileSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt'),'utf8'),'Hello from Agent Studio!\n');
    console.log('Desktop persistence verified.');app.exit(0);return;
  }
  store.data.projects=[{id:'fixture-project',name:'fixture-project',path:process.env.AGENT_STUDIO_FIXTURE_PROJECT}];store.save();
  await js('(async()=>{state = await window.studio.invoke("state"); projectId="fixture-project"; render(); await loadFiles();})()');
  await js('document.querySelector("[data-view=agents]").click(); document.querySelector("#new-agent").click();');
  await js('document.querySelector("#agent-form [name=name]").value="Test Specialist";document.querySelector("#agent-form [name=description]").value="Integration test agent";document.querySelector("#agent-form [name=system]").value="Build and review code.";document.querySelector("#agent-form").requestSubmit();');
  await wait('!document.querySelector("#modal").open');assert.ok(snapshot().agents.some(a=>a.name==='Test Specialist'));
  await js('document.querySelector("[data-view=providers]").click();document.querySelector("#new-provider").click();');
  await js(`document.querySelector('#provider-form [name=name]').value='Local test';document.querySelector('#provider-form [name=baseUrl]').value=${JSON.stringify(process.env.AGENT_STUDIO_FIXTURE_URL)};document.querySelector('#provider-form').requestSubmit();`);
  await wait('!document.querySelector("#modal").open');
  const id=store.data.providers.find(p=>p.name==='Local test').id;
  await js(`document.querySelector('[data-refresh-provider="${id}"]').click();`);
  await wait('document.querySelector("#model-select").value === "fixture-model"');
  await js('document.querySelector("#new-chat").click();document.querySelector("#prompt").value="Create a hello file";document.querySelector("#composer").requestSubmit();');
  await wait('!!document.querySelector("#allow-action")');assert.ok(!fs.existsSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt')));
  await js('document.querySelector("#allow-action").click();');
  await wait('document.querySelector("#messages").textContent.includes("Your local agent is working") && document.querySelector("#stop").hidden');
  assert.equal(fs.readFileSync(path.join(process.env.AGENT_STUDIO_FIXTURE_PROJECT,'hello.txt'),'utf8'),'Hello from Agent Studio!\n');
  assert.ok(!(await js('JSON.stringify(state)')).includes('encrypted'));
  // Capture the real source workspace with its actual file listing.
  const originalProjects=store.data.projects;
  store.data.projects=[{id:'preview',name:'agent-studio',path:path.resolve(__dirname,'..')}];
  await js('(async()=>{state=await window.studio.invoke("state");state.providers=state.providers.filter(p=>p.id==="experiential");state.conversations=[];state.agents=state.agents.filter(a=>a.name!=="Test Specialist");projectId="preview";conversationId=null;providerId="experiential";model="";render();await loadFiles();document.querySelector("#run-status").textContent="";document.querySelector("#toast").hidden=true;})()');
  store.data.projects=originalProjects;
  await new Promise(resolve=>setTimeout(resolve,300));
  fs.mkdirSync(path.resolve(__dirname,'../docs'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../docs/desktop-preview.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);console.log('Desktop interaction and screenshot verified.');app.exit(0);
};
