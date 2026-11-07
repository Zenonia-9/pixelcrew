import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  characterKinds,
  characterLooks,
  spriteAsset,
} from "../shared/character-assets";
import { teamSchema, type Run } from "../shared/types";
import { starterTeam } from "../shared/defaults";
import { normalAgent } from "../shared/normal-agent";
import { Store } from "../server/store";
const { PNG } = createRequire(import.meta.url)("pngjs");

test("every premade look has distinct artwork with compatible frames and transparency", () => {
  const unique = new Set<string>();
  for (const kind of characterKinds)
    for (const life of [false, true]) {
      const original = PNG.sync.read(
        readFileSync(
          new URL(
            `../public${spriteAsset({ sprite: kind.id }, life)}`,
            import.meta.url,
          ),
        ),
      );
      for (const look of characterLooks) {
        const raw = readFileSync(
          new URL(
            `../public${spriteAsset({ sprite: kind.id, look: look.id }, life)}`,
            import.meta.url,
          ),
        );
        const image = PNG.sync.read(raw);
        assert.equal(image.width, life ? 192 : 256);
        assert.equal(image.height, 32);
        for (let at = 3; at < image.data.length; at += 4)
          assert.equal(
            image.data[at],
            original.data[at],
            `${kind.id} ${look.id} keeps transparent pixel bounds`,
          );
        if (!life)
          unique.add(createHash("sha256").update(image.data).digest("hex"));
      }
    }
  assert.equal(unique.size, 30);
});

test("team member and Nova appearances persist independently without changing roles or old runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-appearance-"));
  let store = new Store(join(dir, "test.db"));
  try {
    const original = structuredClone(store.team());
    const second = store.createTeam("Distinct crew");
    const used = new Set(
      original.agents.map(
        (member) => `${member.sprite}:${member.look || "classic"}`,
      ),
    );
    used.add("nova:classic");
    for (const member of store.team().agents)
      assert.ok(!used.has(`${member.sprite}:${member.look || "classic"}`));
    const next = store.team();
    const old = structuredClone(next);
    const history = {
      id: "appearance-history",
      createdAt: new Date().toISOString(),
      teamId: second,
      team: old,
      status: "completed",
    } as Run;
    store.saveRun(history);
    next.agents[0] = { ...next.agents[0], sprite: "mira", look: "frost" };
    next.normalAppearance = {
      sprite: "bolt",
      look: "ember",
      name: "Orbit",
      biography: "A quiet guide.",
    };
    store.saveTeam(next);
    assert.equal(store.team().agents[0].model, original.agents[0].model);
    assert.equal(store.team().agents[0].role, "lead");
    store.switchTeam("default");
    assert.deepEqual(store.team(), { ...original, normalAppearance: next.normalAppearance });
    store.close();
    store = new Store(join(dir, "test.db"));
    store.switchTeam(second);
    assert.equal(store.team().agents[0].look, "frost");
    const nova = normalAgent(
      store.team().agents[0],
      8,
      store.team().normalAppearance,
    );
    assert.equal(nova.name, "Orbit");
    assert.equal(nova.biography, "A quiet guide.");
    assert.equal(nova.sprite, "bolt");
    assert.equal(nova.look, "ember");
    assert.deepEqual(store.runs()[0].team, old);
    assert.deepEqual(normalAgent(nova).look, "ember");
    assert.equal(
      normalAgent(next.agents[0]).look,
      "classic",
      "Nova does not inherit the lead's outfit",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy profiles retain classic artwork and unknown appearance input is rejected", () => {
  const legacy = teamSchema.parse(starterTeam);
  assert.equal(spriteAsset(legacy.agents[0]), "/sprites/atlas.png");
  assert.equal(
    spriteAsset({ ...legacy.agents[0], look: "../../elsewhere" }),
    "/sprites/atlas.png",
  );
  assert.throws(() =>
    teamSchema.parse({
      ...legacy,
      agents: legacy.agents.map((agent, index) =>
        index === 0 ? { ...agent, look: "unknown" } : agent,
      ),
    }),
  );
});
