import { homedir } from "node:os";
import { resolve } from "node:path";
import { relative, isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const appRoot = fileURLToPath(new URL("../", import.meta.url));
export const dataRoot = resolve(process.env.PIXELCREW_DATA_DIR ||
  resolve(process.env.LOCALAPPDATA || resolve(homedir(), ".local/share"), "PixelCrew"));
export const dataPath = (...parts: string[]) => resolve(dataRoot, ...parts);
export const servicePort = Number(process.env.PIXELCREW_PORT || 4318);
if (!Number.isInteger(servicePort) || servicePort < 1024 || servicePort > 65535) throw Error("Invalid PixelCrew port.");
/** Resolve copied attachment paths without modifying immutable historical snapshots. */
export function storedPath(path: string) {
  const marker = dataPath("migration.json");
  if (!existsSync(marker)) return path;
  const { source } = JSON.parse(readFileSync(marker, "utf8"));
  const offset = relative(source, path);
  if (offset === ".." || offset.startsWith("..\\") || offset.startsWith("../") || isAbsolute(offset)) return path;
  const migrated = dataPath(offset);
  return existsSync(migrated) ? migrated : path;
}
