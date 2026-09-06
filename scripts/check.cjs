const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let checked = 0;
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(cjs|js)$/.test(file)) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status) process.exit(result.status); checked++; } } }
['src', 'scripts', 'tests'].forEach(walk); console.log(`Syntax checked ${checked} JavaScript files.`);
