# PixelCrew for Windows

## Install and upgrade

Download the Windows x64 installer from [PixelCrew Releases](https://github.com/Zenonia-9/pixelcrew/releases). Install and sign in to Codex separately, or connect your account under **Settings → Account**. Install [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if prompted.

Setup can install for your Windows account or for all users. The all-users option requires administrator approval. For upgrades, choose **Quit PixelCrew** from the notification area first, then run the new installer over the existing installation.

## Open, close, and keep your data

Open PixelCrew from Start or the optional desktop shortcut. Closing the window sends it to the notification area and active work can continue. Reopen from Start or choose **Open PixelCrew** from the tray icon. **Quit PixelCrew** stops the service and asks before interrupting active tasks.

Each Windows user has separate data in `%LOCALAPPDATA%\PixelCrew`. Back it up while PixelCrew is stopped. Uninstall through Windows Settings and choose **No** when asked to remove your data if you plan to reinstall. PixelCrew keeps your Codex sign-in and global configuration separate.

## Chats, Projects, and the composer

Click the PixelCrew logo to return to the office. Use **Chats** to search conversations or start a new chat. Use **Projects** to open or fold a project's chat list, pin projects, or start a chat in a workspace. On narrow windows, use the Chats or Projects control to return to the list.

When a chat is working, the composer shows a square to interrupt. Type a follow-up to switch it to Send. Enter uses the **Settings → General** follow-up preference, Ctrl+Enter uses the opposite behavior, and Shift+Enter inserts a newline. After interruption, clear the draft and select the Resume triangle to continue the same conversation with the original account. Resume sends no user message.

## In-app Browser

Use the Browser icon to open the panel yourself. Agent Browser access starts off. Turn on **Allow agents to use Browser** under **Settings → General**, then select Browser in the chat. Each chat uses an isolated browser profile. Hiding the panel keeps its tabs available.

**Approve for me** skips prompts for hover, click, type, and drag when that approval mode applies. Opening a site and resetting Browser still ask for approval. Turn off agent access in Settings to block further agent Browser calls.
