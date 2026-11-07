import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function protectDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const marker = resolve(path, ".permissions-v1");
    if (existsSync(marker)) return;
    // Existing private app data needs no ACL rewrite (which can stall Windows
    // while propagating permissions through a large account history).
    const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
      $p=[Console]::In.ReadToEnd(); $a=[IO.Directory]::GetAccessControl($p);
      $u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
      $safe=$true; $ownerAccess=$false;
      foreach($r in $a.Access) {
        if($r.AccessControlType -ne 'Allow') { continue }
        $s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;
        if($s -notin @($u,'S-1-5-18','S-1-5-32-544')) { $safe=$false }
        if($s -eq $u -and ($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) { $ownerAccess=$true }
      }
      if($safe -and $ownerAccess) { [Console]::Write('private') }
    `], { input: path, encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (check.status === 0 && check.stdout.trim() === "private") { writeFileSync(marker, "1"); return; }
    const identity = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
    const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw Error("Could not determine the Windows user for private storage.");
    execFileSync("icacls.exe", [path, "/reset"], { windowsHide: true, stdio: "pipe", timeout: 10000 });
    execFileSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { windowsHide: true, stdio: "pipe", timeout: 10000 });
    writeFileSync(marker, "1");
  } else chmodSync(path, 0o700);
}
function dpapi(value: string, decrypt: boolean) {
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); ` +
    (decrypt
      ? `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`
      : `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`);
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: value, encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0 || result.error) throw Error("Windows credential protection failed.");
  return result.stdout.trim();
}
export function atomicJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, file);
  if (process.platform !== "win32") chmodSync(file, 0o600);
}
export function writeSecret(file: string, value: unknown) {
  atomicJson(file, process.platform === "win32" ? { protection: "dpapi-user-v1", value: dpapi(JSON.stringify(value), false) } : value);
}
export function readSecret<T>(file: string): T {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value.protection === "dpapi-user-v1") {
    if (process.platform !== "win32") throw Error("These credentials belong to a Windows user.");
    return JSON.parse(dpapi(value.value, true));
  }
  // Upgrade existing PixelCrew-owned secrets without touching Codex-owned auth.json.
  if (process.platform === "win32") writeSecret(file, value);
  return value;
}
