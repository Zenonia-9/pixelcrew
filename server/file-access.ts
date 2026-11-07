import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
/** Resolve symlinks before checking the workspace boundary. */
export function withinDirectory(root: string, file: string) {
  try {
    const offset = relative(realpathSync(root), realpathSync(file));
    return offset !== ".." && !offset.startsWith("..\\") && !offset.startsWith("../") && !isAbsolute(offset);
  } catch { return false; }
}
