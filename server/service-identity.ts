import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dataPath, dataRoot } from "./paths";
import { protectDirectory, readSecret, writeSecret } from "./private-storage";

export function controllerToken() {
  const path = dataPath("controller-secret.json");
  if (!existsSync(path)) {
    protectDirectory(dataRoot);
    writeSecret(path, { token: randomBytes(32).toString("hex") });
  }
  return readSecret<{ token: string }>(path).token;
}
export function acquireServiceLock() {
  const file = dataPath("service.lock");
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Error("Invalid service lock; inspect it before restarting.");
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
    if (alive) throw Error("PixelCrew is already running, or its saved process is still present.");
    unlinkSync(file);
  }
  writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => {
    if (existsSync(file) && readFileSync(file, "utf8") === String(process.pid)) unlinkSync(file);
  };
}
