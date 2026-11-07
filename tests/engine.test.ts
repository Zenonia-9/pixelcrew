import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { Engine } from "../server/engine";
import type { Execution, Runtime } from "../server/runtime";
import { finalMessages } from "../server/runtime";
import type { Assignment } from "../shared/types";
import { runOptionsSchema } from "../shared/types";
test("original sprite sheets contain eight 32px frames and tile sheet contains 16px tiles", () => {
  for (const name of ["atlas", "pip", "bolt", "mira"]) {
    const png = readFileSync(
      new URL(`../public/sprites/${name}.png`, import.meta.url),
    );
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 32);
    assert.equal(png[25], 6);
  }
  const tiles = readFileSync(
    new URL("../public/sprites/tiles.png", import.meta.url),
  );
  assert.equal(tiles.readUInt32BE(16), 48);
  assert.equal(tiles.readUInt32BE(20), 16);
});
class FakeRuntime implements Runtime {
  status = { connected: true, authenticated: true, models: [] };
  calls: Execution[] = [];
  resumed: string[] = [];
  working = 0;
  maxWorking = 0;
  writers = 0;
  maxWriters = 0;
  failReview = false;
  rejectBuild = false;
  approval = false;
  responses: boolean[] = [];
  pending?: () => void;
  async execute(input: Execution) {
    if (input.assignment.threadId) this.resumed.push(input.assignment.threadId);
    else if (input.sourceThreadId) this.resumed.push(input.sourceThreadId);
    this.calls.push(input);
    input.onThread(
      input.assignment.threadId || (input.sourceThreadId && ["normal", "plan"].includes(input.options?.mode || "")
        ? `pixelcrew-${input.sourceThreadId}`
        : "thread-" + input.assignment.id),
    );
    input.onTurn("turn-" + input.assignment.id);
    this.working++;
    this.maxWorking = Math.max(this.maxWorking, this.working);
    if (input.agent.access === "workspace-write") {
      this.writers++;
      this.maxWriters = Math.max(this.maxWriters, this.writers);
    }
    try {
      await new Promise((r) => setTimeout(r, 8));
      if (input.assignment.stage === "plan")
        return JSON.stringify({
          summary: "Test plan",
          research: [
            { agentId: "pip", objective: "Inspect source" },
            { agentId: "scout", objective: "Inspect docs" },
          ],
          build: [
            { agentId: "bolt", objective: "Implement one" },
            { agentId: "bolt", objective: "Implement two" },
          ],
        });
      if (input.assignment.stage === "build" && this.rejectBuild)
        throw new Error("Build failed");
      if (input.assignment.stage === "build" && this.approval) {
        input.onApproval(
          "approval-1",
          "item/commandExecution/requestApproval",
          { command: "example" },
        );
        await new Promise<void>((resolve) => (this.pending = resolve));
      }
      if (input.assignment.stage === "review")
        return JSON.stringify({
          passed: !this.failReview,
          findings: this.failReview ? "Needs correction" : "",
        });
      return "Result from " + input.agent.name;
    } finally {
      this.working--;
      if (input.agent.access === "workspace-write") this.writers--;
    }
  }
  async interrupt(_a: Assignment) {
    this.pending?.();
  }
  respond(_id: string, accept: boolean) {
    this.responses.push(accept);
    this.pending?.();
  }
  async reconcile(_a: Assignment) {
    return { finished: false, status: "interrupted", output: "" };
  }
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "hearth-test-"));
  const store = new Store(join(dir, "test.db"));
  const team = store.team();
  team.agents.push({
    ...structuredClone(team.agents[1]),
    id: "scout",
    name: "Scout",
    workstation: 4,
  });
  store.saveTeam(team);
  const runtime = new FakeRuntime();
  const engine = new Engine(store, runtime);
  return {
    dir,
    store,
    runtime,
    engine,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("structured results exclude commentary and tool messages", () => {
  const result = finalMessages([
    { type: "agentMessage", phase: "commentary", text: "I will check." },
    { type: "commandExecution", text: "Tool output" },
    {
      type: "agentMessage",
      phase: "final_answer",
      text: '{"passed":true,"findings":""}',
    },
  ]);
  assert.equal(JSON.parse(result).passed, true);
});
test("device tools enforce global gates and only allow isolated browser in Plan mode", async () => {
  const s = setup();
  try {
    assert.equal(s.store.preferences().allowChrome, false);
    assert.equal(s.store.preferences().allowWindowsComputer, false);
    assert.throws(
      () => s.engine.create("Inspect Chrome", "/tmp", "", [], false, false, runOptionsSchema.parse({ deviceTools: ["chrome"] })),
      /Chrome access is disabled/,
    );
    assert.throws(
      () => s.engine.create("Inspect Windows", "/tmp", "", [], false, false, runOptionsSchema.parse({ deviceTools: ["computer"] })),
      /Windows Computer access is disabled/,
    );
    assert.throws(
      () => s.engine.create("Plan with Chrome", "/tmp", "", [], false, false, runOptionsSchema.parse({ mode: "plan", deviceTools: ["chrome"] })),
      /Plan mode allows isolated Browser/,
    );
    const browser = s.engine.create("Plan with Browser", "/tmp", "", [], false, false, runOptionsSchema.parse({ mode: "plan", deviceTools: ["browser"] }));
    assert.match(browser.options?.deviceSessionId || "", /^[0-9a-f-]{36}$/i);
    await s.engine.stop(browser, true);
  } finally {
    s.close();
  }
});
async function settle(engine: Engine, id: string) {
  const until = Date.now() + 3000;
  while (engine.busy.has(id)) {
    if (Date.now() > until) throw new Error("Run did not settle");
    await new Promise((r) => setTimeout(r, 10));
  }
}
test("profiles persist; invalid imports preserve the current team", () => {
  const s = setup();
  try {
    const team = s.store.team();
    team.agents[1].name = "Renamed";
    s.store.saveTeam(team);
    assert.equal(s.store.team().agents[1].name, "Renamed");
    assert.throws(() => s.store.saveTeam({ ...team, agents: [] }));
    assert.equal(s.store.team().agents[1].name, "Renamed");
    assert.throws(() =>
      s.store.saveTeam({ ...team, agents: [...team.agents, team.agents[0]] }),
    );
  } finally {
    s.close();
  }
});
test("run snapshots isolate edits; shared-chat members take turns and writers serialize", async () => {
  const s = setup();
  try {
    const run = s.engine.create("Make it", "/tmp", "", [], false, true);
    run.references = [];
    const team = s.store.team();
    team.agents[1].name = "Changed";
    s.store.saveTeam(team);
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.team.agents[1].name, "Pip");
    assert.equal(s.runtime.maxWorking, 1);
    assert.equal(
      new Set(run.assignments.map((assignment) => assignment.threadId)).size,
      1,
    );
    assert.equal(s.runtime.maxWriters, 1);
    assert.ok(s.runtime.calls.some((c) => c.agent.name === "Pip"));
    assert.equal(
      s.runtime.calls.filter((c) => c.assignment.stage === "build").length,
      2,
    );
    assert.ok(run.result.includes("Atlas"));
  } finally {
    s.close();
  }
});
test("read-only tasks enforce read-only execution even for builders", async () => {
  const s = setup();
  try {
    const run = s.engine.create("Inspect", "/tmp");
    await settle(s.engine, run.id);
    assert.ok(s.runtime.calls.every((c) => c.agent.access === "read-only"));
  } finally {
    s.close();
  }
});

test("plan mode runs only Nova with read-only permissions", async () => {
  const s = setup();
  try {
    const run = s.engine.create(
      "Plan only",
      "/tmp",
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({ mode: "plan" }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(s.runtime.calls.length, 1);
    assert.equal(s.runtime.calls[0].agent.access, "read-only");
    assert.equal(s.runtime.calls[0].options?.mode, "plan");
    assert.equal(s.runtime.calls[0].agent.id, "codex-normal");
    assert.equal(s.runtime.calls[0].agent.name, "Nova");
    assert.equal(run.nativeTeam, false);
  } finally {
    s.close();
  }
});

test("Normal mode continues the existing chat once using the selected model", async () => {
  const s = setup();
  try {
    (s.runtime.status as any).models = [
      { id: "gpt-6-luna", label: "Luna", efforts: ["low", "medium"] },
    ];
    const run = s.engine.create(
      "Direct question",
      "/tmp",
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({
        mode: "normal",
        sourceThreadId: "existing",
        models: { "codex-normal": { model: "gpt-6-luna", reasoning: "low" } },
      }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(s.runtime.calls.length, 1);
    assert.equal(s.runtime.calls[0].agent.name, "Nova");
    assert.equal(s.runtime.calls[0].agent.id, "codex-normal");
    assert.equal(s.runtime.calls[0].agent.model, "gpt-6-luna");
    assert.equal(s.runtime.calls[0].agent.access, "read-only");
    assert.equal(s.runtime.calls[0].prompt, "Direct question");
    assert.deepEqual(s.runtime.resumed, ["existing"]);
  } finally {
    s.close();
  }
});

test("handoff events point to completed results actually sent in the recipient prompt", async () => {
  const s = setup();
  try {
    const run = s.engine.create("Share evidence", "/tmp");
    await settle(s.engine, run.id);
    const handoffs = s.store
      .events()
      .filter((e) => e.runId === run.id && e.handoff);
    assert.ok(handoffs.length);
    for (const event of handoffs) {
      const h = event.handoff!,
        source = run.assignments.find((a) => a.id === h.sourceAssignmentId)!;
      const target = s.runtime.calls.find(
        (c) => c.assignment.id === h.targetAssignmentId,
      )!;
      assert.equal(source.status, "completed");
      assert.equal(target.agent.id, h.to);
      assert.equal(source.agentId, h.from);
      assert.ok(
        JSON.parse(target.context || target.prompt).previousResults.some(
          (r: any) => r.result === source.output,
        ),
      );
    }
  } finally {
    s.close();
  }
});
test("review allows one revision cycle and retains unresolved findings", async () => {
  const s = setup();
  try {
    s.runtime.failReview = true;
    const run = s.engine.create("Review", "/tmp");
    await settle(s.engine, run.id);
    assert.equal(run.revision, 1);
    assert.equal(
      s.runtime.calls.filter((c) => c.assignment.stage === "review").length,
      2,
    );
    assert.equal(run.status, "failed");
    assert.match(run.error!, /Review findings/);
    assert.ok(run.result);
  } finally {
    s.close();
  }
});
test("approval is routed to the requesting assignment and can be declined", async () => {
  const s = setup();
  try {
    s.runtime.approval = true;
    const run = s.engine.create("Approve", "/tmp");
    while (!s.engine.approvals.length)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(run.status, "approval");
    assert.equal(s.engine.approvals[0].agentId, "bolt");
    s.runtime.approval = false;
    s.engine.approve("approval-1", false);
    await settle(s.engine, run.id);
    assert.deepEqual(s.runtime.responses, [false]);
    assert.equal(run.status, "completed");
  } finally {
    s.close();
  }
});
test("cancellation stops downstream work and preserves completed outputs", async () => {
  const s = setup();
  try {
    s.runtime.approval = true;
    const run = s.engine.create("Cancel", "/tmp");
    while (!s.engine.approvals.length)
      await new Promise((r) => setTimeout(r, 5));
    await s.engine.stop(run, true);
    await settle(s.engine, run.id);
    assert.equal(run.status, "cancelled");
    assert.ok(
      run.assignments.some((a) => a.status === "completed" && a.output),
    );
    assert.ok(!s.runtime.calls.some((c) => c.assignment.stage === "final"));
    assert.equal(s.engine.approvals.length, 0);
  } finally {
    s.close();
  }
});
test("failed assignment retry reuses completed work rather than replanning", async () => {
  const s = setup();
  try {
    s.runtime.rejectBuild = true;
    const run = s.engine.create("Retry", "/tmp");
    await settle(s.engine, run.id);
    assert.equal(run.status, "failed");
    s.runtime.rejectBuild = false;
    await s.engine.resume(run);
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(
      s.runtime.calls.filter((c) => c.assignment.stage === "plan").length,
      1,
    );
  } finally {
    s.close();
  }
});
test("service restart marks active tasks interrupted and preserves completed assignments", () => {
  const s = setup();
  try {
    const run = s.engine.create("Tour", "/tmp", "", [], true);
    clearTimeout(s.engine.demoTimers.get(run.id));
    const next = new Engine(s.store, s.runtime);
    assert.equal(next.runs[0].status, "interrupted");
    assert.match(next.runs[0].error!, /Service restarted/);
    assert.equal(s.store.runs()[0].id, run.id);
  } finally {
    s.close();
  }
});
test("separate chats can be active and malformed lead plans fail before writing", async () => {
  const s = setup();
  try {
    s.runtime.execute = async () => '{"bad":"plan"}';
    const run = s.engine.create("Invalid", "/tmp");
    const second = s.engine.create("Second", "/tmp");
    await settle(s.engine, run.id);
    await settle(s.engine, second.id);
    assert.equal(run.status, "failed");
    assert.equal(run.assignments.length, 2);
  } finally {
    s.close();
  }
});

test("Normal clarification waits with Nova's identity and continues in the same chat", async () => {
  const s = setup();
  try {
    let calls = 0;
    s.runtime.execute = async (input) => {
      input.onThread("normal-question-chat");
      input.onTurn("turn-" + ++calls);
      return calls === 1
        ? "Got it: `Python/exercises/`. What should the new exercise program do?"
        : "Here is the requested explanation.";
    };
    const run = s.engine.create(
      "Explain an exercise",
      "/tmp",
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({ mode: "normal" }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "approval");
    assert.equal(run.assignments[0].status, "completed");
    assert.equal(run.assignments[0].agentId, "codex-normal");
    assert.match(run.question!.text, /^What should/);
    await s.engine.queueMessage(run, "Explain lists");
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.chatThreadId, "normal-question-chat");
    assert.equal(calls, 2);
  } finally {
    s.close();
  }
});

test("a conversational planner refusal gets one delegation repair before a build", async () => {
  const s = setup();
  try {
    let plans = 0;
    s.runtime.execute = async (input) => {
      s.runtime.calls.push(input);
      input.onThread("repair-chat");
      input.onTurn(input.assignment.id);
      if (input.assignment.stage === "plan")
        return ++plans === 1
          ? "This stage is read-only, so I cannot create the file."
          : "Use the existing naming convention.\n\nResearch\nNone\n\nBuild\n- bolt: Create the requested exercise and verify it.";
      if (input.assignment.stage === "review")
        return "PASS\nThe supplied exercise meets the request.";
      return "Completed the assigned work.";
    };
    const run = s.engine.create(
      "Create any simple exercise, you choose",
      s.dir,
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({ mode: "team" }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(plans, 2);
    assert.equal(
      s.runtime.calls.filter((call) => call.assignment.stage === "build")
        .length,
      1,
    );
    assert.match(
      s.runtime.calls[0].responseInstructions!,
      /delegate implementation/,
    );
    assert.match(s.runtime.calls[1].context!, /Repair your previous response/);
  } finally {
    s.close();
  }
});

test("multiple Normal chats execute independently while a duplicate chat is rejected", async () => {
  const s = setup();
  try {
    const options = (id: string) =>
      runOptionsSchema.parse({ mode: "normal", sourceThreadId: id });
    const first = s.engine.create(
      "One",
      "/tmp",
      "",
      [],
      false,
      false,
      options("one"),
    );
    const second = s.engine.create(
      "Two",
      "/tmp",
      "",
      [],
      false,
      false,
      options("two"),
    );
    assert.throws(
      () =>
        s.engine.create(
          "Duplicate",
          "/tmp",
          "",
          [],
          false,
          false,
          options("one"),
        ),
      /already has an active task/,
    );
    await Promise.all([
      settle(s.engine, first.id),
      settle(s.engine, second.id),
    ]);
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(s.runtime.maxWorking, 2);
  } finally {
    s.close();
  }
});

test("two team chats finish independently without overlapping workspace writers", async () => {
  const s = setup();
  try {
    const first = s.engine.create(
      "First team task",
      s.dir,
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({ mode: "team" }),
    );
    const second = s.engine.create(
      "Second team task",
      s.dir,
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({ mode: "team" }),
    );
    await Promise.all([
      settle(s.engine, first.id),
      settle(s.engine, second.id),
    ]);
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.equal(s.runtime.maxWriters, 1);
    assert.equal(s.runtime.maxWorking, 2);
    assert.notEqual(first.chatThreadId, second.chatThreadId);
    assert.ok(
      first.assignments.every((a) => a.threadId === first.chatThreadId),
    );
    assert.ok(
      second.assignments.every((a) => a.threadId === second.chatThreadId),
    );
  } finally {
    s.close();
  }
});
test("question responses require answers and return to the owning member", () => {
  const s = setup();
  try {
    const run = s.engine.create("Question preview", "/tmp", "", [], true);
    clearTimeout(s.engine.demoTimers.get(run.id));
    run.demo = false;
    const assignment = run.assignments[0];
    assignment.status = "approval";
    run.status = "approval";
    s.engine.approvals.push({
      id: "q1",
      runId: run.id,
      assignmentId: assignment.id,
      agentId: assignment.agentId,
      method: "item/tool/requestUserInput",
      title: "Choose",
      detail: "",
      questions: [{ id: "choice", question: "Which option?" }],
    });
    assert.throws(
      () => s.engine.approve("q1", true, {}),
      /Answer each question/,
    );
    s.engine.approve("q1", true, { choice: "First option" });
    assert.equal(s.engine.approvals.length, 0);
    assert.equal(assignment.status, "running");
    assert.deepEqual(s.runtime.responses, [true]);
  } finally {
    s.close();
  }
});

test("a clarification waits for the user, survives restart, and resumes the same run on reply", async () => {
  const s = setup();
  try {
    const execute = s.runtime.execute.bind(s.runtime);
    let plans = 0;
    s.runtime.execute = async (input) => {
      const output = await execute(input);
      return input.assignment.stage === "plan" && plans++ === 0
        ? "Question for you: What should the Python program do?"
        : output;
    };
    const run = s.engine.create("Create a Python program", s.dir);
    await settle(s.engine, run.id);
    assert.equal(run.status, "approval");
    assert.equal(run.question?.text, "What should the Python program do?");
    assert.equal(s.runtime.calls.length, 1);
    const restored = new Engine(s.store, s.runtime);
    const pending = restored.runs.find((r) => r.id === run.id)!;
    assert.equal(pending.status, "approval");
    assert.equal(pending.question?.text, run.question?.text);
    restored.queueMessage(pending, "Make a calculator.");
    await settle(restored, pending.id);
    assert.equal(pending.status, "completed");
    assert.equal(pending.question, undefined);
    assert.equal(pending.assignments.filter((a) => a.question).length, 1);
    assert.equal(
      pending.assignments.filter((a) => a.stage === "plan").length,
      2,
    );
    assert.equal(s.runtime.calls[1].prompt, "Make a calculator.");
    assert.equal(pending.inbox?.[0].status, "delivered");
  } finally {
    s.close();
  }
});

test("Normal mode queues a follow-up once in the same conversation", async () => {
  const s = setup();
  try {
    const execute = s.runtime.execute.bind(s.runtime);
    s.runtime.execute = async (input) =>
      input.agent.id === "codex-normal"
        ? (await execute(input), "Direct result")
        : execute(input);
    const run = s.engine.create(
      "Initial request",
      s.dir,
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({
        mode: "normal",
        sourceThreadId: "shared-normal",
      }),
    );
    await s.engine.queueMessage(run, "Follow-up message", [], [], "queue");
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(s.runtime.calls.length, 2);
    assert.equal(s.runtime.calls[1].prompt, "Follow-up message");
    assert.equal(run.inbox?.[0].status, "delivered");
    assert.ok(run.assignments.every((a) => a.threadId === "pixelcrew-shared-normal"));
  } finally {
    s.close();
  }
});

test("queued follow-up applies its selected approval mode on the next turn", async () => {
  const s = setup();
  try {
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: Execution[] = [];
    s.runtime.execute = async (input) => {
      calls.push(input);
      input.onThread(input.assignment.threadId || "shared-permissions");
      input.onTurn(`turn-${calls.length}`);
      if (calls.length === 1) {
        markFirstStarted();
        await firstTurn;
        return "Initial turn";
      }
      return "Follow-up turn";
    };
    const run = s.engine.create(
      "Initial request",
      s.dir,
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({
        mode: "normal",
        sourceThreadId: "shared-permissions",
        permissions: "ask",
        inheritPermissions: true,
      }),
    );
    await firstStarted;
    await s.engine.queueMessage(run, "Follow-up request", [], [], "queue", "auto");
    releaseFirst();
    await settle(s.engine, run.id);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options?.permissions, "ask");
    assert.equal(calls[1].options?.permissions, "auto");
    assert.equal(calls[1].options?.inheritPermissions, false);
    assert.equal(run.inbox?.[0].permissions, "auto");
  } finally {
    s.close();
  }
});

test("plain question choices wait in Plan mode and an answer continues the same task", async () => {
  const s = setup();
  try {
    let count = 0;
    s.runtime.execute = async (input) => {
      input.onThread("question-chat");
      input.onTurn(`turn-${count}`);
      return count++ === 0
        ? "Which theme should the plan use?\n- Light — Bright background\n- Dark — Dark background"
        : "Plan: use the selected Dark theme.";
    };
    const run = s.engine.create(
      "Ask me for a theme",
      s.dir,
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({ mode: "plan" }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "approval");
    assert.match(run.question!.text, /Dark/);
    await s.engine.queueMessage(run, "Dark");
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.chatThreadId, "question-chat");
    assert.equal(run.assignments.length, 2);
  } finally {
    s.close();
  }
});

test("a planner question inside an empty Research/Build plan waits before final synthesis", async () => {
  const s = setup();
  try {
    s.runtime.execute = async (input) => {
      input.onThread("missing-purpose");
      input.onTurn("question");
      return "## Summary\n\nThis needs one detail before the build can be planned: what should the Python program do?\n\n### Research\n- None\n\n### Build\n- None";
    };
    const run = s.engine.create(
      "Create simple Python program under Python folder",
      s.dir,
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "approval");
    assert.match(run.question!.text, /^What should the Python program do\?/);
    assert.equal(run.assignments.length, 1);
    assert.equal(run.assignments[0].stage, "plan");
    assert.equal(run.result, "");
  } finally {
    s.close();
  }
});

test("a small calculator routes directly to one builder and keeps Auto on Luna/low", async () => {
  const s = setup();
  try {
    Object.assign(s.runtime.status, {
      models: [
        { id: "gpt-6-luna", label: "Luna", efforts: ["low", "medium", "high"] },
        { id: "gpt-6.1-sol", label: "Sol", efforts: ["low", "medium", "high"] },
      ],
    });
    const run = s.engine.create(
      "Create a simple Python calculator",
      s.dir,
      "",
      [],
      false,
      true,
      runOptionsSchema.parse({ mode: "team" }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.deepEqual(
      s.runtime.calls.map((c) => c.assignment.stage),
      ["build", "review", "final"],
    );
    assert.equal(run.directPlan?.build.length, 1);
    assert.ok(
      s.runtime.calls.every(
        (c) => c.agent.model === "gpt-6-luna" && c.agent.reasoning === "low",
      ),
    );
  } finally {
    s.close();
  }
});

test("a calculator answer resumes directly with the builder instead of replanning", async () => {
  const s = setup();
  try {
    const execute = s.runtime.execute.bind(s.runtime);
    s.runtime.execute = async (input) => {
      const output = await execute(input);
      return input.assignment.stage === "plan"
        ? "Question for you: What should the Python program do?"
        : output;
    };
    const run = s.engine.create(
      "Create a simple Python program",
      s.dir,
      "",
      [],
      false,
      true,
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "approval");
    await s.engine.queueMessage(run, "A calculator");
    await settle(s.engine, run.id);
    assert.equal(run.status, "completed");
    assert.deepEqual(
      s.runtime.calls.map((c) => c.assignment.stage),
      ["plan", "build", "review", "final"],
    );
    assert.match(run.directPlan!.build[0].objective, /A calculator/);
    assert.equal(run.inbox![0].status, "delivered");
  } finally {
    s.close();
  }
});

test("native teams execute one coordinator and retain actual child assignments and result handoffs", async () => {
  const s = setup();
  try {
    (s.runtime as Runtime).nativeTeams = true;
    s.runtime.execute = async (input) => {
      s.runtime.calls.push(input);
      input.onThread("native-parent");
      input.onTurn("parent-turn");
      input.onSubagent!({
        agentId: "pip",
        threadId: "native-pip",
        status: "running",
        objective: "Inspect supplied fact",
      });
      input.onApproval(
        "native-question",
        "item/tool/requestUserInput",
        {},
        { agentId: "pip", threadId: "native-pip" },
      );
      input.onSubagent!({
        agentId: "pip",
        threadId: "native-pip",
        status: "running",
        progress: "Waiting",
      });
      assert.equal(
        s.engine.runs[0].assignments.find((a) => a.agentId === "pip")?.status,
        "approval",
      );
      s.engine.approve("native-question", true);
      input.onSubagent!({
        agentId: "pip",
        threadId: "native-pip",
        turnId: "pip-turn",
        status: "completed",
        output: "Verified fact",
      });
      return "Collected verified fact";
    };
    const run = s.engine.create(
      "Investigate supplied fact",
      s.dir,
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({
        mode: "team",
        models: {},
        attachments: [],
        mentions: [],
      }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.nativeTeam, true);
    assert.equal(run.status, "completed");
    assert.equal(s.runtime.calls.length, 1);
    assert.ok(s.runtime.calls[0].nativeTeam);
    assert.equal(
      run.assignments.find((a) => a.agentId === "pip")?.output,
      "Verified fact",
    );
    assert.ok(
      s.store
        .events()
        .some((e) => e.handoff?.from === "pip" && e.handoff?.to === "atlas"),
    );
  } finally {
    s.close();
  }
});

test("native writer conflicts pause without fake child work or duplicate user turns", async () => {
  const s = setup();
  try {
    (s.runtime as Runtime).nativeTeams = true;
    s.runtime.execute = async () => {
      throw Error("thread native-parent already has an active writer");
    };
    const run = s.engine.create(
      "Inspect supplied fact",
      s.dir,
      "",
      [],
      false,
      false,
      runOptionsSchema.parse({
        mode: "team",
        sourceThreadId: "native-parent",
        models: {},
        attachments: [],
        mentions: [],
      }),
    );
    await settle(s.engine, run.id);
    assert.equal(run.status, "interrupted");
    assert.match(run.error!, /previous message was not delivered/);
    assert.equal(run.assignments.length, 1);
    assert.equal(run.inbox?.length, 0);
  } finally {
    s.close();
  }
});


test("a completed Nova plan can continue in Normal or Team in the same conversation", async () => {
  for (const mode of ["normal", "team"] as const) {
    const s = setup();
    try {
      const plan = s.engine.create("Plan a feature", s.dir, "", [], false, true, runOptionsSchema.parse({ mode: "plan" }));
      await settle(s.engine, plan.id);
      const threadId = plan.chatThreadId;
      assert.ok(threadId);
      const implementation = s.engine.create("Implement the agreed plan", s.dir, "", [], false, true, runOptionsSchema.parse({ mode, sourceThreadId: threadId }));
      await settle(s.engine, implementation.id);
      assert.equal(implementation.status, "completed");
      assert.ok(s.runtime.resumed.includes(threadId));
      assert.ok(s.runtime.calls.some(call => call.options?.mode === mode && call.agent.access === "workspace-write"));
    } finally { s.close(); }
  }
});

test("different accounts can run separate chats but cannot run the same chat together", async () => {
  const s = setup();
  try {
    const first = s.engine.create("Read-only task A", s.dir, "", [], false, false, runOptionsSchema.parse({ mode: "normal", sourceThreadId: "chat-a" }), "", "account-a");
    assert.throws(() => s.engine.create("Competing task", s.dir, "", [], false, false, runOptionsSchema.parse({ mode: "normal", sourceThreadId: "chat-a" }), "", "account-b"), /already has an active task/);
    const second = s.engine.create("Read-only task B", s.dir, "", [], false, false, runOptionsSchema.parse({ mode: "normal", sourceThreadId: "chat-b" }), "", "account-b");
    await Promise.all([settle(s.engine, first.id), settle(s.engine, second.id)]);
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    assert.deepEqual(s.runtime.calls.map(call => call.accountId).sort(), ["account-a", "account-b"]);
  } finally { s.close(); }
});
