import { readdirSync, realpathSync } from "node:fs";
import { resolve, relative, dirname, basename, isAbsolute } from "node:path";
import { isLocalFilesystemPath } from "../shared/local-paths";
export function fileCompletions(workspace: string, query: string) {
  if (!workspace || !isAbsolute(workspace) || !isLocalFilesystemPath(workspace) || !isLocalFilesystemPath(query)) return [];
  const root = realpathSync(workspace);
  const normalized = query.replace(/\\/g, "/");
  const folder = normalized.includes("/")
    ? normalized.slice(0, normalized.lastIndexOf("/") + 1)
    : "";
  const candidate = resolve(root, folder);
  if (!isLocalFilesystemPath(candidate)) return [];
  const directory = realpathSync(candidate);
  const path = relative(root, directory);
  if (path.startsWith("..") || isAbsolute(path)) return [];
  const prefix = normalized.slice(folder.length).toLowerCase();
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.isSymbolicLink() &&
        ![".git", "node_modules", ".data", "dist"].includes(entry.name) &&
        entry.name.toLowerCase().startsWith(prefix),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 30)
    .map((entry) => ({
      name: folder + entry.name + (entry.isDirectory() ? "/" : ""),
      path: resolve(directory, entry.name),
      directory: entry.isDirectory(),
    }));
}
