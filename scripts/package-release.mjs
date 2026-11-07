import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "win32") throw Error("Build the Windows package on Windows.");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const target = resolve("artifacts", `PixelCrew-${version}-${process.arch}`);
if (existsSync(target)) throw Error("Package already exists. Move it aside before rebuilding.");
mkdirSync(target, { recursive: true });
for (const folder of ["server", "dist", "resources"]) cpSync(resolve(".build", folder), join(target, folder), { recursive: true });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
delete pkg.devDependencies;
pkg.scripts = { start: "node server/controller.js --open" };
writeFileSync(join(target, "package.json"), JSON.stringify(pkg, null, 2));
cpSync("package-lock.json", join(target, "package-lock.json"));
execFileSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund"], { cwd: target, stdio: "inherit" });
mkdirSync(join(target, "runtime"));
cpSync(process.execPath, join(target, "runtime/node.exe"));
const nodeLicense = resolve(process.execPath, "../LICENSE");
if (existsSync(nodeLicense)) cpSync(nodeLicense, join(target, "runtime/LICENSE"));
else {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`);
  if (!response.ok) throw Error("Could not obtain the license for the bundled Node version.");
  writeFileSync(join(target, "runtime/LICENSE"), await response.text());
}
cpSync("docs/USER-GUIDE.md", join(target, "README.md"));
cpSync("resources/NOTICE.md", join(target, "NOTICE.md"));
writeFileSync(join(target, "PixelCrew.cmd"), '@echo off\r\ncd /d "%~dp0"\r\nif "%~1"=="" (\r\n  "%~dp0runtime\\node.exe" "%~dp0server\\controller.js" --open\r\n) else (\r\n  "%~dp0runtime\\node.exe" "%~dp0server\\controller.js" %*\r\n)\r\n');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}
const forbidden = /(?:^|[\\/])(?:AGENTS\.md|VALIDATION\.md|tests|\.data|\.protocol|\.git|three|models|playwright-core|tsx|vite|typescript)(?:[\\/]|$)|\.(?:glb|gltf|ts|tsx)$/i;
for (const file of files(target)) {
  // Published dependencies may include their own type declarations and test fixtures;
  // runtime dependency installation is audited separately from application payload.
  const local = file.slice(target.length + 1);
  if (!local.startsWith("node_modules") && forbidden.test(local)) throw Error(`Unexpected runtime payload: ${local}`);
}
for (const name of ["three", "tsx", "vite", "typescript", "playwright-core"]) if (existsSync(join(target, "node_modules", name))) throw Error(`Development dependency shipped: ${name}`);
const manifest = files(target).map(file => ({ path: file.slice(target.length + 1).replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(file)).digest("hex") }));
writeFileSync(join(target, "manifest.json"), JSON.stringify({ version, channel: "candidate", files: manifest }, null, 2));
console.log(`Windows release candidate: ${target}`);
