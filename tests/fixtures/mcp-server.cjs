const readline = require('node:readline');
const fs = require('node:fs');
const tools = [{ name: 'echo_text', description: 'Echo text from the fixture server.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }, { name: 'secret_status', description: 'Exercise credential redaction.', inputSchema: { type: 'object', properties: {} } }];
function response(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); if (request.id === undefined || process.argv.includes('--stall')) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'studio-fixture', version: '1.0.0' } };
  else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/list') result = { tools };
  else if (request.method === 'tools/call') {
    if (process.env.TRACE_PATH) fs.appendFileSync(process.env.TRACE_PATH, request.params.name + '\n');
    const value = request.params.name === 'secret_status' ? `token=${process.env.FIXTURE_TOKEN || 'none'}; inherited=${process.env.EXPLABS_API_KEY || 'none'}` : `MCP says: ${request.params.arguments.text}`;
    result = { content: [{ type: 'text', text: value }] };
  } else return response({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  response({ jsonrpc: '2.0', id: request.id, result });
});
