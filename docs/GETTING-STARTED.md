# Start using Agent Studio

1. Run `./launch.sh` from this project, or launch the packaged `agent-studio` executable.
2. Go to **Providers → Experiential Labs → Connect**.
3. Paste your API key from https://platform.experientiallabs.ai/api-keys?section=keys.
4. Save, then click **Load models**.
5. Open a project folder using the **+** button next to Projects.
6. Select **Builder**, a model, and send a task.
7. Review and approve each proposed file change or command.

To add agents: **Agents → Create agent → write instructions → select access → Save agent**.

Check current free-model promotions and usage caps in the Experiential Labs catalog. This app does not enforce free-only billing.

To add the source project to Codex itself: **Add project / Open folder → `/home/ajeet/Desktop/Project/agent-studio`**.

## New features in 0.2.0

- **Chat:** a standalone conversation without a project. Select a model and start talking.
- **Providers → Add standalone model:** enter a display name, exact model ID, compatible API base URL and key. No catalog lookup is required.
- **Connection logos:** choose a colored badge or upload a PNG, JPEG or WebP image under 250 KB.
- **Settings → Appearance:** font sizes, reading font, theme, interface scale and reduced motion. Preview, then Save preferences.
- **Settings → Chat & behavior:** startup mode and Enter versus Ctrl/Command+Enter to send.
- **Settings → Features & help:** an overview and shortcuts to each feature.
- **Settings → MCP connections:** add a local executable or Streamable HTTP endpoint, review and Connect, then inspect the tools. Enable MCP in a conversation when needed. Each tool call requires approval; read-only agents cannot call MCP tools.

MCP servers must already be installed or hosted. Browser OAuth, legacy SSE-only servers, MCP resource browsing and prompt templates are not supported yet. Secrets use the same keyring/session-only storage as model API keys.

After updating, restart Agent Studio. Existing projects, keys, agents and conversations are retained.
