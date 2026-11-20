# PixelCrew 1.0.0 for Windows x64

This is the first public Windows release of PixelCrew, a desktop workspace for coordinating Codex agents.

## What's included

- A pixel-art office for choosing a crew and tracking specialist activity, assignments, and handoffs.
- Team, Plan, Normal, and Goal workflows with docked Chats and Projects.
- One composer control for sending, interrupting, and resuming a conversation. Ctrl+Enter reverses the configured follow-up behavior.
- A docked Browser with isolated chat profiles, opt-in agent access, and permission-based prompts.
- Account authorization in your default browser and a retry control for the same sign-in attempt.
- A Windows installer with a bundled user guide, PixelCrew license, and third-party notices.

## Download and verification

Download PixelCrew-1.0.0-windows-x64-setup.exe and compare its SHA-256 with the accompanying checksum. The installer is unsigned. See the [Windows guide](docs/USER-GUIDE.md) for prerequisites, upgrades, and data retention.

The build, unit tests, and packaged WebView2 checks passed with fixture data. A completed sign-in with a test account, clean install, in-place upgrade, and uninstall with data preserved are pending on isolated Windows.

Private build commit $build.
