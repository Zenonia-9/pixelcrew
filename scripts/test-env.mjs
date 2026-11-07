import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
// Runtime tests must never create native-agent configuration in the user's app data.
mkdirSync(resolve(".protocol"), { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "pixelcrew-tests-"));
process.env.PIXELCREW_DATA_DIR = directory;
process.once("exit", () => {
  if (!relative(resolve(tmpdir()), directory).startsWith("pixelcrew-tests-")) return;
  rmSync(directory, { recursive: true, force: true });
});
