import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldInheritChatPermissions } from "../shared/chat-permissions";

test("saved composer preferences do not replace an existing chat's permissions", () => {
  assert.equal(shouldInheritChatPermissions("existing-normal-chat", false), true);
});

test("explicit permission edits and new chats use the selected permissions", () => {
  assert.equal(shouldInheritChatPermissions("existing-chat", true), false);
  assert.equal(shouldInheritChatPermissions(undefined, false), false);
});
