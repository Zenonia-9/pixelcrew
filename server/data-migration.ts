import { backup, DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { atomicJson, protectDirectory, readSecret } from "./private-storage";

/** A staged copy and SQLite online backup leave the prototype untouched. */
export async function prepareData(target: string, legacy?: string) {
  protectDirectory(target);
  if (legacy) {
    const offset = relative(resolve(legacy), resolve(target));
    if (!offset || offset !== ".." && !offset.startsWith("..\\") && !offset.startsWith("../") && !isAbsolute(offset))
      throw Error("PixelCrew data must be outside the legacy source directory.");
  }
  const marker = resolve(target, "schema.json");
  if (existsSync(marker)) {
    if (JSON.parse(readFileSync(marker, "utf8")).version !== 1) throw Error("Unsupported PixelCrew data version. Restore a compatible backup.");
    return;
  }
  if (existsSync(resolve(target, "migration-v1"))) throw Error("An incomplete migration exists. Inspect migration-v1 before retrying.");
  if (!existsSync(resolve(target, "studio.sqlite")) && legacy && existsSync(resolve(legacy, "studio.sqlite"))) {
    const stage = resolve(target, "migration-v1");
    if (existsSync(stage)) throw Error("An incomplete migration exists. Inspect migration-v1 before retrying.");
    mkdirSync(stage);
    cpSync(legacy, stage, { recursive: true, filter: path => !/studio\.sqlite(?:-wal|-shm)?$/.test(path) });
    const source = new DatabaseSync(resolve(legacy, "studio.sqlite"), { readOnly: true });
    try { await backup(source, resolve(stage, "studio.sqlite")); } finally { source.close(); }
    // A complete untouched migration backup is retained for recovery.
    cpSync(stage, resolve(target, "backups/prototype-v1"), { recursive: true });
    const { readdirSync } = await import("node:fs");
    const names = readdirSync(stage);
    // Detect all collisions before promoting any state. Generated role configs can
    // coexist; existing credentials/databases must never be silently replaced.
    for (const name of names) if (name !== "native-agents" && existsSync(resolve(target, name)))
      throw Error(`Migration target already contains ${name}. Inspect the staged copy before retrying.`);
    for (const name of names) {
      if (name === "native-agents" && existsSync(resolve(target, name)))
        cpSync(resolve(stage, name), resolve(target, name), { recursive: true, force: false });
      else renameSync(resolve(stage, name), resolve(target, name));
    }
    atomicJson(resolve(target, "migration.json"), { version: 1, source: legacy, completed: new Date().toISOString() });
  }
  if (process.platform === "win32") {
    const { readdirSync } = await import("node:fs");
    const secure = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) secure(file);
        else if (entry.name === "pixelcrew-oauth.json") readSecret(file);
      }
    };
    secure(target);
  }
  atomicJson(marker, { version: 1 });
}
