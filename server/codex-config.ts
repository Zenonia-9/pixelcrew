import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";

export type CodexConfig = Record<string, any>;

export function readCodexConfig(home = process.env.CODEX_HOME || join(homedir(), ".codex")): CodexConfig {
  const path = resolve(home, "config.toml");
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf8")) as CodexConfig;
  } catch {
    return {};
  }
}

/** App-account settings override matching host defaults; nested tables merge. */
export function mergeCodexConfig(host: CodexConfig, account: CodexConfig): CodexConfig {
  return {
    ...host,
    ...account,
    sandbox_workspace_write: {
      ...host.sandbox_workspace_write,
      ...account.sandbox_workspace_write,
    },
  };
}
