import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";

test("PixelCrew migrates the old starter name while preserving character identities and custom names", () => {
  for (const name of ["The Hearth Guild", "My Custom Team"]) {
    const dir = mkdtempSync(join(tmpdir(), "pixelcrew-brand-"));
    const path = join(dir, "studio.sqlite");
    let store = new Store(path);
    try {
      const team = store.team();
      assert.equal(team.name, "General Teams");
      store.saveTeam({ ...team, name });
      store.db
        .prepare("DELETE FROM settings WHERE key='pixelcrew-brand-v1'")
        .run();
      store.close();
      store = new Store(path);
      assert.equal(
        store.team().name,
        name === "The Hearth Guild" ? "General Teams" : name,
      );
      assert.deepEqual(store.team().agents, team.agents);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
