import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { release } from "../shared/release";

function chromePath() {
  return [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
  ].filter((path): path is string => !!path).find(existsSync);
}
function computerUseReady() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return false;
  try {
    const runtimes = join(process.env.LOCALAPPDATA, "OpenAI/Codex/runtimes/cua_node");
    const hasSky = readdirSync(runtimes).some(version => existsSync(join(runtimes, version, "bin/node_modules/@oai/sky/package.json")));
    const pipes = readdirSync("\\\\.\\pipe\\").filter(name => /^codex-computer-use-[0-9a-f-]+$/i.test(name));
    return hasSky && pipes.length === 1;
  } catch { return false; }
}
export function deviceToolStatus() {
  if (!release.capabilities.deviceTools) {
    const unavailable = { available: false, reason: "Device tools are not qualified for this release." };
    return { browser: unavailable, chrome: unavailable, computer: unavailable };
  }
  const browser = !!chromePath();
  const computer = computerUseReady();
  return {
    browser: { available: browser, reason: browser ? undefined : "Install Chrome or Edge to use PixelCrew's isolated browser." },
    chrome: { available: computer, reason: computer ? undefined : "Connect Computer Use in the Codex desktop app to control Chrome." },
    computer: { available: computer, reason: computer ? undefined : "Connect Computer Use in the Codex desktop app on Windows." },
  };
}
