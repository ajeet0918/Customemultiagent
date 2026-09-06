const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('node:http');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-studio-desktop-'));
  const projectDir = path.join(dir, 'fixture-project'); await fs.mkdir(projectDir); await fs.writeFile(path.join(projectDir, 'README.md'), '# Integration fixture\n');
  let calls = 0;
  const server = createServer(async (req,res) => {
    if (req.url === '/v1/models') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({data:[{id:'fixture-model',owned_by:'local-test'}]})); }
    const chunks=[]; for await (const chunk of req) chunks.push(chunk); const request=JSON.parse(Buffer.concat(chunks)); calls++;
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    let delta;
    if (request.messages.some(m => m.role === 'tool')) delta={content:'Created hello.txt after your approval. Your local agent is working.'};
    else delta={content:'I will create a small file for this task.',tool_calls:[{index:0,id:'fixture-call',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'hello.txt',content:'Hello from Agent Studio!\n'})}}]};
    res.write(`data: ${JSON.stringify({choices:[{delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const executable=require('electron');
  const env={...process.env,AGENT_STUDIO_DATA_DIR:path.join(dir,'profile'),AGENT_STUDIO_DESKTOP_TEST:'1',AGENT_STUDIO_FIXTURE_PROJECT:projectDir,AGENT_STUDIO_FIXTURE_URL:`http://127.0.0.1:${server.address().port}/v1`};
  delete env.ELECTRON_RUN_AS_NODE;
  const run=phase=>new Promise(resolve=>{ const child=spawn(executable,['.','--disable-gpu'],{cwd:path.resolve(__dirname,'..'),env:{...env,AGENT_STUDIO_TEST_PHASE:phase},stdio:'inherit'}); const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.on('error',error=>{console.error(error);clearTimeout(timer);resolve(1);});child.on('exit',code=>{clearTimeout(timer);resolve(code??1);}); });
  try { let code=await run('exercise'); if (!code) code=await run('persistence'); if (!code && calls!==2) throw new Error(`Expected two mock completion calls; got ${calls}`); if(code) process.exitCode=code; else console.log('Desktop integration passed: provider setup, agent creation, model discovery, streaming, approval, file write, persistence and sandbox isolation.'); }
  finally { server.closeAllConnections();server.close();await fs.rm(dir,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
