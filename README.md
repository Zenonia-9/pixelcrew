<div align="center">

# PixelCrew

**A pixel-art workspace for planning and doing work with Codex.**

Build a crew, give them a shared task, and follow the work in chat, on the task board, and around the office.

<a href="#features">Features</a> · <a href="#quick-start">Quick start</a> · <a href="#service-menu">Service menu</a> · <a href="docs/USER-GUIDE.md">Windows guide</a>

<br />

<img src="https://raw.githubusercontent.com/Zenonia-9/pixelcrew/release/1.0/docs/images/pixelcrew-office.png" alt="PixelCrew's pixel-art office with its team and room areas" width="900" />

</div>

## Features

- **Choose a work mode:** Team coordinates specialist work, Plan researches without editing files, Normal opens a direct Codex chat, and Goal keeps an objective with a conversation.
- **Organize a crew:** Create teams with distinct names, roles, profiles, and office layouts. General Team includes Atlas, Pip, Bolt, Mira, and Nova; a Security team is also available.
- **Keep work together:** Choose a project or workspace, continue existing chats, steer a running response, or queue a follow-up.
- **Follow progress:** See assignments, questions, approvals, and results on the task board. Separate tasks can run concurrently when workspace access permits.
- **Personalize your office:** Arrange characters, desks, furniture, wall sections, doors, and windows; choose a room plan and office colors.
- **Set how Codex works:** Choose available models, reasoning effort, and approval settings for each task.

## Quick start

### Requirements

- Windows
- Node.js 24 or newer
- Codex installed and available on your `PATH`
- A ChatGPT account available through Codex, or an account connected in PixelCrew

### Install and run

From the PixelCrew folder:

```sh
npm install
npm run build
npm run service --open
```

The launcher starts PixelCrew and opens an authenticated browser session at [127.0.0.1:4318](http://127.0.0.1:4318). The service runs in the foreground; press **Ctrl+C** in its terminal to stop it. Add `--detach` to run it in the background.

On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks the script.

## Service menu

Run the interactive controller when you want to choose an action from a menu:

```sh
npm run service -- menu
```

Choose `open`, `start`, `status`, `stop`, or `restart`. The menu stays available for another action until you choose `quit`.

Other service commands:

```sh
npm run service -- status
npm run service -- stop
npm run service -- restart --open
```

## Start work

1. Select a project or enter a workspace folder.
2. Choose **New task** and select Team, Plan, Normal, or Goal.
3. Describe the work and add acceptance criteria or file references if needed.
4. Choose the approval policy and send the task.
5. Follow the conversation or task board, answer questions, and review approval requests.

Plan mode is read-only. Other modes can edit workspace files when their permission settings allow it. A running task keeps the account it started with; another saved account can continue the same chat after it finishes.

## Accounts and local data

Connect accounts from **Settings → Account**. Desktop Codex uses the sign-in already configured on your computer. PixelCrew can also keep separate saved accounts, which you can switch without replacing the desktop sign-in.

PixelCrew runs locally and stores task history, team profiles, settings, workspace paths, and saved account data on your computer. Keep the app data directory private; it may include prompts, responses, and credentials. Review the selected workspace and task permissions before starting work.

For Windows setup, account details, backups, and recovery, see the [Windows user guide](docs/USER-GUIDE.md).
