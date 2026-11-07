import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readSecret, writeSecret } from "./private-storage";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export interface PixelCrewCredentials {
  clientId: string; subject: string; email: string; accessToken: string;
  refreshToken: string; idToken: string; scopes: string[]; expiresAt: number;
}
function atomic(file: string, value: unknown) {
  if (file.endsWith("pixelcrew-oauth.json")) { writeSecret(file, value); return; }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, file);
  chmodSync(file, 0o600);
}
export function readPixelCrewCredentials(home?: string): PixelCrewCredentials | undefined {
  const file = home && resolve(home, "pixelcrew-oauth.json");
  if (!file || !existsSync(file)) return undefined;
  return readSecret<PixelCrewCredentials>(file);
}
function readRegisteredClientId(home: string) {
  const file = resolve(home, "pixelcrew-registration.json");
  if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, "utf8"));
  return typeof value.clientId === "string" && value.clientId ? value.clientId as string : undefined;
}
export async function revokePixelCrewSession(home: string) {
  const saved = readPixelCrewCredentials(home);
  if (!saved) return true;
  try {
    const response = await fetch(`${issuer}/api/accounts/oauth/revoke`, { method: "POST",
      body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: "refresh_token", client_id: saved.clientId }),
      signal: AbortSignal.timeout(8000) });
    return response.status === 200;
  } catch { return false; }
}
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  let value: any;
  try { value = body ? JSON.parse(body) : {}; } catch { value = {}; }
  if (!response.ok) {
    const code = typeof value.error === "string" ? value.error : "";
    const detail = typeof value.error_description === "string" ? value.error_description : typeof value.message === "string" ? value.message : "";
    const safe = detail.replace(/[\r\n\t]+/g, " ").slice(0, 240);
    throw Error(`PixelCrew sign-in request failed (${response.status})${code ? ` ${code}` : ""}${safe ? `: ${safe}` : ". Reconnect this account in Settings."}`);
  }
  return value;
}
async function token(body: Record<string, string>) {
  return json(`${issuer}/api/accounts/oauth/token`, { method: "POST", body: new URLSearchParams(body) });
}
export async function validateIdentity(idToken: string, clientId: string, nonce: string, keys?: any[]) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw Error("Invalid sign-in identity token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw Error("Unsupported sign-in signature.");
  const published = keys || (await json(`${issuer}/.well-known/jwks.json`)).keys;
  const key = published.find((key: any) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!key || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw Error("Invalid sign-in signature.");
  if (claims.iss !== issuer || !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 || claims.nonce !== nonce ||
      typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email ||
      (claims.nbf != null && claims.nbf > Date.now() / 1000 + 30) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId)) throw Error("Sign-in identity validation failed.");
  return { subject: claims.sub as string, email: claims.email as string };
}
export function credentialSet(response: any, clientId: string, identity: { subject: string; email: string }, previous?: PixelCrewCredentials): PixelCrewCredentials {
  const granted = typeof response.scope === "string" ? response.scope.split(/\s+/).filter(Boolean) : previous?.scopes || [];
  if (!granted.includes("chatgpt.tokens.use.direct") || !granted.includes("resource.invoke")) throw Error("ChatGPT plan use was not authorized. Reconnect and allow plan access.");
  if (typeof response.access_token !== "string" || !response.access_token ||
      !(response.refresh_token || previous?.refreshToken) || !Number.isFinite(response.expires_in) || response.expires_in <= 0 ||
      (response.token_type && response.token_type.toLowerCase() !== "bearer")) throw Error("Incomplete sign-in credentials.");
  return { clientId, ...identity, accessToken: response.access_token, refreshToken: response.refresh_token || previous!.refreshToken,
    idToken: response.id_token || previous?.idToken || "", scopes: granted, expiresAt: Date.now() + response.expires_in * 1000 };
}
const renewing = new Map<string, Promise<PixelCrewCredentials>>();
export async function usablePixelCrewCredentials(home?: string): Promise<PixelCrewCredentials | undefined> {
  const saved = readPixelCrewCredentials(home);
  if (!saved || !home || saved.expiresAt > Date.now() + 120000) return saved;
  let pending = renewing.get(home);
  if (!pending) {
    pending = (async () => {
      const response = await token({ grant_type: "refresh_token", client_id: saved.clientId, refresh_token: saved.refreshToken, resource });
      const next = credentialSet(response, saved.clientId, saved, saved);
      // Preserve the last validated ID token for returning-account hints.
      next.idToken = saved.idToken;
      atomic(resolve(home, "pixelcrew-oauth.json"), next);
      return next;
    })().finally(() => renewing.delete(home));
    renewing.set(home, pending);
  }
  return pending;
}

/** One loopback attempt at a time; no access or refresh tokens reach the browser. */
export class PixelCrewSignIn {
  private listener?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private hostFile: string) {}
  cancel() { clearTimeout(this.timer); this.listener?.close(); this.listener = undefined; }
  async start(home: string, complete: (credentials: PixelCrewCredentials) => Promise<void>, failed: (error: Error) => void, expectedEmail?: string) {
    this.cancel();
    let hostId: string;
    if (existsSync(this.hostFile)) hostId = JSON.parse(readFileSync(this.hostFile, "utf8")).hostId;
    else { hostId = `urn:uuid:${randomUUID()}`; atomic(this.hostFile, { hostId }); }
    const saved = readPixelCrewCredentials(home);
    const registeredClientId = saved?.clientId || readRegisteredClientId(home);
    const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
    let redirect = "", consumed = false;
    const listener = createServer(async (request, reply) => {
      reply.setHeader("Content-Type", "text/plain; charset=utf-8");
      reply.setHeader("Cache-Control", "no-store");
      reply.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      const callback = new URL(request.url || "/", redirect);
      if (request.method !== "GET" || callback.pathname !== "/auth/callback" || callback.searchParams.get("state") !== state || consumed) {
        reply.writeHead(400).end("Invalid sign-in callback."); return;
      }
      consumed = true;
      try {
        if (callback.searchParams.has("error")) throw Error("PixelCrew sign-in was cancelled or denied.");
        const clientId = callback.searchParams.get("client_id") || registeredClientId;
        const code = callback.searchParams.get("code");
        if (!clientId || clientId === "dynamic_agent_client" || !code || (registeredClientId && clientId !== registeredClientId)) throw Error("Incomplete or mismatched account registration.");
        // Keep the issued registration even if the one-time code expires or exchange fails.
        // The next authorization must use this client ID rather than registering again.
        atomic(resolve(home, "pixelcrew-registration.json"), { clientId });
        const response = await token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect, resource });
        const identity = await validateIdentity(response.id_token, clientId, nonce);
        if (saved && saved.subject !== identity.subject) throw Error("This is a different ChatGPT account. Use Add account instead.");
        if (!saved && expectedEmail && expectedEmail.toLowerCase() !== identity.email.toLowerCase()) throw Error("This is a different ChatGPT account. Use Add account instead.");
        const credentials = credentialSet(response, clientId, identity);
        if (this.listener !== listener) throw Error("This sign-in attempt is no longer active.");
        atomic(resolve(home, "pixelcrew-oauth.json"), credentials);
        await complete(credentials);
        reply.end("PixelCrew is connected. You can close this window and return to the app.");
      } catch (error) {
        failed(error as Error);
        reply.writeHead(400).end("PixelCrew could not finish sign-in. Return to Settings for details.");
      } finally { if (this.listener === listener) this.cancel(); else listener.close(); }
    });
    this.listener = listener;
    await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    const address = listener.address();
    if (!address || typeof address === "string") throw Error("Could not start the sign-in callback.");
    redirect = `http://127.0.0.1:${address.port}/auth/callback`;
    this.timer = setTimeout(() => { this.cancel(); failed(Error("Sign-in expired. Please try again.")); }, 10 * 60000);
    this.timer.unref();
    const authorize = new URL(`${issuer}/api/accounts/authorize`);
    authorize.search = new URLSearchParams({ client_id: registeredClientId || "dynamic_agent_client", ext_agent_host_id: hostId,
      ...(saved ? { login_hint: saved.email } : registeredClientId ? {} : { agent_name_hint: "PixelCrew" }),
      response_type: "code", redirect_uri: redirect, scope: scopes, resource, state, nonce,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
    return { authUrl: authorize.href };
  }
}
