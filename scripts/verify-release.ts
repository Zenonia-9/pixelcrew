import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, relative } from "node:path";
import { readSecret } from "../server/private-storage";

const target = resolve(process.argv[2] || "artifacts/PixelCrew-1.0.0-rc.1-x64");
const executable = existsSync(join(target, "runtime/node.exe")) ? join(target, "runtime/node.exe") : target === resolve(".build") ? process.execPath : undefined;
assert.ok(executable, "Build the Windows package first.");
const directory = mkdtempSync(join(tmpdir(), "pixelcrew-release-"));
const children: ChildProcess[] = [];
const checks: string[] = [];
const port = await new Promise<number>(done => {
  const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const port = (probe.address() as any).port; probe.close(() => done(port)); });
});
const env = { ...process.env, PIXELCREW_DATA_DIR: join(directory, "data"), PIXELCREW_PORT: String(port), PIXELCREW_SKIP_LEGACY: "1", STUDIO_CODEX_BIN: join(directory, "missing-codex.exe") };
const base = `http://127.0.0.1:${port}`;
const launch = (entry: string, args: string[] = [], override = {}) => {
  const child = spawn(executable, [join(target, "server", entry), ...args], { env: { ...env, ...override }, cwd: target, windowsHide: true, stdio: "ignore" });
  children.push(child); return child;
};
const exited = (child: ChildProcess) => new Promise<number | null>((done, reject) => {
  const timer = setTimeout(() => reject(Error("Process exit timed out.")), 40000);
  if (child.exitCode !== null) { clearTimeout(timer); done(child.exitCode); return; }
  child.once("exit", code => { clearTimeout(timer); done(code); });
});
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + "/api/service/status")).status === 401) return; } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw Error("Service did not become ready.");
}
try {
  let child = launch("index.js"); await waitReady();
  const token = readSecret<{ token: string }>(join(env.PIXELCREW_DATA_DIR, "controller-secret.json")).token;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let status = await (await fetch(base + "/api/service/status", { headers })).json() as any;
  assert.equal(status.connected, false); assert.equal("office3d" in status.capabilities, false);
  checks.push("Clean packaged startup with missing Codex remains manageable");
  const ticket = await (await fetch(base + "/api/session/ticket", { method: "POST", headers, body: "{}" })).json() as any;
  const session = await fetch(base + "/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ticket) });
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  const { csrf } = await session.json() as any;
  assert.equal((await fetch(base + "/api/state", { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + "/api/service/logs", { headers: { cookie } })).status, 403);
  assert.equal((await fetch(base + "/api/service/diagnostics", { headers: { cookie } })).status, 403);
  assert.equal((await fetch(base + "/api/service/diagnostics", { headers })).status, 200);
  assert.equal((await fetch(base + "/api/preferences", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: '{"key":"test","value":true}' })).status, 403);
  assert.equal((await fetch(base + "/api/state", { headers: { cookie, origin: "https://evil.example" } })).status, 403);
  checks.push("Authenticated browser session, anonymous denial, CSRF/origin protection and developer-only diagnostics");
  for (const payload of [{ task: "Demo", workspace: directory, demo: true }, { task: "Device", workspace: directory, options: { deviceTools: ["browser"] } }]) {
    assert.equal((await fetch(base + "/api/runs", { method: "POST", headers: { cookie, "x-pixelcrew-csrf": csrf, "content-type": "application/json" }, body: JSON.stringify(payload) })).status, 400);
  }
  checks.push("Demo and device execution rejected by backend");
  const duplicate = launch("index.js"); assert.notEqual(await exited(duplicate), 0);
  status = await (await fetch(base + "/api/service/status", { headers })).json();
  assert.equal(status.pid, child.pid);
  const occupied = launch("index.js", [], { PIXELCREW_DATA_DIR: join(directory, "occupied") });
  assert.notEqual(await exited(occupied), 0);
  assert.equal(existsSync(join(directory, "occupied/schema.json")), false);
  checks.push("Duplicate startup and occupied port do not disturb the running instance or migrate data");
  const stream = await fetch(base + "/api/events", { headers: { cookie } });
  assert.equal(stream.status, 200); const reader = stream.body!.getReader(); await reader.read();
  const stop = launch("controller.js", ["stop"]); assert.equal(await exited(stop), 0); await exited(child);
  await reader.cancel().catch(() => {});
  assert.equal(existsSync(join(env.PIXELCREW_DATA_DIR, "service.lock")), false);
  checks.push("Controller stop closes event streams and releases the owned lock");
  const start = launch("controller.js", ["-d"]); assert.equal(await exited(start), 0); await waitReady();
  assert.equal((await fetch(base + "/api/state", { headers: { cookie } })).status, 401);
  const restart = launch("controller.js", ["--restart", "-d"]); assert.equal(await exited(restart), 0); await waitReady();
  const finalStop = launch("controller.js", ["stop"]); assert.equal(await exited(finalStop), 0);
  checks.push("Controller start/restart/stop work independently; old sessions expire on restart");
  const foreground = spawn(executable, [join(target, "server/controller.js")], { env, cwd: target, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.push(foreground); let terminal = "";
  foreground.stdout!.on("data", chunk => { terminal += chunk.toString(); });
  await waitReady(); await new Promise(done => setTimeout(done, 500));
  assert.equal(foreground.exitCode, null);
  assert.match(terminal, /PixelCrew is running/); assert.match(terminal, /service.ready/);
  assert.equal(await exited(launch("controller.js", ["--stop"])), 0);
  assert.equal(await exited(foreground), 0);
  checks.push("Default foreground command stays attached and prints service logs; -d explicitly detaches");
  function walk(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]); }
  const application = walk(target).filter(path => !path.includes("node_modules"));
  assert.ok(!application.some(path => /\.(glb|gltf|ts|tsx)$/.test(path)));
  assert.ok(!existsSync(join(target, "AGENTS.md"))); assert.ok(!existsSync(join(target, "tests")));
  const backend = readFileSync(join(target, "server/index.js"), "utf8");
  assert.doesNotMatch(backend, /Office tour complete|Sample result — simulated/);
  for (const file of application.filter(file => file.includes("dist") && file.endsWith(".js")))
    assert.doesNotMatch(readFileSync(file, "utf8"), /Service & logs|Export diagnostics|SIMULATED ANIMATION PREVIEW/);
  checks.push("Runtime artifact excludes source, repository tests, AGENTS.md, 3D models, and simulation implementation");
  for (const check of checks) console.log(`PASS ${check}`);
} finally {
  try { await exited(launch("controller.js", ["stop", "--confirm-interrupt"])); } catch {}
  // Only processes spawned by this isolated acceptance run may be terminated.
  for (const child of children) if (child.exitCode === null) child.kill();
  assert.ok(relative(resolve(tmpdir()), directory).startsWith("pixelcrew-release-"));
  rmSync(directory, { recursive: true, force: true });
}
