import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { registerHttpSecurity } from "../server/http-security";
import { registerLocalSession } from "../server/local-session";
import { registerServiceRoutes } from "../server/service-routes";
import { ServiceLog } from "../server/logging";
import { prepareData } from "../server/data-migration";
import { readSecret, writeSecret, protectDirectory } from "../server/private-storage";
import { withinDirectory } from "../server/file-access";
import { Store } from "../server/store";
import { registerFileRoutes } from "../server/file-routes";
import { controllerOptions } from "../server/controller-options";
import { TerminalLogs } from "../server/terminal-logs";

function temporary() {
  const path = mkdtempSync(join(tmpdir(), "pixelcrew-production-"));
  return { path, close: () => {
    assert.ok(relative(resolve(tmpdir()), resolve(path)).startsWith("pixelcrew-production-"));
    rmSync(path, { recursive: true, force: true });
  } };
}
test("controller flags default to foreground and require an explicit detach flag", () => {
  assert.deepEqual(controllerOptions([]), { action: "start", detach: false, open: false, confirm: false });
  assert.deepEqual(controllerOptions(["--open", "-d"]), { action: "start", detach: true, open: true, confirm: false });
  assert.equal(controllerOptions(["--open"]).detach, false);
  assert.equal(controllerOptions(["--restart", "--detach"]).detach, true);
  assert.equal(controllerOptions(["--stop", "--confirm-interrupt"]).confirm, true);
  assert.throws(() => controllerOptions(["--status", "-d"]), /-d/);
  assert.throws(() => controllerOptions(["--stop", "--open"]), /--open/);
  assert.deepEqual(controllerOptions([], { npm_config_open: "true", npm_config_detach: "true" }), { action: "start", detach: true, open: true, confirm: false });
  assert.equal(controllerOptions([], { npm_config_menu: "true" }).action, "menu");
  assert.equal(controllerOptions([], { npm_config_open: "false" }).open, false);
});
test("Windows private storage does not depend on Git Bash user environment variables", () => {
  const temp = temporary(), domain = process.env.USERDOMAIN, username = process.env.USERNAME;
  try {
    delete process.env.USERDOMAIN; delete process.env.USERNAME;
    protectDirectory(temp.path);
    if (process.platform === "win32") assert.ok(existsSync(join(temp.path, ".permissions-v1")));
    protectDirectory(temp.path);
  } finally {
    if (domain === undefined) delete process.env.USERDOMAIN; else process.env.USERDOMAIN = domain;
    if (username === undefined) delete process.env.USERNAME; else process.env.USERNAME = username;
    temp.close();
  }
});
test("terminal logs handle partial writes and rotation while excluding secrets", () => {
  const temp = temporary(), file = join(temp.path, "service.jsonl"), reader = new TerminalLogs(file);
  try {
    assert.deepEqual(reader.read(), []);
    const line = JSON.stringify({ time: "2026-11-05T00:00:00.000Z", event: "service.ready", token: "secret" });
    writeFileSync(file, line.slice(0, 15)); assert.deepEqual(reader.read(), []);
    appendFileSync(file, line.slice(15) + "\n");
    assert.deepEqual(reader.read(), ["2026-11-05T00:00:00.000Z service.ready"]);
    assert.deepEqual(reader.read(), []);
    renameSync(file, file + ".1"); writeFileSync(file, line + "\n");
    assert.equal(reader.read().length, 1);
  } finally { temp.close(); }
});
test("local sessions require a one-use ticket and CSRF; foreign origins and anonymous streams fail", async () => {
  const app = Fastify();
  const host = "127.0.0.1:4318", bearer = "a".repeat(64);
  registerHttpSecurity(app, { production: true }); registerLocalSession(app, bearer);
  app.get("/api/events", async () => ({ connected: true }));
  app.post("/api/change", async () => ({ changed: true }));
  try {
    assert.equal((await app.inject({ url: "/api/events", headers: { host } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/session/ticket", headers: { host, "content-type": "application/json" }, payload: {} })).statusCode, 401);
    const ticketResponse = await app.inject({ method: "POST", url: "/api/session/ticket", headers: { host, authorization: `Bearer ${bearer}` }, payload: {} });
    const { ticket } = ticketResponse.json();
    const session = await app.inject({ method: "POST", url: "/api/session", headers: { host }, payload: { ticket } });
    assert.equal(session.statusCode, 200);
    const cookie = String(session.headers["set-cookie"]).split(";")[0];
    assert.match(String(session.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
    assert.equal((await app.inject({ method: "POST", url: "/api/session", headers: { host }, payload: { ticket } })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/events", headers: { host, cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/change", headers: { host, cookie }, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/change", headers: { host, cookie, "x-pixelcrew-csrf": session.json().csrf }, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/events", headers: { host, cookie, origin: "http://evil.example" } })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/events", headers: { host, authorization: `Bearer ${"é".repeat(64)}` } })).statusCode, 401);
    assert.match(String(session.headers["content-security-policy"]), /default-src 'self'/);
  } finally { await app.close(); }
});
test("service stop requires explicit confirmation of active tasks", async () => {
  const temp = temporary(), app = Fastify(); let stopped = false;
  registerServiceRoutes(app, { log: new ServiceLog(temp.path), status: () => ({ connected: false }), active: () => [{ id: "run-1", task: "Work" }], stopping: () => stopped, stop: async () => { stopped = true; }, controllerToken: "developer-secret" });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/service/stop", payload: {} })).statusCode, 409);
    assert.equal(stopped, false);
    assert.equal((await app.inject({ url: "/api/service/logs" })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/service/diagnostics" })).statusCode, 403);
    assert.equal((await app.inject({ url: "/api/service/logs", headers: { authorization: "Bearer developer-secret" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/service/stop", payload: { confirmInterrupt: true } })).statusCode, 200);
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(stopped, true);
  } finally { await app.close(); temp.close(); }
});
test("migration uses a SQLite snapshot, preserves source and backups, and rejects newer formats", async () => {
  const temp = temporary(), legacy = join(temp.path, "legacy"), target = join(temp.path, "new"); mkdirSync(legacy);
  const db = new DatabaseSync(join(legacy, "studio.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE runs(id TEXT, data TEXT); INSERT INTO runs VALUES('immutable','completed output');");
  writeFileSync(join(legacy, "account-profiles.json"), '{"profiles":[]}');
  try {
    await prepareData(target, legacy);
    assert.ok(existsSync(join(target, "backups/prototype-v1/studio.sqlite")));
    const copy = new DatabaseSync(join(target, "studio.sqlite"));
    try { assert.equal((copy.prepare("SELECT data FROM runs").get() as any).data, "completed output"); } finally { copy.close(); }
    assert.equal((db.prepare("SELECT data FROM runs").get() as any).data, "completed output");
    await prepareData(target, legacy);
    writeFileSync(join(target, "schema.json"), '{"version":2}');
    await assert.rejects(prepareData(target, legacy), /Unsupported/);
    await assert.rejects(prepareData(join(legacy, "nested"), legacy), /outside/);
  } finally { db.close(); temp.close(); }
});
test("logs rotate and omit non-allowlisted content; secrets round-trip privately", () => {
  const temp = temporary();
  try {
    const log = new ServiceLog(temp.path, 100);
    for (let i = 0; i < 20; i++) log.write("request.failed", { requestId: "req-1", status: 500, token: "secret", code: "token=secret" } as any);
    assert.ok(existsSync(log.file + ".4")); assert.ok(!existsSync(log.file + ".5"));
    assert.doesNotMatch(readFileSync(log.file, "utf8"), /secret|token/);
    const file = join(temp.path, "credential.json"); writeSecret(file, { token: "private-token" });
    assert.deepEqual(readSecret(file), { token: "private-token" });
    if (process.platform === "win32") assert.doesNotMatch(readFileSync(file, "utf8"), /private-token/);
    assert.ok(withinDirectory(temp.path, file)); assert.ok(!withinDirectory(join(temp.path, "other"), file));
  } finally { temp.close(); }
});
test("future SQLite formats and symlink escapes are rejected", () => {
  const temp = temporary();
  try {
    const file = join(temp.path, "future.sqlite"), db = new DatabaseSync(file);
    db.exec("PRAGMA user_version=2"); db.close();
    assert.throws(() => new Store(file), /newer PixelCrew/);
    const root = join(temp.path, "workspace"), outside = join(temp.path, "outside");
    mkdirSync(root); mkdirSync(outside); writeFileSync(join(outside, "secret.txt"), "private");
    symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(withinDirectory(root, join(root, "link/secret.txt")), false);
    assert.equal(withinDirectory(root, join(outside, "secret.txt")), false);
  } finally { temp.close(); }
});
test("chat file routes enforce workspace scope and uploads use private storage", async () => {
  const temp = temporary(), app = Fastify();
  const workspace = join(temp.path, "workspace"), outside = join(temp.path, "outside.txt");
  mkdirSync(workspace); const inside = join(workspace, "inside.txt");
  writeFileSync(inside, "workspace content"); writeFileSync(outside, "private");
  const runtime = { chatFiles: new Map([["chat", new Map([[inside, inside], [outside, outside]])]]), readChat: async () => ({ cwd: workspace }) };
  registerFileRoutes(app, runtime as any, { runs: [] } as any);
  try {
    const preview = await app.inject({ url: `/api/chats/chat/file?path=${encodeURIComponent(inside)}` });
    assert.equal(preview.statusCode, 200); assert.equal(preview.json().text, "workspace content");
    assert.equal((await app.inject({ url: `/api/chats/chat/file?path=${encodeURIComponent(outside)}` })).statusCode, 403);
    const upload = await app.inject({ method: "POST", url: "/api/attachments", payload: { name: "test.png", data: "data:image/png;base64,YWJj" } });
    assert.equal(upload.statusCode, 200);
    assert.equal((await app.inject({ url: upload.json().preview })).statusCode, 200);
    assert.equal((await app.inject({ url: "/api/attachments/not-a-uuid-test.png" })).statusCode, 404);
  } finally { await app.close(); temp.close(); }
});
