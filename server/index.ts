import { registerFileRoutes } from "./file-routes";
import { homedir } from "node:os";
import { appRoot as root, dataPath, dataRoot, servicePort, storedPath } from "./paths";
import { createServer } from "node:net";
import { withinDirectory } from "./file-access";
import { prepareData } from "./data-migration";
import { ServiceLog } from "./logging";
import { controllerToken, acquireServiceLock } from "./service-identity";
import { registerLocalSession } from "./local-session";
import { registerServiceRoutes } from "./service-routes";
import { release } from "../shared/release";
import { usageHistory } from "./usage-history";
import { ChatOutbox, queueOutboxMessage } from "./chat-outbox";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { resolve, isAbsolute, basename, extname } from "node:path";
import {
  existsSync,
  statSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./store";
import { CodexRuntime } from "./runtime";
import { AccountProfiles } from "./account-profiles";
import { PixelCrewSignIn, revokePixelCrewSession } from "./pixelcrew-auth";
import { Engine } from "./engine";
import { runOptionsSchema, teamSchema, threadGoalUpdateSchema } from "../shared/types";
import { projectContains } from "../shared/projects";
import { fileCompletions } from "./file-completion";
import { builtinCatalog } from "./builtin-catalog";
import { officeLayout } from "../shared/office-layouts";
import { registerHttpSecurity, securityHeaders } from "./http-security";
import { isLocalFilesystemPath, requireLocalFilesystemPath } from "../shared/local-paths";
import { deviceToolStatus } from "./device-tool-status";
import { chatTitle } from "../shared/chat-title";
const token = controllerToken();
const log = new ServiceLog(dataPath("logs"));
const unlock = acquireServiceLock();
let crashCleanup = () => {};
process.once("exit", unlock);
process.on("uncaughtException", error => { log.write("service.crash", { code: (error as NodeJS.ErrnoException).code || "UNCAUGHT" }); crashCleanup(); process.exit(1); });
process.on("unhandledRejection", () => { log.write("service.crash", { code: "UNHANDLED_REJECTION" }); crashCleanup(); process.exit(1); });
log.write("service.starting");
// Refuse an occupied port before migrating data or starting a Codex process.
await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(servicePort, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
});
const legacy = existsSync(resolve(root, ".data")) ? resolve(root, ".data") : basename(root) === ".build" ? resolve(root, "../.data") : resolve(root, ".data");
await prepareData(dataRoot, process.env.PIXELCREW_SKIP_LEGACY === "1" ? undefined : process.env.PIXELCREW_LEGACY_DIR || legacy);
const store = new Store(dataPath("studio.sqlite"));
const accounts = new AccountProfiles(dataPath("account-profiles.json"));
const signIn = new PixelCrewSignIn(dataPath("pixelcrew-host.json"));
const runtime = new CodexRuntime(false, accounts.home(), accounts.disconnected);
crashCleanup = () => runtime.close();
runtime.configureAccounts(id => accounts.home(id));
runtime.observeDesktopStatus();
const engine = new Engine(store, runtime);
const loggedStatus = new Map(engine.runs.map(run => [run.id, run.status]));
engine.on("change", () => {
  for (const run of engine.runs) if (loggedStatus.get(run.id) !== run.status) {
    loggedStatus.set(run.id, run.status); log.write("run.status", { runId: run.id, code: run.status });
  }
});
const outbox = new ChatOutbox(store);
const app = Fastify({ bodyLimit: 1024 * 1024 });
let accountMutation = false;
registerHttpSecurity(app, { port: servicePort, production: !process.env.PIXELCREW_DEV });
registerLocalSession(app, token);
let stopping = false;
registerServiceRoutes(app, { log, status: () => ({ connected: runtime.status.connected, authenticated: runtime.status.authenticated,
  connectionHelp: !runtime.status.connected ? "Check that Codex is installed, then reconnect in Settings → Account." : !runtime.status.authenticated ? "Sign in from Settings → Account." : undefined }),
  active: () => engine.runs.filter(run => ["running", "approval", "queued"].includes(run.status)).map(({ id, task }) => ({ id, task })),
  stopping: () => stopping, stop: close, controllerToken: token });
app.addHook("onResponse", async (request, reply) => { log.write("http.response", { requestId: request.id, status: reply.statusCode, durationMs: reply.elapsedTime }); });
app.addHook("onRequest", async (request, reply) => {
  if (stopping && !["GET", "HEAD"].includes(request.method)) return reply.code(503).send({ error: "PixelCrew is stopping." });
});
runtime.on("change", () => {
  if (runtime.status.authenticated && !accountMutation) accounts.confirm(runtime.status.account);
});
const snapshot = () => ({
  queuedMessages: outbox.list(),
  catalog: builtinCatalog,
  activeTeamId: store.activeTeamId(),
  teams: store.teams(),
  layoutPreset: store.layoutPreset(),
  layoutBasePreset: store.layoutBasePreset(),
  officeDesign: store.officeDesign(),
  preferences: store.preferences(),
  deviceToolStatus: deviceToolStatus(),
  layout: store.roomLayout(),
  team: store.team(),
  runs: engine.runs,
  events: store.events(),
  approvals: engine.approvals,
  runtime: runtime.status,
  accounts: accounts.view(),
});
app.addHook("onRequest", async (request, reply) => {
  const changesState = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (accountMutation && changesState && /^\/api\/(?:runs|chats|queued|approvals)(?:[/?]|$)/.test(request.url))
    return reply.code(409).send({ error: "An account change is in progress. Wait for it to finish before using this chat." });
  const expectedTeam = (request.query as { teamId?: string } | undefined)
    ?.teamId;
  if (expectedTeam && expectedTeam !== store.activeTeamId())
    return reply.code(409).send({
      error: "The active team changed. Reopen this team's view before saving.",
    });
});
app.setErrorHandler((error, request, reply) => {
  log.write("http.error", { requestId: request.id, code: error instanceof z.ZodError ? "VALIDATION" : "REQUEST_FAILED" });
  reply.code(error instanceof z.ZodError ? 400 : 400).send({
    error: error instanceof Error ? error.message : "Request failed.",
  });
});
app.get("/api/state", async () => snapshot());
app.post("/api/teams", async (request) => {
  const { name, team } = z
    .object({ name: z.string().trim().min(1).max(60), team: teamSchema.optional() })
    .parse(request.body);
  store.createTeam(name, team);
  engine.emit("change");
  return snapshot();
});
app.post<{ Params: { id: string } }>(
  "/api/teams/:id/activate",
  async (request) => {
    store.switchTeam(request.params.id);
    engine.emit("change");
    return snapshot();
  },
);
const ensureOfficeIdle = () => {
  if (
    engine.runs.some(
      (run) =>
        (run.teamId || "default") === store.activeTeamId() &&
        ["queued", "running", "approval"].includes(run.status),
    )
  )
    throw Error(
      "Finish or interrupt this team's task before arranging the room.",
    );
};
app.post<{ Params: { id: string } }>(
  "/api/teams/:id/delete",
  async (request) => {
    if (
      engine.runs.some(
        (run) =>
          (run.teamId || "default") === request.params.id &&
          ["queued", "running", "approval"].includes(run.status),
      )
    )
      throw Error("Finish or interrupt this team's tasks before deleting it.");
    store.deleteTeam(request.params.id);
    engine.emit("change");
    return snapshot();
  },
);
app.post("/api/office/design", async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.body);
  store.saveOfficeDesign(id);
  engine.emit("change");
  return snapshot();
});
app.post("/api/layout/preset", async (request) => {
  ensureOfficeIdle();
  const { id } = z.object({ id: z.string() }).parse(request.body);
  store.applyLayout(id, officeLayout(id, store.team().agents));
  engine.emit("change");
  return snapshot();
});
app.post("/api/layout/undo", async () => {
  ensureOfficeIdle();
  store.undoLayout();
  engine.emit("change");
  return snapshot();
});
app.get<{ Querystring: { workspace?: string; query?: string } }>(
  "/api/files",
  async (request) => {
    try {
      return {
        items: fileCompletions(
          request.query.workspace || "",
          request.query.query || "",
        ),
      };
    } catch {
      return { items: [] };
    }
  },
);
app.post("/api/usage/reset", async request => changeAccount(async () => {
  const input = z.object({ creditId: z.string().optional(), idempotencyKey: z.string().uuid(), accountId: z.string() }).parse(request.body);
  if (input.accountId !== accounts.selected || accounts.disconnected) throw Error("The active account changed. Reopen Usage before using a reset.");
  return runtime.redeemUsageReset(input.creditId, input.idempotencyKey);
}));
app.get<{ Querystring: { from?: string; to?: string } }>("/api/usage/history", async request => {
  const to = Number(request.query.to || Date.now());
  const from = Number(request.query.from || to - 7 * 86400000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 91 * 86400000) throw Error("Choose a time range of up to 90 days.");
  const roots = [resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex")), ...accounts.profiles.filter(profile => !profile.desktop).map(profile => accounts.home(profile.id)!)];
  return usageHistory(roots, from, to);
});
app.get<{ Params: { id: string } }>("/api/queued/:id/image", async (request, reply) => {
  const id = request.params.id;
  const [, runId, messageId] = id.split(":");
  const attachments = id.startsWith("run:") ? engine.runs.find(run => run.id === runId)?.inbox?.find(item => item.id === messageId)?.attachments : outbox.list().find(item => item.id === id)?.options.attachments;
  const originalAttachment = attachments?.find(item => item.kind === "image");
  const attachment = originalAttachment && { ...originalAttachment, path: storedPath(originalAttachment.path) };
  if (!attachment || !isLocalFilesystemPath(attachment.path) || !existsSync(attachment.path)) return reply.code(404).send({ error: "Queued image not found." });
  const workspace = id.startsWith("run:") ? engine.runs.find(run => run.id === runId)?.workspace : outbox.list().find(item => item.id === id)?.workspace;
  if (!withinDirectory(dataPath("attachments"), attachment.path) && (!workspace || !withinDirectory(workspace, attachment.path)))
    return reply.code(403).send({ error: "Queued image is outside this chat's workspace." });
  const contentType = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extname(attachment.path).toLowerCase()];
  if (!contentType) return reply.code(400).send({ error: "Unsupported image." });
  return reply.type(contentType).header("Cache-Control", "no-store").send(createReadStream(attachment.path));
});
app.put<{ Params: { id: string } }>("/api/queued/:id", async request => {
  const { text } = z.object({ text: z.string().trim().min(1).max(16000) }).parse(request.body);
  const item = outbox.list().find(item => item.id === request.params.id);
  if (!item) throw Error("This message has already been delivered.");
  outbox.save({ ...item, text, error: undefined }); engine.emit("change"); return { updated: true };
});
app.delete<{ Params: { id: string } }>("/api/queued/:id", async request => {
  outbox.remove(request.params.id); engine.emit("change"); return { removed: true };
});
app.post<{ Params: { id: string } }>("/api/queued/:id/steer", async request => {
  const item = outbox.list().find(item => item.id === request.params.id);
  if (!item) throw Error("This message has already been delivered.");
  if (item.accountId !== accounts.selected || item.teamId !== store.activeTeamId()) throw Error("Select the account and team this message was queued with.");
  const owner = engine.runs.find(run => ["running", "queued", "approval"].includes(run.status) && (run.chatThreadId === item.threadId || run.options?.sourceThreadId === item.threadId));
  if (owner && (owner.accountId || "desktop") !== item.accountId) throw Error("This chat is still running with another account. Your message remains queued until it finishes.");
  if (owner) { await queueOutboxMessage(engine, owner, item); outbox.remove(item.id); }
  else {
    const sent = await runtime.steerChat(item.threadId, item.text + item.references.map(path => `\nReference: ${path}`).join(""), item.options.attachments, item.id, { allowWrite: item.allowWrite, options: item.options });
    if (sent) outbox.remove(item.id); else await drainOutbox();
  }
  engine.emit("change"); return { sent: true };
});
app.route<{ Params: { id: string; messageId: string } }>({ method: ["DELETE", "POST", "PUT"], url: "/api/runs/:id/inbox/:messageId", handler: async request => {
  const run = engine.runs.find(run => run.id === request.params.id);
  const message = run?.inbox?.find(message => message.id === request.params.messageId && message.status === "queued");
  if (!run || !message) throw Error("This message has already been delivered.");
  if (request.method === "DELETE") run.inbox = run.inbox!.filter(item => item.id !== message.id);
  else if (request.method === "PUT") message.text = z.object({ text: z.string().trim().min(1).max(16000) }).parse(request.body).text;
  else {
    const active = run.assignments.find(a => a.status === "running");
    if (!active) return { queued: true };
    try { await runtime.steer(active, message.text + (message.references || []).map(path => `\nReference: ${path}`).join(""), message.attachments, message.id); }
    catch (error) { if (/turn.*finished|no active turn/i.test(String(error))) return { queued: true }; throw error; }
    message.status = "delivered"; message.assignmentId = active.id;
  }
  engine.save(run); engine.emit("change"); return { updated: true };
}});
async function drainOutbox() {
  if (stopping || accountMutation || !runtime.status.authenticated || accounts.disconnected) return;
  await outbox.drain({
    eligible: item => !accountMutation && accounts.profiles.some(profile => profile.id === item.accountId) && item.teamId === store.activeTeamId() && !engine.runs.some(run => ["running", "queued", "approval"].includes(run.status) && (run.chatThreadId === item.threadId || run.options?.sourceThreadId === item.threadId)),
    active: async item => Boolean((await runtime.readChat(item.threadId)).active),
    start: item => { engine.create(item.text, item.workspace, item.criteria, item.references, false, item.allowWrite, { ...item.options, sourceThreadId: item.threadId }, "", item.accountId); },
    changed: () => engine.emit("change"),
  });
}
app.put("/api/preferences", async (request) => {
  const input = z
    .object({ key: z.string().min(1).max(250), value: z.unknown() })
    .parse(request.body);
  const preferences = store.savePreference(input.key, input.value);
  engine.emit("change");
  return preferences;
});
app.put("/api/layout", async (request) => {
  ensureOfficeIdle();
  const layout = store.saveRoomLayout(request.body);
  engine.emit("change");
  return layout;
});
app.get<{ Querystring: { projectId?: string; cursor?: string } }>(
  "/api/chats",
  async (request) =>
    runtime.listChats(request.query.projectId, request.query.cursor),
);
app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
  "/api/chats/:id",
  async (request) => runtime.readChat(request.params.id, request.query.cursor),
);
app.get<{ Params: { id: string } }>("/api/chats/:id/goal", async request =>
  runtime.getThreadGoal(request.params.id),
);
app.put<{ Params: { id: string } }>("/api/chats/:id/goal", async request => {
  const update = threadGoalUpdateSchema.parse(request.body);
  const goal = await runtime.setThreadGoal(request.params.id, update);
  if (goal.status === "active") engine.continueGoal(request.params.id);
  return goal;
});
app.delete<{ Params: { id: string } }>("/api/chats/:id/goal", async request =>
  runtime.clearThreadGoal(request.params.id),
);
app.get<{ Querystring: { workspace?: string } }>(
  "/api/composer",
  async (request) =>
    runtime.composerCapabilities(request.query.workspace || ""),
);
registerFileRoutes(app, runtime, engine);
app.post<{ Params: { id: string } }>("/api/chats/:id/interrupt", async request => {
  const id = request.params.id;
  const owner = engine.runs.find(run => ["running", "queued", "approval"].includes(run.status) &&
    (run.chatThreadId === id || run.options?.sourceThreadId === id || run.assignments.some(a => a.threadId === id)));
  if (owner) await engine.stop(owner);
  else await runtime.interruptChat(id);
  engine.emit("change");
  return { stopped: true };
});
app.post("/api/projects/refresh", async () => {
  await runtime.connect();
  await runtime.refreshProjects();
  return {
    projects: runtime.status.projects || [],
    error: runtime.status.projectsError,
  };
});
app.get("/api/team/export", async (_, reply) =>
  reply
    .header("Content-Disposition", 'attachment; filename="pixelcrew-team.json"')
    .send(store.team()),
);
app.put("/api/team", async (request) => {
  const team = store.saveTeam(request.body);
  engine.emit("change");
  return team;
});
async function changeAccount<T>(change: () => Promise<T>) {
  if (accountMutation) throw Error("An account change is already in progress.");
  accountMutation = true;
  try { return await change(); } finally { accountMutation = false; }
}
app.post("/api/runtime/connect", async () => changeAccount(async () => {
  if (accounts.disconnected) {
    accounts.disconnected = false;
    accounts.save();
    await runtime.useAccount(accounts.home());
  } else await runtime.connect();
  await runtime.refresh();
  return runtime.status;
}));
async function beginSignIn(id: string) {
  const home = accounts.home(id);
  if (!home) throw Error("Desktop Codex sign-in is managed in Codex. Add an account to sign in here.");
  return signIn.start(home, async credentials => {
    accounts.confirm(credentials.email, id);
    await changeAccount(async () => {
      await selectAccount(id, false);
    });
  }, error => { runtime.status.error = error.message; engine.emit("change"); }, accounts.get(id).email);
}
async function beginCodexSignIn(id: string) {
  if (!accounts.home(id)) throw Error("Desktop Codex sign-in is managed in Codex. Add an account to sign in here.");
  return runtime.login();
}
app.post("/api/runtime/login", async request => changeAccount(async () => {
  assertAccountsIdle();
  const { provider } = z.object({ provider: z.enum(["codex", "pixelcrew"]).default("codex") }).parse(request.body || {});
  return provider === "pixelcrew" ? beginSignIn(accounts.selected) : beginCodexSignIn(accounts.selected);
}));
app.post("/api/runtime/logout", async request => changeAccount(async () => {
  const confirmation = z.object({ accountId: z.string().optional() }).parse(request.body || {});
  if (confirmation.accountId && confirmation.accountId !== accounts.selected)
    throw Error("The active account changed. Confirm Log out again for the intended account.");
  const id = accounts.selected;
  const removing = accounts.removable(id);
  const ids = new Set(removing.map(profile => profile.id));
  if (engine.runs.some(run => ids.has(run.accountId || "desktop") && ["running", "queued", "approval"].includes(run.status)))
    throw Error("Finish or stop this account's tasks before logging out.");
  signIn.cancel();
  await runtime.useAccount(undefined, false);
  const revocation = await Promise.all(removing.map(profile => revokePixelCrewSession(accounts.home(profile.id)!)));
  try { accounts.remove(id); }
  catch (error) { await runtime.useAccount(accounts.home(id)).catch(() => {}); throw error; }
  // Preserve unsent text, but never deliver it using a removed account.
  for (const item of outbox.list()) if (ids.has(item.accountId))
    outbox.save({ ...item, error: "This account was removed. Copy this message into a chat with a signed-in account." });
  try { await runtime.useAccount(accounts.home()); }
  catch { /* Removal is complete even if the desktop connection is unavailable. */ }
  engine.emit("change");
  return { removed: true, remoteRevocationConfirmed: revocation.every(Boolean) };
}));
function assertAccountsIdle() {
  if (runtime.active.size) throw Error("Wait for active work to finish before disconnecting this account.");
  if (engine.runs.some(run => (run.accountId || "desktop") === accounts.selected && ["running", "queued", "approval"].includes(run.status)))
    throw Error("Wait for active work to finish before changing accounts.");
}
app.post("/api/accounts", async request => changeAccount(async () => {
  assertAccountsIdle();
  const { provider } = z.object({ provider: z.enum(["codex", "pixelcrew"]).default("codex") }).parse(request.body || {});
  const profile = accounts.add("New account", true);
  await selectAccount(profile.id);
  return provider === "pixelcrew" ? beginSignIn(profile.id) : beginCodexSignIn(profile.id);
}));
async function selectAccount(id: string, cancelSignIn = true) {
  if (cancelSignIn) signIn.cancel();
  const home = accounts.home(id);
  try { await runtime.useAccount(home); }
  catch (error) {
    // Keep the intended profile selected when its saved credentials are stale or
    // revoked so Settings can offer reconnect or logout for that exact account.
    accounts.selected = id;
    accounts.disconnected = false;
    accounts.save();
    engine.emit("change");
    throw error;
  }
  accounts.selected = id;
  accounts.disconnected = false;
  accounts.save();
  if (runtime.status.authenticated) accounts.confirm(runtime.status.account, id);
  engine.emit("change");
}
app.post("/api/accounts/select", async request => changeAccount(async () => {
  const { id } = z.object({ id: z.string() }).parse(request.body);
  await selectAccount(id);
  return accounts.view();
}));
const runInput = z.object({
  task: z.string().trim().min(1).max(16000),
  criteria: z.string().max(8000).default(""),
  workspace: z.string().min(1),
  references: z.array(z.string()).max(20).default([]),
  demo: z.literal(false).default(false),
  allowWrite: z.boolean().default(false),
  options: runOptionsSchema.optional(),
});
app.post("/api/runs", async (request) => {
  const expectedAccount = accounts.selected;
  const requireSameAccount = () => {
    if (accountMutation || accounts.selected !== expectedAccount) throw Error("The active account changed. Reopen the chat before sending.");
  };
  const data = runInput.parse(request.body);
  if (!release.capabilities.deviceTools && data.options?.deviceTools?.length) throw Error("Device tools are not qualified for this release.");
  let routingContext = "";
  let externalActive = false;
  const expectedTeam = data.options?.teamId || store.activeTeamId();
  if (expectedTeam !== store.activeTeamId())
    throw Error("The active team changed. Reopen the chat before sending.");
  const activeGroup = engine.runs.find(
    (run) =>
      !!data.options?.sourceThreadId &&
      (run.chatThreadId ||
        run.assignments.find((a) => a.threadId)?.threadId) ===
        data.options.sourceThreadId &&
      ["queued", "running", "approval"].includes(run.status),
  );
  if (activeGroup && (activeGroup.accountId || "desktop") !== expectedAccount)
    throw Error("This chat is running with another account. Wait for it to finish, or start a different chat with the selected account.");
  if (!data.demo) {
    requireLocalFilesystemPath(data.workspace);
    if (
      !isAbsolute(data.workspace) ||
      !existsSync(data.workspace) ||
      !statSync(data.workspace).isDirectory()
    )
      throw new Error("Choose an existing absolute workspace folder.");
    data.workspace = realpathSync(data.workspace);
    if (data.options?.projectId) {
      const project = runtime.status.projects?.find(
        (p) => p.id === data.options!.projectId,
      );
      if (!project || !projectContains(project, data.workspace))
        throw new Error("Workspace must belong to the selected Codex project.");
    }
    if (data.options?.sourceThreadId) {
      const source = await runtime.readChat(data.options.sourceThreadId);
      requireSameAccount();
      routingContext = source.turns
        .slice(-3)
        .flatMap((turn) => [
          ...turn.users.map((m) => m.text),
          ...turn.answers.map((m) => m.text),
        ])
        .join("\n")
        .slice(-20000);
      externalActive = Boolean(source.active && !activeGroup);
      if (
        data.options.projectId &&
        source.projectId !== data.options.projectId
      ) {
        const project = runtime.status.projects?.find(
          (p) => p.id === data.options!.projectId,
        );
        if (
          source.projectId ||
          !project ||
          !projectContains(project, source.cwd)
        )
          throw new Error("Choose a chat from the selected project.");
      }
    }
    for (const attachment of data.options?.attachments || []) {
      requireLocalFilesystemPath(attachment.path);
      if (
        !isAbsolute(attachment.path) ||
        !existsSync(attachment.path) ||
        !statSync(attachment.path).isFile()
      )
        throw new Error(`Attachment not found: ${attachment.name}`);
    }
    for (const p of data.references) {
      requireLocalFilesystemPath(p);
      if (!isAbsolute(p) || !existsSync(p))
        throw new Error(`Reference not found: ${p}`);
    }
    if (externalActive && data.options?.sourceThreadId) {
      if (data.options.goalObjective)
        await runtime.setThreadGoal(data.options.sourceThreadId, {
          objective: data.options.goalObjective,
          status: "active",
          tokenBudget: data.options.goalTokenBudget,
        });
      requireSameAccount();
      const item = outbox.add({ threadId: data.options.sourceThreadId, text: data.task, workspace: data.workspace, criteria: data.criteria,
        references: data.references, allowWrite: data.allowWrite, options: data.options, teamId: expectedTeam, accountId: accounts.selected });
      if (data.options.delivery === "steer" && accounts.selected === "desktop") {
        try { if (await runtime.steerChat(item.threadId, item.text + item.references.map(path => `\nReference: ${path}`).join(""), item.options.attachments, item.id, { allowWrite: item.allowWrite, options: item.options })) outbox.remove(item.id); }
        catch (error) { outbox.save({ ...item, error: "Queued for the next turn. " + (error as Error).message }); }
      }
      engine.emit("change");
      return { followup: true };
    }
    if (activeGroup) {
      if ((activeGroup.teamId || "default") !== expectedTeam)
        throw Error(
          "Switch to the team that owns this running chat before sending.",
        );
      if (data.workspace !== activeGroup.workspace)
        throw Error("Keep team messages in the active chat workspace.");
      if (data.options?.goalObjective && data.options.sourceThreadId)
        await runtime.setThreadGoal(data.options.sourceThreadId, {
          objective: data.options.goalObjective,
          status: "active",
          tokenBudget: data.options.goalTokenBudget,
        });
      requireSameAccount();
      return engine.queueMessage(
        activeGroup,
        data.task,
        data.options?.attachments,
        data.references,
        data.options?.delivery,
        data.options?.permissions,
      );
    }
    await runtime.connect();
    requireSameAccount();
    if (!runtime.status.authenticated)
      throw new Error(
        "Open Settings → Codex connection and sign in with ChatGPT.",
      );
  }
  if (expectedTeam !== store.activeTeamId())
    throw Error(
      "The active team changed before this task started. Send again from the intended team.",
    );
  return engine.create(
    data.task,
    data.workspace,
    data.criteria,
    data.references,
    data.demo,
    data.allowWrite,
    data.options,
    routingContext,
    accounts.selected,
  );
});
app.post<{ Params: { id: string; action: string } }>(
  "/api/runs/:id/:action",
  async (request) => {
    const run = engine.runs.find((r) => r.id === request.params.id);
    if (!run) throw new Error("Task not found.");
    switch (request.params.action) {
      case "interrupt":
        await engine.stop(run);
        break;
      case "cancel":
        await engine.stop(run, true);
        break;
      case "resume":
        run.accountId = accounts.selected;
        await engine.resume(run);
        break;
      case "retry": {
        if (!["failed", "interrupted"].includes(run.status))
          throw new Error("Only failed or interrupted tasks can be retried.");
        const { assignmentId } = z
          .object({ assignmentId: z.string().optional() })
          .parse(request.body);
        if (
          assignmentId &&
          !run.assignments.some(
            (a) =>
              a.id === assignmentId &&
              ["failed", "interrupted"].includes(a.status),
          )
        )
          throw new Error("That assignment is not eligible for retry.");
        run.accountId = accounts.selected;
        await engine.resume(run);
        break;
      }
      default:
        throw new Error("Unknown action.");
    }
    return run;
  },
);
app.post<{ Params: { id: string } }>("/api/approvals/:id", async (request) => {
  const approval = engine.approvals.find(approval => approval.id === request.params.id);
  const owner = engine.runs.find(run => run.id === approval?.runId);
  const { accept, answers } = z
    .object({
      accept: z.boolean(),
      answers: z.record(z.string(), z.string()).optional(),
    })
    .parse(request.body);
  engine.approve(request.params.id, accept, answers);
  return { ok: true };
});
app.get("/api/events", async (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = () => reply.raw.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  send();
  engine.on("change", send);
  runtime.on("change", send);
  const heartbeat = setInterval(
    () => reply.raw.write(": heartbeat\n\n"),
    15000,
  );
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    engine.off("change", send);
    runtime.off("change", send);
  });
});
{
  mkdirSync(resolve(root, "dist"), { recursive: true });
  await app.register(fastifyStatic, { root: resolve(root, "dist") });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith("/api/")
      ? reply.code(404).send({ error: "Not found" })
      : existsSync(resolve(root, "dist/index.html"))
        ? reply.sendFile("index.html")
        : reply
            .code(503)
            .type("text/html")
            .send(
              '<!doctype html><title>Studio updating</title><meta http-equiv="refresh" content="2"><p>Studio is updating. This page will reconnect automatically.</p>',
            ),
  );
}
async function close() {
  if (stopping) return;
  stopping = true;
  log.write("service.stopping");
  const deadline = setTimeout(() => { log.write("service.shutdown-timeout"); runtime.close(); process.exit(1); }, 15000);
  signIn.cancel();
  clearInterval(projectRefresh);
  clearInterval(usageRefresh);
  clearInterval(activityRefresh);
  clearInterval(outboxRefresh);
  for (const run of engine.runs)
    if (["running", "approval", "queued"].includes(run.status))
      await engine.stop(run).catch(() => { log.write("run.interrupt-failed", { runId: run.id }); });
  runtime.close();
  app.server.closeAllConnections();
  await app.close();
  store.close();
  clearTimeout(deadline);
  log.write("service.stopped");
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
await app.listen({ host: "127.0.0.1", port: servicePort });
const projectRefresh = setInterval(() => {
  if (!stopping && runtime.status.connected) void runtime.refreshProjects().catch(() => log.write("runtime.projects-failed"));
}, 30000);
const usageRefresh = setInterval(() => {
  if (!stopping && runtime.status.connected) void runtime.refreshUsage().catch(() => log.write("runtime.usage-failed"));
}, 60000);
const outboxRefresh = setInterval(() => { void drainOutbox().catch(() => log.write("outbox.refresh-failed")); }, 2000);
const activityRefresh = setInterval(() => { if (!stopping) void runtime.refreshExternalActivity().catch(() => log.write("runtime.activity-failed")); }, 4000);
log.write("service.ready");
void runtime
  .connect()
  .then(async () => {
    // Backfill ownership metadata without changing historical task outputs.
    for (const run of engine.runs.filter(run => !run.accountId)) {
      const threadId = run.chatThreadId || run.assignments.find(assignment => assignment.threadId)?.threadId;
      if (!threadId) continue;
      try {
        const { thread } = await runtime.request("thread/read", { threadId, includeTurns: false });
        const owner = accounts.ownerOfRollout(thread.path);
        if (owner) { run.accountId = owner; engine.save(run); }
      } catch { /* A missing thread remains in its historical desktop view. */ }
    }
    const titleRuns = engine.runs.filter(run => !run.demo);
    const rootThreads = new Map<string, (typeof titleRuns)[number]>();
    for (const run of titleRuns) {
      const threadId = run.chatThreadId || run.assignments.find(assignment => assignment.threadId)?.threadId;
      if (threadId) rootThreads.set(threadId, run);
    }
    for (const [threadId, run] of [...rootThreads].slice(0, 12)) {
      try {
        const { thread } = await runtime.request("thread/read", { threadId, includeTurns: false });
        const name = String(thread.name || "").trim();
        const generatedByPixelCrew = /^(?:Nova|Atlas|Pip|Bolt|Mira|Team)\s*[·•]\s*(?:build|plan|research|review|final|revise)\s*[·•]\s*/i.test(name);
        const copiedFromPrompt = !name || name === "New chat" || name === chatTitle(run.task) || name === run.task.trim().split("\n")[0] || /^Source:\s*/i.test(name);
        if (generatedByPixelCrew || copiedFromPrompt) {
          if ((run.accountId || "desktop") === accounts.selected)
            runtime.queueChatTitle(threadId, run.task, run.workspace, name, run.accountId, run.result || "", true);
        }
      } catch { /* A missing thread or unavailable title does not block startup. */ }
    }
  })
  .catch(() => { log.write("runtime.connect-failed", { code: "CODEX_UNAVAILABLE" }); });
