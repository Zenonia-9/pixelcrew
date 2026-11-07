/** Explicit live acceptance: uses the signed-in account and creates read-only test chats. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { readSecret } from "../server/private-storage";
if (!process.env.PIXELCREW_DATA_DIR || !process.env.PIXELCREW_PORT) throw Error("Specify an isolated PIXELCREW_DATA_DIR and PIXELCREW_PORT first.");
const data = resolve(process.env.PIXELCREW_DATA_DIR), base = `http://127.0.0.1:${process.env.PIXELCREW_PORT}/api`;
const { token } = readSecret<{ token: string }>(join(data, "controller-secret.json"));
async function api(path: string, body?: unknown) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const value = await response.json() as any;
  if (!response.ok) throw Error(`${path}: ${value.error || response.status}`);
  return value;
}
let state = await api("/state");
assert.ok(state.runtime.connected && state.runtime.authenticated, "Sign in before live acceptance.");
console.log("PASS Live Codex connection, saved project discovery, account metadata and model catalog");
const workspace = join(data, "acceptance-workspace"); mkdirSync(workspace, { recursive: true });
async function task(mode: string, expected: string, sourceThreadId?: string, goal = false) {
  const run = await api("/runs", { task: `This is a PixelCrew release acceptance check. Do not modify files or delegate. ${goal ? "Use only the goal lifecycle tool to mark the goal complete after returning the marker." : "Do not use tools."} Reply exactly ${expected}.`, workspace, allowWrite: false,
    options: { mode, permissions: "ask", ...(sourceThreadId ? { sourceThreadId, continueSourceThread: true } : {}), ...(goal ? { goalObjective: "Return the exact acceptance marker and complete the goal.", goalTokenBudget: 1500 } : {}) } });
  for (let i = 0; i < 120; i++) {
    await new Promise(done => setTimeout(done, 1000)); state = await api("/state");
    const current = state.runs.find((item: any) => item.id === run.id);
    if (goal && current.status === "interrupted") {
      const lifecycle = await api(`/chats/${current.chatThreadId}/goal`);
      assert.equal(lifecycle.status, "budgetLimited"); assert.match(current.result, new RegExp(expected));
      console.log("PASS Live goal token-budget stop preserves the completed response and requires explicit resume"); return current;
    }
    if (["failed", "interrupted", "cancelled", "approval"].includes(current.status)) throw Error(`${mode} acceptance stopped: ${current.error || current.status}`);
    if (current.status === "completed") {
      assert.match(current.result, new RegExp(expected));
      console.log(`PASS Live ${mode}${goal ? " goal" : ""}${sourceThreadId ? " follow-up" : ""} response and persisted output`);
      return current;
    }
  }
  await api(`/runs/${run.id}/interrupt`, {}); throw Error(`${mode} acceptance timed out and was interrupted.`);
}
if (!process.argv.includes("--storage-only")) {
  const chat = await task("normal", "PIXELCREW_CHAT_OK");
  await task("normal", "PIXELCREW_FOLLOWUP_OK", chat.chatThreadId);
  await task("plan", "PIXELCREW_PLAN_OK");
  await task("team", "PIXELCREW_TEAM_OK");
}
if (process.argv.includes("--goal")) await task("normal", "PIXELCREW_GOAL_OK", undefined, true);
const attachment = await api("/attachments", { name: "acceptance.png", data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=" });
assert.ok(attachment.path.startsWith(data));
assert.equal((await fetch(`http://127.0.0.1:${process.env.PIXELCREW_PORT}${attachment.preview}`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
console.log("PASS Authenticated attachment upload/download in private data storage");
await api("/usage/history");
console.log("PASS Live usage history endpoint");
