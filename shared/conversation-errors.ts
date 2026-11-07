export const conversationBusy = (value: unknown) =>
  /active writer|open for writing in (?:another|Codex)|chat is in use in Codex/i.test(
    String(value || ""),
  );
export const conversationBusyMessage =
  "The previous message was not delivered. Retry it or send a new message to continue this shared conversation.";
