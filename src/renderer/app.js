const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (name, value) => window.studio.invoke(name, value);
let state, projectId, conversationId = null, view = 'workspace', providerId, agentId = 'builder', model = '', busy = false, streamed = '', folder = '.', attached = null, currentApproval = null, runError = '', filesVisible = true, useMcp = false, computerMode = false;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 6000); }
function safely(fn) { return async (...args) => { try { return await fn(...args); } catch (error) { toast(error.message); } }; }
function project() { return state.projects.find(p => p.id === projectId); }
function provider() { return state.providers.find(p => p.id === providerId); }
function conversation() { return state.conversations.find(c => c.id === conversationId); }
function closeModal() { if (currentApproval) return; $('#modal').close(); }
function modal(html) { $('#modal-content').innerHTML = html; const heading=$('#modal-content h2');if(heading){heading.id='modal-title';$('#modal').setAttribute('aria-labelledby','modal-title');}else{$('#modal').removeAttribute('aria-labelledby');$('#modal').setAttribute('aria-label','Agent Studio dialog');}$('#modal-content').querySelectorAll('[data-close]').forEach(b=>{if(!b.getAttribute('aria-label'))b.setAttribute('aria-label','Close dialog');}); if (!$('#modal').open) $('#modal').showModal(); $('#modal-content').querySelector('[data-close]')?.addEventListener('click', closeModal); }
function showView(next) {
  view = next; document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `${next}-view`);
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === next));
  $('#header-view').textContent = next[0].toUpperCase() + next.slice(1); $('#header-project').textContent = next === 'workspace' ? project()?.name || 'No project' : 'Agent Studio';
  if (state) { applyAppearance(); updateChatContext(); }
}
function render() {
  if (!state.providers.some(p => p.id === providerId)) providerId = state.providers[0]?.id;
  if (!state.agents.some(a => a.id === agentId)) agentId = state.agents[0]?.id;
  $('#agent-count').textContent = state.agents.length;
  $('#projects').innerHTML = state.projects.map(p => `<div class="project-row ${p.id === projectId ? 'selected' : ''}"><button class="project-open" data-project="${esc(p.id)}"><span>▱</span>${esc(p.name)}</button><button class="project-remove" data-remove-project="${esc(p.id)}" title="Remove from workspace" aria-label="Remove project">×</button></div>`).join('') || '<p class="empty-small">Open a folder to get started.</p>';
  $('#conversations').innerHTML = state.conversations.slice(0,30).map(c => `<button class="conversation-link ${c.id === conversationId ? 'selected' : ''}" data-conversation="${esc(c.id)}"><span>◌</span>${esc(c.title)}</button>`).join('') || '<p class="empty-small">Your next idea starts here.</p>';
  $('#agent-select').innerHTML = state.agents.map(a => `<option value="${esc(a.id)}">${esc(a.icon)} ${esc(a.name)}</option>`).join(''); $('#agent-select').value = agentId;
  $('#provider-select').innerHTML = state.providers.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); $('#provider-select').value = providerId || '';
  renderModels();
  const agent = state.agents.find(a => a.id === agentId);
  $('#permission-caption').textContent = provider()?.tools === false ? 'Chat only · tools disabled for this provider' : agent?.mode === 'read' ? 'Read-only agent · no edits or commands' : 'Edits and commands ask for approval';
  $('#connect-banner').hidden = !!provider()?.hasKey || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(provider()?.baseUrl || '');
  $('#file-project-name').textContent = project()?.name || 'No project selected';
  $('#agent-cards').innerHTML = state.agents.map(a => `<article class="agent-card"><div class="agent-card-top"><span class="agent-avatar">${esc(a.icon)}</span><span class="tag">${a.mode === 'edit' ? 'Approval required' : 'Read only'}</span></div><h2>${esc(a.name)}</h2><p>${esc(a.description)}</p><div class="agent-instructions">${esc(a.system)}</div><div class="card-footer"><button class="text-link" data-use-agent="${esc(a.id)}">Start a conversation ↗</button><button class="secondary" data-edit-agent="${esc(a.id)}">Edit agent</button></div></article>`).join('');
  renderProviders();
  $('#storage-note').textContent = state.secureStorage ? 'API keys are encrypted using your Linux keyring. Conversations and agent instructions are stored locally.' : 'A secure Linux keyring is unavailable. Keys entered here last for this session only. You can also launch with an environment variable. Keys are never saved in plain text.';
  $('#storage-note').append(document.createTextNode(` Data folder: ${state.dataPath}`));
  showView(view); renderMessages(); setBusy(busy); renderSettings(); updateChatContext();
}
function renderModels() {
  const p = provider(); let items = p?.models || [];
  if (p?.model && !items.some(m => m.id === p.model)) items = [{ id: p.model }, ...items];
  if (p?.kind === 'single') items = [{ id: p.model }];
  if (model && !items.some(m => m.id === model)) model = '';
  if (!model && p?.model) model = p.model;
  $('#model-select').innerHTML = items.length ? '<option value="">Choose a model…</option>' + items.map(m => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join('') : '<option value="">Connect a model…</option>';
  $('#model-select').value = model;
  renderProviders();
}
function setBusy(value) {
  busy = value; $('#send').hidden = value; $('#stop').hidden = !value;
  ['#agent-select','#provider-select','#model-select','#context-select','#mcp-enabled'].forEach(s => $(s).disabled = value);
}
function formatContent(value) {
  return String(value || '').split(/(```[\s\S]*?```)/g).map(part => {
    if (part.startsWith('```')) { const content = part.slice(3,-3); const line = content.indexOf('\n'); return `<div class="code-block"><div class="code-language">${esc(line >= 0 ? content.slice(0,line) : 'code')}<button class="copy-code">Copy</button></div><pre><code>${esc(line >= 0 ? content.slice(line+1) : content)}</code></pre></div>`; }
    return `<div class="prose">${esc(part).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')}</div>`;
  }).join('');
}
function renderMessages() {
  const c = conversation(); $('#welcome').hidden = !!c; $('#messages').hidden = !c; if (!c) return;
  const panel = $('#messages'); const bottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100;
  panel.innerHTML = `<div class="chat-heading"><span>${esc(c.title)}</span><div><button id="export-chat" title="Export conversation">Export ↗</button><button id="delete-chat" title="Delete conversation">Delete</button></div></div>` + c.messages.map(m => m.role === 'tool' ? `<details class="tool-result"><summary>✓ ${esc(m.name)} <span>View result</span></summary><pre>${esc(m.content)}</pre></details>` : m.content ? `<article class="message ${esc(m.role)}"><div class="message-avatar">${m.role === 'user' ? 'Y' : '✳'}</div><div class="message-body"><div class="message-label">${m.role === 'user' ? 'You' : 'Agent'}${m.role === 'assistant' ? `<span>${esc(c.model)}</span>` : ''}</div>${formatContent(m.content)}</div></article>` : '').join('') + (streamed ? `<article class="message assistant"><div class="message-avatar">✳</div><div class="message-body"><div class="message-label">Agent <span>Responding</span></div>${formatContent(streamed)}</div></article>` : '');
  if (bottom) panel.scrollTop = panel.scrollHeight;
}
async function loadFiles(next = '.') {
  folder = next; $('#file-breadcrumb').innerHTML = folder !== '.' ? '<button id="parent-folder">← Up one folder</button>' : '';
  if (!project()) { $('#files').innerHTML = '<p class="empty-small">Open a project to browse files.</p>'; return; }
  try { const files = await api('files', { projectId, relative: folder }); $('#files').innerHTML = files.map(f => `<button class="file-entry" data-file="${esc(f.path)}" data-directory="${f.directory}"><span>${f.directory ? '▱' : '≡'}</span>${esc(f.name)}${f.directory ? '<b>›</b>' : ''}</button>`).join('') || '<p class="empty-small">This folder is empty.</p>'; }
  catch (error) { $('#files').innerHTML = `<p class="empty-small">${esc(error.message)}</p>`; }
}
function resetChat(nextProject = projectId) { if (busy) return toast('Stop the current run before starting another conversation.'); conversationId = null; projectId = nextProject || null; useMcp = false; attached = null; $('#attachment').hidden = true; streamed = ''; $('#run-status').textContent = ''; showView('workspace'); render(); loadFiles(); $('#prompt').focus(); }
function agentDialog(id) {
  const a = state.agents.find(a => a.id === id) || { name: '', description: '', system: '', mode: 'read' };
  modal(`<form id="agent-form"><div class="modal-heading"><div><div class="eyebrow">MAKE IT YOUR OWN</div><h2>${id ? 'Edit agent' : 'Create an agent'}</h2></div><button type="button" data-close class="icon-button">×</button></div><div class="form-columns"><label>Name<input name="name" value="${esc(a.name)}" required maxlength="60" placeholder="Frontend specialist"></label><label>Access<select name="mode"><option value="read" ${a.mode === 'read' ? 'selected' : ''}>Read only</option><option value="edit" ${a.mode === 'edit' ? 'selected' : ''}>Edit & commands with approval</option></select></label></div><label>Short description<input name="description" value="${esc(a.description)}" required maxlength="200" placeholder="Build thoughtful, accessible interfaces."></label><label>Agent instructions<textarea name="system" rows="9" required maxlength="20000" placeholder="You are a frontend engineer. Read the project conventions before making changes…">${esc(a.system)}</textarea></label><p class="field-note">Choose this agent and any connected model in the conversation composer.</p><div class="modal-actions">${id ? '<button type="button" id="remove-agent" class="danger-link">Delete agent</button>' : ''}<span></span><button class="primary" type="submit">Save agent</button></div></form>`);
  $('#agent-form').onsubmit = safely(async event => { event.preventDefault(); state = await api('save-agent', { id, ...Object.fromEntries(new FormData(event.target)) }); closeModal(); render(); toast('Agent saved.'); });
  $('#remove-agent')?.addEventListener('click', safely(async () => { state = await api('delete-agent', id); closeModal(); render(); }));
}
function approvalDialog(event) {
  currentApproval = event.id;
  if(event.name.startsWith('computer_')) return computerApproval(event);
  if (event.name === 'mcp_call') {
    modal(`<div class="modal-heading"><div><div class="eyebrow">EXTERNAL TOOL APPROVAL</div><h2>${esc(event.toolName)}</h2></div><span class="tag">${esc(event.serverName)}</span></div><p>Review the arguments being sent to this MCP server.</p><pre class="command-review">${esc(JSON.stringify(event.args, null, 2))}</pre><div class="info-note">This external server may access data or perform actions with its own permissions. Only approve the requested operation if you trust it.</div><div class="modal-actions"><button id="deny-action" class="secondary">Decline</button><span></span><button id="allow-action" class="primary">Approve tool call</button></div>`);
    $('#allow-action').onclick = safely(() => api('approve', { id: event.id, accepted: true })); $('#deny-action').onclick = safely(() => api('approve', { id: event.id, accepted: false })); return;
  }
  const edit = event.name === 'write_file';
  modal(`<div class="modal-heading"><div><div class="eyebrow">YOUR APPROVAL IS NEEDED</div><h2>${edit ? 'Review proposed file change' : 'Review shell command'}</h2></div><span class="tag">${edit ? 'File write' : 'Host command'}</span></div><p class="approval-path">${esc(edit ? event.args.path : event.projectPath)}</p>${edit ? `<div class="diff-columns"><div><h3>Current file</h3><pre>${esc(event.before ?? '(new file)')}</pre></div><div><h3>Proposed file</h3><pre>${esc(event.args.content)}</pre></div></div>` : `<p>${esc(event.args.reason)}</p><pre class="command-review">${esc(event.args.command)}</pre><div class="info-note">Runs as your Linux user in the displayed working folder. This command can access files and the network outside the project. Review it before allowing.</div>`}<div class="modal-actions"><button id="deny-action" class="secondary">Decline</button><span></span><button id="allow-action" class="primary">${edit ? 'Approve change' : 'Run command'}</button></div>`);
  $('#allow-action').onclick = safely(() => api('approve', { id: event.id, accepted: true })); $('#deny-action').onclick = safely(() => api('approve', { id: event.id, accepted: false }));
}
function gettingStarted() {
  modal(`<div class="modal-heading"><div><div class="eyebrow">WELCOME TO AGENT STUDIO</div><h2>From setup to your first task.</h2></div><button data-close class="icon-button">×</button></div><ol class="guide"><li><strong>Connect your models</strong><p>Open Providers → Experiential Labs → Connect. Paste a key from your Experiential dashboard, save, then click Load models.</p></li><li><strong>Open a project</strong><p>Use + next to Projects to select a folder, or Create a project for a new folder.</p></li><li><strong>Choose your agent</strong><p>Builder can propose changes. Reviewer and Planner are read only. Add your own under Agents → Create agent.</p></li><li><strong>Start building</strong><p>Choose a model in the composer and send a task. Review file changes and commands before approving them.</p></li></ol><div class="info-note">Free promotions, account credits and rate limits are managed by Experiential Labs. Check its catalog for current terms.</div><div class="modal-actions"><button data-external="keys" class="secondary">Get API key ↗</button><span></span><button data-external="docs" class="primary">Provider documentation ↗</button></div>`);
}
async function send(event) {
  event?.preventDefault(); if (busy) return; const input = $('#prompt').value.trim(); if (!input) return;
  if (!provider() || !model) { showView('providers'); toast('Connect a provider and load models, or configure a model ID first.'); return; }
  const prompt = attached ? `${input}\n\nAttached file: ${attached.path}\n<file_content>\n${attached.content}\n</file_content>` : input;
  setBusy(true); streamed = ''; runError = ''; $('#run-status').textContent = 'Starting…';
  try { const result = await api('chat', { prompt, providerId, agentId, model, projectId, conversationId, useMcp, computerMode }); state = result.state; conversationId = result.conversationId; $('#prompt').value = ''; attached = null; $('#attachment').hidden = true; render(); }
  catch (error) { setBusy(false); $('#run-status').textContent = ''; throw error; }
}
window.studio.onEvent(event => {
  if (event.type === 'computer-state') { if(state){state.computer=event.computer;renderComputer();} return; }
  if (event.type === 'mcp-state') { if (state) { state.mcpServers = event.servers; if (view === 'settings' && settingsTab === 'mcp') renderSettings(); updateChatContext(); } return; }
  if (event.type === 'approval') return approvalDialog(event);
  if (event.type === 'approval-closed') { if (currentApproval === event.id) { currentApproval = null; $('#modal').close(); } return; }
  if (event.conversationId && event.conversationId !== conversationId) return;
  if (event.type === 'status') $('#run-status').textContent = event.text;
  if (event.type === 'delta') { streamed += event.text; renderMessages(); }
  if (event.type === 'message') { const c = conversation(); c?.messages.push(event.message); streamed = ''; renderMessages(); }
  if (event.type === 'tool-start') $('#run-status').textContent = `${event.name.replaceAll('_',' ')} · ${event.args.path || event.args.query || 'awaiting approval'}`;
  if (event.type === 'run-error') { runError = event.text; $('#run-status').textContent = event.text; toast(event.text); }
  if (event.type === 'done') { state = event.state; streamed = ''; setBusy(false); $('#run-status').textContent = runError || 'Run finished'; render(); loadFiles(folder); }
});
document.addEventListener('click', safely(async event => {
  const el = event.target.closest('button'); if (!el) return; const d = el.dataset;
  if (d.view) { if(d.view==='workspace' && !busy) computerMode=false; if (d.view === 'workspace' && !project()) { if (busy) return toast('Stop the current run before switching modes.'); if (state.projects.length) resetChat(state.projects[0].id); else return addProject(false); } showView(d.view); }
  if (d.external) await api('external', d.external);
  if (d.project) {computerMode=false;resetChat(d.project);}
  if (d.removeProject) { state = await api('remove-project', d.removeProject); if (projectId === d.removeProject) resetChat(state.projects[0]?.id); render(); }
  if (d.conversation) { if (busy) return toast('Stop this run before switching conversations.'); conversationId = d.conversation; const c = conversation(); projectId = c.projectId; providerId = c.providerId; model = c.model; agentId = c.agentId; useMcp = c.useMcp === true; computerMode = c.computerMode === true; streamed = ''; attached = null; $('#attachment').hidden = true; $('#run-status').textContent = ''; showView('workspace'); render(); loadFiles(); }
  if (d.prompt) { $('#prompt').value = d.prompt; if (d.prompt.startsWith('Review')) agentId = state.agents.find(a => a.id === 'reviewer')?.id || agentId; else if (d.prompt.startsWith('Explore')) agentId = state.agents.find(a => a.id === 'planner')?.id || agentId; render(); $('#prompt').focus(); }
  if (d.chatPrompt) { $('#prompt').value = d.chatPrompt; $('#prompt').focus(); }
  if (d.useProvider) { if (busy) return toast('Stop the current run first.'); providerId = d.useProvider; model = provider()?.model || ''; agentId = state.agents.find(a => a.id === 'chat')?.id || agentId; resetChat(null); }
  if (d.settingsTab) { settingsTab = d.settingsTab; renderSettings(); }
  if (d.editMcp) mcpDialog(d.editMcp);
  if (d.connectMcp) { if (busy) return toast('Stop the current run before connecting a server.'); reviewMcpConnection(d.connectMcp); }
  if (d.disconnectMcp) { state = await api('disconnect-mcp', d.disconnectMcp); render(); }
  if (d.featureAction) { if (d.featureAction === 'computer') $('#computer-mode').click(); else if (d.featureAction === 'start-chat') $('#chat-mode').click(); else if (d.featureAction === 'open-project') await addProject(false); else if (d.featureAction === 'mcp') { settingsTab = 'mcp'; renderSettings(); } else if (d.featureAction === 'help') gettingStarted(); else showView(d.featureAction); }
  if (d.editProvider) providerDialog(d.editProvider);
  if (d.refreshProvider) { el.disabled = true; el.textContent = 'Loading…'; try { state = await api('models', d.refreshProvider); providerId = d.refreshProvider; model = provider()?.model || ''; render(); toast('Models loaded. Choose one in your conversation.'); } finally { el.disabled = false; el.textContent = '↻ Load models'; } }
  if (d.editAgent) agentDialog(d.editAgent);
  if (d.useAgent) { if (busy) return toast('Stop the current run before switching agents.'); resetChat(); agentId = d.useAgent; render(); }
  if (d.file) {
    if (d.directory === 'true') return loadFiles(d.file);
    const content = await api('read-file', { projectId, relative: d.file });
    modal(`<div class="modal-heading"><h2>${esc(d.file)}</h2><button data-close class="icon-button">×</button></div><pre class="file-preview">${esc(content)}</pre><div class="modal-actions"><small>Attach to send this file with your next message.</small><span></span><button class="primary" id="attach-file">Attach to message</button></div>`);
    $('#attach-file').onclick = () => { attached = { path: d.file, content }; $('#attachment').hidden = false; $('#attachment').innerHTML = `≡ ${esc(d.file)} <button id="detach-file" aria-label="Remove attachment">×</button>`; closeModal(); showView('workspace'); $('#prompt').focus(); };
  }
  if (el.id === 'detach-file') { attached = null; $('#attachment').hidden = true; }
  if (el.id === 'parent-folder') await loadFiles(folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '.');
  if (el.id === 'export-chat') { if (await api('export-conversation', conversationId)) toast('Conversation exported.'); }
  if (el.id === 'delete-chat') { modal('<h2>Delete this conversation?</h2><p>This removes the locally saved conversation.</p><div class="modal-actions"><button data-close class="secondary">Keep conversation</button><span></span><button id="confirm-delete-chat" class="primary">Delete conversation</button></div>'); }
  if (el.id === 'confirm-delete-chat') { state = await api('delete-conversation', conversationId); closeModal(); resetChat(); }
  if (el.classList.contains('copy-code')) { await navigator.clipboard.writeText(el.closest('.code-block').querySelector('code').textContent); el.textContent = 'Copied'; }
}));
$('#new-chat').onclick = () => resetChat();
$('#computer-mode').onclick = () => { if(busy)return toast('Stop the current run before switching modes.'); computerMode=true;agentId=state.agents.find(a=>a.id==='chat')?.id || agentId;resetChat(null); };
$('#chat-mode').onclick = () => { if (busy) return toast('Stop the current run before switching modes.'); computerMode=false;agentId = state.agents.find(a => a.id === 'chat')?.id || agentId; resetChat(null); };
$('#context-select').onchange = event => {computerMode=false;resetChat(event.target.value || null);};
$('#mcp-enabled').onchange = event => { useMcp = event.target.checked; updateChatContext(); };
$('#new-model').onclick = () => providerDialog(undefined, 'single');
$('#new-agent').onclick = () => agentDialog(); $('#new-provider').onclick = () => providerDialog();
$('#connect-provider').onclick = () => { showView('providers'); providerDialog(providerId); };
$('#help').onclick = gettingStarted;
$('#toggle-files').onclick = () => { filesVisible = !filesVisible; updateChatContext(); };
$('#refresh-files').onclick = () => loadFiles(folder);
$('#reveal-project').onclick = safely(() => projectId && api('reveal-project', projectId));
async function addProject(create) { const result = await api('add-project', { create }); if (result) { state = result.state; resetChat(result.projectId); } }
$('#add-project').onclick = safely(() => addProject(false)); $('#create-project').onclick = safely(() => addProject(true));
$('#composer').onsubmit = safely(send);
$('#prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && (state.settings.sendShortcut === 'enter' || event.ctrlKey || event.metaKey)) { event.preventDefault(); safely(send)(); } };
$('#provider-select').onchange = event => { providerId = event.target.value; model = ''; render(); };
$('#agent-select').onchange = event => { agentId = event.target.value; render(); };
$('#model-select').onchange = event => model = event.target.value;
$('#stop').onclick = safely(() => api('stop'));
$('#modal').addEventListener('cancel', event => { if (currentApproval) { event.preventDefault(); toast('Approve or decline the action, or stop the run.'); } });
document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); resetChat(); } });
safely(async () => { state = await api('state'); projectId = state.settings.startScreen === 'workspace' ? state.projects[0]?.id || null : null; providerId = state.providers[0]?.id; agentId = projectId ? state.agents[0]?.id : state.agents.find(a => a.id === 'chat')?.id || state.agents[0]?.id; render(); await loadFiles(); if (new URLSearchParams(location.search).has('setup')) { showView('providers'); providerDialog(providerId); } })();

$('#settings-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=Array.from(document.querySelectorAll('[data-settings-tab]'));let index=tabs.findIndex(t=>t.dataset.settingsTab===settingsTab);index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;event.preventDefault();settingsTab=tabs[index].dataset.settingsTab;renderSettings();document.querySelector(`[data-settings-tab="${settingsTab}"]`).focus();});
