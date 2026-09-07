# Agent Studio desktop redesign — 0.4.0

The design was produced through the user's local OpenDesign service with Local Codex and integrated into the production Electron renderer. The generator reached its usage limit during final checks after producing its files; the integration was independently verified in the real Electron app.

## Design

Native system typography, neutral light/dark surfaces, teal primary actions, consistent borders and visible keyboard focus make navigation and forms easier to read. Existing chat/code font sizes, reading-font choices and interface scaling remain configurable.

The sidebar keeps Settings in its bottom-left footer while project and conversation lists scroll. Conversation content scrolls independently of the composer. Computer access has a bounded scroll region, and dialogs stay within the viewport. Compact layouts preserve access to sending messages and closing dialogs.

The production override is `src/renderer/studio-redesign.css`, loaded after the original stylesheet and explicitly served by the app's resource allowlist. The OpenDesign browser preview uses a simulated backend and was not copied into the application. No external fonts, remote images or additional runtime dependencies were added.

## Usability

- Settings tabs have associated panels and Left/Right/Home/End keyboard navigation.
- Dialogs have names derived from their headings; close, remove-project and remove-attachment controls have accessible labels.
- Provider forms explain the API base URL and warn that changing it clears the saved key.
- Local loopback connections no longer show an API-key warning merely because they do not require authentication.

Credential handling, command approval, MCP permissions and native computer-control boundaries remain in the existing main-process implementation.

## Validation

The Electron interaction suite passed with an isolated profile and a local mock provider: settings, standalone chat/model setup, logos, command and write approval/decline, MCP discovery and calls, persistence and sandbox isolation.

Automated layout checks covered Chat, Computer and Workspace in light and dark themes at 1440×900, 1020×700, and 1440×900 with 125% scaling. They checked horizontal overflow, the Settings footer, composer visibility, input/send dimensions and connection-dialog scrolling. Browser canvas color sampling verified readable dark-theme text contrast. Chat, Computer and Settings screenshots were visually reviewed.

These checks do not validate live provider billing or real desktop mouse/keyboard control. Native screen sharing still requires the user's Linux permission dialog. No real provider keys or paid inference requests were used for integration testing.
