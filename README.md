# Agent Studio

A Linux desktop workspace for coding with multiple AI models. Bring an Experiential Labs API key or another OpenAI-compatible server, open a project, and work with custom agents.

![Agent Studio desktop](docs/desktop-preview.png)

## Run

Requires Linux x64 (or a matching Electron build), Node.js 22 or newer, npm, and a graphical desktop.

```bash
cd /home/ajeet/Desktop/Project/agent-studio
npm install
npm start
```

Electron downloads its runtime on the first launch if it is not already installed. If your package installation disables lifecycle scripts, this is supported; `node node_modules/electron/install.js` also downloads it explicitly.

A Linux application-menu launcher is installed as **Agent Studio** on this machine. To install it on another checkout, run `npm run install:launcher`.

The packaged build does not require Node.js. Extract the archive in `dist/` and run its `agent-studio` executable. Keep the executable alongside all the other extracted runtime files.

## Connect Experiential Labs

1. Sign in to [Experiential Labs API keys](https://platform.experientiallabs.ai/api-keys?section=keys) and create a key. Keep the full key private.
2. In Agent Studio, open **Providers → Experiential Labs → Connect**.
3. Keep the base URL as `https://api.experientiallabs.ai/v1` and paste the key into **API key**.
4. Click **Save connection**, then **Load models**. This calls `GET /v1/models`; it does not submit a completion.
5. Return to **Workspace**. Select an agent, provider, and model in the composer. Send a small first task to verify inference on your account.

You can alternatively provide `EXPLABS_API_KEY` in the environment of the process launching Agent Studio. For a temporary terminal session without putting the key in shell history:

```bash
read -rs -p 'Experiential API key: ' EXPLABS_API_KEY
export EXPLABS_API_KEY
npm start
unset EXPLABS_API_KEY
```

The application uses Bearer authentication and `POST /v1/chat/completions` with streaming and tool calls. Provider credentials are handled in the main process. They are not returned in renderer state or written to the repository.

Official references: [core API workflow](https://platform.experientiallabs.ai/docs/core-loop), [model catalog](https://platform.experientiallabs.ai/docs/models), [coding agent integrations](https://platform.experientiallabs.ai/docs/coding-agents).

### Free models and usage

Experiential Labs currently advertises free promotions on some models, including [GPT-6 Astra](https://platform.experientiallabs.ai/models/gpt-6-astra) when checked on September 6, 2026. Free promotions, account eligibility, regions, quotas and routing can change. The app does **not** enforce free-only billing and does not label an entire provider as free. Review the selected model's current catalog page and configure any spending limits in your provider account before using it. A model appearing in `/v1/models` does not prove that a completion is free or available in your region.

If a model does not support tools, edit the provider and disable **Enable agent tools** for chat-only requests. You can add a second provider profile pointing at the same base URL if you want separate chat-only and tool-enabled configurations.

## Add your own agents

1. Open **Agents → Create agent**.
2. Give it a name and a short description.
3. Select **Read only** or **Edit & commands with approval**.
4. Write its instructions and click **Save agent**.
5. Click **Start a conversation** on its card, then choose your model.

Example instructions for a frontend specialist:

```text
You are a frontend engineer. Read the project's existing components and conventions
before proposing changes. Build accessible, responsive interfaces. Keep changes
focused on the requested feature, and validate the result using the project's
available checks. Explain what changed and any remaining limitations.
```

Included agents:

| Agent | Purpose | Access |
| --- | --- | --- |
| Builder | Implement and validate code changes | Read, propose writes, request commands |
| Reviewer | Identify bugs and missing tests | Read only |
| Planner | Understand architecture and plan work | Read only |

Agent definitions live locally in this app. Experiential Labs supplies model inference; creating an agent here does not register a hosted agent in its dashboard. The selected model must support OpenAI-compatible tool calling to use file and command tools.

## Projects and conversations

- **+ next to Projects** opens an existing folder.
- **Create a project** creates a new folder and README.
- The development build includes this source project in its own sidebar on first launch.
- Click a project file to preview it. **Attach to message** explicitly sends that content with your next message.
- Agents can list directories, read text, search files, propose complete file changes, and request shell commands.
- Every agent write presents current and proposed content for review. Every command presents its exact text and working directory before execution.
- **Stop** cancels network activity and terminates an active command's process group.
- Conversations persist across restarts. Use **Export** for Markdown or **Delete** to remove a conversation.
- **Ctrl+N** starts a conversation. **Enter** sends; **Shift+Enter** adds a line.

To add this source folder as a project in the **Codex desktop app**, use Codex's **Add project / Open folder** control and select `/home/ajeet/Desktop/Project/agent-studio`. Agent Studio and Codex maintain separate project lists.

## Other providers

Use **Providers → Add provider** and choose a preset or enter a compatible URL:

- Experiential Labs: `https://api.experientiallabs.ai/v1`
- Ollama: `http://localhost:11434/v1` (start your local server separately)
- LM Studio: `http://localhost:1234/v1` (start its local server separately)
- Custom gateway: its HTTPS OpenAI-compatible `/v1` base URL

Discover models or enter an exact model ID manually. Remote HTTP URLs and redirects are rejected to protect API credentials. Direct native Anthropic/Gemini API protocols are not implemented; use those models through a compatible gateway.

## Storage and execution boundaries

Settings, custom agents, projects and conversation history are stored in Electron's user-data folder (shown on the Providers page; normally `~/.config/Agent Studio`). Override it with `AGENT_STUDIO_DATA_DIR` for an isolated profile.

API keys use Electron `safeStorage` when a secure Linux keyring is available. If the selected backend is `basic_text` or the keyring is unavailable, keys entered in the UI stay in memory for the current session only. Environment variables work across launches when exported by the launcher. Clearing a key removes the stored credential and suppresses it for the current session; remove an exported environment variable too if you do not want it to return next launch.

The renderer has context isolation, sandboxing, no Node integration, a restrictive Content Security Policy, a narrow IPC bridge, no remote content, and denied navigation/popups. Model responses are escaped before display. Tool paths must stay inside the chosen project; symlinks, common credential filenames, `.env` files and dependency/build directories are excluded. Text files are limited to 200 KB and searches are bounded.

Approved shell commands run with **your Linux user's permissions**, not in an OS sandbox. They can reach outside the project and access the network. Inherited variables with common secret-related names are filtered, but this is not comprehensive secret isolation. Commands time out after 60 seconds and have bounded output. Use read-only agents when you want no write or command capability. The file tool path checks are not a defense against another local process deliberately racing filesystem changes.

Source files that an agent reads are sent to the selected model provider as task context. Review the provider's retention policy if that matters for a project. Nothing is sent merely by opening a project.

## Development and packaging

```bash
npm run check          # Syntax validation
npm test               # Unit and local mock-provider integration tests
npm run test:desktop   # Actual Electron UI, isolated profile, local mock gateway
npm run package        # Portable Linux executable directory and .tar.gz
```

Desktop tests require a graphical session. On a headless Linux CI runner with Xvfb installed, use `xvfb-run -a npm run test:desktop`. The test suite uses no real provider keys or paid model calls.

```text
src/main.cjs             Electron lifecycle and validated IPC handlers
src/preload.cjs          Allowlisted renderer API
src/core/provider.cjs    Model discovery and streaming chat adapter
src/core/agent.cjs       Bounded tool-call loop and approval gates
src/core/workspace.cjs   Project file tools and command execution
src/core/store.cjs       Atomic local workspace persistence
src/core/vault.cjs       OS-backed credential encryption / session fallback
src/renderer/            Desktop interface
scripts/                 Checks, desktop integration and Linux packaging
```

The current release runs one agent task at a time and has a 12-round tool limit. It does not include multi-agent orchestration, terminal emulation, automatic updates, MCP plugins, inline editor editing, or Git worktree management. This is an independent application; it does not embed OpenAI Codex or inherit Codex account access.

## Troubleshooting

- **401:** verify or replace the provider key.
- **402:** inspect your provider balance or allowance.
- **403:** inspect model permissions and supported region.
- **429:** wait for the provider's rate limit to reset.
- **No models:** verify the base URL and key; use an exact manual model ID if the server has no model-list endpoint.
- **Unsupported tools:** disable tools for that provider profile, or select a model that supports them.
- **Context too long:** start a fresh conversation; automatic context compaction is not implemented.
- **Linux sandbox error:** enable the distribution's supported Chromium/Electron user-namespace or sandbox configuration. The launcher deliberately does not disable Chromium's sandbox.
