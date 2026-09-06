# Agent Studio
Linux Electron application. Main process owns secrets, networking and filesystem access. Renderer is sandboxed and uses only the allowlisted preload API.
- `npm test` checks provider streaming, workspace boundaries and the agent loop.
- `npm run check` checks JavaScript syntax.
- `npm run test:desktop` runs the desktop integration test in an isolated profile.
- `npm start` starts the application.
- Never put API keys into source, logs, renderer state, or test fixtures.
- Preserve explicit approval for every agent write and shell command. Read-only agents must never receive write or command tools.
- Model IDs come from the provider catalog or an explicit user entry. Do not claim a model is free without provider evidence.
- Keep dependencies minimal. Node built-ins power the backend; HTML/CSS/JS power the UI.
