# PixelCrew Windows guide

## 1. Install and open PixelCrew

Install [PixelCrew from Microsoft Store](https://apps.microsoft.com/detail/9MSPKZ7CZ3W1) and open it from Start. If PixelCrew reports that WebView2 is missing, install the [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## 2. Connect a Codex account

PixelCrew includes the Codex runtime, so you do not need to install Codex separately. To add an account, open **Settings → Account**, choose **Add account**, then select **ChatGPT** or **PixelCrew plan**. If you already use Codex, choose **Connect to Codex** to use that connection and **Sync from Codex** in Chats to import its conversations.

Complete authorization in your default browser and return to PixelCrew. If the browser did not open, use **Open sign-in again** to retry the same attempt. Use the account menu to switch accounts. Work in progress keeps its original account.

## 3. Work with agents

Use **Projects** to open a workspace, search and pin projects, or expand a project's chat list. Use **Chats** to search or start a conversation. Choose **Team** to coordinate specialists, **Plan** to investigate read-only, **Normal** to work directly with Codex, or **Goal** for an ongoing objective.

Follow specialist progress, handoffs, and results in the conversation. Approve requests or answer questions when the crew needs a decision. While a turn is running, the square interrupts it. Typing a draft switches the square to Send. After an interruption, clear the draft to show the Resume triangle. It continues in the same conversation.

| Shortcut | Behavior |
| --- | --- |
| Enter | Sends the message with your configured follow-up preference |
| Ctrl+Enter | Uses the opposite follow-up behavior for this message |
| Shift+Enter | Starts a new line |

Set your default follow-up preference in **Settings → General**.

## 4. Work with the in-app Browser

Use the Browser icon to open or hide the panel. Agent access starts off. To grant access, enable **Allow agents to use Browser** under **Settings → General** and select Browser in the chat. Each chat uses an isolated browser profile.

**Approve for me** skips prompts for hover, click, type, and drag when that approval mode applies. Opening a site and resetting Browser still ask. Turn off agent access in Settings to block further agent Browser calls.

![PixelCrew Team conversation and the in-app Browser displaying the workshop guide](https://zenonia-9.github.io/pixelcrew/browser.png)

## 5. Updates, backups, and migration

Microsoft Store manages updates. Closing the window sends PixelCrew to the tray, where work can continue. Choose **Quit PixelCrew** when you need to stop it completely.

To move supported data to another device, open **Settings → Data → Device Transfer** and choose **Export .pxc**. On the other device, sign in, choose **Import .pxc**, review the preview, select replacement folders for any missing workspaces, and confirm. The transfer includes projects, conversation history, memories, and supported settings; credentials and browser sessions are excluded. Imported history is available as read-only copies. Keep the transfer file somewhere secure.

Moving from a standalone copy? Back up your data if that build supports it, quit the old copy, install the Store edition, and restore the backup. Confirm your data is recoverable before removing the old copy or its profile. If your standalone build has no backup control, keep its profile.

Store v1.2.2 normally keeps projects, chats, and memories under `%USERPROFILE%\.pixelcrew`, including after uninstall. Older custom Store profile locations remain in use. Sign-ins and browser sessions are stored separately in package data, so you may need to sign in again after reinstalling. Export important data before removing or resetting the app, and remember that separately saved transfer files remain where you saved them.
