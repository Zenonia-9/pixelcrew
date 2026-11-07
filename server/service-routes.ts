import type { FastifyInstance } from "fastify";
import type { ServiceLog } from "./logging";
import { release } from "../shared/release";
import { secureEqual } from "./local-session";

export function registerServiceRoutes(app: FastifyInstance, input: {
  log: ServiceLog; status: () => object; active: () => { id: string; task: string }[];
  stop: () => Promise<void>; stopping: () => boolean; controllerToken: string;
}) {
  app.addHook("onRequest", async (request, reply) => {
    if (/^\/api\/service\/(logs|diagnostics)(?:\?|$)/.test(request.url) &&
      !secureEqual(String(request.headers.authorization || ""), `Bearer ${input.controllerToken}`))
      return reply.code(403).send({ error: "Developer controller access required." });
  });
  app.get("/api/service/status", async () => ({ ...release, pid: process.pid, stopping: input.stopping(), active: input.active(), ...input.status() }));
  app.get("/api/service/logs", async () => input.log.tail());
  app.get("/api/service/diagnostics", async (_, reply) => {
    reply.header("Content-Disposition", 'attachment; filename="pixelcrew-diagnostics.json"');
    return { ...release, platform: process.platform, node: process.version, logs: input.log.tail() };
  });
  app.post("/api/service/stop", async (request, reply) => {
    const active = input.active();
    if (active.length && (request.body as { confirmInterrupt?: boolean })?.confirmInterrupt !== true)
      return reply.code(409).send({ error: "Confirm interruption of active tasks.", active });
    // Respond before closing the HTTP listener.
    setTimeout(() => { void input.stop(); }, 100);
    return { stopping: true };
  });
}
