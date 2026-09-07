const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store, uid } = require('./core/store.cjs');
const { Vault } = require('./core/vault.cjs');
const { validateBaseUrl, listModels } = require('./core/provider.cjs');
const workspace = require('./core/workspace.cjs');
const { runAgent } = require('./core/agent.cjs');
const { normalizeSettings } = require('./core/settings.cjs');
const { McpManager, validateServer, validateSecrets, connectionSignature } = require('./core/mcp.cjs');
const appVersion = require('../package.json').version;
app.setName('Agent Studio');
if (process.env.AGENT_STUDIO_DATA_DIR) app.setPath('userData', path.resolve(process.env.AGENT_STUDIO_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, store, vault, mcp, active = null;
const approvals = new Map();
const text = (value, max = 500) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid or empty text field.'); return value.trim(); };
function snapshot() { return { ...store.data, providers: store.data.providers.map(p => ({ ...p, hasKey: !!vault.get(p) })), mcpServers: store.data.mcpServers.map(s => ({ ...s, ...mcp.status(s.id), hasSecret: !!mcp.secret(s.id) })), appVersion, secureStorage: vault.secure(), dataPath: app.getPath('userData'), activeConversationId: active?.conversationId || null }; }
function emit(event) { if (win && !win.isDestroyed()) win.webContents.send('studio:event', event); }
function guard(handler) { return async (event, data) => { if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('studio://app/')) throw new Error('Untrusted caller.'); return handler(data); }; }
function handle(name, fn) { ipcMain.handle(`studio:${name}`, guard(fn)); }
function idle() { if (active) throw new Error('Wait for the current run to finish or stop it first.'); }
function repairHistory(conversation) {
  const answered = new Set(conversation.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id));
  const repaired = [];
  for (const message of conversation.messages) {
    repaired.push(message);
    if (message.tool_calls) for (const call of message.tool_calls) if (!answered.has(call.id)) repaired.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: 'Interrupted before this action completed. Inspect current state before retrying.' });
  }
  conversation.messages = repaired;
}
function approve(action, signal) {
  return new Promise(resolve => {
    const id = uid(); const abort = () => finish(false);
    const finish = value => { approvals.delete(id); signal.removeEventListener('abort', abort); emit({ type: 'approval-closed', id }); resolve(value); };
    approvals.set(id, finish); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return finish(false);
    emit({ type: 'approval', id, ...action });
  });
}
function handlers() {
  handle('state', () => snapshot());
  handle('save-settings', input => { store.data.settings = normalizeSettings(input); store.save(); win.webContents.setZoomFactor(store.data.settings.interfaceScale / 100); return snapshot(); });
  handle('pick-provider-logo', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose a model or provider logo', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp'] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0]; if (fs.statSync(file).size > 250000) throw new Error('Choose an image smaller than 250 KB.');
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!['png','jpg','jpeg','webp'].includes(ext)) throw new Error('Choose a PNG, JPEG or WebP image.');
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`;
  });
  handle('pick-executable', async () => { const result = await dialog.showOpenDialog(win, { title: 'Choose the MCP server executable', properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('save-mcp', async input => {
    idle(); const server = validateServer({ ...input, id: input.id || uid() });
    const existing = store.data.mcpServers.find(s => s.id === server.id);
    let secret;
    if (input.secret) secret = server.transport === 'stdio' ? JSON.stringify(validateSecrets(JSON.parse(text(input.secret, 20000)))) : text(input.secret, 4000);
    const changed = existing && connectionSignature(existing) !== connectionSignature(server);
    await mcp.disconnect(server.id);
    if (changed || input.clearSecret) vault.set(`mcp:${server.id}`, '');
    if (secret !== undefined) vault.set(`mcp:${server.id}`, secret);
    if (existing) Object.assign(existing, server); else store.data.mcpServers.push(server);
    // Drop fields belonging to the previous transport.
    const index = store.data.mcpServers.findIndex(s => s.id === server.id); store.data.mcpServers[index] = server;
    store.save(); return snapshot();
  });
  handle('connect-mcp', async id => { idle(); await mcp.connect(store.get('mcpServers', id)); return snapshot(); });
  handle('disconnect-mcp', async id => { idle(); await mcp.disconnect(id); return snapshot(); });
  handle('delete-mcp', async id => { idle(); await mcp.disconnect(id); store.data.mcpServers = store.data.mcpServers.filter(s => s.id !== id); vault.set(`mcp:${id}`, ''); store.save(); return snapshot(); });
  handle('save-provider', input => {
    idle(); const id = input.id || uid(); const existing = store.data.providers.find(p => p.id === id);
    const baseUrl = validateBaseUrl(text(input.baseUrl, 2000));
    const provider = { id, name: text(input.name, 80), baseUrl, envKey: input.envKey ? text(input.envKey, 100) : '', model: String(input.model || '').slice(0,200), tools: input.tools !== false, models: existing?.baseUrl === baseUrl ? existing.models : [], kind: input.kind === 'single' ? 'single' : 'gateway', brand: ['auto','custom','experiential','openai','anthropic','gemini','deepseek','ollama','terminal'].includes(input.brand) ? input.brand : 'auto', logoData: input.logoData || '' };
    if (provider.kind === 'single' && !provider.model.trim()) throw new Error('Enter the exact model ID for this standalone model.');
    if (provider.logoData && (provider.logoData.length > 350000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(provider.logoData))) throw new Error('Invalid logo image.');
    if (provider.envKey && !/^[A-Z_][A-Z0-9_]*$/.test(provider.envKey)) throw new Error('Environment variable names must use uppercase letters, numbers and underscores.');
    const incomingKey = input.key ? text(input.key, 4000) : '';
    if (existing && existing.baseUrl !== baseUrl) vault.set(id, '');
    if (incomingKey) vault.set(id, incomingKey);
    if (input.clearKey) vault.set(id, '');
    if (existing) Object.assign(existing, provider); else store.data.providers.push(provider);
    store.save(); return snapshot();
  });
  handle('delete-provider', id => { idle(); store.get('providers', id); store.data.providers = store.data.providers.filter(p => p.id !== id); vault.set(id, ''); store.save(); return snapshot(); });
  handle('models', async id => {
    idle(); const provider = store.get('providers', id); if (provider.kind === 'single') throw new Error('Standalone models use the model ID entered in their connection settings.'); const models = await listModels(provider, vault.get(provider));
    provider.models = models; if (provider.model && !models.some(m => m.id === provider.model)) provider.model = ''; store.save(); return snapshot();
  });
  handle('save-agent', input => {
    idle(); const agent = { id: input.id || uid(), name: text(input.name, 60), description: text(input.description, 200), system: text(input.system, 20000), mode: input.mode === 'edit' ? 'edit' : 'read', icon: '◇' };
    const existing = store.data.agents.find(a => a.id === agent.id); if (existing) Object.assign(existing, agent); else store.data.agents.push(agent); store.save(); return snapshot();
  });
  handle('delete-agent', id => { idle(); if (store.data.agents.length === 1) throw new Error('Keep at least one agent.'); store.data.agents = store.data.agents.filter(a => a.id !== id); store.save(); return snapshot(); });
  handle('add-project', async ({ create = false } = {}) => {
    idle();
    const selected = create ? await dialog.showSaveDialog(win, { title: 'Create a project folder', defaultPath: path.join(app.getPath('documents'), 'my-project'), buttonLabel: 'Create project', properties: ['createDirectory'] }) : await dialog.showOpenDialog(win, { title: 'Open project folder', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled) return null;
    const directory = create ? selected.filePath : selected.filePaths[0];
    if (create) { if (fs.existsSync(directory)) throw new Error('That folder already exists. Use Open folder.'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'README.md'), `# ${path.basename(directory)}\n\nCreated with Agent Studio.\n`); }
    const real = fs.realpathSync(directory); let project = store.data.projects.find(p => p.path === real);
    if (!project) { project = { id: uid(), name: path.basename(real), path: real }; store.data.projects.push(project); store.save(); }
    return { state: snapshot(), projectId: project.id };
  });
  handle('remove-project', id => { idle(); store.data.projects = store.data.projects.filter(p => p.id !== id); store.save(); return snapshot(); });
  handle('files', ({ projectId, relative }) => workspace.listFiles(store.get('projects', projectId).path, relative || '.'));
  handle('read-file', ({ projectId, relative }) => workspace.readFile(store.get('projects', projectId).path, relative));
  handle('reveal-project', id => shell.openPath(store.get('projects', id).path));
  handle('delete-conversation', id => { idle(); store.data.conversations = store.data.conversations.filter(c => c.id !== id); store.save(); return snapshot(); });
  handle('export-conversation', async id => {
    const c = store.get('conversations', id); const selected = await dialog.showSaveDialog(win, { defaultPath: `${c.title.replace(/[^a-z0-9 -]/gi, '').slice(0,70)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!selected.canceled) fs.writeFileSync(selected.filePath, `# ${c.title}\n\n` + c.messages.map(m => `## ${m.role}\n\n${m.content || JSON.stringify(m.tool_calls)}\n`).join('\n')); return !selected.canceled;
  });
  handle('approve', ({ id, accepted }) => { const finish = approvals.get(id); if (!finish) throw new Error('This approval is no longer active.'); finish(accepted === true); });
  handle('stop', () => { active?.controller.abort(); });
  handle('external', key => { const urls = { keys: 'https://platform.experientiallabs.ai/api-keys?section=keys', models: 'https://platform.experientiallabs.ai/models', docs: 'https://platform.experientiallabs.ai/docs/core-loop', telemetry: 'https://platform.experientiallabs.ai/telemetry', mcp: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers', credits: 'https://platform.experientiallabs.ai/credits' }; if (!urls[key]) throw new Error('Unknown link.'); return shell.openExternal(urls[key]); });
  handle('chat', input => {
    idle(); const prompt = text(input.prompt, 100000); const provider = store.get('providers', input.providerId); const agent = store.get('agents', input.agentId); const model = text(input.model, 200); const key = vault.get(provider);
    if (!key && new URL(provider.baseUrl).protocol !== 'http:') throw new Error('Add an API key in Providers first.');
    let conversation = input.conversationId ? store.get('conversations', input.conversationId) : null;
    const projectId = conversation ? conversation.projectId : input.projectId;
    const project = projectId ? store.data.projects.find(p => p.id === projectId) : null;
    if (projectId && !project) throw new Error('This project was removed. Open its folder and start a new conversation.');
    const externalTools = input.useMcp === true && provider.tools !== false && agent.mode === 'edit' ? mcp.toolSet() : [];
    if (!conversation) { conversation = { id: uid(), title: prompt.slice(0,65), projectId: project?.id || null, createdAt: new Date().toISOString(), messages: [] }; store.data.conversations.unshift(conversation); }
    conversation.useMcp = externalTools.length > 0;
    repairHistory(conversation); conversation.providerId = provider.id; conversation.model = model; conversation.agentId = agent.id;
    conversation.messages.push({ role: 'user', content: prompt }); conversation.updatedAt = new Date().toISOString(); store.save();
    const controller = new AbortController(); active = { conversationId: conversation.id, controller };
    setImmediate(async () => {
      try {
        await runAgent({ provider, key, model, agent, project, messages: [...conversation.messages], signal: controller.signal, approve, externalTools, emit: event => {
          if (event.type === 'message') { conversation.messages.push(event.message); if (event.usage) conversation.usage = event.usage; store.save(); }
          emit({ ...event, conversationId: conversation.id });
        } });
      } catch (error) { emit({ type: 'run-error', conversationId: conversation.id, text: controller.signal.aborted ? 'Stopped. You can continue with a follow-up.' : error.message }); }
      finally { repairHistory(conversation); active = null; store.save(); emit({ type: 'done', conversationId: conversation.id, state: snapshot() }); }
    });
    return { conversationId: conversation.id, state: snapshot() };
  });
}
app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'), app.isPackaged ? null : path.resolve(__dirname, '..'));
  vault = new Vault(app.getPath('userData'), safeStorage);
  mcp = new McpManager({ vault, cwd: app.getPath('home'), onChange: () => emit({ type: 'mcp-state', servers: store.data.mcpServers.map(s => ({ ...s, ...mcp.status(s.id), hasSecret: !!mcp.secret(s.id) })) }) });
  protocol.handle('studio', request => {
    const url = new URL(request.url); const allowed = new Set(['/index.html', '/app.js', '/styles.css', '/connections.js', '/settings.js']);
    if (url.host !== 'app' || !allowed.has(url.pathname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'renderer', url.pathname.slice(1))).href);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  handlers();
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1020, minHeight: 700, title: 'Agent Studio', backgroundColor: '#f8f9f7', icon: path.join(__dirname, '../assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.setMenuBarVisibility(false); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', () => active?.controller.abort());
  win.webContents.setZoomFactor(store.data.settings.interfaceScale / 100);
  await win.loadURL('studio://app/index.html' + (process.argv.includes('--setup') ? '?setup=1' : ''));
  if (process.env.AGENT_STUDIO_DESKTOP_TEST === '1') require('../scripts/desktop-scenario.cjs')({ app, win, store, snapshot }).catch(error => { console.error(error); app.exit(1); });
}).catch(error => { console.error(error.message); app.exit(1); });
let closing = false;
app.on('before-quit', event => { if (mcp && !closing) { event.preventDefault(); closing = true; active?.controller.abort(); mcp.close().finally(() => app.quit()); } });
app.on('window-all-closed', () => app.quit());
