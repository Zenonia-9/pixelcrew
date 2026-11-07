export function controllerOptions(args: string[], environment: Record<string, string | undefined> = process.env) {
  const npmFlags = ["start", "stop", "restart", "status", "logs", "diagnostics", "menu", "help", "open", "detach", "confirm-interrupt"]
    .filter(flag => ["true", "1"].includes(environment[`npm_config_${flag.replaceAll("-", "_")}`] || ""))
    .map(flag => `--${flag}`);
  args = [...npmFlags.filter(flag => !args.includes(flag)), ...args];
  const actions = new Set(["start", "open", "stop", "restart", "status", "logs", "diagnostics", "menu", "help"]);
  let action = "start", selected = false, detach = false, open = false, confirm = false;
  for (const argument of args) {
    if (argument === "-d" || argument === "--detach") { detach = true; continue; }
    if (argument === "--open" || argument === "open") { open = true; continue; }
    if (argument === "--confirm-interrupt") { confirm = true; continue; }
    const value = argument === "-h" ? "help" : argument.replace(/^--/, "");
    if (!actions.has(value) || selected) throw Error(`Invalid controller option: ${argument}. Use --help.`);
    action = value; selected = true;
  }
  if (open && !["start", "restart"].includes(action)) throw Error("--open requires starting or restarting the service.");
  if (detach && !["start", "restart"].includes(action)) throw Error("-d applies only to starting or restarting the service.");
  return { action, detach, open, confirm };
}
