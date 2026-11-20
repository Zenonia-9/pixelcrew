# PixelCrew Windows x64 v1.0.0-rc.2

This prerelease introduces the native Windows installer and in-app Browser. See the [Windows guide](docs/USER-GUIDE.md) for setup and upgrade steps.

- Docked Chats and Projects with search, project pinning, and collapsible chat lists.
- A shared Send, Interrupt, and Resume button. Ctrl+Enter reverses the configured follow-up behavior.
- In-app Browser with isolated profiles and a global agent access switch. Approve for me skips prompts for hover, click, type, and drag. Opening a site and resetting Browser still require approval.
- Closing to the notification area keeps the workspace and browser tabs available.

The Windows installer is unsigned. Verify the installer SHA-256 against the accompanying checksum file.

The automated build and test suite passed. Clean installation, in-place upgrade, and uninstall data retention still require validation on an isolated Windows system.

Private source build commit is e080ca55d5831a4e62f8a1fa151aa2b5c110316b.
