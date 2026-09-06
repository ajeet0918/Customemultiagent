const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ignored = new Set(['.git', 'node_modules', '.runtime', 'dist', 'build', '.next', '.venv', '__pycache__', '.ssh', '.aws', '.gnupg']);
function sensitive(value) { return value.split(/[\\/]/).some(p => ignored.has(p) || /^\.env(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p) || /^(credentials|id_rsa|id_ed25519)$/i.test(p)); }
async function resolveSafe(root, relative = '.', writing = false) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Use a relative project path.');
  if (sensitive(relative)) throw new Error('This path is excluded from agent access.');
  const realRoot = await fs.realpath(root); const target = path.resolve(realRoot, relative);
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new Error('Path is outside the project.');
  const parts = path.relative(realRoot, target).split(path.sep).filter(Boolean); let current = realRoot;
  for (const part of parts) {
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('Symbolic links are excluded from agent access.'); }
    catch (error) { if (writing && error.code === 'ENOENT') continue; throw error; }
  }
  return target;
}
async function listFiles(root, relative = '.') {
  const entries = await fs.readdir(await resolveSafe(root, relative), { withFileTypes: true });
  return entries.filter(e => !sensitive(e.name) && !e.isSymbolicLink()).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0, 500).map(e => ({ name: e.name, path: path.posix.join(relative, e.name), directory: e.isDirectory() }));
}
async function readFile(root, relative) {
  const file = await resolveSafe(root, relative); const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 200000) throw new Error('Choose a text file smaller than 200 KB.');
  const data = await fs.readFile(file); if (data.includes(0)) throw new Error('Binary files cannot be read as text.'); return data.toString('utf8');
}
async function writeFile(root, relative, content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 200000) throw new Error('File content must be text smaller than 200 KB.');
  const file = await resolveSafe(root, relative, true); await fs.mkdir(path.dirname(file), { recursive: true }); await resolveSafe(root, relative, true); await fs.writeFile(file, content); return `Saved ${relative}`;
}
async function searchFiles(root, query, relative = '.') {
  if (typeof query !== 'string' || !query.length) throw new Error('Provide a search string.');
  const matches = []; let visited = 0;
  async function walk(dir, depth) {
    if (depth > 8 || visited > 1500 || matches.length >= 80) return;
    for (const entry of await listFiles(root, dir)) {
      if (++visited > 1500 || matches.length >= 80) break;
      if (entry.directory) await walk(entry.path, depth + 1);
      else { try { const text = await readFile(root, entry.path); text.split('\n').forEach((line, index) => { if (matches.length < 80 && line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: entry.path, line: index + 1, text: line.slice(0,400) }); }); } catch {} }
    }
  }
  await walk(relative, 0); return matches;
}
function runCommand(root, command, signal) {
  if (typeof command !== 'string' || !command.trim() || command.length > 10000) throw new Error('Invalid shell command.');
  return new Promise((resolve, reject) => {
    // Explicitly approved shell commands are NOT a filesystem sandbox.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, capped = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 60000);
    const collect = chunk => { if (output.length < 64000) output += chunk.toString().slice(0, 64000 - output.length); else if (!capped) { capped = true; stop(); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(error); });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve({ code, output, timedOut, capped, cancelled: !!signal?.aborted }); });
  });
}
module.exports = { resolveSafe, listFiles, readFile, writeFile, searchFiles, runCommand };
