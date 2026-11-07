import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { starterTeam } from "../shared/defaults";
import { normalAgent } from "../shared/normal-agent";
import { builtinCatalog, bundledGuidance } from "../server/builtin-catalog";

test("General Teams ships four role specialists plus Nova with automatic models", () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), "general-team-")), "studio.sqlite"));
  try {
    assert.equal(store.team().name, "General Teams");
    assert.equal(store.teams()[0].members, 5);
    const team = store.team();
    assert.deepEqual(team.agents.map(agent => agent.role), ["lead", "researcher", "builder", "reviewer"]);
    for (const agent of [...team.agents, normalAgent(team.agents[0])]) {
      assert.equal(agent.model, "");
      assert.equal(agent.reasoning, undefined);
    }
    for (const agent of team.agents) {
      assert.ok(agent.specialties?.length);
      assert.ok(agent.skills?.length);
      for (const id of agent.specialties!) assert.ok(builtinCatalog.agents.some(item => item.id === id), id);
      for (const id of agent.skills!) assert.ok(builtinCatalog.skills.some(item => item.id === id), id);
    }
    assert.match(bundledGuidance(team.agents[1]), /crew-research/);
    assert.doesNotMatch(bundledGuidance(team.agents[1]), /crew-frontend/);
  } finally { store.close(); }
});

test("adding the built-in default preserves custom teams and immutable run snapshots", () => {
  const path = join(mkdtempSync(join(tmpdir(), "general-upgrade-")), "studio.sqlite");
  let store = new Store(path);
  const custom = { ...structuredClone(starterTeam), name: "My existing crew" };
  custom.agents[0].model = "my-selected-model";
  store.saveTeam(custom);
  store.db.prepare("INSERT INTO runs VALUES(?,?,?)").run("old", "2026-10-26", JSON.stringify({ id: "old", team: custom }));
  store.db.prepare("DELETE FROM settings WHERE key='general-team-v1'").run();
  store.close();
  store = new Store(path);
  try {
    assert.equal(store.team().name, "General Teams");
    assert.equal(store.teams().length, 3);
    assert.equal(store.runs()[0].team.name, "My existing crew");
    store.switchTeam("default");
    assert.deepEqual(store.team(), custom);
    store.close();
    store = new Store(path);
    assert.equal(store.teams().length, 3);
    assert.equal(store.team().name, "My existing crew");
  } finally { store.close(); }
});

test("the one-time default selection upgrades existing installs with another active crew", () => {
  const path = join(mkdtempSync(join(tmpdir(), "general-default-upgrade-")), "studio.sqlite");
  let store = new Store(path);
  const generalId = store.teams().find(team => team.name === "General Teams")!.id;
  store.createTeam("Keep my current crew");
  assert.notEqual(store.activeTeamId(), generalId);
  store.db.prepare("DELETE FROM settings WHERE key='general-team-default-v2'").run();
  store.close();
  store = new Store(path);
  try {
    assert.equal(store.activeTeamId(), generalId);
    assert.equal(store.team().name, "General Teams");
    assert.equal(store.teams().length, 3);
  } finally { store.close(); }
});
