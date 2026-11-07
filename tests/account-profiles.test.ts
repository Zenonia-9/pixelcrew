import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountProfiles } from "../server/account-profiles";
import { CodexRuntime } from "../server/runtime";

test("account profiles keep isolated homes and persist selection and app-only logout", () => {
  const file = join(mkdtempSync(join(tmpdir(), "pixelcrew-accounts-")), "profiles.json");
  const accounts = new AccountProfiles(file);
  assert.equal(accounts.home(), undefined);
  const first = accounts.add("Personal"), second = accounts.add("Work");
  assert.notEqual(accounts.home(first.id), accounts.home(second.id));
  assert.throws(() => accounts.home("../../desktop"), /Unknown/);
  accounts.selected = second.id;
  accounts.disconnected = true;
  accounts.rename(second.id, "  Work account  ");
  accounts.rename("desktop", "My desktop account");
  assert.throws(() => accounts.rename(second.id, " "), /Account name/);
  assert.throws(() => accounts.rename("unknown", "Name"), /Unknown/);
  accounts.save();
  const restored = new AccountProfiles(file);
  assert.equal(restored.selected, second.id);
  assert.equal(restored.disconnected, true);
  assert.equal(restored.profiles.length, 3);
  assert.equal(restored.get(second.id).label, "Work account");
  assert.equal(restored.get("desktop").label, "My desktop account");
  assert.equal(readFileSync(file, "utf8").includes("authUrl"), false);
});

test("account switching preserves local projects while workers inherit the selected credential home", async () => {
  const runtime = new CodexRuntime();
  runtime.chatFiles.set("old", new Map([["file", "path"]]));
  runtime.status.projects = [{ id: "old", name: "Old account", roots: [] }];
  await runtime.useAccount("C:/PixelCrew/account-2", false);
  assert.equal(runtime.chatFiles.size, 0);
  assert.deepEqual(runtime.status.projects, [{ id: "old", name: "Old account", roots: [] }]);
  assert.equal((runtime.createExecutionWorker() as any).accountHome, "C:/PixelCrew/account-2");
  await assert.rejects(runtime.connect(), /disconnected/);
});

test("unregistered pending accounts stay hidden, but failed PixelCrew registrations remain retryable", () => {
  const accounts = new AccountProfiles(join(mkdtempSync(join(tmpdir(), "pending-accounts-")), "profiles.json"));
  const pending = accounts.add("Never signed in");
  const otherPending = accounts.add("Never signed in");
  assert.equal(accounts.view().profiles.some(profile => profile.id === pending.id), false);
  writeFileSync(join(accounts.home(pending.id)!, "pixelcrew-registration.json"), JSON.stringify({ clientId: "issued-client" }));
  writeFileSync(join(accounts.home(otherPending.id)!, "pixelcrew-registration.json"), JSON.stringify({ clientId: "other-issued-client" }));
  const retryable = accounts.view().profiles.find(profile => profile.id === pending.id);
  assert.equal(retryable?.authType, "pending");
  assert.match(retryable?.label || "", /Never signed in 1 \(sign-in incomplete\)/);
  assert.match(accounts.view().profiles.find(profile => profile.id === otherPending.id)?.label || "", /Never signed in 2 \(sign-in incomplete\)/);
  accounts.selected = pending.id;
  accounts.confirm("signed-in@example.com");
  assert.equal(accounts.view().profiles.find(profile => profile.id === pending.id)?.label, "signed-in@example.com");
});

test("the account picker shows each email once and preserves the active connection", () => {
  const accounts = new AccountProfiles(join(mkdtempSync(join(tmpdir(), "unique-accounts-")), "profiles.json"));
  accounts.confirm("same@example.com");
  const duplicate = accounts.add("Same person");
  accounts.selected = duplicate.id; accounts.confirm("SAME@example.com");
  assert.equal(accounts.view().profiles.length, 1);
  assert.ok(accounts.view().profiles.some(profile => profile.id === duplicate.id));
  assert.equal(new Set(accounts.view().profiles.map(profile => profile.label)).size, 1);
  const older = accounts.add("Another saved connection");
  accounts.confirm("same@example.com", older.id);
  assert.equal(accounts.view().profiles.length, 1);
  assert.equal(accounts.view().profiles[0].id, duplicate.id);
  assert.equal(accounts.profiles.length, 3);
  accounts.selected = "desktop";
  assert.equal(accounts.view().profiles.length, 1);
  assert.equal(accounts.view().profiles[0].id, "desktop");
});

test("rollout ownership distinguishes account roots from similar folder prefixes", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ownership-")), "profiles.json");
  const accounts = new AccountProfiles(file);
  const first = accounts.add("First"), second = accounts.add("Second");
  assert.equal(accounts.ownerOfRollout(join(accounts.home(first.id)!, "sessions", "chat.jsonl")), first.id);
  assert.equal(accounts.ownerOfRollout(join(accounts.home(second.id)!, "sessions", "chat.jsonl")), second.id);
  assert.equal(accounts.ownerOfRollout(join(accounts.home(first.id)! + "-other", "sessions", "chat.jsonl")), undefined);
});

test("PixelCrew OAuth usage cannot read or redeem a legacy account's credits", async () => {
  const runtime = new CodexRuntime();
  (runtime as any).oauthCredentials = { email: "selected@example.com" };
  runtime.connect = async () => {};
  runtime.request = async () => { throw Error("Must not access legacy account limits"); };
  runtime.status.usage = [{ id: "legacy", label: "Legacy account", windows: [] }];
  await runtime.refreshUsage();
  assert.equal(runtime.status.usage, undefined);
  assert.match(runtime.status.usageError!, /ChatGPT Settings/);
  await assert.rejects(runtime.redeemUsageReset(undefined, "unused"), /ChatGPT Settings/);
});

test("switching the selected account keeps concurrent workers pinned to their original accounts", async () => {
  const root = new CodexRuntime();
  root.configureAccounts(id => `C:/PixelCrew/${id}`);
  const homes: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const original = root.createExecutionWorker.bind(root);
  root.createExecutionWorker = accountId => {
    const worker = original(accountId);
    homes.push((worker as any).accountHome);
    worker.shutdown = async () => {};
    worker.execute = async () => {
      if (accountId === "a") { started(); await new Promise<void>(resolve => { release = resolve; }); }
      return `Finished ${accountId}`;
    };
    return worker;
  };
  const task = (accountId: string) => ({ accountId, assignment: { id: accountId } } as any);
  const a = root.execute(task("a"));
  await ready;
  await root.useAccount("C:/PixelCrew/b", false);
  assert.equal(root.writers.size, 1);
  assert.equal(await root.execute(task("b")), "Finished b");
  assert.deepEqual(homes, ["C:/PixelCrew/a", "C:/PixelCrew/b"]);
  release();
  assert.equal(await a, "Finished a");
  assert.equal(root.writers.size, 0);
});

test("logout forgets every saved connection for an app account and its credentials while retaining chats", () => {
  const file = join(mkdtempSync(join(tmpdir(), "forget-account-")), "profiles.json");
  const accounts = new AccountProfiles(file);
  const first = accounts.add("First connection"), duplicate = accounts.add("Older connection"), other = accounts.add("Different account");
  accounts.confirm("remove@example.com", first.id);
  accounts.confirm("REMOVE@example.com", duplicate.id);
  accounts.confirm("keep@example.com", other.id);
  const homes = [accounts.home(first.id)!, accounts.home(duplicate.id)!];
  for (const home of homes) {
    writeFileSync(join(home, "auth.json"), "{}");
    writeFileSync(join(home, "pixelcrew-oauth.json"), "{}");
    mkdirSync(join(home, "sessions"));
    writeFileSync(join(home, "sessions", "history.jsonl"), "saved history");
  }
  accounts.selected = first.id;
  assert.equal(accounts.remove().length, 2);
  assert.equal(accounts.selected, "desktop");
  assert.equal(accounts.get(other.id).email, "keep@example.com");
  for (const home of homes) {
    assert.equal(existsSync(join(home, "auth.json")), false);
    assert.equal(existsSync(join(home, "pixelcrew-oauth.json")), false);
    assert.equal(readFileSync(join(home, "sessions", "history.jsonl"), "utf8"), "saved history");
  }
  const restored = new AccountProfiles(file);
  assert.equal(restored.view().profiles.some(profile => profile.email?.toLowerCase() === "remove@example.com"), false);
  assert.throws(() => restored.remove("desktop"), /managed by the Codex app/);
  assert.equal(restored.get("desktop").desktop, true);
});
