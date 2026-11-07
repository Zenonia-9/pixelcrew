import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/** Follow the rotating developer log without printing arbitrary payloads or partial records. */
export class TerminalLogs {
  private offset = 0;
  private identity = "";
  private pending = "";
  private skipPartial = false;
  constructor(private file: string) {}
  read() {
    if (!existsSync(this.file)) return [];
    const stat = statSync(this.file), identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    if (identity !== this.identity || stat.size < this.offset) {
      this.identity = identity; this.offset = Math.max(0, stat.size - 64 * 1024); this.pending = "";
      this.skipPartial = this.offset > 0;
    }
    const fd = openSync(this.file, "r");
    try {
      const buffer = Buffer.alloc(Math.min(stat.size - this.offset, 64 * 1024));
      const count = readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += count;
      const lines = (this.pending + buffer.subarray(0, count).toString("utf8")).split("\n");
      this.pending = lines.pop() || "";
      if (this.skipPartial && lines.length) { lines.shift(); this.skipPartial = false; }
      return lines.flatMap(line => {
        try {
          const value = JSON.parse(line);
          if (!/^[\w.-]{1,80}$/.test(value.event) || !/^[\dT:.Z-]{1,30}$/.test(value.time)) return [];
          const fields = ["requestId", "runId", "status", "code", "durationMs"].flatMap(key => {
            const field = value[key];
            return typeof field === "number" || typeof field === "string" && /^[\w.:-]{1,120}$/.test(field) ? [`${key}=${field}`] : [];
          });
          return [`${value.time} ${value.event}${fields.length ? " " + fields.join(" ") : ""}`];
        } catch { return []; }
      });
    } finally { closeSync(fd); }
  }
}
