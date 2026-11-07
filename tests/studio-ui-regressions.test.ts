import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Turn } from "../src/ChatThread";
import { MemberEditor } from "../src/MemberEditor";
import { normalizeTurn } from "../server/chat-history";
import { starterTeam } from "../shared/defaults";
import { normalAgent } from "../shared/normal-agent";
import { nearestActivityTarget } from "../shared/office-activity-target";
import { officeLayout } from "../shared/office-layouts";
import { furniture, furnitureBounds } from "../shared/room-layout";
import { teamSchema } from "../shared/types";
import { conversationTimeline } from "../shared/conversation-timeline";
import type { GroupMessage } from "../shared/group-chat";
import { createdTaskDestination } from "../shared/created-task-navigation";

test("native follow-ups are interleaved by time instead of appended after later team messages", () => {
  const messages = [
    { id: "first", at: "2026-10-25T01:00:00Z" },
    { id: "later", at: "2026-10-25T03:00:00Z" },
  ] as GroupMessage[];
  const native = normalizeTurn({
    id: "middle",
    startedAt: Date.parse("2026-10-25T02:00:00Z") / 1000,
    status: "completed",
    items: [],
  });
  const timeline = conversationTimeline(messages, [native]);
  assert.deepEqual(
    timeline.map((item) =>
      item.kind === "native" ? item.turn.id : item.message.id,
    ),
    ["first", "middle", "later"],
  );
});

test("new Normal and Team runs open their chat instead of the task details page", () => {
  const normal = {
    demo: false,
    chatThreadId: undefined,
    assignments: [{ threadId: "normal-thread" }],
    options: { mode: "normal", models: {} },
  } as any;
  const team = {
    demo: false,
    chatThreadId: "team-thread",
    assignments: [{ threadId: "member-thread" }],
    options: { mode: "team", models: {} },
  } as any;
  assert.deepEqual(createdTaskDestination(normal), { kind: "thread", threadId: "normal-thread" });
  assert.deepEqual(createdTaskDestination(team), { kind: "thread", threadId: "team-thread" });
  assert.deepEqual(createdTaskDestination({ ...team, chatThreadId: undefined, assignments: [] }), { kind: "wait-for-thread" });
});

test("new chat runs reuse their source chat and simulations open in chat view", () => {
  const followup = {
    demo: false,
    chatThreadId: "current",
    assignments: [],
    options: { mode: "team", sourceThreadId: "current", models: {} },
  } as any;
  const simulation = { ...followup, demo: true };
  assert.deepEqual(createdTaskDestination(followup, "current"), { kind: "reuse-current" });
  assert.deepEqual(createdTaskDestination(simulation, "current"), { kind: "run" });
});

test("native chat identifies the user and the saved sender, with distinct message surfaces", () => {
  const turn = normalizeTurn({
    id: "turn",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        type: "agentMessage",
        id: "answer",
        phase: "final_answer",
        text: "### Atlas\n\nDone.",
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(Turn, {
      chatId: "chat",
      turn,
      speaker: starterTeam.agents[1],
    }),
  );
  assert.match(html, /Message from you/);
  assert.match(html, />You<\/span>/);
  assert.match(html, /assistant-turn/);
  assert.match(html, />Pip<\/strong>/);
  assert.match(html, /pip.png/);
  assert.match(html, /Done\./);
  assert.doesNotMatch(html, /<h3>Atlas<\/h3>/);
});

test("Normal character editor exposes identity fields and excludes working configuration", () => {
  const team = {
    ...starterTeam,
    normalAppearance: {
      sprite: "nova" as const,
      name: "Orbit",
      biography: "A patient guide.",
    },
  };
  const normal = normalAgent(
    {
      ...starterTeam.agents[0],
      instructions: "CUSTOM",
      skills: ["custom"],
      tools: ["custom"],
    },
    8,
    team.normalAppearance,
  );
  assert.equal(normal.name, "Orbit");
  assert.equal(normal.biography, "A patient guide.");
  assert.notEqual(normal.instructions, "CUSTOM");
  assert.deepEqual(normal.skills, []);
  assert.deepEqual(normal.tools, []);
  const html = renderToStaticMarkup(
    createElement(MemberEditor, {
      agent: normal,
      team,
      models: [],
      busy: false,
      onSave: async () => true,
      onCancel: () => {},
    }),
  );
  assert.match(html, /Biography/);
  assert.match(html, /Orbit/);
  assert.match(html, /Character/);
  for (const field of [
    "Working instructions",
    "Workspace access",
    "Codex model",
    "Agent specialties",
    "Available for new tasks",
    "Workstation",
  ])
    assert.ok(!html.includes(field), field);
  assert.throws(() =>
    teamSchema.parse({
      ...starterTeam,
      agents: starterTeam.agents.filter((member) => member.role !== "lead"),
    }),
  );
  assert.throws(() =>
    teamSchema.parse({
      ...starterTeam,
      agents: [...starterTeam.agents, normal],
    }),
  );
});

test("stretching uses different reachable positions on a moved rug and watering chooses the closest reachable plant", () => {
  const agents = starterTeam.agents;
  const layout = officeLayout("suite", agents);
  const left = nearestActivityTarget(
    "stretch",
    { x: 280, y: 448 },
    agents,
    layout,
  )!;
  const right = nearestActivityTarget(
    "stretch",
    { x: 480, y: 448 },
    agents,
    layout,
  )!;
  const bounds = furnitureBounds(
    furniture(agents).find((item) => item.id === "rug")!,
    layout,
  );
  assert.ok(left && right);
  assert.notDeepEqual(left, right);
  for (const point of [left, right])
    assert.ok(
      point.x >= bounds.left &&
        point.x <= bounds.left + bounds.width &&
        point.y >= bounds.top &&
        point.y <= bounds.top + bounds.height,
    );
  const plantLeft = nearestActivityTarget(
    "plants",
    { x: 96, y: 352 },
    agents,
    layout,
  )!;
  const plantRight = nearestActivityTarget(
    "plants",
    { x: 752, y: 400 },
    agents,
    layout,
  )!;
  assert.ok(plantLeft.x < 200);
  assert.ok(plantRight.x > 600);
});
