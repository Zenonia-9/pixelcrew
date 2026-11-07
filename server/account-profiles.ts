import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export interface AccountProfile { id: string; label: string; desktop?: boolean; email?: string; pending?: boolean }
/** Only profile metadata is stored here. Codex owns credentials in each private home. */
export class AccountProfiles {
  profiles: AccountProfile[] = [{ id: "desktop", label: "Desktop Codex", desktop: true }];
  selected = "desktop";
  disconnected = false;
  constructor(private file: string) {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(saved.profiles) || !saved.profiles.every((p: AccountProfile) =>
        typeof p.label === "string" && (p.id === "desktop" || /^[0-9a-f-]{36}$/.test(p.id))))
        throw Error("Invalid saved account profiles.");
      this.profiles = saved.profiles;
      this.selected = saved.selected;
      this.disconnected = Boolean(saved.disconnected);
      this.get(this.selected);
      // Recover identity only from successful Codex logins, never from a user label.
      for (const profile of this.profiles.filter(p => !p.desktop && !p.email)) {
        try {
          const auth = JSON.parse(readFileSync(resolve(this.home(profile.id)!, "auth.json"), "utf8"));
          const token = auth.tokens?.id_token;
          if (typeof token === "string") {
            const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
            if (typeof claims.email === "string" && auth.tokens?.refresh_token) profile.email = claims.email;
          }
        } catch { /* A pending or cancelled sign-in has no saved identity. */ }
      }
    }
  }
  get(id: string) {
    const profile = this.profiles.find(p => p.id === id);
    if (!profile) throw Error("Unknown account profile.");
    return profile;
  }
  home(id = this.selected) {
    this.get(id);
    return id === "desktop" ? undefined : resolve(dirname(this.file), "accounts", id);
  }
  ownerOfRollout(path?: string) {
    if (!path) return undefined;
    const plain = path.startsWith("\\\\?\\") ? path.slice(4) : path;
    return this.profiles.find(profile => {
      const root = this.home(profile.id) || resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"));
      const offset = relative(root, resolve(plain));
      return offset !== ".." && !offset.startsWith("..\\") && !offset.startsWith("../") && !isAbsolute(offset);
    })?.id;
  }
  add(label: string, pending = false) {
    const profile = { id: randomUUID(), label: label.trim().slice(0, 80) || "New account", ...(pending ? { pending: true } : {}) };
    this.profiles.push(profile);
    mkdirSync(this.home(profile.id)!, { recursive: true, mode: 0o700 });
    this.save();
    return profile;
  }
  rename(id: string, label: string) {
    const name = label.trim();
    if (!name || name.length > 80) throw Error("Account name must be 1–80 characters.");
    this.get(id).label = name;
    this.save();
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ profiles: this.profiles,
      selected: this.selected, disconnected: this.disconnected }), { mode: 0o600 });
  }
  confirm(email?: string, id = this.selected) {
    const profile = this.get(id);
    const changed = Boolean(email && profile.email !== email || profile.pending);
    if (email) profile.email = email;
    profile.pending = false;
    if (!changed) return;
    this.save();
  }
  removable(id = this.selected) {
    const account = this.get(id);
    if (account.desktop || id === "desktop") throw Error("This account is managed by the Codex app and cannot be logged out here.");
    return this.profiles.filter(profile => !profile.desktop && (profile.id === id ||
      Boolean(account.email && profile.email?.trim().toLowerCase() === account.email.trim().toLowerCase())));
  }
  remove(id = this.selected) {
    const removing = this.removable(id);
    const root = realpathSync(resolve(dirname(this.file), "accounts"));
    // Remove credentials only. Session histories and tasks remain available.
    for (const profile of removing) {
      const home = this.home(profile.id)!;
      if (!existsSync(home)) continue;
      const offset = relative(root, realpathSync(home));
      if (offset === ".." || offset.startsWith("..\\") || offset.startsWith("../") || isAbsolute(offset))
        throw Error("Account credential folder is outside PixelCrew storage.");
      for (const name of ["auth.json", "pixelcrew-oauth.json", "pixelcrew-registration.json"])
        if (existsSync(resolve(home, name))) unlinkSync(resolve(home, name));
    }
    const ids = new Set(removing.map(profile => profile.id));
    this.profiles = this.profiles.filter(profile => !ids.has(profile.id));
    if (ids.has(this.selected)) this.selected = "desktop";
    this.disconnected = false;
    this.save();
    return [...ids];
  }
  view() {
    // Present accounts, rather than every historical credential connection.
    // Keep the active connection (and background workers) unchanged.
    const accounts = new Map<string, AccountProfile>();
    for (const profile of this.profiles.filter(p => p.desktop || p.email || p.pending ||
      existsSync(resolve(this.home(p.id)!, "pixelcrew-registration.json")))) {
      const key = profile.email?.trim().toLowerCase() || profile.id;
      const existing = accounts.get(key);
      if (!existing || profile.id === this.selected || existing.id !== this.selected && profile.desktop)
        accounts.set(key, profile);
    }
    const profiles = [...accounts.values()];
    const pendingNumbers = new Map<string, number>();
    let nextPendingNumber = 1;
    return { profiles: profiles.map(p => {
      const home = this.home(p.id);
      const hasCredentials = Boolean(home && existsSync(resolve(home, "pixelcrew-oauth.json")));
      const hasCodexCredentials = Boolean(home && existsSync(resolve(home, "auth.json")));
      const pendingRegistration = Boolean(home && !hasCredentials && !hasCodexCredentials &&
        (p.pending || existsSync(resolve(home, "pixelcrew-registration.json"))));
      if (pendingRegistration) pendingNumbers.set(p.id, nextPendingNumber++);
      const authType = p.desktop ? "desktop" as const : hasCredentials ? "pixelcrew" as const : pendingRegistration ? "pending" as const : "codex" as const;
      const label = p.email || (p.desktop ? "Desktop Codex" : pendingRegistration ? `${p.label} ${pendingNumbers.get(p.id)} (sign-in incomplete)` : p.label);
      return { ...p, label, authType };
    }), selected: this.selected, disconnected: this.disconnected };
  }
}
