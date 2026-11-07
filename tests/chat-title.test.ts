import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTitle } from "../shared/chat-title";

test("chat titles summarize PixelCrew failures instead of exposing a stage prefix", () => {
  assert.equal(chatTitle("Fix pixelcrew, it is showing failed when I chat. It is start from last commit. Fix it first."), "Fix PixelCrew chat failures");
});

test("issue-log chats use a readable source filename instead of copying a path", () => {
  assert.equal(
    chatTitle("Source: C:\\Users\\lenovo\\Documents\\Issue Logs\\vhg\\tha-stock-packaging-count-sheet-new-products.md\n\nFix this issue log. Ask anything you need."),
    "Update THA Stock Packaging Count Sheet New Products",
  );
});

test("chat titles stay concise and omit the assistant and stage names", () => {
  const title = chatTitle("Commit draft changes in pixelcrew. Keep the RPG office and chat workflow intact.");
  assert.equal(title, "Commit Draft Changes In PixelCrew");
  assert.doesNotMatch(title, /Nova|build/i);
});
