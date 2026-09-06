const fs = require('node:fs');
const path = require('node:path');
class Vault {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'secrets.json'); this.safeStorage = safeStorage; this.session = new Map();
    this.encrypted = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  secure() { return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend() !== 'basic_text'; }
  get(provider) {
    if (this.session.has(provider.id)) return this.session.get(provider.id);
    if (this.encrypted[provider.id] && this.secure()) {
      try { return this.safeStorage.decryptString(Buffer.from(this.encrypted[provider.id], 'base64')); } catch { return ''; }
    }
    return provider.envKey ? process.env[provider.envKey] || '' : '';
  }
  set(id, key) {
    this.session.set(id, key); delete this.encrypted[id];
    if (key && this.secure()) this.encrypted[id] = this.safeStorage.encryptString(key).toString('base64');
    const temporary = this.file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(this.encrypted), { mode: 0o600 }); fs.renameSync(temporary, this.file);
  }
}
module.exports = { Vault };
