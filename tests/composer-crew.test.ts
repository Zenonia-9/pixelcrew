import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionAt } from "../shared/composer-completion";
import { deviceToolMentionText, deviceToolMentions, insertDeviceToolMention, removeDeviceToolMention } from "../shared/device-tool-mentions";
import { toggleComposerPopover } from "../shared/composer-popover";
import { fileCompletions } from "../server/file-completion";
import { crewGuide } from "../shared/crew-guide";
import { starterTeam } from "../shared/defaults";
import { agentSchema } from "../shared/types";

test("composer triggers honor the caret, complete tokens, and leave ordinary text alone", () => {
  assert.deepEqual(completionAt("Use $rev", 8), {
    kind: "$",
    query: "rev",
    start: 4,
    end: 8,
  });
  assert.equal(completionAt("/plan", 5)?.kind, "/");
  assert.equal(completionAt("@src/app", 8)?.query, "src/app");
  assert.equal(completionAt("mail@example.com", 16), undefined);
  assert.equal(completionAt("use $review now", 11)?.query, "review");
  assert.equal(completionAt("ordinary words", 14), undefined);
});

test("device tool mentions enable tools and stay visible in the task text", () => {
  const task = insertDeviceToolMention("Check this", "browser", 6, 6);
  assert.equal(task, "Check @browser this");
  assert.deepEqual(deviceToolMentions(`${task} @chrome @browser`), ["browser", "chrome"]);
  assert.equal(removeDeviceToolMention(task, "browser"), "Check this");
  assert.equal(deviceToolMentionText(["browser", "chrome"]), "@browser @chrome");
});

test("composer popovers are exclusive and the active popover toggles closed", () => {
  assert.equal(toggleComposerPopover(null, "goalBudget"), "goalBudget");
  assert.equal(toggleComposerPopover("goalBudget", "add"), "add");
  assert.equal(toggleComposerPopover("add", "add"), null);
  assert.equal(toggleComposerPopover("permissions", "model"), "model");
});

test("file picker stays inside the selected workspace and excludes generated directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcrew-files-"));
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "src", "app.ts"), "export {};");
    assert.equal(
      fileCompletions(dir, "").some((item) => item.name === "node_modules/"),
      false,
    );
    assert.equal(fileCompletions(dir, "src/a")[0].name, "src/app.ts");
    assert.deepEqual(fileCompletions(dir, "../"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("crew specialties and preferred skills do not change saved model or effort", () => {
  const agent = agentSchema.parse({
    ...starterTeam.agents[2],
    model: "gpt-6-luna",
    reasoning: "low",
    skills: ["frontend-design", "testing"],
  });
  const guide = crewGuide(agent);
  assert.match(guide, /frontend\/UI, backend\/API, debugging/);
  assert.match(guide, /frontend-design, testing/);
  assert.equal(agent.model, "gpt-6-luna");
  assert.equal(agent.reasoning, "low");
  assert.match(
    crewGuide(starterTeam.agents[0]),
    /two independent investigations/,
  );
});
