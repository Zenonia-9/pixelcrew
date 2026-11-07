import test from "node:test";
import assert from "node:assert/strict";
import { CodexRuntime } from "../server/runtime";
import { generatedTitle } from "../server/chat-naming";

test("generated titles accept short structured names and reject invalid metadata", () => {
  assert.equal(generatedTitle('{"title":"Fix office layout"}'), "Fix office layout");
  assert.equal(generatedTitle("A copied prompt"), undefined);
  assert.equal(generatedTitle(JSON.stringify({ title: "x".repeat(37) })), undefined);
  assert.equal(generatedTitle('{"title":""}'), undefined);
});
test("background naming uses the owning account and preserves a concurrent manual rename", async () => {
  for (const manualRename of [false, true]) {
    const runtime = new CodexRuntime(); let reads = 0, saved: string | undefined, closed = false, executions = 0;
    runtime.createExecutionWorker = account => {
      assert.equal(account, "owner-account");
      return {
        connect: async () => {}, status: { models: [{ id: "available-luna", efforts: ["low"] }] },
        request: async (method: string, params: any) => {
          if (method === "thread/read") return { thread: { name: ++reads > 1 && manualRename ? "My chosen title" : "New chat" } };
          if (method === "thread/name/set") saved = params.name;
          return {};
        },
        execute: async (input: any) => {
          executions++; assert.equal(input.metadataOnly, true); assert.equal(input.agent.access, "read-only");
          assert.equal(input.agent.model, "available-luna"); assert.equal(input.title, undefined);
          return '{"title":"Repair creative office"}';
        }, close: () => { closed = true; },
      } as any;
    };
    runtime.queueChatTitle("chat", "Fix creative corner layout. It is not correct.", "/workspace", "New chat", "owner-account");
    runtime.queueChatTitle("chat", "Duplicate", "/workspace", "New chat", "owner-account");
    await (runtime as any).titleQueue;
    assert.equal(executions, 1); assert.equal(closed, true);
    assert.equal(saved, manualRename ? undefined : "Repair creative office");
    assert.equal(runtime.status.chatTitleRevision, manualRename ? undefined : 1);
  }
});
