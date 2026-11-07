import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export const secureEqual = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const equal = secureEqual;
export function registerLocalSession(app: FastifyInstance, controllerToken: string) {
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const tickets = new Map<string, number>();
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    const bearer = String(request.headers.authorization || "").replace(/^Bearer /, "");
    if (equal(bearer, controllerToken)) return;
    if (request.url.split("?")[0] === "/api/session" && request.method === "POST") return;
    const id = /(?:^|;\s*)pixelcrew=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || "")?.[1];
    const session = id && sessions.get(id);
    if (!session || session.expires < Date.now()) return reply.code(401).send({ error: "Open PixelCrew from its launcher to connect." });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !equal(String(request.headers["x-pixelcrew-csrf"] || ""), session.csrf))
      return reply.code(403).send({ error: "Invalid session request." });
  });
  app.post("/api/session/ticket", async (request, reply) => {
    if (!equal(String(request.headers.authorization || "").replace(/^Bearer /, ""), controllerToken))
      return reply.code(403).send({ error: "Launcher access required." });
    for (const [key, expires] of tickets) if (expires < Date.now()) tickets.delete(key);
    const ticket = randomBytes(32).toString("hex");
    tickets.set(ticket, Date.now() + 60000);
    return { ticket };
  });
  app.post("/api/session", async (request, reply) => {
    const ticket = (request.body as { ticket?: string })?.ticket || "";
    const expires = tickets.get(ticket);
    tickets.delete(ticket);
    if (!expires || expires < Date.now()) return reply.code(401).send({ error: "Launch link expired. Open PixelCrew from its launcher." });
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
    sessions.set(id, { csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
    reply.header("Set-Cookie", `pixelcrew=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    return { csrf };
  });
  app.get("/api/session", async request => {
    const id = /(?:^|;\s*)pixelcrew=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || "")?.[1];
    return { csrf: id ? sessions.get(id)?.csrf : undefined };
  });
}
