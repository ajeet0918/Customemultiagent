const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-studio-desktop-'));
  const projectDir = path.join(dir, 'fixture-project'); await fs.mkdir(projectDir); await fs.writeFile(path.join(projectDir, 'README.md'), '# Integration fixture\n');
  let calls = 0; let catalogCalls = 0;
  const server = createServer(async (req,res) => {
    if (req.url === '/v1/models') { catalogCalls++; res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({data:[{id:'fixture-model',owned_by:'local-test'}]})); }
    const chunks=[]; for await (const chunk of req) chunks.push(chunk); const request=JSON.parse(Buffer.concat(chunks)); calls++;
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    let delta;
    const external = request.tools?.find(t => t.function.name.startsWith('mcp_'));
    if (!request.tools?.length) delta={content:'Standalone chat works without project access.'};
    else if (request.messages.some(m => m.role === 'tool')) delta={content: external ? 'External MCP result received.' : 'Created hello.txt after your approval. Your local agent is working.'};
    else if (external) delta={content:'I will ask the connected MCP tool.',tool_calls:[{index:0,id:'mcp-fixture-call',type:'function',function:{name:external.function.name,arguments:JSON.stringify({text:'desktop test'})}}]};
    else if (request.tools.some(t=>t.function.name==='run_command') && !request.tools.some(t=>t.function.name==='write_file')) delta={content:'I will check the terminal.',tool_calls:[{index:0,id:'computer-terminal',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'printf studio-computer-test',reason:'Verify projectless terminal'})}}]};
    else delta={content:'I will create a small file for this task.',tool_calls:[{index:0,id:'fixture-call',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'hello.txt',content:'Hello from Agent Studio!\n'})}}]};
    res.write(`data: ${JSON.stringify({choices:[{delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executable=require('electron');
  const env={...process.env,AGENT_STUDIO_DATA_DIR:path.join(dir,'profile'),AGENT_STUDIO_DESKTOP_TEST:'1',AGENT_STUDIO_FIXTURE_PROJECT:projectDir,AGENT_STUDIO_FIXTURE_NODE:process.execPath,AGENT_STUDIO_FIXTURE_URL:`http://127.0.0.1:${server.address().port}/v1`};
  delete env.ELECTRON_RUN_AS_NODE;
  const run=phase=>new Promise(resolve=>{ const child=spawn(executable,['.','--disable-gpu'],{cwd:path.resolve(__dirname,'..'),env:{...env,AGENT_STUDIO_TEST_PHASE:phase},stdio:'inherit'}); const timer=setTimeout(()=>child.kill('SIGKILL'),90000);child.on('error',error=>{console.error(error);clearTimeout(timer);resolve(1);});child.on('exit',code=>{clearTimeout(timer);resolve(code??1);}); });
  try { let code=await run('exercise'); if (!code) code=await run('persistence'); if (!code && (calls!==9 || catalogCalls!==1)) throw new Error(`Expected nine completions and one catalog call; got ${calls} completions and ${catalogCalls} catalogs`); if(code) process.exitCode=code; else console.log('Desktop integration passed: settings, themes, standalone models, projectless chat, MCP discovery, approved/declined tools, project writes, persistence and sandbox isolation.'); }
  finally { server.closeAllConnections();server.close();await fs.rm(dir,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
