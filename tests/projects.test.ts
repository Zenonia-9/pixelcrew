import { test } from "node:test";
import assert from "node:assert/strict";
import { projectContains } from "../shared/projects";
import { CodexRuntime } from "../server/runtime";
test("project workspaces match exact roots and descendants without prefix collisions", () => {
  const p = {
    id: "test",
    name: "Actual project",
    roots: ["C:\\Work\\Example", "D:\\Docs"],
  };
  assert.ok(projectContains(p, "c:\\work\\example\\src"));
  assert.ok(projectContains(p, "D:\\Docs"));
  assert.equal(projectContains(p, "C:\\Work\\ExampleOther"), false);
  assert.equal(
    projectContains(
      { id: "linux", name: "Case sensitive", roots: ["/work/Example"] },
      "/work/example",
    ),
    false,
  );
});
test("Codex project listing follows pagination and preserves saved names and roots", async () => {
  const runtime = new CodexRuntime();
  const calls: unknown[] = [];
  runtime.request = async (method, params) => {
    assert.equal(method, "project/list");
    calls.push(params);
    return calls.length === 1
      ? {
          data: [
            {
              id: "p1",
              name: "Saved name",
              roots: [{ path: "C:\\Work\\One" }, { path: "D:\\Notes" }],
              metadata: { private: "not exposed" },
            },
          ],
          nextCursor: "second",
        }
      : {
          data: [{ id: "p2", name: "Second project", roots: [] }],
          nextCursor: null,
        };
  };
  await runtime.refreshProjects();
  assert.equal(calls.length, 2);
  assert.deepEqual(runtime.status.projects, [
    { id: "p1", name: "Saved name", roots: ["C:\\Work\\One", "D:\\Notes"] },
    { id: "p2", name: "Second project", roots: [] },
  ]);
  assert.equal(runtime.status.projectsError, undefined);
});
test("unavailable project listing reports an error without inventing saved projects", async () => {
  const runtime = new CodexRuntime();
  runtime.status.connected = true;
  runtime.request = async () => {
    throw new Error("Method unavailable");
  };
  await runtime.refreshProjects();
  assert.ok(runtime.status.projectsError?.includes("Method unavailable"));
  assert.equal(runtime.status.connected, true);
  assert.equal(runtime.status.projects, undefined);
});

test("project chats include legacy folder chats and exclude chats assigned elsewhere", async () => {
  const runtime = new CodexRuntime();
  runtime.status = {
    connected: true,
    authenticated: true,
    models: [],
    projects: [{ id: "project", name: "Saved", roots: ["C:\\Work"] }],
  };
  runtime.request = async (method, params) => {
    assert.equal(method, "thread/list");
    assert.deepEqual((params as { modelProviders: string[] }).modelProviders, []);
    return {
      data: [
        {
          id: "legacy",
          name: "Existing folder chat",
          cwd: "C:\\Work\\Child",
          projectId: null,
        },
        {
          id: "native",
          name: "New assigned chat",
          cwd: "C:\\Work",
          projectId: "project",
        },
        { id: "other", cwd: "C:\\Work", projectId: "another-project" },
        { id: "outside", cwd: "C:\\WorkOther" },
      ],
    };
  };
  assert.deepEqual(
    (await runtime.listChats("project")).chats.map((c) => c.id),
    ["legacy", "native"],
  );
});

test("chat reader uses paginated history and retains message order", async () => {
  const runtime = new CodexRuntime();
  runtime.status = { connected: true, authenticated: true, models: [] };
  runtime.request = async (method) =>
    method === "thread/read"
      ? { thread: { id: "chat", name: "Saved title", cwd: "C:\\Work" } }
      : {
          data: [
            {
              id: "new",
              items: [{ id: "b", type: "agentMessage", text: "Answer" }],
            },
            {
              id: "old",
              items: [
                {
                  id: "a",
                  type: "userMessage",
                  content: [{ type: "text", text: "Question" }],
                },
              ],
            },
          ],
          nextCursor: "older",
        };
  const chat = await runtime.readChat("chat");
  assert.deepEqual(
    chat.messages.map((m: any) => m.text),
    ["Question", "Answer"],
  );
  assert.equal(chat.nextCursor, "older");
});
