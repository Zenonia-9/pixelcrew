import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { builtinCatalog } from "../server/builtin-catalog";
import { nativeAgentConfiguration } from "../server/runtime";
import { starterTeam } from "../shared/defaults";
import { securityTeam } from "../shared/security-team";
import { normalAgent } from "../shared/normal-agent";
import { teamSchema } from "../shared/types";

test("team profiles are created live while Normal identity stays shared across teams and restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-normal-"));
  const path = join(dir, "studio.sqlite");
  let store = new Store(path);
  try {
    const original = store.team();
    const custom = structuredClone(securityTeam);
    custom.agents[0].name = "Sentinel";
    store.createTeam("Custom security", custom);
    assert.equal(store.team().agents[0].name, "Sentinel");
    assert.deepEqual(store.team().normalAppearance, original.normalAppearance);
    const edited = store.team();
    edited.normalAppearance = { name: "Nova custom", sprite: "nova", look: "forest" };
    store.saveTeam(edited);
    store.switchTeam("security");
    assert.deepEqual(store.team().normalAppearance, edited.normalAppearance);
    store.close();
    store = new Store(path);
    store.switchTeam("default");
    assert.deepEqual(store.team().normalAppearance, edited.normalAppearance);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Security ships distinct security specialists and shared Nova with automatic models", () => {
  const dir = mkdtempSync(join(tmpdir(), "security-team-"));
  const store = new Store(join(dir, "studio.sqlite"));
  try {
    assert.equal(store.team().name, "General Teams");
    const entry = store.teams().find((team) => team.name === "Security")!;
    assert.equal(entry.members, 5);
    store.switchTeam(entry.id);
    const team = teamSchema.parse(store.team());
    assert.deepEqual(team.agents, securityTeam.agents);
    assert.deepEqual(
      team.agents.map((agent) => agent.role),
      ["lead", "researcher", "builder", "reviewer"],
    );
    assert.deepEqual(
      team.agents
        .filter((agent) => agent.access === "workspace-write")
        .map((agent) => agent.id),
      ["forge"],
    );
    const normal = normalAgent(team.agents[0], 8, team.normalAppearance);
    assert.equal(normal.name, "Nova");
    assert.equal(
      new Set([...team.agents, normal].map((agent) => agent.name)).size,
      5,
    );
    for (const agent of team.agents) {
      assert.ok(
        !starterTeam.agents.some(
          (member) => member.id === agent.id || member.name === agent.name,
        ),
      );
      assert.ok(
        !starterTeam.agents.some(
          (member) =>
            member.sprite === agent.sprite &&
            (member.look || "classic") === agent.look,
        ),
      );
      assert.match(agent.instructions, /security/);
      assert.ok(agent.skills?.includes("crew-security"));
      for (const id of agent.specialties!)
        assert.ok(
          builtinCatalog.agents.some((item) => item.id === id),
          id,
        );
      for (const id of agent.skills!)
        assert.ok(
          builtinCatalog.skills.some((item) => item.id === id),
          id,
        );
    }
    for (const agent of [...team.agents, normal]) {
      assert.equal(agent.model, "");
      assert.equal(agent.reasoning, undefined);
    }
    const native = nativeAgentConfiguration(team.agents, join(dir, "native"));
    assert.match(native.instructions, /You are Aegis, the parent coordinator/);
    for (const agent of team.agents.filter((agent) => agent.role !== "lead")) {
      assert.equal(native.roles.get(`crew_${agent.id}`), agent.id);
      const profile = readFileSync(
        join(dir, "native", `crew_${agent.id}.toml`),
        "utf8",
      );
      assert.ok(profile.includes(agent.instructions));
      assert.doesNotMatch(profile, /^model(?:_reasoning_effort)?\s*=/m);
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Security upgrade preserves active custom teams, layouts and history despite an ID collision", () => {
  const dir = mkdtempSync(join(tmpdir(), "security-upgrade-"));
  const path = join(dir, "studio.sqlite");
  let store = new Store(path);
  try {
    // Model a pre-Security install with an unrelated crew already using its ID.
    store.deleteTeam("security");
    const customId = store.createTeam("Existing custom crew");
    const custom = structuredClone(store.team());
    custom.agents[0].model = "selected-model";
    store.saveTeam(custom);
    const layout = store.saveRoomLayout({ bed: { x: 80, y: 280 } });
    store.saveOfficeDesign("garden");
    store.db
      .prepare("INSERT INTO teams VALUES('security',?,?)")
      .run(
        JSON.stringify({ ...custom, name: "Unrelated security crew" }),
        "{}",
      );
    const history = { id: "old", teamId: customId, team: custom };
    store.db
      .prepare("INSERT INTO runs VALUES(?,?,?)")
      .run("old", "2026-10-26", JSON.stringify(history));
    store.db.prepare("DELETE FROM settings WHERE key='security-team-v1'").run();
    store.close();
    store = new Store(path);
    assert.equal(store.activeTeamId(), customId);
    assert.deepEqual(store.team(), custom);
    assert.deepEqual(store.roomLayout(), layout);
    assert.equal(store.officeDesign(), "garden");
    assert.deepEqual(store.runs()[0], history);
    assert.ok(
      store
        .teams()
        .some(
          (team) =>
            team.id === "security" && team.name === "Unrelated security crew",
        ),
    );
    const added = store.teams().find((team) => team.name === "Security")!;
    assert.notEqual(added.id, "security");
    store.close();
    store = new Store(path);
    assert.equal(
      store.teams().filter((team) => team.name === "Security").length,
      1,
    );
    assert.equal(store.activeTeamId(), customId);
    assert.deepEqual(store.runs()[0], history);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Security upgrade chooses an unambiguous name without changing same-named user teams", () => {
  const dir = mkdtempSync(join(tmpdir(), "security-name-collision-"));
  const path = join(dir, "studio.sqlite");
  let store = new Store(path);
  try {
    store.deleteTeam("security");
    const customId = store.createTeam("Security");
    const custom = structuredClone(store.team());
    store.db
      .prepare("INSERT INTO teams VALUES(?,?,?)")
      .run(
        "user-built-in",
        JSON.stringify({ ...custom, name: "Security (built-in)" }),
        "{}",
      );
    store.db
      .prepare("INSERT INTO teams VALUES(?,?,?)")
      .run(
        "user-built-in-2",
        JSON.stringify({ ...custom, name: "Security (built-in 2)" }),
        "{}",
      );
    const before = store.db.prepare("SELECT * FROM teams ORDER BY id").all();
    store.db.prepare("DELETE FROM settings WHERE key='security-team-v1'").run();
    store.close();
    store = new Store(path);
    assert.equal(store.activeTeamId(), customId);
    assert.deepEqual(store.team(), custom);
    assert.deepEqual(
      store.db
        .prepare("SELECT * FROM teams WHERE id != 'security' ORDER BY id")
        .all(),
      before,
    );
    store.switchTeam("security");
    assert.equal(store.team().name, "Security (built-in 3)");
    assert.deepEqual(store.team().agents, securityTeam.agents);
    const names = store.teams().map((team) => team.name);
    assert.equal(new Set(names).size, names.length);
    store.close();
    store = new Store(path);
    assert.equal(store.team().name, "Security (built-in 3)");
    assert.equal(store.teams().length, before.length + 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Security profile edits and deliberate deletion survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "security-edit-"));
  const path = join(dir, "studio.sqlite");
  let store = new Store(path);
  try {
    store.switchTeam("security");
    const edited = structuredClone(store.team());
    edited.name = "My security team";
    edited.agents[2].model = "selected-model";
    edited.agents[2].instructions = "My remediation instructions";
    store.saveTeam(edited);
    store.close();
    store = new Store(path);
    assert.equal(store.activeTeamId(), "security");
    assert.deepEqual(store.team(), edited);
    assert.equal(store.teams().length, 2);
    store.deleteTeam("security");
    store.close();
    store = new Store(path);
    assert.equal(store.activeTeamId(), "default");
    assert.equal(store.teams().length, 1);
    assert.throws(() => store.switchTeam("security"), /Team not found/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
