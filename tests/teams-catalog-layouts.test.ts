import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import {
  builtinCatalog,
  builtinSkills,
  bundledGuidance,
} from "../server/builtin-catalog";
import { officeLayout, officeLayouts } from "../shared/office-layouts";
import { starterTeam } from "../shared/defaults";
import { composerKey } from "../shared/preferences";
import { officeDesigns, officeDesign } from "../shared/office-designs";
test("office backgrounds belong to teams and persist after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-designs-"));
  let store = new Store(join(dir, "test.db"));
  try {
    assert.equal(store.officeDesign(), "timber");
    store.saveOfficeDesign("garden");
    const second = store.createTeam("Night shift");
    store.saveOfficeDesign("midnight");
    store.switchTeam("default");
    assert.equal(store.officeDesign(), "garden");
    store.close();
    store = new Store(join(dir, "test.db"));
    assert.equal(store.officeDesign(), "garden");
    store.switchTeam(second);
    assert.equal(store.officeDesign(), "midnight");
    assert.throws(() => store.saveOfficeDesign("missing"));
    assert.equal(officeDesign("missing").id, "timber");
    assert.equal(
      new Set(officeDesigns.map((design) => design.pattern)).size,
      6,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("deleting a team switches safely and preserves historical runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-delete-"));
  let store = new Store(join(dir, "test.db"));
  try {
    // Isolate the last-team guard from the additional built-in Security crew.
    store.deleteTeam("security");
    const second = store.createTeam("Temporary crew");
    const history = {
      id: "history",
      createdAt: new Date().toISOString(),
      teamId: second,
      team: structuredClone(store.team()),
      status: "completed",
    } as import("../shared/types").Run;
    store.saveRun(history);
    store.deleteTeam(second);
    assert.equal(store.activeTeamId(), "default");
    assert.equal(store.teams().length, 1);
    assert.deepEqual(store.runs()[0], history);
    assert.throws(() => store.switchTeam(second));
    assert.throws(() => store.deleteTeam("default"));
    const third = store.createTeam("Replacement");
    store.deleteTeam("default");
    store.close();
    store = new Store(join(dir, "test.db"));
    assert.equal(store.activeTeamId(), third);
    assert.equal(store.team().name, "Replacement");
    assert.equal(store.teams().length, 1);
    assert.equal(store.runs()[0].teamId, second);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("teams preserve independent profiles and layouts across switching and restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-teams-"));
  let store = new Store(join(dir, "test.db"));
  try {
    store.saveRoomLayout({ bed: { x: 80, y: 280 } });
    const first = structuredClone(store.team());
    const second = store.createTeam("Second crew");
    assert.deepEqual(store.roomLayout(), {});
    store.saveTeam({
      ...store.team(),
      agents: store.team().agents.map((agent) => ({
        ...agent,
        name: agent.id === "pip" ? "Scout" : agent.name,
      })),
    });
    store.saveRoomLayout({ bed: { x: 200, y: 280 } });
    store.switchTeam("default");
    assert.deepEqual(store.team(), first);
    assert.equal(store.roomLayout().bed.x, 80);
    store.switchTeam(second);
    store.close();
    store = new Store(join(dir, "test.db"));
    assert.equal(store.activeTeamId(), second);
    assert.equal(store.roomLayout().bed.x, 200);
    assert.equal(
      store.team().agents.find((agent) => agent.id === "pip")!.name,
      "Scout",
    );
    assert.equal(store.teams().length, 3);
    assert.throws(() => store.switchTeam("missing"));
    assert.notEqual(
      composerKey(undefined, "project", second),
      composerKey(undefined, "project", "default"),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("every office preset is saveable and applying one can undo a custom arrangement", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-presets-"));
  const store = new Store(join(dir, "test.db"));
  try {
    const original = store.saveRoomLayout({ coffee: { x: 576, y: 336 } });
    for (const preset of officeLayouts) {
      store.applyLayout(
        preset.id,
        officeLayout(preset.id, store.team().agents),
      );
      assert.equal(store.layoutPreset(), preset.id);
      store.undoLayout();
      assert.deepEqual(store.roomLayout(), original);
    }
    assert.throws(() => officeLayout("missing", starterTeam.agents));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the selected floor plan survives custom furniture, restart, and undo", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-layout-selection-"));
  let store = new Store(join(dir, "test.db"));
  try {
    store.applyLayout("commons", officeLayout("commons", store.team().agents));
    store.saveRoomLayout({ ...store.roomLayout(), coffee: { x: 688, y: 120 } });
    assert.equal(store.layoutPreset(), "custom");
    assert.equal(store.layoutBasePreset(), "commons");
    const custom = store.roomLayout();
    store.close();
    store = new Store(join(dir, "test.db"));
    assert.equal(store.layoutBasePreset(), "commons");
    store.applyLayout("suite", officeLayout("suite", store.team().agents));
    store.undoLayout();
    assert.equal(store.layoutPreset(), "custom");
    assert.equal(store.layoutBasePreset(), "commons");
    assert.deepEqual(store.roomLayout(), custom);
    store.applyLayout("library", officeLayout("library", store.team().agents));
    store.applyLayout("focus", officeLayout("focus", store.team().agents));
    store.undoLayout();
    assert.equal(store.layoutPreset(), "library");
    assert.equal(store.layoutBasePreset(), "library");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("built-in agents and skills ship attribution and omit upstream model defaults", () => {
  assert.equal(
    new Set(builtinCatalog.agents.map((agent) => agent.id)).size,
    builtinCatalog.agents.length,
  );
  assert.ok(builtinCatalog.agents.length >= 175);
  assert.equal(builtinSkills.length, 9);
  assert.equal(builtinCatalog.attribution.name, "VoltAgent");
  for (const skill of builtinSkills) {
    const source = readFileSync(skill.path, "utf8");
    assert.match(source, /^---\r?\nname:/);
    if (skill.id !== "create-team") {
      assert.match(source, /VoltAgent/);
      assert.match(source, /MIT License/);
    } else assert.equal(skill.source, "Built in · PixelCrew");
  }
  for (const agent of builtinCatalog.agents) {
    const source = readFileSync(
      new URL(`../resources/agents/${agent.id}.toml`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /^model(?:_reasoning_effort)?\s*=/m);
    assert.doesNotMatch(source, /^sandbox_mode\s*=/m);
  }
  const custom = {
    ...starterTeam.agents[2],
    model: "gpt-6-luna",
    reasoning: "low" as const,
    specialties: ["frontend-developer"],
  };
  assert.match(bundledGuidance(custom), /Own frontend changes/);
  assert.equal(custom.model, "gpt-6-luna");
  assert.equal(custom.reasoning, "low");
});
