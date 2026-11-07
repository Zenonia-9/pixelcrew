import type { FastifyInstance } from "fastify";

export const securityHeaders = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

/** Protect the local control UI, including static pages and error responses. */
export function registerHttpSecurity(app: FastifyInstance, options: { port?: number; production?: boolean } = {}) {
  app.addHook("onRequest", async (request, reply) => {
    reply.headers(securityHeaders);
    reply.header("Referrer-Policy", "no-referrer");
    if (options.production) reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(request.headers.host || ""))
      return reply.code(403).send({ error: "Local access only." });
    const origin = request.headers.origin;
    const allowed = new Set([`http://127.0.0.1:${options.port || 4318}`, `http://localhost:${options.port || 4318}`, ...(!options.production ? ["http://127.0.0.1:5173", "http://localhost:5173"] : [])]);
    if (origin && !allowed.has(origin))
      return reply.code(403).send({ error: "Origin not allowed." });
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
      return reply.code(415).send({ error: "JSON content type required." });
  });
}
