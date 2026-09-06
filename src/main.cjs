const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store, uid } = require('./core/store.cjs');
const { Vault } = require('./core/vault.cjs');
const { validateBaseUrl, listModels } = require('./core/provider.cjs');
const workspace = require('./core/workspace.cjs');
const { runAgent } = require('./core/agent.cjs');
app.setName('Agent Studio');
if (process.env.AGENT_STUDIO_DATA_DIR) app.setPath('userData', path.resolve(process.env.AGENT_STUDIO_DATA_DIR));
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, store, vault, active = null;
const approvals = new Map();
const text = (value, max = 500) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid or empty text field.'); return value.trim(); };
function snapshot() { return { ...store.data, providers: store.data.providers.map(p => ({ ...p, hasKey: !!vault.get(p) })), secureStorage: vault.secure(), dataPath: app.getPath('userData'), activeConversationId: active?.conversationId || null }; }
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
  handle('save-provider', input => {
    idle(); const id = input.id || uid(); const existing = store.data.providers.find(p => p.id === id);
    const baseUrl = validateBaseUrl(text(input.baseUrl, 2000));
    if (existing && existing.baseUrl !== baseUrl) vault.set(id, '');
    const provider = { id, name: text(input.name, 80), baseUrl, envKey: input.envKey ? text(input.envKey, 100) : '', model: String(input.model || '').slice(0,200), tools: input.tools !== false, models: existing?.baseUrl === baseUrl ? existing.models : [] };
    if (provider.envKey && !/^[A-Z_][A-Z0-9_]*$/.test(provider.envKey)) throw new Error('Environment variable names must use uppercase letters, numbers and underscores.');
    if (input.key) vault.set(id, text(input.key, 4000));
    if (input.clearKey) vault.set(id, '');
    if (existing) Object.assign(existing, provider); else store.data.providers.push(provider);
    store.save(); return snapshot();
  });
  handle('delete-provider', id => { idle(); store.get('providers', id); store.data.providers = store.data.providers.filter(p => p.id !== id); vault.set(id, ''); store.save(); return snapshot(); });
  handle('models', async id => {
    idle(); const provider = store.get('providers', id); const models = await listModels(provider, vault.get(provider));
    provider.models = models; if (!provider.model || !models.some(m => m.id === provider.model)) provider.model = models[0]?.id || ''; store.save(); return snapshot();
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
  handle('external', key => { const urls = { keys: 'https://platform.experientiallabs.ai/api-keys?section=keys', models: 'https://platform.experientiallabs.ai/models', docs: 'https://platform.experientiallabs.ai/docs/core-loop', telemetry: 'https://platform.experientiallabs.ai/telemetry' }; if (!urls[key]) throw new Error('Unknown link.'); return shell.openExternal(urls[key]); });
  handle('chat', input => {
    idle(); const prompt = text(input.prompt, 100000); const provider = store.get('providers', input.providerId); const agent = store.get('agents', input.agentId); const model = text(input.model, 200); const key = vault.get(provider);
    if (!key && new URL(provider.baseUrl).protocol !== 'http:') throw new Error('Add an API key in Providers first.');
    let conversation = input.conversationId ? store.get('conversations', input.conversationId) : null;
    const projectId = conversation ? conversation.projectId : input.projectId;
    const project = projectId ? store.data.projects.find(p => p.id === projectId) : null;
    if (projectId && !project) throw new Error('This project was removed. Open its folder and start a new conversation.');
    if (!conversation) { conversation = { id: uid(), title: prompt.slice(0,65), projectId: project?.id || null, createdAt: new Date().toISOString(), messages: [] }; store.data.conversations.unshift(conversation); }
    repairHistory(conversation); conversation.providerId = provider.id; conversation.model = model; conversation.agentId = agent.id;
    conversation.messages.push({ role: 'user', content: prompt }); conversation.updatedAt = new Date().toISOString(); store.save();
    const controller = new AbortController(); active = { conversationId: conversation.id, controller };
    setImmediate(async () => {
      try {
        await runAgent({ provider, key, model, agent, project, messages: [...conversation.messages], signal: controller.signal, approve, emit: event => {
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
  protocol.handle('studio', request => {
    const url = new URL(request.url); const allowed = new Set(['/index.html', '/app.js', '/styles.css']);
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
  await win.loadURL('studio://app/index.html' + (process.argv.includes('--setup') ? '?setup=1' : ''));
  if (process.env.AGENT_STUDIO_DESKTOP_TEST === '1') require('../scripts/desktop-scenario.cjs')({ app, win, store, snapshot }).catch(error => { console.error(error); app.exit(1); });
}).catch(error => { console.error(error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
