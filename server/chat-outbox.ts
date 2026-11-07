import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type { Engine } from "./engine";
import type { Run } from "../shared/types";
import type { PendingFollowup } from "../shared/followups";

export function queueOutboxMessage(
  engine: Pick<Engine, "queueMessage">,
  run: Run,
  item: PendingFollowup,
) {
  return engine.queueMessage(
    run,
    item.text,
    item.options.attachments,
    item.references,
    "steer",
    item.options.permissions,
  );
}

export class ChatOutbox {
  private draining = false;
  constructor(private store: Store) { store.db.exec("CREATE TABLE IF NOT EXISTS chat_outbox(id TEXT PRIMARY KEY,data TEXT NOT NULL)"); }
  list(): PendingFollowup[] { return (this.store.db.prepare("SELECT data FROM chat_outbox ORDER BY rowid").all() as { data: string }[]).map(row => JSON.parse(row.data)); }
  add(input: Omit<PendingFollowup, "id" | "at">) { const item = { ...input, id: randomUUID(), at: new Date().toISOString() }; this.save(item); return item; }
  save(item: PendingFollowup) { this.store.db.prepare("INSERT INTO chat_outbox VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(item.id, JSON.stringify(item)); }
  async drain(actions: { eligible: (item: PendingFollowup) => boolean; active: (item: PendingFollowup) => Promise<boolean>; start: (item: PendingFollowup) => void; changed: () => void }) {
    if (this.draining) return;
    this.draining = true;
    try {
      for (const item of this.list()) {
        if (!actions.eligible(item)) continue;
        try {
          if (await actions.active(item)) {
            if (item.error && /thread not found|thread not loaded/i.test(item.error) && this.list().some(current => current.id === item.id)) {
              this.save({ ...item, error: undefined }); actions.changed();
            }
            continue;
          }
          if (!actions.eligible(item) || !this.list().some(current => current.id === item.id)) continue;
          actions.start(item); this.remove(item.id); actions.changed();
        } catch (error) {
          const message = (error as Error).message;
          if (message !== item.error && this.list().some(current => current.id === item.id)) { this.save({ ...item, error: message }); actions.changed(); }
        }
      }
    } finally { this.draining = false; }
  }
  remove(id: string) { this.store.db.prepare("DELETE FROM chat_outbox WHERE id=?").run(id); }
}
