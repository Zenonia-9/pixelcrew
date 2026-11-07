import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { starterTeam } from "../shared/defaults";
import type { Run } from "../shared/types";
import { groupMessages, completedBoardTasks } from "../shared/group-chat";
import { planResult, reviewResult } from "../shared/agent-results";
import { GroupChat, NativeChatTurn, TeamMessageTurn } from "../src/GroupChat";
import { normalAgent } from "../shared/normal-agent";
import { runOptionsSchema } from "../shared/types";
test("Normal chat bubbles use the shared identity without changing historical team snapshots", () => {
  const task = run();
  task.options = runOptionsSchema.parse({ mode: "normal" });
  task.team.normalAppearance = { name: "Cipher", sprite: "nova", look: "frost" };
  const snapshot = structuredClone(task.team);
  const html = renderToStaticMarkup(createElement(GroupChat, {
    runs: [task], events: [], onDetails() {}, sharedNormal: normalAgent(starterTeam.agents[0]),
  }));
  assert.ok(html.includes("Nova"));
  assert.ok(!html.includes("Cipher"));
  assert.deepEqual(task.team, snapshot);
});
test("team usage limits render once as a system message outside agent bubbles", () => {
  const task = run();
  task.status = "failed";
  task.error = "You've hit your usage limit.";
  for (const assignment of task.assignments) {
    assignment.status = "failed";
    assignment.error = task.error;
    assignment.output = "";
  }
  const html = renderToStaticMarkup(createElement(GroupChat, { runs: [task], events: [], onDetails() {} }));
  assert.equal((html.match(/chat-system-message/g) || []).length, 1);
  assert.ok(!html.includes('class="group-member'));
  assert.ok(html.includes("Upgrade your plan or add credits"));
});

test("goal clearing does not show an empty automatic continuation as a chat reply", () => {
  const task = run();
  task.goalInitialized = true;
  const continuation = {
    id: "goal-continuation",
    agentId: "atlas",
    stage: "build" as const,
    objective: "Continue the thread goal (3).",
    status: "running" as const,
    output: "",
    goalContinuation: true,
  };
  task.assignments.push(continuation);

  const visible = groupMessages([task], []);
  assert.equal(visible.some((message) => message.text.includes("Continue the thread goal")), false);
  const completed = groupMessages([{ ...task, assignments: [{ ...continuation, status: "completed" as const }] }], []);
  assert.equal(completed.some((message) => message.text.includes("Continue the thread goal")), false);
  const visibleProgress = groupMessages([task], [{
    seq: 1, runId: task.id, assignmentId: continuation.id, kind: "message",
    text: "Making progress toward the goal.", at: "2026-11-07T00:00:00.000Z",
  }]);
  assert.equal(visibleProgress.some((message) => message.text === "Making progress toward the goal."), true);
});
test("working team bubbles prefer live output and render the observed native turn", () => {
  const task = run();
  task.status = "running";
  task.assignments[0].status = "running";
  task.assignments[0].output = "Current work update";
  const message = groupMessages([task], []).find(message => message.role === "member")!;
  assert.equal(message.text, "Current work update");
  const html = renderToStaticMarkup(createElement(TeamMessageTurn, {
    message, runs: [task], events: [], chatId: "chat",
    nativeTurn: { id: "native", status: "inProgress", users: [], answers: [], files: [], activity: [{ id: "comment", type: "agentMessage", title: "Update", text: "Live Codex commentary" }] },
  }));
  assert.match(html, /Live Codex commentary/);
  assert.doesNotMatch(html, /Current work update/);
});
const run = (): Run => ({
  id: "r",
  task: "Inspect this workspace",
  criteria: "",
  workspace: "C:/Work",
  references: [],
  team: structuredClone(starterTeam),
  demo: false,
  allowWrite: false,
  status: "completed",
  createdAt: "2026-10-24T01:00:00Z",
  result: "Final evidence",
  revision: 0,
  groupChat: true,
  chatThreadId: "native",
  assignments: [
    {
      id: "p",
      agentId: "atlas",
      stage: "plan",
      objective: "Plan",
      status: "completed",
      output: '{"summary":"Inspect files","research":[],"build":[]}',
      finishedAt: "2026-10-24T01:00:01Z",
    },
    {
      id: "f",
      agentId: "atlas",
      stage: "final",
      objective: "Report",
      status: "completed",
      output: "Final evidence",
      finishedAt: "2026-10-24T01:00:03Z",
    },
  ],
});

test("native-app follow-ups use Nova's profile without duplicating the user prompt", () => {
  const html = renderToStaticMarkup(
    createElement(NativeChatTurn, {
      chatId: "mixed",
      agent: normalAgent(starterTeam.agents[0]),
      turn: {
        id: "external",
        status: "completed",
        users: [{ id: "user", text: "Review this exercise." }],
        answers: [{ id: "reply", text: "### Atlas\n\nNo findings." }],
        activity: [],
        files: [],
      },
    }),
  );
  assert.match(html, /aria-label="Nova"/);
  assert.match(html, /No findings/);
  assert.match(html, /Review this exercise\./);
  assert.equal((html.match(/class="user-message"/g) || []).length, 1);
  assert.doesNotMatch(html, /<h3>Atlas<\/h3>/);
});

test("Normal turns in an existing team chat show Nova's profile and full reply", () => {
  const team = run();
  const normal = {
    ...run(),
    id: "normal",
    groupChat: false,
    task: "Check the program",
    options: runOptionsSchema.parse({ mode: "normal" }),
    assignments: [
      {
        ...team.assignments[1],
        id: "normal-reply",
        stage: "build" as const,
        output: "## Atlas\n\nThe program runs correctly.",
        finishedAt: "2026-10-24T01:01:00Z",
      },
    ],
  };
  const messages = groupMessages([team, normal], []);
  const reply = messages.find((message) => message.id === "normal-reply")!;
  assert.equal(reply.agent?.id, "codex-normal");
  assert.equal(reply.agent?.name, "Nova");
  assert.equal(reply.agent?.sprite, "nova");
  assert.equal(reply.text, "The program runs correctly.");
  assert.equal(reply.final, true);
  assert.equal(reply.direct, true);
  const html = renderToStaticMarkup(
    createElement(GroupChat, {
      runs: [team, normal],
      events: [],
      onDetails() {},
    }),
  );
  assert.match(html, /aria-label="Nova"/);
  assert.match(html, /sprites\/nova.png/);
  assert.equal(team.team.agents[0].name, "Atlas");
  assert.equal(
    normal.assignments[0].output,
    "## Atlas\n\nThe program runs correctly.",
  );
});
test("group transcript shows one real request and named readable member messages", () => {
  const task = run(),
    messages = groupMessages([task], []);
  task.assignments[1].metrics = { durationMs: 5000, actualModel: "test-model" };
  assert.equal(messages.filter((m) => m.role === "user").length, 1);
  assert.equal(messages[1].note, "Inspect files");
  assert.equal(messages[1].agent?.name, "Atlas");
  const html = renderToStaticMarkup(
    createElement(GroupChat, { runs: [task], events: [], onDetails() {} }),
  );
  assert.ok(html.includes("group-avatar"));
  assert.ok(html.includes("Final evidence"));
  assert.ok(html.includes("Worked for 5s"));
  assert.ok(html.includes("test-model"));
  assert.ok(html.includes('class="turn-work"'));
  assert.ok(!html.includes('<summary>Details</summary>'));
  assert.ok(!html.includes("&quot;summary&quot;"));
});
test("board has the three newest completed real tasks and deduplicates a conversation", () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({
    ...run(),
    id: `r${i}`,
    chatThreadId: `thread${i}`,
    createdAt: `2026-10-24T01:00:0${i}Z`,
    assignments: [],
  }));
  assert.deepEqual(
    completedBoardTasks(tasks).map((r) => r.id),
    ["r4", "r3", "r2"],
  );
  assert.equal(
    completedBoardTasks([{ ...tasks[4], demo: true }, tasks[0]]).length,
    1,
  );
  assert.equal(
    completedBoardTasks([tasks[0], { ...tasks[0], id: "another" }]).length,
    1,
  );
});
test("human-readable planning and review keep internal structure out of chat", () => {
  const plan = planResult(
    "Inspect the workspace.\n## Research\n- pip: Read package files\n## Build\nNone",
  );
  assert.deepEqual(plan.research, [
    { agentId: "pip", objective: "Read package files" },
  ]);
  assert.equal(reviewResult("## Mira\nPASS\nEvidence checked.").passed, true);
  assert.equal(
    reviewResult("CHANGES REQUESTED: Missing evidence").passed,
    false,
  );
  assert.throws(() => reviewResult("Probably fine"));
});

test("a named member handoff is accepted without headings, unknown members are rejected", () => {
  const plan = planResult("## Atlas\n- **pip:** Inspect the Python folder", [
    { id: "pip", role: "researcher" },
  ]);
  assert.deepEqual(plan.research, [
    { agentId: "pip", objective: "Inspect the Python folder" },
  ]);
  assert.equal(plan.build.length, 0);
  assert.throws(() =>
    planResult("## Atlas\n- **unknown:** Write files", [
      { id: "pip", role: "researcher" },
    ]),
  );
});

test("an untracked desktop reply replaces the pending app placeholder without hiding the user", async () => {
  const { visibleGroupMessages } = await import("../shared/group-chat");
  const task = run(); task.options = { mode: "normal", models: {}, attachments: [], mentions: [] }; task.status = "running";
  task.assignments = [{ ...task.assignments[0], status: "running", output: "Continuing in the shared Codex conversation.", turnId: undefined }];
  const native = { id: "desktop-turn", startedAt: Date.parse(task.createdAt) / 1000 + 1, status: "inProgress", users: [], answers: [], activity: [], files: [] };
  const visible = visibleGroupMessages([task], [], [native]);
  assert.equal(visible.filter(message => message.role === "user").length, 1); assert.equal(visible.filter(message => message.role === "member").length, 0);
  assert.equal(visibleGroupMessages([task], [], [{ ...native, startedAt: 1 }]).filter(message => message.role === "member").length, 1);
});

test("recorded Normal replies render once and preserve later Codex user messages", async () => {
  const { groupConversationTimeline } = await import("../shared/conversation-timeline");
  const task = run(); task.options = { mode: "normal", models: {}, attachments: [], mentions: [] }; task.assignments[0].turnId = "recorded";
  const messages = [{ id: "request", at: task.createdAt, role: "user", text: task.task, note: task.task, runId: task.id }, { id: task.assignments[0].id, assignmentId: task.assignments[0].id, at: task.createdAt, role: "member", text: "Continuing in the shared Codex conversation.", note: "", runId: task.id }] as any;
  const turn = { id: "recorded", status: "completed", startedAt: Date.parse(task.createdAt) / 1000, users: [{ id: "first", text: task.task }, { id: "steer", text: "Use blue instead" }], answers: [{ id: "reply", text: "Real reply" }], activity: [], files: [] };
  const result = groupConversationTimeline(messages, [turn], [task]);
  assert.equal(result.filter(item => item.kind === "native").length, 1);
  assert.equal(result.filter(item => item.kind === "studio" && item.message.role === "member").length, 0);
  const recorded = result.find(item => item.kind === "native")!; if (recorded.kind === "native") assert.deepEqual(recorded.turn.users.map(user => user.text), ["Use blue instead"]);
});
