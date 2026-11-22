# PixelCrew Privacy Policy

**Effective date: November 22, 2026**

PixelCrew is a Windows desktop workspace for coordinating coding agents through the Codex App Server. This policy explains what PixelCrew stores, when information leaves your device, and the choices available to you.

## Information PixelCrew handles

PixelCrew stores app data on your Windows device. Depending on the features you use, this can include project and chat names, prompts and responses, task and approval history, settings, selected attachments, usage summaries read from Codex history, account profile labels, and in-app browser data such as cookies and site storage. The app stores this information in your Windows user profile. The Store and standalone installer editions use separate data locations.

PixelCrew does not operate a cloud service that receives or stores your chat history, project files, or attachments. The desktop app does not use advertising or intentionally send chat content or diagnostic reports to PixelCrew servers. The standalone edition can contact GitHub to check for stable app updates. Store installations use Microsoft Store for updates.

## Codex, sign-in, and agent processing

PixelCrew connects to the Codex App Server installed on your computer. When you submit work, your prompt, selected attachments, and relevant task context may be sent by Codex to OpenAI services. If you grant access to a workspace, an agent may read or change files there according to the permissions and approvals you select. OpenAI processes information under its own terms and privacy practices. PixelCrew does not control OpenAI's retention or use of information sent to its services.

Codex sign-in is handled by the installed Codex app and its account storage. PixelCrew-managed account sign-in uses OpenAI authorization and stores its account tokens in the local PixelCrew profile protected with Windows user-scoped encryption. PixelCrew sends authentication requests to OpenAI's authorization services to complete sign-in, refresh, or revoke those tokens. Account details such as an email address may be displayed locally to identify the selected account.

## Browser and other services

When you visit a website using PixelCrew's in-app Browser, your browser requests go to that website. The website may receive your IP address and request details and may store cookies or other site data under its own policies. Browser data is stored locally in the corresponding PixelCrew profile. Agent access to Browser is disabled by default and requires the app-wide permission and Browser selection in the chat; action approvals also depend on your selected permission mode. You can use the Browser manually regardless of the agent-use setting.

PixelCrew may open the system browser for account authorization. Windows, Microsoft Edge WebView2, OpenAI, GitHub, and Microsoft Store may process information when you use their respective services. Their own privacy statements and settings apply.

## Storage, retention, and deletion

App history, settings, attachments, account profiles, and browser data remain on the device in the relevant PixelCrew profile until you remove them. Signing out removes PixelCrew-managed account credentials but does not erase chat history. Clearing an in-app browser profile removes its cookies and site data. Removing or resetting one edition does not automatically remove the other edition's separate profile.

To erase local PixelCrew data, exit PixelCrew from the tray so its local service is stopped, then remove that edition's data folder. The standalone edition stores data under `%LOCALAPPDATA%\PixelCrew`. The Microsoft Store edition stores it under `%LOCALAPPDATA%\Packages\Zenonia.PixelCrew_p1bh7pv6tb1na\LocalState\PixelCrew`. Deleting these folders permanently removes the local chats, settings, attachments, account data, and browser profiles they contain. Back up anything you want to keep first. OpenAI-held data must be managed through the relevant OpenAI account controls.

When you back up data in PixelCrew, the app saves a `.pxc` file to a location you choose. It may contain settings, teams, layouts, selected local chat and run history, project paths, and stored attachments. Account records, credentials, browser cookies, and the Desktop Codex data folder are excluded. Backups can contain private content. Windows uninstall normally removes the Store edition’s package data, while separately saved backups and older custom profiles can remain. To remove a backup, delete it from its saved location.

## Security

PixelCrew keeps its backend bound to the local computer and uses local request protections to limit access to the desktop app. Local data is subject to the security of your Windows account and device. Keep Windows up to date, use a secured account, and avoid sharing your profile folders or diagnostic files. Information sent to OpenAI or a website is subject to that service's security practices.

## Your choices

You can choose whether to use PixelCrew-managed accounts, which workspace and attachments to provide to agents, which agent permissions to allow, whether to enable agent Browser use, which websites to visit, and whether to back up or restore local data. You can sign out of PixelCrew-managed accounts, clear browser profiles, or delete local app data using the instructions above. You may decline optional features that transmit data to external services.

## Children

PixelCrew is a developer productivity application and is not designed for children under 13. PixelCrew does not knowingly collect children's personal information through a PixelCrew-operated online service.

## Changes and contact

We may revise this policy when PixelCrew's data practices or features change. The effective date above identifies the current version. For product support or privacy questions, contact the publisher through [PixelCrew's GitHub issue tracker](https://github.com/Zenonia-9/pixelcrew/issues). Please do not post passwords, access tokens, private chats, project files, or other sensitive personal information in a public issue. For a privacy request that requires private handling, ask for a private contact channel before sending personal data.

---

This policy is informed by the organization and transparency principles in the [Microsoft Privacy Statement](https://www.microsoft.com/en-us/privacy/privacystatement). Microsoft is not the publisher of PixelCrew, and its statement does not apply to PixelCrew.
