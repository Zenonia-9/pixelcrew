import { test } from "node:test";
import assert from "node:assert/strict";
import { CodexRuntime } from "../server/runtime";
import { isValidGoalTokenBudgetInput, MAX_GOAL_OBJECTIVE_LENGTH, runOptionsSchema, threadGoalUpdateSchema } from "../shared/types";
import { composerPreferencesSchema } from "../shared/preferences";
import { starterTeam } from "../shared/defaults";
import type { Execution } from "../server/runtime";
import { GoalReadGeneration } from "../shared/goal-read-generation";
import { formatGoalDuration } from "../shared/goal-format";
import { Store } from "../server/store";
import { Engine } from "../server/engine";
import { normalizeTurn } from "../server/chat-history";
import {
  threadGoalCanEdit,
  threadGoalCanResume,
  threadGoalStatusAfterEdit,
  GOAL_CONTINUATION_INPUT,
} from "../shared/thread-goal-controls";

test("Goal mode preferences survive parsing and submit as a normal Codex chat with a thread objective", () => {
  const preferences = composerPreferencesSchema.parse({
    mode: "goal",
    permissions: "ask",
    allowWrite: true,
    models: {},
  });
  assert.equal(preferences.mode, "goal");
  const options = runOptionsSchema.parse({
    mode: "normal",
    goalObjective: "Implement the feature and pass its tests.\n\nSuccess criteria: all tests pass",
    goalTokenBudget: null,
  });
  assert.equal(options.mode, "normal");
  assert.match(options.goalObjective || "", /Success criteria: all tests pass/);
  assert.equal(options.goalTokenBudget, null);
  assert.equal(runOptionsSchema.parse({ mode: "normal", goalObjective: "Ship", goalTokenBudget: 12000 }).goalTokenBudget, 12000);
  assert.throws(() => runOptionsSchema.parse({ mode: "normal", goalObjective: "Ship", goalTokenBudget: 0 }));
  assert.equal(isValidGoalTokenBudgetInput(""), true);
  assert.equal(isValidGoalTokenBudgetInput("12000"), true);
  assert.equal(isValidGoalTokenBudgetInput("0"), false);
  assert.equal(isValidGoalTokenBudgetInput("1.5"), false);
  assert.equal(isValidGoalTokenBudgetInput("9007199254740992"), false);
  assert.equal(runOptionsSchema.parse({ mode: "normal", goalObjective: "x".repeat(MAX_GOAL_OBJECTIVE_LENGTH) }).goalObjective?.length, MAX_GOAL_OBJECTIVE_LENGTH);
  assert.throws(() => runOptionsSchema.parse({ mode: "normal", goalObjective: "x".repeat(MAX_GOAL_OBJECTIVE_LENGTH + 1) }));
  assert.equal(threadGoalUpdateSchema.parse({ objective: "x".repeat(MAX_GOAL_OBJECTIVE_LENGTH) }).objective?.length, MAX_GOAL_OBJECTIVE_LENGTH);
  assert.throws(() => threadGoalUpdateSchema.parse({ objective: "x".repeat(MAX_GOAL_OBJECTIVE_LENGTH + 1) }));
});

test("a Goal poll cannot overwrite a newer user lifecycle action", () => {
  const reads = new GoalReadGeneration();
  const pollStartedBeforePause = reads.begin();
  reads.invalidate();
  assert.equal(reads.isCurrent(pollStartedBeforePause), false);
  const pollStartedAfterPause = reads.begin();
  assert.equal(reads.isCurrent(pollStartedAfterPause), true);
});

test("Goal duration retains seconds for short runs and omits empty hour units", () => {
  assert.equal(formatGoalDuration(0), "0s");
  assert.equal(formatGoalDuration(12.8), "12s");
  assert.equal(formatGoalDuration(59), "59s");
  assert.equal(formatGoalDuration(60), "1m");
  assert.equal(formatGoalDuration(3660), "1h 1m");
  assert.equal(formatGoalDuration(3600), "1h");
  assert.equal(formatGoalDuration(-5), "0s");
});

test("limited and blocked Goals expose recovery actions", () => {
  assert.equal(threadGoalCanEdit("budgetLimited"), true);
  assert.equal(threadGoalStatusAfterEdit("budgetLimited"), "active");
  assert.equal(threadGoalCanResume("budgetLimited"), false, "increase the budget before resuming");
  assert.equal(threadGoalCanEdit("blocked"), true);
  assert.equal(threadGoalCanResume("blocked"), true);
  assert.equal(threadGoalStatusAfterEdit("blocked"), "active");
  assert.equal(threadGoalCanEdit("usageLimited"), true);
  assert.equal(threadGoalCanResume("usageLimited"), true);
  assert.equal(threadGoalStatusAfterEdit("usageLimited"), "active");
  assert.equal(threadGoalCanResume("paused"), true);
  assert.equal(threadGoalStatusAfterEdit("paused"), "paused");
  assert.equal(threadGoalCanEdit("complete"), false);
});

test("native thread goal API forwards user lifecycle operations to Codex", async () => {
  const runtime = new CodexRuntime();
  runtime.status.connected = true;
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "thread/goal/get") return { goal: null };
    if (method === "thread/goal/set") return { goal: { ...params, status: params.status || "active" } };
    return {};
  };
  assert.equal(await runtime.getThreadGoal("chat-1"), null);
  const goal = await runtime.setThreadGoal("chat-1", { objective: "Ship the feature", status: "active", tokenBudget: 12000 });
  assert.equal(goal.objective, "Ship the feature");
  assert.equal(goal.tokenBudget, 12000);
  await runtime.setThreadGoal("chat-1", { status: "paused" });
  await runtime.clearThreadGoal("chat-1");
  assert.deepEqual(calls.map(call => call.method), [
    "thread/goal/get",
    "thread/goal/set",
    "thread/goal/set",
    "thread/goal/clear",
  ]);
  assert.equal(calls[1].params.origin, "user");
  assert.equal(calls[1].params.tokenBudget, 12000);
  assert.deepEqual(calls[3].params, { threadId: "chat-1", origin: "user" });
  await runtime.shutdown();
});

test("Goal is set on the native thread before its first turn starts", async () => {
  const runtime = new CodexRuntime(true);
  runtime.status = { connected: true, authenticated: true, models: [] };
  const calls: { method: string; params: any }[] = [];
  runtime.request = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: {} };
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "goal-thread" } };
    if (method === "thread/fork") return { thread: { id: "goal-fork" } };
    if (method === "thread/goal/set")
      return { goal: { ...params, status: params.status || "active" } };
    if (method === "thread/goal/get") return { goal: { status: "active" } };
    if (method === "turn/start") {
      queueMicrotask(() => runtime.active.get(params.threadId)!.resolve("Done"));
      return { turn: { id: "goal-turn" } };
    }
    return {};
  };
  const execution: Execution = {
    agent: structuredClone(starterTeam.agents[0]),
    assignment: {
      id: "goal-assignment",
      agentId: starterTeam.agents[0].id,
      stage: "plan",
      objective: "Complete the goal",
      status: "running",
      output: "",
    },
    workspace: "C:\\Work\\Example",
    prompt: "Start the implementation",
    options: runOptionsSchema.parse({
      mode: "normal",
      goalObjective: "Ship the feature and verify it",
      goalTokenBudget: 12000,
    }),
    onThread() {},
    onTurn() {},
    onEvent() {},
    onApproval() {},
  };

  assert.equal(await runtime.execute(execution), "Done");
  const goalIndex = calls.findIndex((call) => call.method === "thread/goal/set");
  const turnIndex = calls.findIndex((call) => call.method === "turn/start");
  assert.ok(goalIndex >= 0 && goalIndex < turnIndex);
  assert.equal(calls[goalIndex].params.threadId, "goal-thread");
  assert.equal(calls[goalIndex].params.objective, "Ship the feature and verify it");
  assert.equal(calls[goalIndex].params.tokenBudget, 12000);
  await runtime.execute({ ...execution, goalContinuation: true, sourceThreadId: "goal-thread", options: runOptionsSchema.parse({ mode: "normal" }) });
  const continuation = calls.filter(call => call.method === "turn/start").at(-1)!;
  assert.equal(continuation.params.turnTrigger, "goal");
  assert.deepEqual(continuation.params.input, [{ type: "text", text: GOAL_CONTINUATION_INPUT }]);
  const transcript = normalizeTurn({ id: "continuation", status: "completed", items: [
    { type: "userMessage", id: "system", text: GOAL_CONTINUATION_INPUT },
    { type: "userMessage", id: "human", text: "Continue with the second stage" },
  ] });
  assert.deepEqual(transcript.users.map(user => user.text), ["Continue with the second stage"], "the harness prompt must not appear as a message from the user");
  await runtime.shutdown();
});

test("Goal reads and controls reach the worker before a new thread is persisted", async () => {
  const runtime = new CodexRuntime();
  const worker = new CodexRuntime(true);
  runtime.status = worker.status = { connected: true, authenticated: true, models: [] };
  runtime.createExecutionWorker = () => worker;
  runtime.request = async () => { throw Error("thread not found on the catalog connection"); };
  let goal: any = null;
  worker.request = async (method, params: any) => {
    if (method === "thread/start") return { thread: { id: "new-goal-thread" } };
    if (method === "thread/goal/set") return { goal: goal = { ...goal, ...params } };
    if (method === "thread/goal/get") return { goal };
    if (method === "thread/goal/clear") { goal = null; return {}; }
    if (method === "turn/start") {
      queueMicrotask(async () => {
        try {
          assert.equal((await runtime.getThreadGoal("new-goal-thread"))?.objective, "Test Goal");
          await runtime.setThreadGoal("new-goal-thread", { status: "paused" });
          assert.equal((await runtime.getThreadGoal("new-goal-thread"))?.status, "paused");
          await runtime.clearThreadGoal("new-goal-thread");
          assert.equal(await runtime.getThreadGoal("new-goal-thread"), null);
          worker.active.get("new-goal-thread")!.resolve("Done");
        } catch (error) { worker.active.get("new-goal-thread")!.reject(error as Error); }
      });
      return { turn: { id: "turn-1" } };
    }
    return {};
  };
  const input: Execution = {
    agent: structuredClone(starterTeam.agents[0]),
    assignment: { id: "new-assignment", agentId: "atlas", stage: "build", objective: "Test", status: "running", output: "" },
    workspace: "C:\\Work\\Example", prompt: "Test",
    onThread(id) { assert.equal(id, "new-goal-thread"); }, onEvent() {}, onApproval() {}, onTurn() {},
  };
  const execution = runtime.execute({ ...input, options: runOptionsSchema.parse({ mode: "normal", goalObjective: "Test Goal" }) });
  assert.equal(await execution, "Done");
  await runtime.shutdown();
});

test("answering a Goal question preserves an edited budget and persists initialization", async () => {
  const store = new Store(":memory:");
  const runtime = new CodexRuntime();
  runtime.status = { connected: true, authenticated: true, models: [] };
  runtime.getThreadGoal = async () => null;
  let budget = 20000;
  let calls = 0;
  runtime.execute = async input => {
    calls++;
    input.onThread("persistent-goal");
    if (input.options?.goalObjective) {
      budget = input.options.goalTokenBudget!;
      input.onGoalInitialized?.();
    }
    input.onTurn(`turn-${calls}`);
    return calls === 1 ? "Question for you: Which word should I return?" : "GOAL_UI_OK";
  };
  const engine = new Engine(store, runtime);
  const run = engine.create("Ask me for a word", "C:\\Work\\Example", "", [], false, false,
    runOptionsSchema.parse({ mode: "normal", goalObjective: "Return my chosen word", goalTokenBudget: 20000 }));
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (engine.busy.has(run.id)) {
      if (Date.now() > deadline) throw Error("Goal did not settle");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  try {
    await settle();
    assert.ok(run.question);
    assert.equal(store.runs()[0].goalInitialized, true);
    budget = 100000; // The user raises the budget in the Goal card.
    await engine.queueMessage(run, "GOAL_UI_OK");
    await settle();
    assert.equal(run.status, "completed");
    assert.equal(calls, 2);
    assert.equal(budget, 100000);
    assert.equal(run.options?.goalTokenBudget, 20000, "historical submission stays intact");
  } finally {
    store.close();
    await runtime.shutdown();
  }
});

test("active Goals continue across turns, pause without completing, and resume once", async () => {
  const store = new Store(":memory:");
  const runtime = new CodexRuntime();
  runtime.status = { connected: true, authenticated: true, models: [] };
  let status: import("../shared/types").ThreadGoalStatus = "active";
  const calls: Execution[] = [];
  runtime.getThreadGoal = async () => ({ threadId: "goal-chat", objective: "Two stages", status, tokensUsed: 1, timeUsedSeconds: 1, createdAt: 1, updatedAt: 1 });
  runtime.execute = async input => {
    calls.push(input);
    input.onThread("goal-chat");
    if (input.options?.goalObjective) input.onGoalInitialized?.();
    input.onTurn(`turn-${calls.length}`);
    if (calls.length === 2) status = "paused";
    if (calls.length === 3) status = "complete";
    return `Stage ${calls.length}`;
  };
  const engine = new Engine(store, runtime);
  const run = engine.create("Two stages", "C:\\Work\\Example", "", [], false, false,
    runOptionsSchema.parse({ mode: "normal", goalObjective: "Two stages" }));
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (engine.busy.has(run.id)) {
      if (Date.now() > deadline) throw Error("Goal did not settle");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  try {
    await settle();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].goalContinuation, true);
    assert.equal(calls[1].options?.goalObjective, undefined);
    assert.equal(run.status, "interrupted");
    status = "active";
    engine.continueGoal("goal-chat");
    engine.continueGoal("goal-chat");
    await settle();
    assert.equal(calls.length, 3, "a double Resume must not launch duplicate turns");
    assert.equal(run.status, "completed");
    assert.equal(run.result, "Stage 3");
  } finally {
    store.close();
    await runtime.shutdown();
  }
});
