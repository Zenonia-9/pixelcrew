import { resolve } from "node:path";

/** Two readers globally; exclusive writes within each workspace tree. */
export class WorkspaceScheduler {
  private active: { workspace: string; write: boolean }[] = [];
  private waiters: (() => void)[] = [];
  async acquire(workspace: string, write: boolean, stopped: () => boolean) {
    const key = resolve(workspace)
      .replace(/\\/g, "/")
      .toLowerCase()
      .replace(/\/$/, "");
    const overlaps = (other: string) =>
      key === other ||
      key.startsWith(other + "/") ||
      other.startsWith(key + "/");
    while (true) {
      if (stopped()) throw Error("Run stopped.");
      const conflict = this.active.some(
        (job) => overlaps(job.workspace) && (write || job.write),
      );
      if (
        !conflict &&
        (write || this.active.filter((job) => !job.write).length < 2)
      )
        break;
      await new Promise<void>((wake) => this.waiters.push(wake));
    }
    const job = { workspace: key, write };
    this.active.push(job);
    return () => {
      this.active = this.active.filter((other) => other !== job);
      this.wake();
    };
  }
  wake() {
    this.waiters.splice(0).forEach((wake) => wake());
  }
}
