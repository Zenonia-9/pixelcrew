import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { ChatOutbox, queueOutboxMessage } from "../server/chat-outbox";
import { aggregateUsage } from "../shared/usage-history";
import { followupDelivery } from "../shared/followups";
import { normalizeResetCredits } from "../shared/account-usage";
import { CodexRuntime } from "../server/runtime";

test("usage graph deduplicates mirrored turns and keeps cached input a subset", () => {
  const usage = { inputTokens: 80, cachedInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 100 };
  const result = aggregateUsage([{ id: "same", at: 50, usage }, { id: "same", at: 50, usage }, { id: "end", at: 100, usage }, { id: "old", at: -1, usage }], 0, 100, 2);
  assert.equal(result.turns, 2); assert.equal(result.totals.total, 200); assert.equal(result.totals.cached, 60);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.total, 0), 200);
});
test("follow-up defaults persist and Ctrl+Enter uses the opposite delivery", () => {
  const path = join(mkdtempSync(join(tmpdir(), "followup-settings-")), "studio.sqlite");
  let store = new Store(path);
  assert.equal(store.preferences().followupBehavior, "queue");
  store.savePreference("followupBehavior", "steer"); store.close(); store = new Store(path);
  assert.equal(store.preferences().followupBehavior, "steer");
  assert.equal(followupDelivery("steer", true), "queue"); assert.equal(followupDelivery("queue", true), "steer");
  assert.equal(followupDelivery("queue", false), "queue"); store.close();
});
test("external follow-ups survive restart and cancellation removes only that message", () => {
  const path = join(mkdtempSync(join(tmpdir(), "chat-outbox-")), "studio.sqlite");
  let store = new Store(path); let outbox = new ChatOutbox(store);
  const input = { threadId: "external", text: "Follow up", teamId: "default", accountId: "desktop", workspace: "C:/workspace", criteria: "", references: [], allowWrite: true, options: { mode: "normal" as const, models: {}, attachments: [], mentions: [] } };
  const first = outbox.add(input), second = outbox.add({ ...input, text: "Another" }); store.close();
  store = new Store(path); outbox = new ChatOutbox(store);
  assert.deepEqual(outbox.list().map(item => item.id), [first.id, second.id]);
  outbox.remove(first.id); assert.deepEqual(outbox.list().map(item => item.id), [second.id]); store.close();
});
test("active-run outbox delivery forwards the selected approval mode", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "chat-outbox-permissions-")), "studio.sqlite");
  const store = new Store(path);
  const outbox = new ChatOutbox(store);
  const item = outbox.add({
    threadId: "active-chat",
    text: "Follow up",
    teamId: "default",
    accountId: "desktop",
    workspace: "C:/workspace",
    criteria: "",
    references: [],
    allowWrite: true,
    options: { mode: "normal", permissions: "auto", models: {}, attachments: [], mentions: [] },
  });
  let forwarded: any[] = [];
  const engine = {
    async queueMessage(...args: any[]) { forwarded = args; },
  } as any;
  await queueOutboxMessage(engine, { id: "run" } as any, item);
  assert.equal(forwarded[0].id, "run");
  assert.equal(forwarded[1], "Follow up");
  assert.equal(forwarded[4], "steer");
  assert.equal(forwarded[5], "auto");
  store.close();
});
test("external steering targets the current turn and never creates a competing turn", async () => {
  const runtime = new CodexRuntime(); const calls: unknown[] = [];
  runtime.readChat = async () => ({ turns: [{ id: "live", status: "inProgress" }] } as any);
  runtime.request = async (method, params) => { calls.push([method, params]); return {}; };
  assert.equal(await runtime.steerChat("chat", "Update", [], "message", { allowWrite: true, options: { mode: "normal", inheritPermissions: true, models: {}, attachments: [], mentions: [] } }), true);
  assert.deepEqual(calls, [["turn/steer", { threadId: "chat", expectedTurnId: "live", clientUserMessageId: "message", input: [{ type: "text", text: "Update" }] }]]);
  runtime.readChat = async () => ({ turns: [] } as any);
  assert.equal(await runtime.steerChat("chat", "Update"), false); assert.equal(calls.length, 1);
});
test("reset credits preserve reported counts and expiry without inventing details", () => {
  assert.equal(normalizeResetCredits({}), undefined);
  assert.deepEqual(normalizeResetCredits({ rateLimitResetCredits: { availableCount: 1, credits: null } }), { availableCount: 1, credits: null });
  const result = normalizeResetCredits({ rateLimitResetCredits: { availableCount: 1, credits: [{ id: "reset", status: "available", resetType: "codexRateLimits", expiresAt: 123 }, { id: "used", status: "redeemed" }] } });
  assert.equal(result?.credits?.length, 1); assert.equal(result?.credits?.[0].expiresAt, 123);
});

test("the outbox waits for external work, delivers once, and honors cancellation during a read", async () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), "outbox-drain-")), "studio.sqlite"));
  const outbox = new ChatOutbox(store);
  const item = outbox.add({ threadId: "external", text: "Follow up", teamId: "default", accountId: "desktop", workspace: "C:/workspace", criteria: "", references: [], allowWrite: true, options: { mode: "normal", models: {}, attachments: [], mentions: [] } });
  let active = true, started = 0;
  const actions = { eligible: () => true, active: async () => active, start: () => { started++; }, changed: () => {} };
  await outbox.drain(actions); assert.equal(started, 0); assert.equal(outbox.list().length, 1);
  active = false; await outbox.drain(actions); await outbox.drain(actions); assert.equal(started, 1); assert.equal(outbox.list().length, 0);
  const cancelled = outbox.add({ ...item, text: "Cancel me" });
  await outbox.drain({ ...actions, active: async () => { outbox.remove(cancelled.id); return false; } });
  assert.equal(started, 1); store.close();
});

test("queued edits keep the message identity, attachments and FIFO position", () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), "outbox-edit-")), "studio.sqlite"));
  const outbox = new ChatOutbox(store);
  const first = outbox.add({ threadId: "chat", text: "Before", teamId: "default", accountId: "desktop", workspace: "C:/workspace", criteria: "", references: [], allowWrite: true, options: { mode: "normal", models: {}, attachments: [{ name: "image.png", path: "C:/image.png", kind: "image" }], mentions: [] } });
  const second = outbox.add({ ...first, text: "Second" });
  outbox.save({ ...first, text: "After" });
  assert.deepEqual(outbox.list().map(message => message.id), [first.id, second.id]);
  assert.equal(outbox.list()[0].text, "After"); assert.equal(outbox.list()[0].options.attachments[0].path, "C:/image.png"); store.close();
});
test("desktop steering forwards through the owning adapter when its turn is not loaded locally", async () => {
  const runtime = new CodexRuntime(); let forwarded = "";
  runtime.readChat = async () => ({ turns: [{ id: "live", status: "inProgress" }] } as any);
  runtime.request = async () => { throw Error("thread not loaded"); };
  (runtime as any).desktop = { available: true, async send(threadId: string, text: string) { assert.equal(threadId,"desktop-chat"); forwarded = text; } };
  assert.equal(await runtime.steerChat("desktop-chat", "Apply the new setting", [], undefined, { allowWrite: true, options: { mode: "normal", inheritPermissions: true, models: {}, attachments: [], mentions: [] } }), true);
  assert.equal(forwarded, "Apply the new setting");
});

test("a turn finishing during Steer leaves the follow-up queued instead of discarding it", async () => {
  const { Engine } = await import("../server/engine"); const { starterTeam } = await import("../shared/defaults");
  const store = new Store(join(mkdtempSync(join(tmpdir(), "steer-race-")), "studio.sqlite"));
  const engine = new Engine(store, { async steer() { throw Error("This turn has finished. Queue your message instead."); } } as any);
  const run = { id: "race", createdAt: new Date().toISOString(), status: "running", team: structuredClone(starterTeam), inbox: [], assignments: [{ id: "a", agentId: "atlas", status: "running" }] } as any;
  await engine.queueMessage(run, "Keep this follow-up", [], [], "steer");
  assert.equal(run.inbox.length, 1); assert.equal(run.inbox[0].text, "Keep this follow-up"); assert.equal(run.inbox[0].status, "queued"); store.close();
});
