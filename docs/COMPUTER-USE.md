# Computer mode

Choose **Computer** in the sidebar. No project folder is required.

## Terminal tasks

Select a model connection with **Allow agent tools** enabled and an agent with editing access (Chat companion or Builder). Ask for a terminal task, such as checking the Linux version or Git status. Review the proposed command and working directory before approving it. Without a project, commands start in your home directory. They run as your Linux user, can access the host and network, and are limited to 60 seconds with bounded output. This is command execution, not an interactive terminal emulator.

## Visual desktop tasks

Choose **Connect screen**, then continue to the Linux permission dialog. Share one monitor and allow keyboard and mouse access. The portal session stays local; only a screenshot you approve is sent to your selected model. Use a model that supports both image input and tool calling through its Chat Completions API.

The agent can request a screenshot, move/click the pointer, scroll, type text, and press keys or shortcuts. Each screenshot and action requires approval. Studio minimizes before executing a desktop operation; put the intended application behind it before approving. The app restores when the run finishes or when another approval needs attention.

**Stop sharing** remains in Studio's header while connected and terminates sharing plus the active agent run. The desktop's own screen-sharing indicator can also end the session. Stopping an in-progress mouse/keyboard operation disconnects the desktop helper. Screen permission never resumes automatically after restarting Studio. Read-only agents cannot control the desktop.

Screen images are transient and are not saved in chat history or exports. Tool arguments and textual results are saved, so never ask the agent to type passwords or private keys. API credentials stay in the key vault and are excluded from the desktop helper's environment. The model can see only screenshots actually approved in the current run.

## Linux dependencies

Requires a desktop implementing the XDG Remote Desktop and ScreenCast portals (including a compatible portal backend), Python 3, PyGObject, GStreamer, and PipeWire. On Ubuntu/Debian:

```bash
sudo apt install python3-gi gir1.2-gstreamer-1.0 gstreamer1.0-pipewire gstreamer1.0-plugins-good
```

This installation command does not select or configure your desktop's portal backend. Unsupported desktops report a connection error. Windows/macOS, multi-monitor control, drag gestures, browser DOM tools, and clipboard transfer are not included in this release. Typing uses keyboard events; unusual keyboard layouts or apps may require a different input method.

Protocol reference: [XDG Remote Desktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html).

## Verification

The release is covered by backend tests, isolated Electron UI tests, and native helper protocol tests (`/usr/bin/python3 tests/native_portal_test.py`). The native tests verify the D-Bus response callback, monitor coordinate scaling, and keyboard modifier release without controlling the desktop. A real desktop session creation/closure check passed on the development machine. Full input control still needs a user-approved screen-sharing session on the target desktop.
