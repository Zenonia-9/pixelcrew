import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { recordedUsage } from "./chat-history";
import { aggregateUsage, type UsageRecord } from "../shared/usage-history";
export async function usageHistory(roots: string[], from: number, to: number) {
  const records: UsageRecord[] = [];
  for (const root of new Set(roots)) for (const directory of ["sessions", "archived_sessions"]) {
    const base = resolve(root, directory);
    let files: string[];
    try { files = await readdir(base, { recursive: true }); } catch { continue; }
    for (const name of files.filter(name => name.endsWith(".jsonl"))) {
      const path = resolve(base, name);
      try { if ((await stat(path)).mtimeMs < from) continue; } catch { continue; }
      const turns = await recordedUsage(path, root);
      for (const [id, turn] of turns) if (turn.usage && turn.startedAt) records.push({ id, at: turn.startedAt * 1000, usage: turn.usage });
    }
  }
  return aggregateUsage(records, from, to, to - from <= 86400000 ? 24 : Math.min(90, Math.ceil((to - from) / 86400000)));
}
