import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { CodexRuntime, nativeAgentConfiguration } from "../server/runtime";
import { starterTeam } from "../shared/defaults";

test("composer permissions, models and project pins survive a store restart independently", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-prefs-"));
  let store = new Store(join(dir, "state.db"));
  try {
    const preferences = {
      mode: "goal",
      permissions: "auto",
      allowWrite: true,
      models: { atlas: { model: "gpt-6-luna", reasoning: "low" } },
    };
    store.savePreference("chat:test", preferences);
    store.savePreference("pinnedProjects", ["project-a"]);
    store.close();
    store = new Store(join(dir, "state.db"));
    assert.deepEqual(store.preferences().composers["chat:test"], preferences);
    assert.deepEqual(store.preferences().pinnedProjects, ["project-a"]);
    store.savePreference("pinnedProjects", []);
    assert.deepEqual(store.preferences().composers["chat:test"], preferences);
    assert.throws(() =>
      store.savePreference("chat:test", {
        ...preferences,
        permissions: "invalid",
      }),
    );
    assert.deepEqual(store.preferences().composers["chat:test"], preferences);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native specialist profiles keep saved instructions and explicit reviewer boundaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-native-"));
  try {
    const team = structuredClone(starterTeam);
    team.agents[0].name = "Coordinator";
    const mira = team.agents.find((a) => a.id === "mira")!;
    mira.model = "gpt-6-luna";
    mira.reasoning = "low";
    const result = nativeAgentConfiguration(team.agents, dir);
    assert.ok(
      result.instructions.includes(
        "You are Coordinator, the parent coordinator",
      ),
    );
    assert.equal(result.roles.get("crew_mira"), "mira");
    assert.equal(result.roles.has("crew_atlas"), false);
    const profile = readFileSync(join(dir, "crew_mira.toml"), "utf8");
    for (const text of [
      "gpt-6-luna",
      "low",
      "read-only, defect-first",
      "Do not edit files",
      mira.instructions,
    ])
      assert.ok(profile.includes(text), text);
    assert.equal(result.config["features.multi_agent_v2"], true);
    assert.equal(result.config["features.shell_tool"], true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("V2 child history maps native roles and completed results to the correct member", async () => {
  const runtime = new CodexRuntime(true) as any;
  runtime.nativeRoles.set("crew_pip", "pip");
  runtime.request = async (method: string) =>
    method === "thread/read"
      ? { thread: { agentRole: "crew_pip" } }
      : {
          data: [
            {
              id: "child-turn",
              status: "completed",
              items: [
                { type: "agentMessage", phase: "commentary", text: "Checking" },
                {
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "PIP_NATIVE_OK",
                },
              ],
            },
          ],
        };
  const events: any[] = [];
  await runtime.readNativeChild(
    { onSubagent: (event: any) => events.push(event) },
    "parent",
    {
      agentThreadId: "child",
      agentPath: "/root/pip",
      model: "gpt-6-luna",
      reasoningEffort: "low",
    },
  );
  assert.equal(events[0].agentId, "pip");
  assert.equal(events.at(-1).status, "completed");
  assert.equal(events.at(-1).output, "PIP_NATIVE_OK");
  assert.equal(events.at(-1).threadId, "child");
});

test("native child approval belongs to the child and cannot finish its parent turn", () => {
  const runtime = new CodexRuntime(true) as any;
  const approvals: any[] = [],
    events: any[] = [];
  let parentFinished = false;
  runtime.nativeChildren.set("child", {
    parent: "parent",
    agentId: "mira",
    output: "",
  });
  runtime.active.set("parent", {
    input: {
      assignment: { id: "parent-assignment" },
      onApproval: (...args: any[]) => approvals.push(args),
      onSubagent: (event: any) => events.push(event),
    },
    resolve: () => {
      parentFinished = true;
    },
  });
  runtime.receive({
    id: 42,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "child",
      questions: [{ id: "q", question: "Which target?" }],
    },
  });
  assert.equal(approvals[0][0], "parent-assignment:42");
  assert.deepEqual(approvals[0][3], { agentId: "mira", threadId: "child" });
  assert.equal(events[0].status, "approval");
  runtime.receive({
    method: "turn/completed",
    params: { threadId: "child", turn: { status: "completed" } },
  });
  assert.equal(parentFinished, false);
});
