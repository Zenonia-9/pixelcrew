import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
function serverPath() {
  const root = resolve(homedir(), ".codex/plugins/cache/openai-bundled/codex-app-tools");
  try { return readdirSync(root).sort().reverse().map(version => resolve(root, version, "server.mjs")).find(path => existsSync(path)); } catch { return undefined; }
}
function desktopPipe() {
  if (process.env.CODEX_APP_TOOLS_PIPE_PATH) return process.env.CODEX_APP_TOOLS_PIPE_PATH;
  if (process.platform !== "win32") return undefined;
  try { const names = readdirSync("\\\\.\\pipe\\").filter(name => /^codex-app-tools-[0-9a-f-]+$/i.test(name)); return names.length === 1 ? `\\\\.\\pipe\\${names[0]}` : undefined; } catch { return undefined; }
}
/** Use the installed desktop MCP adapter; never take over another process's writer. */
export class DesktopBridge {
  private turnStatus = new Map<string, { expires: number; value?: { id: string; status: string; completedAt?: number } }>();
  private statusReads = new Map<string, Promise<{ id: string; status: string; completedAt?: number } | undefined>>();
  private child?: ChildProcessWithoutNullStreams;
  private next = 1;
  private ready?: Promise<void>;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  get available() { return Boolean(desktopPipe() && serverPath()); }
  private rpc(method: string, params: unknown, timeout = 30000): Promise<any> {
    if (!this.child?.stdin.writable) return Promise.reject(Error("The Codex desktop connection is unavailable."));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`Codex desktop ${method} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  private async connect() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const path = serverPath(), pipe = desktopPipe(); if (!path || !pipe) throw Error("The Codex desktop connection is unavailable.");
      const child = spawn(process.execPath, [path], { stdio: "pipe", windowsHide: true, env: { ...process.env, CODEX_APP_TOOLS_PIPE_PATH: pipe } }); this.child = child;
      child.stderr.on("data", () => {});
      const failed = (error: Error) => { if (this.child !== child) return; this.ready = undefined; this.child = undefined; for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); };
      child.on("error", failed); child.on("exit", () => failed(Error("The Codex desktop adapter closed.")));
      createInterface({ input: child.stdout }).on("line", line => {
        try { const response = JSON.parse(line), entry = this.pending.get(response.id); if (!entry) return; clearTimeout(entry.timer); this.pending.delete(response.id); if (response.error) entry.reject(Error(response.error.message)); else entry.resolve(response.result); } catch { /* Ignore non-protocol output. */ }
      });
      await this.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "pixelcrew", version: "0.1.0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    })();
    try { await this.ready; } catch (error) { this.ready = undefined; throw error; }
  }
  async tools() { await this.connect(); return (await this.rpc("tools/list", {})).tools as { name: string }[]; }
  /** Read authoritative desktop lifecycle metadata without resuming or sending. */
  async latestTurn(threadId: string) {
    const cached = this.turnStatus.get(threadId);
    if (cached && cached.expires > Date.now()) return cached.value;
    let pending = this.statusReads.get(threadId);
    if (!pending) {
      pending = (async () => {
        let value: { id: string; status: string; completedAt?: number } | undefined;
        try {
          const tools = await this.tools();
          const name = tools.find(tool => tool.name === "read_thread" || tool.name.endsWith("__read_thread"))?.name;
          if (name) {
            const response = await this.rpc("tools/call", { name, arguments: { threadId, turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 200 }, _meta: { "openai/threadId": threadId } });
            if (!response.isError) {
              const data = JSON.parse(response.content?.find((item: any) => item.type === "text")?.text || "{}");
              const turn = data.turns?.[0];
              if (typeof turn?.id === "string" && typeof turn.status === "string")
                value = { id: turn.id, status: turn.status, ...(typeof turn.completedAt === "number" ? { completedAt: turn.completedAt } : {}) };
            }
          }
        } catch { /* Keep status unknown when the native observer is unavailable. */ }
        this.turnStatus.set(threadId, { expires: Date.now() + 15000, value });
        if (this.turnStatus.size > 100) this.turnStatus.delete(this.turnStatus.keys().next().value!);
        return value;
      })().finally(() => this.statusReads.delete(threadId));
      this.statusReads.set(threadId, pending);
    }
    return pending;
  }
  async send(threadId: string, prompt: string, model?: string, thinking?: string) {
    const tools = await this.tools();
    const name = tools.find(tool => tool.name === "send_message_to_thread" || tool.name.endsWith("__send_message_to_thread"))?.name;
    if (!name) throw Error("The desktop app does not expose message submission.");
    const response = await this.rpc("tools/call", { name, arguments: { threadId, prompt, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) }, _meta: { "openai/threadId": threadId } }, 120000);
    if (response.isError) throw Error(response.content?.filter((item: any) => item.type === "text").map((item: any) => item.text).join("\n") || "Codex could not accept the message.");
    return response;
  }
  close() { const child = this.child; this.child = undefined; this.ready = undefined; child?.kill(); for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(Error("Desktop adapter closed.")); } this.pending.clear(); }
}
