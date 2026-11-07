import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

const root = process.cwd(), output = resolve(root, ".build-next"), current = resolve(root, ".build"), previous = resolve(root, ".build-previous");
for (const directory of [output, previous]) {
  const offset = relative(root, directory);
  if (!offset || offset.startsWith("..") || isAbsolute(offset)) throw Error("Invalid build directory.");
}
rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "server"), { recursive: true });
const result = await build({ entryPoints: ["server/index.ts", "server/controller.ts"], outdir: resolve(output, "server"),
  bundle: true, platform: "node", format: "esm", target: "node24", packages: "external", metafile: true,
  plugins: [{ name: "exclude-simulation", setup(builder) {
    builder.onLoad({ filter: /[\\/]engine\.ts$/ }, async args => {
      const source = readFileSync(args.path, "utf8");
      const start = source.indexOf("  private demo(run: Run) {");
      if (start < 0 || !source.trimEnd().endsWith("}")) throw Error("Simulation exclusion must be updated.");
      return { contents: source.slice(0, start) + '  private demo(_run: Run) { throw Error("Demo execution is excluded from this release."); }\n}\n', loader: "ts" };
    });
  }}],
});
cpSync("dist", resolve(output, "dist"), { recursive: true });
cpSync("public/sprites", resolve(output, "dist/sprites"), { recursive: true });
cpSync("public/favicon.svg", resolve(output, "dist/favicon.svg"));
cpSync("resources", resolve(output, "resources"), { recursive: true, filter: path => !path.includes("chrome-extension") });
writeFileSync(resolve(output, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(resolve(output, "backend-metafile.json"), JSON.stringify(result.metafile, null, 2));
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; }
    catch (error) {
      if (attempt >= 15 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      await new Promise(done => setTimeout(done, 200));
    }
  }
}
if (existsSync(previous)) rmSync(previous, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
if (existsSync(current)) {
  try { await renameWithRetry(current, previous); }
  catch { throw Error("Stop the checkout service before replacing .build. The new build remains in .build-next."); }
}
try { await renameWithRetry(output, current); }
catch (error) { if (existsSync(previous) && !existsSync(current)) await renameWithRetry(previous, current); throw error; }
console.log("Compiled backend and release UI in .build");
