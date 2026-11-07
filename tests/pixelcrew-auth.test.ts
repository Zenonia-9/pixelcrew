import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PixelCrewSignIn, validateIdentity, credentialSet, readPixelCrewCredentials, usablePixelCrewCredentials, revokePixelCrewSession } from "../server/pixelcrew-auth";

test("PixelCrew validates signed identity, issuer, audience, expiry and attempt nonce", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "test", use: "sig" };
  const jwt = (overrides = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "issued-client", exp: Date.now() / 1000 + 300, sub: "subject", email: "user@example.com", nonce: "attempt", ...overrides })).toString("base64url");
    return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
  };
  assert.deepEqual(await validateIdentity(jwt(), "issued-client", "attempt", [key]), { subject: "subject", email: "user@example.com" });
  for (const overrides of [{ iss: "https://attacker.invalid" }, { aud: "other-client" }, { nonce: "old-attempt" }, { exp: 1 }, { sub: "" }, { aud: ["issued-client", "other"], azp: "other" }]) {
    await assert.rejects(validateIdentity(jwt(overrides), "issued-client", "attempt", [key]), /validation failed/);
  }
  await assert.rejects(validateIdentity(jwt(), "issued-client", "attempt", []), /signature/);
  assert.throws(() => credentialSet({ scope: "openid email", access_token: "access", refresh_token: "refresh", expires_in: 3600 }, "client", { subject: "s", email: "e" }), /not authorized/);
});

test("registration keeps the active account untouched, uses stable host ID and validates callback state", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".protocol", "pixelcrew-oauth-"));
  const auth = new PixelCrewSignIn(join(directory, "host.json"));
  let completed = false;
  try {
    const first = new URL((await auth.start(join(directory, "pending"), async () => { completed = true; }, () => {})).authUrl);
    assert.equal(first.searchParams.get("agent_name_hint"), "PixelCrew");
    assert.equal(first.searchParams.get("client_id"), "dynamic_agent_client");
    assert.equal(first.searchParams.get("code_challenge_method"), "S256");
    assert.equal(readPixelCrewCredentials(join(directory, "pending")), undefined);
    const callback = new URL(first.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: "wrong", code: "not-used" }).toString();
    assert.equal((await fetch(callback)).status, 400);
    const second = new URL((await auth.start(join(directory, "other"), async () => {}, () => {})).authUrl);
    assert.equal(first.searchParams.get("ext_agent_host_id"), second.searchParams.get("ext_agent_host_id"));
    assert.notEqual(first.searchParams.get("state"), second.searchParams.get("state"));
    assert.notEqual(first.searchParams.get("nonce"), second.searchParams.get("nonce"));
    assert.equal(completed, false);
  } finally { auth.cancel(); rmSync(directory, { recursive: true, force: true }); }
});

test("refresh is serialized and rotates only the selected registration's credentials", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".protocol", "pixelcrew-refresh-"));
  const { writeFileSync } = await import("node:fs");
  const file = join(directory, "pixelcrew-oauth.json");
  const previous = credentialSet({ access_token: "old", refresh_token: "old-refresh", id_token: "validated-id", scope: "resource.invoke chatgpt.tokens.use.direct", expires_in: 1 }, "issued", { subject: "subject", email: "email" });
  previous.expiresAt = 1;
  writeFileSync(file, JSON.stringify(previous));
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count++;
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("client_id"), "issued");
    assert.equal(body.get("refresh_token"), "old-refresh");
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
  };
  try {
    const [a, b] = await Promise.all([usablePixelCrewCredentials(directory), usablePixelCrewCredentials(directory)]);
    assert.equal(count, 1);
    assert.equal(a?.accessToken, "new");
    assert.deepEqual(a, b);
    assert.equal(readPixelCrewCredentials(directory)?.refreshToken, "new-refresh");
    assert.equal(a?.subject, "subject");
  } finally { globalThis.fetch = original; rmSync(directory, { recursive: true, force: true }); }
});

test("a valid loopback sign-in stores only its own registration and reuses its issued client", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".protocol", "pixelcrew-callback-"));
  const home = join(directory, "account");
  const auth = new PixelCrewSignIn(join(directory, "host.json"));
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let nonce = "", completed = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
    if (String(url).endsWith("jwks.json")) return new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test" }] }));
    assert.equal(String(url), "https://auth.openai.com/api/accounts/oauth/token");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("client_id"), "issued-pixelcrew");
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.ok(body.get("code_verifier"));
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "issued-pixelcrew", exp: Date.now() / 1000 + 300, sub: "validated-subject", email: "other@example.com", nonce })).toString("base64url");
    const id = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
    return new Response(JSON.stringify({ access_token: "private-access", refresh_token: "private-refresh", id_token: id, scope: "openid email resource.invoke chatgpt.tokens.use.direct", expires_in: 3600 }));
  };
  try {
    const authorize = new URL((await auth.start(home, async credentials => { assert.equal(credentials.subject, "validated-subject"); completed = true; }, error => { throw error; })).authUrl);
    nonce = authorize.searchParams.get("nonce")!;
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "one-time-code", client_id: "issued-pixelcrew" }).toString();
    const response = await originalFetch(callback);
    assert.equal(response.status, 200);
    assert.equal(completed, true);
    assert.ok(!(await response.text()).includes("private-access"));
    assert.equal(readPixelCrewCredentials(home)?.clientId, "issued-pixelcrew");
    const returning = new URL((await auth.start(home, async () => {}, () => {})).authUrl);
    assert.equal(returning.searchParams.get("client_id"), "issued-pixelcrew");
    assert.equal(returning.searchParams.has("agent_name_hint"), false);
    assert.equal(returning.searchParams.get("login_hint"), "other@example.com");
    const before = readFileSync(join(home, "pixelcrew-oauth.json"), "utf8");
    const bad = new URL(returning.searchParams.get("redirect_uri")!);
    bad.search = new URLSearchParams({ state: returning.searchParams.get("state")!, code: "bad", client_id: "different-client" }).toString();
    assert.equal((await originalFetch(bad)).status, 400);
    assert.equal(readFileSync(join(home, "pixelcrew-oauth.json"), "utf8"), before);
    const migrationHome = join(directory, "legacy-account");
    const migration = new URL((await auth.start(migrationHome, async () => { throw Error("Must not activate another identity"); }, () => {}, "expected@example.com")).authUrl);
    nonce = migration.searchParams.get("nonce")!;
    const mismatch = new URL(migration.searchParams.get("redirect_uri")!);
    mismatch.search = new URLSearchParams({ state: migration.searchParams.get("state")!, code: "migration", client_id: "issued-pixelcrew" }).toString();
    assert.equal((await originalFetch(mismatch)).status, 400);
    assert.equal(readPixelCrewCredentials(migrationHome), undefined);
  } finally { auth.cancel(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); }
});

test("failed first exchange preserves the issued registration and reports the provider error", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".protocol", "pixelcrew-failed-registration-"));
  const home = join(directory, "account");
  const auth = new PixelCrewSignIn(join(directory, "host.json"));
  const originalFetch = globalThis.fetch;
  let failure: Error | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
    return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Authorization code expired" }), { status: 400 });
  };
  try {
    const authorize = new URL((await auth.start(home, async () => {}, error => { failure = error; })).authUrl);
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "expired-code", client_id: "issued-pixelcrew" }).toString();
    assert.equal((await originalFetch(callback)).status, 400);
    assert.match(failure?.message || "", /400.*invalid_grant.*Authorization code expired/);
    assert.equal(readPixelCrewCredentials(home), undefined);
    const retry = new URL((await auth.start(home, async () => {}, () => {})).authUrl);
    assert.equal(retry.searchParams.get("client_id"), "issued-pixelcrew");
    assert.equal(retry.searchParams.get("agent_name_hint"), null);
  } finally { auth.cancel(); globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); }
});

test("logout revokes only the selected registration and reports remote failure honestly", async () => {
  const directory = mkdtempSync(join(process.cwd(), ".protocol", "pixelcrew-revoke-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(directory, "pixelcrew-oauth.json"), JSON.stringify({ clientId: "selected-client", refreshToken: "selected-refresh" }));
  const original = globalThis.fetch;
  let responseStatus = 200;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://auth.openai.com/api/accounts/oauth/revoke");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("client_id"), "selected-client");
    assert.equal(body.get("token"), "selected-refresh");
    assert.equal(body.get("token_type_hint"), "refresh_token");
    return new Response("", { status: responseStatus });
  };
  try {
    assert.equal(await revokePixelCrewSession(directory), true);
    responseStatus = 503;
    assert.equal(await revokePixelCrewSession(directory), false);
  } finally { globalThis.fetch = original; rmSync(directory, { recursive: true, force: true }); }
});
