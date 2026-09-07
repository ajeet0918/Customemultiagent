const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/client/stdio');
const { createHash } = require('node:crypto');
const { validateBaseUrl } = require('./provider.cjs');
const pkg = require('../../package.json');
function validateServer(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw new Error('Enter an MCP server name (up to 80 characters).');
  const server = { id: input.id, name: input.name.trim(), transport: input.transport };
  if (input.transport === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 2000 || input.command.includes('\0')) throw new Error('Enter an executable path or command name, with arguments in the separate list.');
    if (!Array.isArray(input.args) || input.args.length > 80 || input.args.some(a => typeof a !== 'string' || a.length > 8000 || a.includes('\0'))) throw new Error('Arguments must be a JSON array of strings.');
    server.command = input.command.trim(); server.args = input.args;
  } else if (input.transport === 'http') server.url = validateBaseUrl(input.url);
  else throw new Error('Choose a local stdio or Streamable HTTP server.');
  return server;
}
function validateSecrets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Environment variables must be a JSON object.');
  for (const [key, entry] of Object.entries(value)) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof entry !== 'string' || entry.includes('\0')) throw new Error('Environment variables need valid names and string values.');
  if (JSON.stringify(value).length > 20000) throw new Error('Environment configuration is too large.');
  return value;
}
const connectionSignature = s => JSON.stringify([s.transport,s.url,s.command,s.args]);
class McpManager {
  constructor({ vault, onChange = () => {}, cwd }) { this.vault = vault; this.onChange = onChange; this.cwd = cwd; this.connections = new Map(); this.statuses = new Map(); }
  status(id) { return this.statuses.get(id) || { status: 'disconnected', tools: [] }; }
  update(id, value) { this.statuses.set(id, value); this.onChange(); }
  secret(id) { return this.vault.get({ id: `mcp:${id}` }); }
  redact(id, value) {
    let result = String(value); const secret = this.secret(id);
    if (secret) { result = result.split(secret).join('[redacted]'); try { for (const v of Object.values(JSON.parse(secret))) if (typeof v === 'string' && v) result = result.split(v).join('[redacted]'); } catch {} }
    return result.slice(0, 1200);
  }
  async connect(server) {
    if (this.status(server.id).status === 'connecting') throw new Error('This server is already connecting.');
    if (this.connections.has(server.id)) return;
    const client = new Client({ name: 'agent-studio', version: pkg.version }, { capabilities: {}, listMaxPages: 8 });
    const secret = this.secret(server.id);
    const transport = server.transport === 'stdio'
      ? new StdioClientTransport({ command: server.command, args: server.args, cwd: this.cwd, env: { ...getDefaultEnvironment(), ...(secret ? validateSecrets(JSON.parse(secret)) : {}) }, stderr: 'pipe', maxBufferSize: 1000000 })
      : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { ...(secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}), redirect: 'error' }, fetch: (url, init) => { const target = new URL(url instanceof Request ? url.url : url); if (target.origin !== new URL(server.url).origin) throw new Error('MCP redirect or cross-origin request blocked.'); return fetch(url, { ...init, redirect: 'error' }); } });
    // Drain server stderr without exposing tokens or arbitrary server logs to the UI.
    transport.stderr?.on('data', () => {});
    const controller = new AbortController();
    const entry = { client, transport, server, controller, tools: [] };
    this.connections.set(server.id, entry); this.update(server.id, { status: 'connecting', tools: [] });
    client.onerror = () => {};
    client.onclose = () => { if (this.connections.get(server.id) === entry) { this.connections.delete(server.id); this.update(server.id, { status: 'disconnected', tools: [], error: 'Connection closed. Connect again when the server is ready.' }); } };
    const timer = setTimeout(() => { controller.abort(); client.close().catch(() => {}); }, 20000);
    try {
      await client.connect(transport, { signal: controller.signal, timeout: 20000 });
      const result = await client.listTools({}, { signal: controller.signal, timeout: 15000 });
      if (result.tools.length > 64) throw new Error('This server exposes more than 64 tools. Configure a smaller tool set on the server.');
      entry.tools = result.tools.map(tool => {
        if (!tool.name || JSON.stringify(tool.inputSchema).length > 64000) throw new Error('The server returned an invalid or oversized tool schema.');
        return { ...tool, localName: 'mcp_' + createHash('sha256').update(`${server.id}:${tool.name}`).digest('hex').slice(0,32) };
      });
      if (controller.signal.aborted || this.connections.get(server.id) !== entry) throw new Error('Connection cancelled.');
      this.update(server.id, { status: 'connected', tools: entry.tools.map(t => ({ name: t.name, description: String(t.description || '').slice(0,1000) })) });
    } catch (error) {
      const ownsConnection = this.connections.get(server.id) === entry;
      if (ownsConnection) this.connections.delete(server.id);
      await client.close().catch(() => {});
      const message = this.redact(server.id, error.message);
      if (ownsConnection || (!controller.signal.aborted && !this.connections.has(server.id))) this.update(server.id, { status: 'error', error: message, tools: [] });
      throw new Error(message);
    } finally { clearTimeout(timer); }
  }
  async disconnect(id) {
    const entry = this.connections.get(id); this.connections.delete(id);
    if (entry) { entry.controller.abort(); await entry.client.close().catch(() => {}); }
    this.update(id, { status: 'disconnected', tools: [] });
  }
  toolSet() {
    const tools = [];
    for (const [id, entry] of this.connections) {
      if (this.status(id).status !== 'connected') continue;
      for (const tool of entry.tools) tools.push({
        definition: { type: 'function', function: { name: tool.localName, description: `[${entry.server.name}] ${String(tool.description || tool.name).slice(0,4000)}`, parameters: tool.inputSchema } },
        serverName: entry.server.name, remoteName: tool.name,
        call: async (args, signal) => {
          if (this.connections.get(id) !== entry) throw new Error('MCP server disconnected.');
          try { const result = await entry.client.callTool({ name: tool.name, arguments: args }, { signal, timeout: 60000 });
            // Only text and structured JSON are included as model context in this release.
            const content = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || JSON.stringify(result.structuredContent || { message: 'The tool returned non-text content, which this app does not display.' });
            const redacted = this.redactResult(id, content);
            return { isError: result.isError === true, content: redacted.slice(0,64000), truncated: redacted.length > 64000 };
          } catch (error) { throw new Error(this.redact(id, error.message)); }
        }
      });
    }
    if (tools.length > 64) throw new Error('More than 64 MCP tools are connected. Disconnect a server before enabling tools.');
    return tools;
  }
  redactResult(id, content) {
    let output = String(content); const secret = this.secret(id);
    if (secret) { output = output.split(secret).join('[redacted]'); try { for (const value of Object.values(JSON.parse(secret))) if (value) output = output.split(value).join('[redacted]'); } catch {} }
    return output;
  }
  async close() { await Promise.allSettled([...this.connections.keys()].map(id => this.disconnect(id))); }
}
module.exports = { McpManager, validateServer, validateSecrets, connectionSignature };
