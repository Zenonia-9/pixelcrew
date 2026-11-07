import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

export const chromeActions = new Set(["tabs", "select_tab", "snapshot", "click", "hover", "type", "press_key", "scroll", "drag", "release"]);
export class ChromeBridge {
  private server: WebSocketServer;
  private clients = new Map<string, WebSocket>();
  private pending = new Map<string, { socket: WebSocket; resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly token: string;
  constructor(server: Server, stateFile: string, private allowed: () => boolean) {
    let token: string | undefined;
    try { token = JSON.parse(readFileSync(stateFile, "utf8")).token; } catch {}
    this.token = token && /^[a-f0-9]{64}$/.test(token) ? token : randomBytes(32).toString("hex");
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ token: this.token }), { mode: 0o600 });
    this.server = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/api/chrome/connect") return;
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin || "")) { socket.destroy(); return; }
      this.server.handleUpgrade(request, socket, head, ws => this.attach(ws));
    });
  }
  get connected() { return this.clients.size > 0; }
  authenticated(token: string) {
    const expected = Buffer.from(this.token); const supplied = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  private attach(socket: WebSocket) {
    let clientId = "";
    const deadline = setTimeout(() => socket.close(1008, "Pairing required"), 5000);
    socket.on("message", raw => {
      let message: any; try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, "Invalid message"); return; }
      if (!clientId) {
        if (message.type !== "hello" || !this.authenticated(String(message.token || "")) || !/^[a-z0-9-]{1,80}$/i.test(message.clientId || "")) { socket.close(1008, "Pairing failed"); return; }
        clientId = message.clientId;
        this.clients.get(clientId)?.close(); this.clients.set(clientId, socket); clearTimeout(deadline);
        socket.send(JSON.stringify({ type: "connected" })); return;
      }
      if (message.type === "ping") { socket.send(JSON.stringify({ type: "pong" })); return; }
      const pending = this.pending.get(message.id);
      if (!pending || pending.socket !== socket) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(message.error)));
      else pending.resolve(message.result);
    });
    socket.on("close", () => {
      clearTimeout(deadline);
      if (this.clients.get(clientId) === socket) this.clients.delete(clientId);
      for (const [id, pending] of this.pending) if (pending.socket === socket) {
        clearTimeout(pending.timer); pending.reject(new Error("Chrome extension disconnected. Inspect the tab before retrying input.")); this.pending.delete(id);
      }
    });
  }
  private send(socket: WebSocket, action: string, args: any) {
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Chrome tab request timed out. Inspect before retrying input.")); }, 30000);
      this.pending.set(id, { socket, resolve, reject, timer });
      socket.send(JSON.stringify({ id, action, args }));
    });
  }
  async command(action: string, args: any = {}) {
    if (!this.allowed()) throw new Error("Chrome access is disabled in Settings → General.");
    if (!chromeActions.has(action)) throw new Error("Unsupported Chrome tab action.");
    if (!this.connected) throw new Error("Connect the PixelCrew Chrome extension in Settings → General. Chrome use does not use Windows Computer Use.");
    if (action === "tabs") {
      const result = await Promise.all([...this.clients].map(async ([clientId, socket]) =>
        (await this.send(socket, action, {})).map((tab: any) => ({ ...tab, tabId: `${clientId}:${tab.id}` }))));
      return result.flat();
    }
    const match = /^([a-z0-9-]+):(\d+)$/i.exec(String(args.tabId || ""));
    const socket = match && this.clients.get(match[1]);
    if (!match || !socket) throw new Error("Choose a tabId from the latest chrome_tabs result.");
    return this.send(socket, action, { ...args, tabId: Number(match[2]) });
  }
  close() { for (const socket of this.clients.values()) socket.close(); this.server.close(); }
}
