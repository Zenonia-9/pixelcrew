import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
export function codexBinary() {
  if (process.env.STUDIO_CODEX_BIN) return process.env.STUDIO_CODEX_BIN;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (existsSync(join(root, "codex.exe"))) return join(root, "codex.exe");
    try {
      const candidates = readdirSync(root)
        .map((name) => join(root, name, "codex.exe"))
        .filter((path) => existsSync(path))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch {}
  }
  return "codex";
}

/** Codex ships helper executables such as rg.exe in versioned sibling folders. */
export function codexEnvironment(): NodeJS.ProcessEnv {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return process.env;
  const root = join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  let toolDirectories: string[] = [];
  try {
    toolDirectories = readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => existsSync(join(path, "rg.exe")));
  } catch {}
  if (!toolDirectories.length) return process.env;
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") || "PATH";
  const currentPath = process.env[pathKey] || "";
  const existing = new Set(currentPath.split(delimiter).map((path) => path.toLowerCase()));
  return {
    ...process.env,
    [pathKey]: [...toolDirectories.filter((path) => !existing.has(path.toLowerCase())), currentPath]
      .filter(Boolean)
      .join(delimiter),
  };
}
