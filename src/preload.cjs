const { contextBridge, ipcRenderer } = require('electron');
const channels = ['save-settings', 'pick-provider-logo', 'pick-executable', 'save-mcp', 'connect-mcp', 'disconnect-mcp', 'delete-mcp', 'state', 'save-provider', 'delete-provider', 'models', 'save-agent', 'delete-agent', 'add-project', 'remove-project', 'files', 'read-file', 'reveal-project', 'delete-conversation', 'export-conversation', 'approve', 'stop', 'external', 'chat'];
contextBridge.exposeInMainWorld('studio', {
  invoke: (channel, data) => { if (!channels.includes(channel)) return Promise.reject(new Error('Unknown action.')); return ipcRenderer.invoke(`studio:${channel}`, data); },
  onEvent: callback => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('studio:event', listener); return () => ipcRenderer.removeListener('studio:event', listener); }
});
