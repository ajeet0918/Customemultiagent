# Agent Studio 0.2.0

Settings and standalone chat make the application useful beyond project coding. Connect one model directly, adjust the reading experience, or opt in to trusted MCP tools.

## Included

- Persistent appearance and conversation preferences with a live font/theme preview.
- Standalone chat, a Chat companion agent, and an explicit project-context selector.
- Single-model connections with API keys; catalog discovery is optional.
- Colored connection badges and local custom-logo upload.
- MCP stdio / Streamable HTTP connections, tool discovery, per-conversation opt-in and per-call approvals.
- An in-app feature overview and updated setup documentation.
- Existing workspace migration, with user data and credentials preserved.

## Validation

The automated suite covers preferences, migration, standalone access boundaries, MCP stdio and HTTP requests, credential handling, approvals, read-only access, connection cancellation, redirects, and the original coding tools. The isolated desktop test exercises actual UI forms, theme contrast, font previews, logos, standalone chat, MCP approvals, file writes and restart persistence.

Live third-party model or MCP accounts are not exercised by these tests. Native non-compatible model APIs, MCP OAuth/resource browsing/prompts, and automatic updates are outside this release.
