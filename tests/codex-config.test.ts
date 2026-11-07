import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeCodexConfig, readCodexConfig } from "../server/codex-config";

test("global Codex settings are read and app-account values override them", () => {
  const home = mkdtempSync(join(tmpdir(), "pixelcrew-codex-config-"));
  try {
    writeFileSync(join(home, "config.toml"), [
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      'developer_instructions = "Keep the host instructions"',
      "[sandbox_workspace_write]",
      "network_access = true",
    ].join("\n"));
    const host = readCodexConfig(home);
    const merged = mergeCodexConfig(host, {
      approval_policy: "on-request",
      sandbox_workspace_write: { network_access: false },
    });
    assert.equal(merged.sandbox_mode, "danger-full-access");
    assert.equal(merged.approval_policy, "on-request");
    assert.equal(merged.developer_instructions, "Keep the host instructions");
    assert.deepEqual(merged.sandbox_workspace_write, { network_access: false });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
