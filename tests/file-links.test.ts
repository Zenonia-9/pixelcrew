import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  localFileReference,
  localFileReferences,
  editorFileUri,
} from "../shared/file-links";
import { Markdown } from "../src/ChatThread";
import { CodexRuntime } from "../server/runtime";

test("returned Windows screenshot paths preserve dot folders through Markdown parsing", () => {
  const path = String.raw`C:\Work\studio\.data\screenshots\capture.png`;
  const html = renderToStaticMarkup(createElement(Markdown, {
    chatId: "screenshots", text: `![Screenshot](${path})`,
  }));
  assert.ok(html.includes("/api/chats/screenshots/attachment?path=" + encodeURIComponent(path.replaceAll("\\", "/"))));
  assert.ok(!html.includes("studio.data"));
});

test("local file links preserve Windows paths and line numbers without becoming website routes", () => {
  assert.deepEqual(localFileReference("/C:/My%20Project/game.py:12:3"), {
    path: "C:/My Project/game.py",
    line: 12,
  });
  assert.deepEqual(localFileReference("src/main.ts#L8"), {
    path: "src/main.ts",
    line: 8,
  });
  for (const url of [
    "https://example.com/a.py",
    "javascript:alert(1)",
    "//example.com/file.py",
    "#heading",
    "/api/state",
  ])
    assert.equal(localFileReference(url), undefined);
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      chatId: "files",
      text: "[Game](</C:/My Project/game.py:12>)",
    }),
  );
  assert.match(html, /class="local-file-link"/);
  assert.ok(
    html.includes("/api/chats/files/file?path=C%3A%2FMy%20Project%2Fgame.py"),
  );
  assert.match(html, /Open C:\/My Project\/game.py:12/);
  assert.ok(!html.includes('href="/C:/'));
  assert.equal(
    editorFileUri("C:\\My Project\\game.py", 12),
    "vscode://file/C:/My%20Project/game.py:12:1",
  );
});

test("only file links declared in the chat populate its file registry, relative to its workspace", async () => {
  assert.deepEqual(
    localFileReferences(
      "![Image](/C:/a.png) [Remote](https://example.com/a.py) [Code](src/main.py#L3)",
    ),
    [{ path: "src/main.py", line: 3 }],
  );
  const runtime = new CodexRuntime(true);
  runtime.connect = async () => {};
  runtime.request = async (method) =>
    method === "thread/read"
      ? { thread: { id: "file-chat", name: "Files", cwd: "C:/Work" } }
      : {
          data: [
            {
              id: "turn",
              status: "completed",
              items: [
                {
                  id: "answer",
                  type: "agentMessage",
                  phase: "final_answer",
                  text: "[Code](src/main.py#L3)",
                },
              ],
            },
          ],
        };
  await runtime.readChat("file-chat");
  assert.equal(
    runtime.chatFiles.get("file-chat")?.get("src/main.py")?.replace(/\\/g, "/"),
    "C:/Work/src/main.py",
  );
  assert.equal(runtime.chatFiles.get("another-chat"), undefined);
  assert.equal(
    runtime.chatFiles.get("file-chat")?.has("C:/unlinked.txt"),
    false,
  );
});
