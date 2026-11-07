import test from "node:test";
import assert from "node:assert/strict";
import { CodexRuntime } from "../server/runtime";
import { DesktopBridge } from "../server/desktop-bridge";

test("desktop turns update working state without starting or resuming a turn", async () => {
  const runtime = new CodexRuntime();
  runtime.connect = async () => {};
  runtime.status.connected = true;
  let running = true;
  let progress = "Checking the current file";
  const calls: string[] = [];
  runtime.request = async (method) => {
    calls.push(method);
    if (method === "thread/list") return { data: [{ id: "desktop", updatedAt: Date.now() / 1000 }] };
    if (method === "thread/read") return { thread: { id: "desktop", cwd: "C:/Work", name: "Desktop work" } };
    if (method === "thread/turns/list") return { data: [{ id: "turn", status: running ? "inProgress" : "completed", items: [{ id: "progress", type: "agentMessage", phase: "commentary", text: progress }] }] };
    throw Error(`Unexpected request: ${method}`);
  };
  await runtime.refreshExternalActivity();
  assert.deepEqual(runtime.status.activeChats, ["desktop"]);
  assert.equal(runtime.status.chatProgress?.desktop, "Checking the current file");
  progress = "Reviewing the latest changes";
  await runtime.refreshExternalActivity();
  assert.equal(runtime.status.chatProgress?.desktop, progress);
  running = false;
  await runtime.refreshExternalActivity();
  assert.deepEqual(runtime.status.activeChats, []);
  assert.equal(runtime.status.chatProgress?.desktop, undefined);
  assert.ok(calls.every(method => ["thread/list", "thread/read", "thread/turns/list"].includes(method)));
});

test("desktop-owned unloaded chats use read-only saved history and keep pagination", async () => {
  const runtime = new CodexRuntime();
  runtime.connect = async () => {};
  const turns = Array.from({ length: 35 }, (_, index) => ({
    id: `turn-${index}`, status: index === 34 ? "inProgress" : "completed", items: [],
  }));
  runtime.request = async (method, params) => {
    if (method === "thread/turns/list") throw Error("thread not loaded: desktop");
    assert.equal(method, "thread/read");
    return { thread: { id: "desktop", cwd: "C:/Work", turns: (params as { includeTurns: boolean }).includeTurns ? turns : undefined } };
  };
  const recent = await runtime.readChat("desktop");
  assert.equal(recent.active, true);
  assert.deepEqual(runtime.status.activeChats, ["desktop"]);
  assert.equal(recent.turns.length, 30);
  assert.equal(recent.nextCursor, "disk:30");
  const older = await runtime.readChat("desktop", recent.nextCursor);
  assert.equal(older.turns.length, 5);
  assert.deepEqual(runtime.status.activeChats, ["desktop"]);
});

test("stopping an external chat targets its active turn without starting another turn", async () => {
  const runtime = new CodexRuntime();
  const calls: unknown[] = [];
  runtime.readChat = async () => ({ turns: [{ id: "active-turn", status: "inProgress" }] } as any);
  runtime.request = async (method, params) => { calls.push([method, params]); return {}; };
  await runtime.interruptChat("desktop-chat");
  assert.deepEqual(calls, [["turn/interrupt", { threadId: "desktop-chat", turnId: "active-turn" }]]);
  runtime.readChat = async () => ({ turns: [] } as any);
  await assert.rejects(runtime.interruptChat("desktop-chat"), /no active turn/);
});

test("an account attaches its own unloaded chat before controlling it", async () => {
  const runtime = new CodexRuntime(true, "C:/PixelCrew/account-b");
  runtime.readChat = async () => ({ turns: [{ id: "turn", status: "inProgress" }] } as any);
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params: any) => {
    calls.push({ method, params });
    if (method === "turn/interrupt" && calls.filter(call => call.method === "turn/interrupt").length === 1) throw Error("thread not found: shared");
    if (method === "thread/resume" && !params.path) throw Error("no rollout found for thread id shared");
    if (method === "thread/read") return { thread: { id: "shared", path: "C:/PixelCrew/account-b/sessions/shared.jsonl" } };
    if (method === "thread/resume") return { thread: { id: "shared" } };
    return {};
  };
  await runtime.interruptChat("shared");
  assert.deepEqual(calls.map(call => call.method), ["turn/interrupt", "thread/resume", "thread/read", "thread/resume", "turn/interrupt"]);
  assert.equal(calls[3].params.path, "C:/PixelCrew/account-b/sessions/shared.jsonl");
  assert.equal((runtime as any).accountHome, "C:/PixelCrew/account-b");
});

test("all saved chats remain visible while execution uses the selected account", async () => {
  const runtime = new CodexRuntime(true, "C:/PixelCrew/account-b");
  runtime.connect = async () => {};
  runtime.status.connected = true;
  const threads = [
    { id: "desktop", path: "C:/Codex/sessions/pro.jsonl" },
    { id: "other", path: "C:/PixelCrew/account-a/sessions/other.jsonl" },
    { id: "own", path: "C:/PixelCrew/account-b/sessions/own.jsonl" },
  ];
  runtime.request = async method => { assert.equal(method, "thread/list"); return { data: threads }; };
  assert.deepEqual((await runtime.listChats()).chats.map(chat => chat.id), ["desktop", "other", "own"]);
});

test("native interrupted status clears a stale saved running turn without resuming work", async () => {
  const runtime = new CodexRuntime();
  runtime.connect = async () => {};
  runtime.status.activeChats = ["stale"];
  runtime.status.chatProgress = { stale: "Old progress" };
  (runtime as any).externalTurnReader = async () => ({ id: "turn", status: "interrupted" });
  const calls: string[] = [];
  runtime.request = async method => {
    calls.push(method);
    if (method === "thread/read") return { thread: { id: "stale", cwd: "C:/Work" } };
    if (method === "thread/turns/list") return { data: [{ id: "turn", status: "inProgress", items: [] }] };
    throw Error(`Unexpected mutation: ${method}`);
  };
  const chat = await runtime.readChat("stale");
  assert.equal(chat.active, false);
  assert.equal(chat.turns[0].status, "interrupted");
  assert.deepEqual(runtime.status.activeChats, []);
  assert.equal(runtime.status.chatProgress?.stale, undefined);
  assert.deepEqual(calls, ["thread/read", "thread/turns/list"]);
});

test("missing or mismatched native lifecycle evidence preserves a genuinely running latest turn", async () => {
  for (const evidence of [undefined, { id: "older", status: "interrupted" }, { id: "turn", status: "inProgress" }]) {
    const runtime = new CodexRuntime();
    runtime.connect = async () => {};
    (runtime as any).externalTurnReader = async () => evidence;
    runtime.request = async method => method === "thread/read" ? { thread: { id: "live", cwd: "C:/Work" } } : { data: [{ id: "turn", status: "inProgress", items: [] }] };
    assert.equal((await runtime.readChat("live")).active, true);
  }
});

test("historical unfinished turns cannot keep a completed conversation marked working", async () => {
  const runtime = new CodexRuntime();
  runtime.connect = async () => {};
  runtime.request = async method => method === "thread/read" ? { thread: { id: "done", cwd: "C:/Work" } } : { data: [
    { id: "new", status: "completed", items: [] }, { id: "old", status: "inProgress", items: [] },
  ] };
  const chat = await runtime.readChat("done");
  assert.equal(chat.active, false);
  assert.equal(chat.turns[0].status, "interrupted");
});

test("desktop status reads include executor thread metadata and coalesce repeated observations", async () => {
  const bridge = new DesktopBridge();
  bridge.tools = async () => [{ name: "read_thread" }];
  let calls = 0;
  (bridge as any).rpc = async (method: string, params: any) => {
    calls++;
    assert.equal(method, "tools/call");
    assert.equal(params.name, "read_thread");
    assert.equal(params._meta["openai/threadId"], "chat");
    assert.equal(params.arguments.turnLimit, 1);
    return { content: [{ type: "text", text: JSON.stringify({ turns: [{ id: "turn", status: "interrupted" }] }) }] };
  };
  const [first, second] = await Promise.all([bridge.latestTurn("chat"), bridge.latestTurn("chat")]);
  assert.deepEqual(first, { id: "turn", status: "interrupted" });
  assert.deepEqual(first, second);
  assert.deepEqual(await bridge.latestTurn("chat"), first);
  assert.equal(calls, 1);
  bridge.close();
});
