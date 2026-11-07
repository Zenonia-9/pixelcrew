/** Features and capabilities included in this release build. */
export const release = {
  version: "1.0.0-rc.1",
  channel: "candidate",
  capabilities: { chat: true, teams: true, goals: true, accounts: true, usage: true,
    office2d: true, attachments: true, deviceTools: false, demos: false },
} as const;
