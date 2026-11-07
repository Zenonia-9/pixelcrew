import test from "node:test";
import assert from "node:assert/strict";
import { officeActivity } from "../shared/office-status";
test("office progress shows human activity instead of raw commands and paths", () => {
  assert.equal(
    officeActivity(
      "commandExecution: C:\\Users\\Example\\powershell.exe -Command Get-Content src/App.tsx",
    ),
    "Reading project files",
  );
  assert.equal(
    officeActivity("commandExecution: npm.cmd test"),
    "Running checks",
  );
  assert.equal(officeActivity("mcpToolCall: database.read"), "Using a tool");
  assert.equal(
    officeActivity("Atlas: Checking the calculator input handling."),
    "Checking the calculator input handling.",
  );
});
