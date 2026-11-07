import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A click-through native indicator, scoped to an approved desktop action. */
export class ControlOverlay {
  private child?: ChildProcess;
  private statePath: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.statePath = join(directory, `overlay-${process.pid}.json`);
  }
  async show(x?: number, y?: number) {
    if (process.platform !== "win32") return;
    writeFileSync(this.statePath, JSON.stringify({ active: true, x, y, expires: Date.now() + 15000 }));
    if (!this.child) {
      try { unlinkSync(this.statePath + ".ready"); } catch {}
      let diagnostic = "";
      this.child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-File", fileURLToPath(new URL("./control-overlay.ps1", import.meta.url)), "-StatePath", this.statePath, "-OwnerPid", String(process.pid)], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      this.child.stderr?.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-1000); });
      this.child.on("error", () => { this.child = undefined; });
      this.child.on("exit", () => { this.child = undefined; });
      const deadline = Date.now() + 8000;
      while (!existsSync(this.statePath + ".ready") && Date.now() < deadline && this.child?.exitCode == null) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!existsSync(this.statePath + ".ready")) {
        this.close();
        throw new Error(`The live control arrow could not start. No input action was sent. ${diagnostic.trim()}`);
      }
    }
  }
  hide() { writeFileSync(this.statePath, JSON.stringify({ active: false })); }
  close() { this.child?.kill(); this.child = undefined; for (const path of [this.statePath, this.statePath + ".ready"]) { try { unlinkSync(path); } catch {} } }
}
