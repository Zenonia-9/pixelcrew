import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CodexRuntime, chatTitleIntent, deviceToolMcpNodeArgs, type Execution } from "../server/runtime";
import { starterTeam } from "../shared/defaults";
import { runOptionsSchema } from "../shared/types";
import { resolveProfile } from "../shared/models";
import { codexBinary } from "../server/codex-binary";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("device MCP loader uses a Windows-compatible file URL with Node --import", () => {
  const [flag, loaderUrl] = deviceToolMcpNodeArgs();
  assert.equal(flag, "--import");
  assert.match(loaderUrl, /^file:\/\//);
  const child = spawnSync(process.execPath, [flag, loaderUrl, "-e", "process.stdout.write('loaded')"], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "loaded");
});

test("isolated Browser exposes visual coordinate controls alongside DOM controls", () => {
  const [flag, loaderUrl] = deviceToolMcpNodeArgs();
  const server = fileURLToPath(new URL("../server/device-tools-mcp.ts", import.meta.url));
  const child = spawnSync(process.execPath, [flag, loaderUrl, server], {
    encoding: "utf8",
    input: [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ].join("\n") + "\n",
    env: { ...process.env, PIXELCREW_DEVICE_TOOLS: "browser" },
  });
  assert.equal(child.status, 0, child.stderr);
  const listing = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  const names = listing.result.tools.map((tool: { name: string }) => tool.name);
  for (const name of ["browser_screenshot", "browser_click_at", "browser_hover", "browser_drag", "browser_type_text", "browser_scroll"])
    assert.ok(names.includes(name), `Missing ${name}`);
});

const input = (): Execution => ({
  agent: {
    ...structuredClone(starterTeam.agents[1]),
    name: "Custom researcher",
    instructions: "Check every source",
    personality: "Direct",
    model: "supported",
    tools: ["search"],
    expectedOutput: "Evidence table",
  },
  assignment: {
    id: "assignment",
    agentId: "pip",
    stage: "research",
    objective: "Investigate",
    status: "running",
    output: "",
  },
  workspace: "C:\\Work\\Example",
  prompt: "Read the supplied context",
  onThread() {},
  onTurn() {},
  onEvent() {},
  onApproval() {},
});
test("chat title intent covers new chats, forks, continuations, metadata, and assignments", () => {
  const base = input();
  assert.deepEqual(chatTitleIntent(base), { shouldGenerate: true, sourceFork: false });
  assert.deepEqual(chatTitleIntent({ ...base, sourceThreadId: "source", options: runOptionsSchema.parse({ mode: "normal" }) }), { shouldGenerate: true, sourceFork: true });
  assert.deepEqual(chatTitleIntent({ ...base, sourceThreadId: "source", options: runOptionsSchema.parse({ mode: "plan" }) }), { shouldGenerate: true, sourceFork: true });
  assert.deepEqual(chatTitleIntent({ ...base, sourceThreadId: "source", options: runOptionsSchema.parse({ mode: "normal", continueSourceThread: true }) }), { shouldGenerate: false, sourceFork: false });
  assert.deepEqual(chatTitleIntent({ ...base, metadataOnly: true }), { shouldGenerate: false, sourceFork: false });
  assert.deepEqual(chatTitleIntent({ ...base, assignment: { ...base.assignment, threadId: "existing" } }), { shouldGenerate: false, sourceFork: false });
});
test("MCP app approvals forward the user's accept or decline as elicitation actions", () => {
  const runtime = new CodexRuntime(true);
  const sent: any[] = [];
  (runtime as any).send = (message: unknown) => { sent.push(message); };
  for (const accept of [false, true]) {
    runtime.requests.set("app-approval", { id: 12, method: "mcpServer/elicitation/request" });
    runtime.respond("app-approval", accept);
    assert.deepEqual(sent.at(-1), { id: 12, result: accept ? { action: "accept", content: {} } : { action: "decline" } });
    assert.equal(runtime.requests.has("app-approval"), false);
  }
});
test("device turns verify the thread-scoped catalog before model execution and fail explicitly if tools are missing", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  const calls: string[] = [];
  runtime.request = async (method, params) => {
    calls.push(method);
    if (method === "config/read") return { config: {} };
    if (method === "thread/start") return { thread: { id: "device-chat" } };
    if (method === "thread/name/set") return {};
    if (method === "mcpServerStatus/list") {
      assert.deepEqual(params, { threadId: "device-chat", serverName: "pixelcrew_device" });
      return { data: [{ name: "pixelcrew_device", tools: {}, toolsError: "MCP startup failed" }] };
    }
    throw new Error(`Unexpected request ${method}`);
  };
  const execution = input();
  execution.options = runOptionsSchema.parse({ mode: "normal", deviceTools: ["chrome"] });
  await assert.rejects(runtime.execute(execution), /device tools could not start \(chrome\).*MCP startup failed/);
  assert.ok(calls.includes("mcpServerStatus/list"));
  assert.ok(!calls.includes("turn/start"));
});
test("read-only Chrome turns ask the user for MCP approval while denying sandbox and permission escalation", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "chrome-chat" } };
    if (method === "mcpServerStatus/list") return { data: [{ name: "pixelcrew_device", tools: { chrome_windows: {} } }] };
    if (method === "turn/start") {
      queueMicrotask(() => runtime.active.get("chrome-chat")!.resolve("Ready"));
      return { turn: { id: "chrome-turn" } };
    }
    return {};
  };
  const execution = input();
  execution.options = runOptionsSchema.parse({ mode: "normal", deviceTools: ["chrome"], permissions: "auto" });
  await runtime.execute(execution);
  const settings = calls.find(call => call.method === "thread/start")!.params;
  const turn = calls.find(call => call.method === "turn/start")!.params;
  assert.equal(settings.sandbox, "read-only");
  assert.equal(turn.sandboxPolicy.type, "readOnly");
  assert.equal(turn.approvalsReviewer, "user");
  assert.deepEqual(turn.approvalPolicy, { granular: { mcp_elicitations: true, sandbox_approval: false, rules: false, request_permissions: false, skill_approval: false } });
  assert.ok(calls.findIndex(call => call.method === "mcpServerStatus/list") < calls.findIndex(call => call.method === "turn/start"));
});
test("isolated writers are released after execution and controls reach their owner", async () => {
  const root = new CodexRuntime();
  root.status = { connected: true, authenticated: true, models: [] };
  const worker = new CodexRuntime(true);
  let release!: () => void,
    started!: () => void,
    closed = false,
    interrupted = false,
    answered = false;
  const ready = new Promise<void>((resolve) => (started = resolve));
  worker.execute = async () => {
    started();
    await new Promise<void>((resolve) => (release = resolve));
    return "Done";
  };
  worker.shutdown = async () => {
    closed = true;
  };
  worker.interrupt = async () => {
    interrupted = true;
  };
  worker.requests.set("assignment:1", {
    id: 1,
    method: "item/tool/requestUserInput",
  });
  worker.respond = () => {
    answered = true;
  };
  root.createExecutionWorker = () => worker;
  const execution = input(),
    promise = root.execute(execution);
  await ready;
  await root.interrupt(execution.assignment);
  root.respond("assignment:1", true);
  assert.ok(interrupted && answered);
  assert.equal(root.writers.size, 1);
  release();
  assert.equal(await promise, "Done");
  assert.ok(closed);
  assert.equal(root.writers.size, 0);
  assert.equal(root.active.size, 0);
});
test("explicit Codex executable configuration is honored", () => {
  const previous = process.env.STUDIO_CODEX_BIN;
  try {
    process.env.STUDIO_CODEX_BIN = "C:/Codex/codex.exe";
    assert.equal(codexBinary(), "C:/Codex/codex.exe");
  } finally {
    if (previous === undefined) delete process.env.STUDIO_CODEX_BIN;
    else process.env.STUDIO_CODEX_BIN = previous;
  }
});

test("runtime applies the saved identity, instructions, model and access to its own conversation", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = {
    connected: true,
    authenticated: true,
    models: [{ id: "supported", label: "Supported" }],
  };
  let settings: any;
  runtime.request = async (method, params) => {
    if (method === "config/read") return { config: {} };
    if (method === "thread/unsubscribe") return { status: "unsubscribed" };
    if (method === "thread/start") {
      settings = params;
      return { thread: { id: "test-thread" } };
    }
    assert.equal(method, "turn/start");
    queueMicrotask(() => {
      runtime.active.get("test-thread")!.resolve("Done");
      runtime.active.delete("test-thread");
    });
    return { turn: { id: "turn" } };
  };
  assert.equal(await runtime.execute(input()), "Done");
  assert.equal(settings.model, "supported");
  assert.equal(settings.sandbox, "read-only");
  assert.equal(settings.approvalPolicy, "never");
  for (const text of [
    "Custom researcher",
    "Check every source",
    "Direct",
    "Evidence table",
    "search",
  ])
    assert.ok(settings.developerInstructions.includes(text));
  assert.equal(settings.config["features.multi_agent"], false);
});

test("an unsupported model fails explicitly before starting a conversation", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [] };
  runtime.request = async () => {
    throw new Error("Should not start a conversation");
  };
  await assert.rejects(
    runtime.execute(input()),
    /Model unavailable: supported/,
  );
});

test("an unavailable saved model falls back to the current catalog default", () => {
  const agent = { ...structuredClone(starterTeam.agents[0]), model: "removed-model" };
  const resolved = resolveProfile(agent, [
    { id: "current-default", label: "Current default", isDefault: true, efforts: ["medium"] },
  ]);
  assert.equal(resolved.model, "current-default");
});

test("resumed Normal chats keep Codex instructions and add PixelCrew guidance without rewriting the thread", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = {
    connected: true,
    authenticated: true,
    models: [{ id: "supported", label: "Supported" }],
  };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: { instructions: "User Codex instructions", developer_instructions: "Developer Codex instructions" } };
    if (method === "thread/resume")
      return { thread: { id: "former-team-chat" } };
    if (method === "turn/start") {
      queueMicrotask(() =>
        runtime.active.get("former-team-chat")!.resolve("I am Nova."),
      );
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const execution = input();
  execution.assignment.threadId = "former-team-chat";
  execution.options = runOptionsSchema.parse({ mode: "normal" });
  await runtime.execute(execution);
  const turn = calls.find((call) => call.method === "turn/start")!;
  const resumed = calls.find((call) => call.method === "thread/resume")!;
  assert.match(resumed.params.developerInstructions, /^User Codex instructions\n\nDeveloper Codex instructions\n\nPixelCrew team creation skill:/);
  assert.match(turn.params.collaborationMode.settings.developer_instructions, /^User Codex instructions\n\nDeveloper Codex instructions\n\nPixelCrew team creation skill:/);
  assert.match(resumed.params.developerInstructions, /PixelCrew addendum:/);
  assert.match(resumed.params.developerInstructions, /Follow Codex's built-in instructions/);
  assert.ok(!resumed.params.developerInstructions.includes("You are Nova"));
  assert.ok(!calls.some((call) => call.method === "thread/inject_items"));
  assert.deepEqual(turn.params.input, [
    { type: "text", text: execution.prompt },
  ]);
  assert.ok(!calls.some((call) => call.method === "thread/fork"));
});

test("new chats get meaningful titles and preserve project, model, effort and image inputs", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = {
    connected: true,
    authenticated: true,
    models: [{ id: "supported", label: "Supported", efforts: ["medium"] }],
  };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: { developer_instructions: "Team Codex developer instructions" } };
    if (method === "thread/start") return { thread: { id: "created" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        runtime.active.get("created")!.resolve("Finished");
        runtime.active.delete("created");
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const execution = input();
  execution.agent.reasoning = "medium";
  execution.title = "Commit PixelCrew draft changes";
  execution.options = runOptionsSchema.parse({
    projectId: "saved-project",
    attachments: [
      {
        name: "reference.png",
        path: "C:\\Files\\reference.png",
        kind: "image",
      },
    ],
  });
  await runtime.execute(execution);
  const started = calls.find((call) => call.method === "thread/start")!;
  assert.equal(started.params.projectId, "saved-project");
  assert.match(started.params.developerInstructions, /^Team Codex developer instructions\n\n/);
  const turnCall = calls.find((call) => call.method === "turn/start")!;
  assert.equal(turnCall.params.collaborationMode, undefined);
  assert.equal(started.params.ephemeral, false);
  const titleCalls = calls.filter((call) => call.method === "thread/name/set");
  assert.equal(titleCalls.length, 1);
  assert.ok(titleCalls.every((call) => call.params.name === "Commit PixelCrew draft changes"));
  const turn = turnCall.params;
  assert.equal(turn.model, "supported");
  assert.equal(turn.effort, "medium");
  assert.ok(turn.input.some((i: any) => i.type === "localImage"));
  assert.equal(calls.at(-1)?.method, "thread/unsubscribe");
});

test("starting a PixelCrew Plan from a chat forks it and leaves the source chat untouched", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = {
    connected: true,
    authenticated: true,
    models: [{ id: "supported", label: "Supported" }],
  };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: { instructions: "Keep Codex instructions" } };
    if (method === "thread/fork") return { thread: { id: "pixelcrew-fork" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        runtime.active.get("pixelcrew-fork")!.resolve("Plan");
        runtime.active.delete("pixelcrew-fork");
      });
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const execution = input();
  execution.sourceThreadId = "original";
  execution.options = runOptionsSchema.parse({
    projectId: "project",
    mode: "plan",
  });
  await runtime.execute(execution);
  const fork = calls.find((c) => c.method === "thread/fork")!;
  assert.equal(fork.params.threadId, "original");
  assert.equal(fork.params.projectId, "project");
  assert.ok(calls.filter((c) => !["thread/fork", "config/read"].includes(c.method)).every((c) => c.params.threadId === "pixelcrew-fork"));
  assert.equal(
    calls.find((c) => c.method === "turn/start")!.params.collaborationMode.mode,
    "plan",
  );
});

test("starting PixelCrew Normal from a Codex chat forks the source before adding its task turn", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: { developer_instructions: "Keep my Codex workflow" } };
    if (method === "thread/fork") return { thread: { id: "pixelcrew-normal", name: "New chat" } };
    if (method === "turn/start") {
      queueMicrotask(() => runtime.active.get("pixelcrew-normal")!.resolve("Done"));
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const execution = input();
  execution.sourceThreadId = "my-codex-chat";
  execution.options = runOptionsSchema.parse({ mode: "normal" });
  await runtime.execute(execution);
  assert.equal(calls.find((call) => call.method === "thread/fork")?.params.threadId, "my-codex-chat");
  assert.ok(calls.filter((call) => call.method !== "config/read" && call.method !== "thread/fork").every((call) => call.params.threadId === "pixelcrew-normal"));
  assert.ok(!calls.some((call) => call.method === "thread/inject_items"));
  assert.match(calls.find((call) => call.method === "thread/fork")!.params.developerInstructions, /Keep my Codex workflow[\s\S]*PixelCrew addendum:/);
});

test("Nova continues in the existing thread when switching from Team to Normal", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: {} };
    if (method === "thread/resume") return { thread: { id: "team-chat" } };
    if (method === "turn/start") {
      queueMicrotask(() => runtime.active.get("team-chat")!.resolve("Done"));
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const execution = input();
  execution.sourceThreadId = "team-chat";
  execution.options = runOptionsSchema.parse({ mode: "normal", continueSourceThread: true });
  await runtime.execute(execution);
  assert.ok(calls.some(call => call.method === "thread/resume" && call.params.threadId === "team-chat"));
  assert.ok(!calls.some(call => call.method === "thread/fork"));
  assert.ok(calls.filter(call => !["config/read", "thread/resume"].includes(call.method)).every(call => call.params.threadId === "team-chat"));
});

test("Sol and Luna auto profiles resolve before snapshotting and explicit overrides win", () => {
  const catalog = [
    { id: "gpt-6.1-sol", label: "Sol", efforts: ["medium"] },
    { id: "gpt-6-luna", label: "Luna", efforts: ["low", "medium"] },
  ];
  assert.equal(
    resolveProfile(starterTeam.agents[0], catalog).model,
    "gpt-6.1-sol",
  );
  assert.equal(
    resolveProfile(starterTeam.agents[1], catalog).model,
    "gpt-6-luna",
  );
  assert.equal(
    resolveProfile(starterTeam.agents[2], catalog).model,
    "gpt-6.1-sol",
  );
  assert.equal(
    resolveProfile(starterTeam.agents[3], catalog).model,
    "gpt-6-luna",
  );
  assert.equal(
    resolveProfile(starterTeam.agents[0], catalog, {
      model: "gpt-6-luna",
      reasoning: "low",
    }).reasoning,
    "low",
  );
  assert.throws(
    () =>
      resolveProfile(starterTeam.agents[0], catalog, {
        model: "gpt-6-luna",
        reasoning: "ultra",
      }),
    /unavailable/,
  );
});

test("turn overrides preserve member instructions and selected approval policy", async () => {
  for (const permissions of ["ask", "auto", "custom"] as const) {
    const runtime = new CodexRuntime(true);
    runtime.status = {
      connected: true,
      authenticated: true,
      models: [{ id: "supported", label: "Supported" }],
    };
    let turn: any;
    runtime.request = async (method, params) => {
      if (method === "config/read")
        return {
          config: { approval_policy: "on-request", approvals_reviewer: "user" },
        };
      if (method === "thread/resume") return { thread: { id: "shared" } };
      if (method === "turn/start") {
        turn = params;
        queueMicrotask(() => runtime.active.get("shared")!.resolve("Done"));
        return { turn: { id: "turn" } };
      }
      return {};
    };
    const execution = input();
    execution.agent.access = "workspace-write";
    execution.sourceThreadId = "shared";
    execution.options = runOptionsSchema.parse({ permissions });
    await runtime.execute(execution);
    assert.equal(turn.sandboxPolicy.type, "workspaceWrite");
    assert.deepEqual(turn.sandboxPolicy.writableRoots, [execution.workspace]);
    assert.equal(
      turn.approvalPolicy,
      permissions === "ask" ? "untrusted" : "on-request",
    );
    assert.equal(
      turn.approvalsReviewer,
      permissions === "auto" ? "auto_review" : "user",
    );
    assert.match(
      turn.collaborationMode.settings.developer_instructions,
      /Check every source/,
    );
  }
});

test("Custom permissions use approval and workspace sandbox settings from config.toml", async () => {
  const home = mkdtempSync(join(tmpdir(), "pixelcrew-profile-codex-"));
  writeFileSync(join(home, "config.toml"), [
    'approval_policy = "on-request"',
    'approvals_reviewer = "user"',
    'sandbox_mode = "workspace-write"',
    "[sandbox_workspace_write]",
    "network_access = true",
  ].join("\n"));
  try {
    const runtime = new CodexRuntime(true, home);
    runtime.status = {
      connected: true,
      authenticated: true,
      models: [{ id: "supported", label: "Supported" }],
    };
    let turn: any;
    runtime.request = async (method, params) => {
      if (method === "config/read") return { config: {} };
      if (method === "thread/start") return { thread: { id: "custom-config" } };
      if (method === "turn/start") {
        turn = params;
        queueMicrotask(() => runtime.active.get("custom-config")!.resolve("Done"));
        return { turn: { id: "turn" } };
      }
      return {};
    };
    const execution = input();
    execution.agent.access = "workspace-write";
    execution.options = runOptionsSchema.parse({ permissions: "custom" });
    await runtime.execute(execution);
    assert.equal(turn.approvalPolicy, "on-request");
    assert.equal(turn.approvalsReviewer, "user");
    assert.deepEqual(turn.sandboxPolicy, {
      type: "workspaceWrite",
      writableRoots: [execution.workspace],
      networkAccess: true,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Custom permissions use the host config and keep the selected workspace as cwd", async () => {
  const home = mkdtempSync(join(tmpdir(), "pixelcrew-host-codex-"));
  const configPath = join(home, "config.toml");
  writeFileSync(configPath, [
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    'developer_instructions = "Preserve host instructions"',
  ].join("\n"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const runtime = new CodexRuntime(true);
    runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
    const calls: { method: string; params: any }[] = [];
    runtime.request = async (method, params) => {
      calls.push({ method, params });
      if (method === "config/read") return { config: {} };
      if (method === "thread/start") return { thread: { id: "host-config" } };
      if (method === "turn/start") {
        queueMicrotask(() => runtime.active.get("host-config")!.resolve("Done"));
        return { turn: { id: "turn" } };
      }
      return {};
    };
    const execution = input();
    execution.agent.access = "workspace-write";
    execution.workspace = "C:\\ZenDev\\Odoo\\odoo_19_projects";
    execution.options = runOptionsSchema.parse({ permissions: "custom" });
    await runtime.execute(execution);
    const start = calls.find(call => call.method === "thread/start")!.params;
    const turn = calls.find(call => call.method === "turn/start")!.params;
    assert.equal(start.cwd, execution.workspace);
    assert.equal(start.sandbox, "danger-full-access");
    assert.equal(start.approvalPolicy, "never");
    assert.ok(start.developerInstructions.startsWith("Preserve host instructions\n\n"));
    assert.deepEqual(turn.sandboxPolicy, { type: "dangerFullAccess" });
    assert.equal(turn.approvalPolicy, "never");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("steering targets the owning active turn and stale turns are rejected", async () => {
  const root = new CodexRuntime();
  const worker = new CodexRuntime(true);
  const execution = input();
  execution.assignment.threadId = "shared";
  execution.assignment.turnId = "current";
  root.writers.set(execution.assignment.id, worker);
  worker.active.set("shared", {
    input: execution,
    resolve() {},
    reject() {},
    output: "",
  });
  let call: any;
  worker.request = async (method, params) => {
    call = { method, params };
    return {};
  };
  await root.steer(execution.assignment, "Use blue", [], "message-1");
  assert.equal(call.method, "turn/steer");
  assert.equal(call.params.expectedTurnId, "current");
  assert.equal(call.params.clientUserMessageId, "message-1");
  worker.active.clear();
  await assert.rejects(
    root.steer(execution.assignment, "Too late"),
    /finished/,
  );
});

test("chat reads during a run use the app-server that owns the new thread", async () => {
  const root = new CodexRuntime();
  const worker = new CodexRuntime(true);
  (worker as any).ownedThreads.add("new-team-thread");
  const expected = { id: "new-team-thread", turns: [], messages: [] } as any;
  let readByOwner = false;
  worker.readChat = async () => {
    readByOwner = true;
    worker.chatAttachments.set("new-team-thread", new Map([["attachment", { path: "attachment", name: "file.txt", kind: "file" }]]));
    return expected;
  };
  root.writers.set("team-assignment", worker);
  root.request = async () => { throw new Error("thread not loaded: new-team-thread"); };
  assert.equal(await root.readChat("new-team-thread"), expected);
  assert.equal(readByOwner, true);
  assert.ok(root.chatAttachments.get("new-team-thread")?.has("attachment"));
});

test("Auto routes simple work to Luna and complex work to Sol with matching effort", () => {
  const catalog = [
    { id: "gpt-6.1-sol", label: "Sol", efforts: ["low", "medium", "high"] },
    { id: "gpt-6-luna", label: "Luna", efforts: ["low", "medium", "high"] },
  ];
  const agent = starterTeam.agents[0];
  const simple = resolveProfile(
    agent,
    catalog,
    { model: "" },
    { text: "Summarize this sentence" },
  );
  assert.equal(simple.model, "gpt-6-luna");
  assert.equal(simple.reasoning, "low");
  const complex = resolveProfile(
    agent,
    catalog,
    { model: "" },
    { text: "Migrate production authentication and investigate concurrency" },
  );
  assert.equal(complex.model, "gpt-6.1-sol");
  assert.equal(complex.reasoning, "high");
  const explicit = resolveProfile(
    agent,
    catalog,
    { model: "gpt-6-luna", reasoning: "medium" },
    { text: "Migrate production authentication" },
  );
  assert.equal(explicit.model, "gpt-6-luna");
  assert.equal(explicit.reasoning, "medium");
});

test("permission requests reach the user and grants are limited to the requested turn", () => {
  const runtime = new CodexRuntime(true);
  const execution = input();
  let approval: any, response: any;
  execution.onApproval = (id, method, params) => {
    approval = { id, method, params };
  };
  runtime.active.set("thread", {
    input: execution,
    resolve() {},
    reject() {},
    output: "",
  });
  (runtime as any).send = (value: any) => {
    response = value;
  };
  const permissions = { network: { enabled: true } };
  (runtime as any).receive({
    id: 7,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread",
      permissions,
      reason: "Fetch requested documentation",
    },
  });
  assert.equal(approval.method, "item/permissions/requestApproval");
  assert.equal(response, undefined);
  runtime.respond(approval.id, true);
  assert.deepEqual((response as any).result, { permissions, scope: "turn" });
});

test("existing chats inherit native permissions unless the user chooses an override, while read-only remains enforced", async () => {
  for (const readOnly of [false, true]) {
    const runtime = new CodexRuntime(true);
    runtime.status = {
      connected: true,
      authenticated: true,
      models: [{ id: "supported", label: "Supported" }],
    };
    const calls: { method: string; params: any }[] = [];
    runtime.request = async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/resume")
        return { thread: { id: "permission-chat" } };
      if (method === "turn/start") {
        queueMicrotask(() =>
          runtime.active.get("permission-chat")!.resolve("Done"),
        );
        return { turn: { id: "permission-turn" } };
      }
      return {};
    };
    const execution = input();
    execution.agent.access = readOnly ? "read-only" : "workspace-write";
    execution.assignment.threadId = "permission-chat";
    execution.options = runOptionsSchema.parse({
      mode: "normal",
      permissions: "auto",
      inheritPermissions: true,
    });
    await runtime.execute(execution);
    const resume = calls.find(
      (call) => call.method === "thread/resume",
    )!.params;
    const turn = calls.find((call) => call.method === "turn/start")!.params;
    if (readOnly) {
      assert.equal(resume.approvalPolicy, "never");
      assert.equal(turn.sandboxPolicy.type, "readOnly");
    } else {
      for (const key of ["approvalPolicy", "approvalsReviewer", "sandbox"])
        assert.ok(!(key in resume));
      for (const key of [
        "approvalPolicy",
        "approvalsReviewer",
        "sandboxPolicy",
      ])
        assert.ok(!(key in turn));
    }
  }
});


test("Plan mode keeps its planning addendum and read-only sandbox", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  let settings: any, turn: any;
  runtime.request = async (method, params) => {
    if (method === "config/read") return { config: { instructions: "Keep Codex instructions" } };
    if (method === "thread/start") { settings = params; return { thread: { id: "plan-thread" } }; }
    if (method === "thread/unsubscribe") return {};
    assert.equal(method, "turn/start");
    turn = params;
    queueMicrotask(() => runtime.active.get("plan-thread")!.resolve("Plan ready"));
    return { turn: { id: "plan-turn" } };
  };
  const execution = input();
  execution.agent = { ...execution.agent, id: "codex-normal", name: "Nova", access: "read-only" };
  execution.options = runOptionsSchema.parse({ mode: "plan" });
  assert.equal(await runtime.execute(execution), "Plan ready");
  assert.match(settings.developerInstructions, /^Keep Codex instructions\n\nYou are Nova/);
  assert.equal(settings.sandbox, "read-only");
  assert.match(settings.developerInstructions, /Nova/);
  assert.match(settings.developerInstructions, /request_user_input/);
  assert.match(settings.developerInstructions, /Normal or Team/);
  assert.equal(turn.collaborationMode.mode, "plan");
  assert.match(turn.collaborationMode.settings.developer_instructions, /^Keep Codex instructions\n\nYou are Nova/);
  assert.equal(turn.sandboxPolicy.type, "readOnly");
});

test("Goal turns append PixelCrew goal guidance to Codex developer instructions", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  let turn: any;
  runtime.request = async (method, params) => {
    if (method === "config/read") return { config: { instructions: "Keep Codex base instructions", developer_instructions: "Keep Codex developer instructions" } };
    if (method === "thread/start") return { thread: { id: "goal-thread" } };
    if (method === "thread/goal/set") return { goal: { objective: (params as any).objective, status: "active", tokensUsed: 0, timeUsedSeconds: 0 } };
    if (method === "turn/start") {
      turn = params;
      queueMicrotask(() => runtime.active.get("goal-thread")!.resolve("Working toward the goal."));
      return { turn: { id: "goal-turn" } };
    }
    return {};
  };
  const execution = input();
  execution.options = runOptionsSchema.parse({ mode: "normal", goalObjective: "Complete the work" });
  await runtime.execute(execution);
  assert.match(turn.collaborationMode.settings.developer_instructions, /^Keep Codex base instructions\n\nKeep Codex developer instructions\n\nPixelCrew team creation skill:/);
  assert.match(turn.collaborationMode.settings.developer_instructions, /For an active goal, track its time and token budget/);
});

test("an idle shared chat can continue on another account without changing its conversation ID", async () => {
  const runtime = new CodexRuntime(true, "C:/PixelCrew/account-b");
  runtime.status = { connected: true, authenticated: true, models: [{ id: "supported", label: "Supported" }] };
  (runtime as any).selectedModelProvider = "openai";
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method, params: any) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: {} };
    if (method === "thread/fork") return { thread: { id: "pixelcrew-shared" } };
    if (method === "thread/resume" && !params.path) throw Error("no rollout found for thread id shared");
    if (method === "thread/read") return { thread: { id: "shared", path: "C:/PixelCrew/account-a/sessions/shared.jsonl" } };
    if (method === "thread/resume") return { thread: { id: "shared" } };
    if (method === "turn/start") {
      queueMicrotask(() => runtime.active.get("pixelcrew-shared")!.resolve("Account B continued the chat"));
      return { turn: { id: "b-turn" } };
    }
    return {};
  };
  const execution = input();
  execution.sourceThreadId = "shared";
  execution.options = runOptionsSchema.parse({ mode: "normal" });
  assert.equal(await runtime.execute(execution), "Account B continued the chat");
  assert.equal((runtime as any).accountHome, "C:/PixelCrew/account-b");
  assert.ok(calls.find(call => call.method === "thread/fork")?.params.modelProvider === "openai");
  assert.equal(calls.find(call => call.method === "thread/fork")?.params.threadId, "shared");
  assert.ok(!calls.some(call => ["thread/start", "thread/resume"].includes(call.method)));
});
