function validateBaseUrl(value) {
  const url = new URL(String(value));
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a base URL without credentials, query parameters, or fragments.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Providers must use HTTPS; local servers may use HTTP.');
  return url.href.replace(/\/+$/, '');
}
function headers(key) { return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }; }
async function request(provider, key, endpoint, options = {}) {
  const response = await fetch(`${validateBaseUrl(provider.baseUrl)}${endpoint}`, { ...options, redirect: 'error', headers: headers(key), signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(30000) });
  if (!response.ok) {
    const raw = await response.text();
    let detail; try { const value = JSON.parse(raw); detail = value.error?.message || value.message; } catch {}
    const hints = { 401: 'Check your API key in Providers.', 402: 'Check your provider balance or free-tier allowance.', 403: 'Check account permissions, model access, and supported region.', 429: 'The provider rate limit was reached. Try again later.' };
    let message = String(detail || hints[response.status] || response.statusText).slice(0, 700);
    if (key) message = message.split(key).join('[redacted]');
    throw new Error(`Provider ${response.status}: ${message}`);
  }
  return response;
}
async function listModels(provider, key) {
  let body;
  try { body = await (await request(provider, key, '/models')).json(); }
  catch (error) { if (key) error.message = error.message.split(key).join('[redacted]'); throw error; }
  if (!Array.isArray(body.data)) throw new Error('Unexpected model catalog. You can enter a model ID manually.');
  return body.data.filter(m => typeof m.id === 'string').map(m => ({ id: m.id, owner: String(m.owned_by || '') })).sort((a,b) => a.id.localeCompare(b.id));
}
async function* sseEvents(body) {
  const decoder = new TextDecoder(); let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }); let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  const data = buffer.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
  if (data) yield data;
}
async function completion({ provider, key, model, messages, tools, signal, onDelta = () => {} }) {
  const response = await request(provider, key, '/chat/completions', { method: 'POST', signal, body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}) }) });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const body = await response.json(); if (body.error) throw new Error(String(body.error.message || 'Provider error'));
    const message = body.choices?.[0]?.message; if (!message) throw new Error('Provider returned no assistant message.');
    if (message.content) onDelta(message.content); return { ...message, usage: body.usage };
  }
  let content = '', usage, finished = false; const calls = new Map();
  for await (const data of sseEvents(response.body)) {
    if (data === '[DONE]') { finished = true; break; }
    const packet = JSON.parse(data); if (packet.error) throw new Error(String(packet.error.message || 'Provider stream error'));
    if (packet.usage) usage = packet.usage;
    const choice = packet.choices?.[0]; if (choice?.finish_reason) finished = true;
    const delta = choice?.delta; if (!delta) continue;
    if (typeof delta.content === 'string') { content += delta.content; onDelta(delta.content); }
    for (const call of delta.tool_calls || []) {
      const entry = calls.get(call.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.function.name += call.function.name;
      if (call.function?.arguments) entry.function.arguments += call.function.arguments;
      calls.set(call.index, entry);
    }
  }
  if (!finished) throw new Error('The provider stream ended early. Retry the request.');
  return { role: 'assistant', content: content || null, ...(calls.size ? { tool_calls: [...calls.values()] } : {}), usage };
}
module.exports = { validateBaseUrl, listModels, completion, sseEvents };
