import test from "node:test";
import assert from "node:assert/strict";
import { draftKey, readDraft, writeDraft } from "../shared/composer-drafts";
import { CodexRuntime, type Execution } from "../server/runtime";
import { normalizeTurn } from "../server/chat-history";
import { starterTeam } from "../shared/defaults";
import { normalAgent } from "../shared/normal-agent";
import { runOptionsSchema } from "../shared/types";
import { completedBoardTasks } from "../shared/group-chat";

test("drafts survive navigation and keep each chat's text and attachments separate", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string,string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key,value), removeItem: (key: string) => values.delete(key) } });
  try {
    const first = draftKey("team", "first"), second = draftKey("team", "second");
    const draft = { text: "Keep this draft", criteria: "Criteria", references: "C:/file", goalTokenBudget: 12000, attachments: [{ name: "image.png", path: "C:/upload.png", kind: "image" as const, preview: "/api/attachments/image.png" }], mentions: [] };
    writeDraft(first, draft); writeDraft(second, { ...draft, text: "Other chat" });
    assert.deepEqual(readDraft(first), draft); assert.equal(readDraft(second)?.text, "Other chat");
    writeDraft(first, { text: "", criteria: "", references: "", goalTokenBudget: 12000, attachments: [], mentions: [] });
    assert.equal(readDraft(first)?.goalTokenBudget, 12000, "a budget-only draft must survive navigation");
    writeDraft(first, { text: "", criteria: "", references: "", attachments: [], mentions: [] });
    assert.equal(readDraft(first), undefined); assert.equal(readDraft(second)?.text, "Other chat");
  } finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete (globalThis as any).localStorage; }
});

test("reset redemption uses the selected credit and preserves the retry key", async () => {
  const runtime = new CodexRuntime(); const calls: unknown[] = [];
  runtime.connect = async () => {}; runtime.refreshUsage = async () => { calls.push("refresh"); };
  runtime.request = async (method, params) => { calls.push([method, params]); return { outcome: "reset" }; };
  assert.deepEqual(await runtime.redeemUsageReset("credit", "same-attempt"), { outcome: "reset" });
  assert.deepEqual(calls, [["account/rateLimitResetCredit/consume", { creditId: "credit", idempotencyKey: "same-attempt" }], "refresh"]);
});

test("a locked Normal conversation tracks a userless desktop-forwarded turn", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  runtime.connect = async () => {};
  const calls: string[] = []; let sent = false, thread = "", turn = "";
  runtime.request = async method => { calls.push(method); if (method === "thread/resume") throw Error("thread already has an active writer"); return {}; };
  runtime.readChat = async () => ({ turns: sent ? [{ id: "native-turn", status: "completed", users: [], answers: [{ text: "Native reply" }], activity: [], files: [] }] : [] } as any);
  (runtime as any).desktop = { available: true, close() {}, async send(id: string, prompt: string) { assert.equal(id, "native-chat"); assert.equal(prompt, "Do this request"); sent = true; } };
  const agent = { ...normalAgent(starterTeam.agents[0]), model: "supported" };
  const input: Execution = { agent, assignment: { id: "a", agentId: agent.id, stage: "build", objective: "Task", status: "running", output: "", threadId: "native-chat" }, workspace: "C:/workspace", sourceThreadId: "native-chat", prompt: "Do this request", options: runOptionsSchema.parse({ mode: "normal", inheritPermissions: true }), onThread: id => { thread = id; }, onTurn: id => { turn = id; }, onEvent() {}, onApproval() {} };
  assert.equal(await runtime.execute(input), "Native reply"); assert.equal(thread, "native-chat"); assert.equal(turn, "native-turn");
  assert.equal(calls.includes("thread/start"), false); assert.equal(calls.includes("turn/start"), false);
});

test("switching teams in a desktop-owned chat retains its ID, selected roles and saved child history", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  runtime.connect = async () => {};
  let sent = false, forwarded = "", thread = "";
  const calls: string[] = [], children: any[] = [];
  runtime.request = async method => { calls.push(method); if (method === "thread/resume") throw Error("active writer"); return {}; };
  const child = normalizeTurn({ id: "child-turn", status: "completed", items: [
    { type: "agentMessage", id: "result", text: "Verified source evidence", phase: "final_answer" },
  ] });
  const parent = normalizeTurn({ id: "reply", status: "completed", items: [
    { type: "agentMessage", id: "reply-text", text: "Team result", phase: "final_answer" },
    { type: "subAgentActivity", id: "spawn", agentThreadId: "child", agentPath: "/root/pip" },
    { type: "collabAgentToolCall", id: "wait", receiverThreadIds: ["child"] },
  ] });
  let polls = 0;
  const updates: string[] = [];
  runtime.readChat = async id => ({ turns: id === "child" ? [child] : sent ? [++polls === 1 ? { ...parent, status: "inProgress", answers: [], activity: [...parent.activity, { id: "live", type: "agentMessage", title: "Update", text: "Investigating now" }] } : parent] : [] } as any);
  (runtime as any).desktop = { available: true, async send(id: string, text: string) { assert.equal(id, "existing-chat"); sent = true; forwarded = text; } };
  const team = structuredClone(starterTeam.agents).map(agent => ({ ...agent, model: "supported" }));
  team[0].access = "workspace-write";
  team[0].name = "New selected lead";
  const input: Execution = { agent: team[0], nativeTeam: team, assignment: { id: "team-assignment", agentId: team[0].id, stage: "final", objective: "Task", status: "running", output: "", threadId: "existing-chat" }, workspace: "C:/workspace", sourceThreadId: "existing-chat", prompt: "Check the source", options: runOptionsSchema.parse({ mode: "team", inheritPermissions: true }), onThread: id => { assert.equal(id, "existing-chat"); thread = id; }, onTurn() {}, onEvent() {}, onApproval() {}, onSubagent: event => children.push(event) };
  input.onDelta = text => updates.push(text);
  assert.equal(await runtime.execute(input), "Team result");
  assert.deepEqual(updates, ["Investigating now", "Team result"]);
  assert.equal(thread, "existing-chat");
  assert.match(forwarded, /New selected lead/);
  assert.match(forwarded, /\[PixelCrew:pip\]/);
  assert.match(forwarded, /read-only/);
  assert.equal(children[0].output, "Verified source evidence");
  assert.equal(children[0].threadId, "child");
  assert.ok(!calls.some(method => ["thread/fork", "thread/start", "turn/start"].includes(method)));
});

test("completed Normal tasks are eligible for board pins", () => {
  const normal = { id: "normal", demo: false, status: "completed", result: "Done", task: "Normal task", createdAt: "2026-10-26T00:00:00Z", options: { mode: "normal" }, assignments: [{ agentId: "codex-normal", finishedAt: "2026-10-26T00:01:00Z" }], chatThreadId: "normal-chat" } as any;
  assert.equal(completedBoardTasks([normal])[0].id, "normal");
});

test("desktop fallback refuses read-only, Plan and explicitly managed permissions", async () => {
  for (const settings of [
    { access: "read-only" as const, mode: "normal" as const, inheritPermissions: true },
    { access: "workspace-write" as const, mode: "plan" as const, inheritPermissions: true },
    { access: "workspace-write" as const, mode: "normal" as const, permissions: "ask" as const },
    { access: "workspace-write" as const, mode: "normal" as const, permissions: "auto" as const },
    { access: "workspace-write" as const, mode: "normal" as const, permissions: "custom" as const },
  ]) {
    const runtime = new CodexRuntime(true);
    runtime.status = { connected: true, authenticated: true, models: [] };
    runtime.connect = async () => {};
    let sent = false;
    runtime.request = async method => {
      if (method === "thread/resume") throw Error("active writer");
      return { config: {} };
    };
    (runtime as any).desktop = { available: true, async send() { sent = true; } };
    const agent = { ...normalAgent(starterTeam.agents[0]), access: settings.access };
    const input: Execution = { agent, assignment: { id: "blocked", agentId: agent.id, stage: "build", objective: "Task", status: "running", output: "", threadId: "native-chat" }, workspace: "C:/workspace", sourceThreadId: "native-chat", prompt: "Do this request", options: runOptionsSchema.parse(settings), onThread() {}, onTurn() {}, onEvent() {}, onApproval() {} };
    await assert.rejects(runtime.execute(input), /cannot enforce the selected permissions/);
    assert.equal(sent, false);
  }
});

test("external desktop steering fails closed without writable inherited permissions", async () => {
  const runtime = new CodexRuntime();
  runtime.readChat = async () => ({ turns: [{ id: "live", status: "inProgress" }] } as any);
  runtime.request = async () => { throw Error("thread not loaded"); };
  let sent = false;
  (runtime as any).desktop = { available: true, async send() { sent = true; } };
  for (const permissions of [undefined, { allowWrite: false, options: runOptionsSchema.parse({ inheritPermissions: true }) }, { allowWrite: true, options: runOptionsSchema.parse({ mode: "plan", inheritPermissions: true }) }, { allowWrite: true, options: runOptionsSchema.parse({ permissions: "ask" }) }]) {
    await assert.rejects(runtime.steerChat("chat", "Task", [], undefined, permissions), /cannot enforce the selected permissions/);
    assert.equal(sent, false);
  }
});

test("successful app-server steering cannot bypass restrictive permission choices", async () => {
  const runtime = new CodexRuntime();
  runtime.readChat = async () => ({ turns: [{ id: "live", status: "inProgress" }] } as any);
  const calls: string[] = [];
  runtime.request = async method => { calls.push(method); return {}; };
  for (const permissions of [
    undefined,
    { allowWrite: false, options: runOptionsSchema.parse({ mode: "normal", inheritPermissions: true }) },
    { allowWrite: true, options: runOptionsSchema.parse({ mode: "plan", inheritPermissions: false }) },
    { allowWrite: true, options: runOptionsSchema.parse({ mode: "plan", inheritPermissions: true }) },
    ...(["ask", "auto", "custom"] as const).map(value => ({ allowWrite: true, options: runOptionsSchema.parse({ permissions: value, inheritPermissions: false }) })),
  ]) {
    await assert.rejects(runtime.steerChat("chat", "Task", [], undefined, permissions), /cannot enforce the selected permissions/);
    assert.deepEqual(calls, []);
  }
  assert.equal(await runtime.steerChat("chat", "Task", [], undefined, { allowWrite: true, options: runOptionsSchema.parse({ mode: "normal", inheritPermissions: true }) }), true);
  assert.deepEqual(calls, ["turn/steer"]);
  runtime.readChat = async () => ({ turns: [] } as any);
  assert.equal(await runtime.steerChat("chat", "Task"), false);
  assert.deepEqual(calls, ["turn/steer"]);
});
