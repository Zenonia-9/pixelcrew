import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Allowlisted metadata only: never serialize requests, error messages, or runtime payloads. */
export class ServiceLog {
  readonly file: string;
  constructor(directory: string, private limit = 10 * 1024 * 1024) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = resolve(directory, "service.jsonl");
  }
  write(event: string, fields: { requestId?: string; runId?: string; status?: number; code?: string; durationMs?: number } = {}) {
    if (existsSync(this.file) && statSync(this.file).size >= this.limit) {
      if (existsSync(`${this.file}.4`)) unlinkSync(`${this.file}.4`);
      for (let i = 3; i >= 0; i--) {
        const source = i ? `${this.file}.${i}` : this.file;
        if (existsSync(source)) renameSync(source, `${this.file}.${i + 1}`);
      }
    }
    const safe = Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
      ["requestId", "runId", "status", "code", "durationMs"].includes(key) &&
      (typeof value === "number" || typeof value === "string" && /^[\w.:-]{1,120}$/.test(value))));
    appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), event: /^[\w.-]{1,80}$/.test(event) ? event : "event", ...safe }) + "\n", { mode: 0o600 });
  }
  tail() {
    if (!existsSync(this.file)) return [];
    // A rotation is at most 10 MB; return only the newest 200 safe records.
    return readFileSync(this.file, "utf8").trim().split("\n").slice(-200).filter(Boolean).map(line => JSON.parse(line));
  }
}
