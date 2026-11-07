import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { win32 } from "node:path";
import { isLocalFilesystemPath, requireLocalFilesystemPath } from "../shared/local-paths";
import { localFileReference } from "../shared/file-links";
import { localImagePath, localImageAttachments, userContent } from "../shared/chat-presentation";
import { fileCompletions } from "../server/file-completion";
import { CodexRuntime } from "../server/runtime";

const networkPaths = [
  String.raw`/\attacker.invalid\share\image.png`,
  String.raw`\/attacker.invalid\share\image.png`,
  String.raw`\\attacker.invalid\share\image.png`,
  "//attacker.invalid/share/image.png",
  String.raw`\\?\UNC\attacker.invalid\share\image.png`,
  String.raw`\\.\device\image.png`,
  String.raw`\??\UNC\attacker.invalid\share\image.png`,
  "/%5cattacker.invalid/share/image.png",
];

test("Markdown cannot register mixed-separator UNC or device paths for server reads", () => {
  assert.ok(win32.normalize(networkPaths[0]).startsWith("\\\\"));
  for (const path of networkPaths) {
    assert.equal(isLocalFilesystemPath(path), false, path);
    assert.equal(localImagePath(path), undefined, path);
    assert.equal(localFileReference(path), undefined, path);
    assert.deepEqual(localImageAttachments(`![Image](<${path}>)`), [], path);
    assert.deepEqual(userContent(`[Attachment: ${path}]`, [{ path, name: "image.png", kind: "image" }]).attachments, [], path);
    assert.throws(() => requireLocalFilesystemPath(path), /Network and device/);
    // Network workspaces are rejected before realpath or directory enumeration.
    assert.deepEqual(fileCompletions(path, ""), []);
  }
  for (const path of ["C:/Work/image.png", "/C:/Work/image.png", "/tmp/image.png", "../src/main.ts"]) {
    assert.equal(isLocalFilesystemPath(path), true, path);
    assert.ok(localFileReference(path), path);
  }
  assert.equal(localImagePath("/C:/Work/image.png"), "C:/Work/image.png");
  assert.equal(localImagePath("/tmp/image.png"), "/tmp/image.png");
});

test("the API path guard denies network reads before invoking filesystem work", async () => {
  const app = Fastify(); let reads = 0;
  app.get<{ Querystring: { path: string } }>("/file", async request => {
    requireLocalFilesystemPath(request.query.path);
    reads += 1;
    return { allowed: true };
  });
  try {
    for (const path of networkPaths) {
      const response = await app.inject({ url: `/file?path=${encodeURIComponent(path)}` });
      assert.equal(response.statusCode, 500);
    }
    assert.equal(reads, 0);
    assert.equal((await app.inject({ url: "/file?path=C%3A%2FWork%2Fdocument.txt" })).statusCode, 200);
    assert.equal(reads, 1);
  } finally { await app.close(); }
});

test("chat metadata with a network cwd cannot turn relative output links into network reads", async () => {
  const runtime = new CodexRuntime(true);
  runtime.connect = async () => {};
  runtime.request = async method => method === "thread/read"
    ? { thread: { id: "network-chat", cwd: String.raw`\\attacker.invalid\share` } }
    : { data: [{ id: "turn", status: "completed", items: [{ id: "answer", type: "agentMessage", phase: "final_answer", text: "[Code](src/main.ts)" }] }] };
  await runtime.readChat("network-chat");
  assert.equal(runtime.chatFiles.get("network-chat")?.size, 0);
});
