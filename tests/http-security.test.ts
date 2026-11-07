import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerHttpSecurity } from "../server/http-security";
import viteConfig from "../vite.config";

test("local UI, API and error responses cannot be embedded by an attacker", async () => {
  const app = Fastify();
  registerHttpSecurity(app);
  app.get("/", async (_, reply) => reply.type("text/html").send("<!doctype html><title>Studio</title>"));
  app.post("/api/change", async () => ({ changed: true }));
  try {
    for (const request of [
      { url: "/", headers: { host: "127.0.0.1:4318" } },
      { url: "/missing", headers: { host: "localhost:4318" } },
      { url: "/", headers: { host: "attacker.example" } },
    ]) {
      const response = await app.inject(request);
      assert.equal(response.headers["x-frame-options"], "DENY");
      assert.equal(response.headers["content-security-policy"], "frame-ancestors 'none'");
      assert.equal(response.headers["x-content-type-options"], "nosniff");
    }
    for (const origin of ["http://127.0.0.1:4318", "http://localhost:5173"]) {
      const response = await app.inject({ method: "POST", url: "/api/change", headers: { host: "127.0.0.1:4318", origin, "content-type": "application/json; charset=utf-8" }, payload: "{}" });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { changed: true });
    }
    for (const headers of [
      { host: "attacker.example", "content-type": "application/json" },
      { host: "127.0.0.1:4318", origin: "https://attacker.example", "content-type": "application/json" },
      { host: "127.0.0.1:4318", origin: "null", "content-type": "application/json" },
    ]) {
      assert.equal((await app.inject({ method: "POST", url: "/api/change", headers, payload: "{}" })).statusCode, 403);
    }
    assert.equal((await app.inject({ method: "POST", url: "/api/change", headers: { host: "localhost:4318", "content-type": "text/plain" }, payload: "{}" })).statusCode, 415);
    assert.equal((await app.inject({ url: "/", headers: { host: "[::1]:4318" } })).statusCode, 200);
    assert.equal(viteConfig.server?.headers?.["X-Frame-Options"], "DENY");
    assert.equal(viteConfig.server?.headers?.["Content-Security-Policy"], "frame-ancestors 'none'");
  } finally { await app.close(); }
});
