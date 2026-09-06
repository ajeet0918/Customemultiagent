const fs = require('node:fs');
const path = require('node:path');
const { randomUUID: uid } = require('node:crypto');
const defaultAgents = () => [
  { id: 'builder', name: 'Builder', description: 'Turn an idea into working code.', icon: '◇', mode: 'edit', system: 'You are a careful coding agent. Inspect the project before making changes. Implement complete working solutions, explain your changes and validate them. Use tools when needed. Never claim an action happened unless its tool succeeded.' },
  { id: 'reviewer', name: 'Reviewer', description: 'Find bugs, risks, and missing tests.', icon: '◎', mode: 'read', system: 'You are a code reviewer. Read relevant files and identify concrete bugs and regressions. Prioritize actionable findings, explain impact and cite file paths. You have read-only access.' },
  { id: 'planner', name: 'Planner', description: 'Explore a codebase. Shape the next step.', icon: '⌘', mode: 'read', system: 'You are a software architect. Inspect the project, explain its structure, and create practical implementation plans with clear tradeoffs. You have read-only access.' }
];
class Store {
  constructor(dir, initialProject) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'workspace.json');
    if (fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch { throw new Error(`Cannot read workspace data at ${this.file}. Preserve the file and restore a backup before restarting.`); }
    } else {
      this.data = { version: 1, providers: [{ id: 'experiential', name: 'Experiential Labs', baseUrl: 'https://api.experientiallabs.ai/v1', envKey: 'EXPLABS_API_KEY', models: [], model: '', tools: true }], agents: defaultAgents(), projects: initialProject ? [{ id: uid(), name: path.basename(initialProject), path: initialProject }] : [], conversations: [] };
      this.save();
    }
  }
  save() { const temp = `${this.file}.tmp`; fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file); }
  get(collection, id) { const result = this.data[collection].find(item => item.id === id); if (!result) throw new Error(`${collection} entry not found.`); return result; }
}
module.exports = { Store, uid };
