import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { appRoot, dataPath, servicePort } from "./paths";
import { controllerToken } from "./service-identity";
import { release } from "../shared/release";
import { resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { TerminalLogs } from "./terminal-logs";
import { controllerOptions } from "./controller-options";

const base = `http://127.0.0.1:${servicePort}`;
console.log("PixelCrew controller starting …");
let token: string | undefined;
let foregroundChild: ChildProcess | undefined;
async function api(path: string, body?: unknown) {
  token ??= controllerToken();
  const response = await fetch(base + "/api" + path, { method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || `Service request failed (${response.status}).`);
  return value;
}
async function status(): Promise<any | undefined> {
  try {
    const value = await api("/service/status");
    if (value.version !== release.version) throw Error("A different PixelCrew version owns this port. Stop it with its own controller.");
    return value;
  } catch (error) {
    if (["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"].includes((error as any).cause?.code)) return undefined;
    throw error;
  }
}
async function start(detached = false) {
  console.log(`Checking PixelCrew at ${base} …`);
  const existing = await status();
  if (existing) { console.log(`PixelCrew is already running (PID ${existing.pid}).`); return false; }
  console.log("Starting PixelCrew service …");
  const child = spawn(process.execPath, [resolve(appRoot, "server/index.js")], {
    cwd: appRoot, detached, windowsHide: true, stdio: "ignore", env: process.env,
  });
  if (!detached) foregroundChild = child;
  if (detached) child.unref();
  let failed = false;
  child.once("error", () => { failed = true; });
  child.once("exit", () => { failed = true; });
  for (let i = 0; i < 100; i++) {
    const ready = await status();
    if (ready) { console.log(`PixelCrew is running at ${base} (PID ${ready.pid}).`); return true; }
    if (failed) throw Error("Service failed to start. Inspect developer logs with the controller logs command.");
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw Error("Service startup timed out. Inspect developer logs with the controller logs command.");
}
async function followLogs(stopOwnedService = false) {
  const file = dataPath("logs/service.jsonl"), reader = new TerminalLogs(file);
  console.log(`Developer logs: ${file}`);
  console.log(stopOwnedService ? "Following service logs. Ctrl+C stops this foreground service." : "Following service logs. Ctrl+C stops log viewing; the existing service keeps running.");
  for (const line of reader.read().slice(-10)) console.log(line);
  await new Promise<void>(done => {
    const poll = () => {
      try { for (const line of reader.read()) { console.log(line); if (/ service.(stopped|crash|shutdown-timeout)(?: |$)/.test(line)) close(); } }
      catch { console.error("Could not read the developer log; retrying."); }
    };
    const timer = setInterval(poll, 1000);
    const close = () => { clearInterval(timer); process.off("SIGINT", close); process.off("SIGTERM", close); foregroundChild?.off("exit", close); done(); };
    process.on("SIGINT", close); process.on("SIGTERM", close);
    if (stopOwnedService) foregroundChild?.once("exit", close);
    if (stopOwnedService && foregroundChild?.exitCode !== null) close();
  });
  if (stopOwnedService) { await stop(true); console.log("PixelCrew is stopped."); }
  else console.log("Stopped following logs.");
}
async function serve(detach: boolean, showBrowser: boolean) {
  const owned = await start(detach);
  if (showBrowser) {
    const { ticket } = await api("/session/ticket", {});
    console.log("Opening an authenticated PixelCrew browser session …");
    open(`${base}/#session=${ticket}`);
  }
  if (detach) console.log("Detached. Use --status or --stop to manage the service.");
  else await followLogs(owned);
}
function open(target: string) {
  if (process.platform !== "win32") throw Error("This launcher targets Windows.");
  const script = `Start-Process -FilePath '${target.replaceAll("'", "''")}'`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" });
  child.once("error", () => console.error("Could not open the requested location."));
}
async function stop(confirm: boolean) {
  const state = await status();
  if (!state) return;
  if (state.active.length && !confirm) {
    console.log("Stopping interrupts these tasks:");
    for (const run of state.active) console.log(`  ${run.id}: ${run.task}`);
    if (!stdin.isTTY) throw Error("Repeat with --confirm-interrupt to interrupt active tasks.");
    const prompt = createInterface({ input: stdin, output: stdout });
    try { if ((await prompt.question("Interrupt these tasks? Type yes: ")).trim().toLowerCase() !== "yes") return false; }
    finally { prompt.close(); }
  }
  await api("/service/stop", { confirmInterrupt: true });
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    if (!await status() && !existsSync(dataPath("service.lock"))) return true;
  }
  throw Error("Shutdown timed out. Inspect logs before starting again; no unrelated process was killed.");
}
async function run(command: string, menu = false, confirm = false) {
  switch (command) {
    case "start": await serve(menu, false); break;
    case "open": {
      await serve(menu, true);
      break;
    }
    case "status": {
      const state = await status(); console.log(state ? JSON.stringify(state, null, 2) : "PixelCrew is stopped."); break;
    }
    case "stop": if (await stop(confirm || process.argv.includes("--confirm-interrupt")) !== false) console.log("PixelCrew is stopped."); break;
    case "restart": if (await stop(process.argv.includes("--confirm-interrupt")) !== false) { console.log("Restarting PixelCrew …"); await serve(menu, false); } break;
    case "logs": await followLogs(); break;
    case "diagnostics": {
      const file = dataPath("diagnostics.json");
      writeFileSync(file, JSON.stringify(await api("/service/diagnostics"), null, 2), { mode: 0o600 });
      console.log(`Developer diagnostics saved to ${file}`); break;
    }
    default: throw Error("Commands: start, open, status, stop, restart, menu. Developer commands: logs, diagnostics.");
  }
}
try {
  const options = controllerOptions(process.argv.slice(2)), command = options.action;
  if (command === "menu") {
    while (true) {
      const prompt = createInterface({ input: stdin, output: stdout });
      let choice: string;
      try { choice = (await prompt.question("PixelCrew: open / start / status / stop / restart / quit > ")).trim().toLowerCase(); }
      finally { prompt.close(); }
      if (choice === "quit" || !choice) break;
      try { await run(choice, true); } catch (error) { console.error((error as Error).message); }
    }
  } else if (command === "help") {
    console.log("PixelCrew [--open] [-d|--detach]\nDefault: foreground service with terminal logs; Ctrl+C stops it.\n--open opens an authenticated browser. -d detaches.\n--status | --stop [--confirm-interrupt] | --restart [--open] [-d]\nDeveloper: --logs | --diagnostics. Optional manager: --menu.");
  } else if (command === "start") await serve(options.detach, options.open);
  else if (command === "restart") { if (await stop(options.confirm) !== false) await serve(options.detach, options.open); }
  else await run(command, false, options.confirm);
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
