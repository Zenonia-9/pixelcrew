# PixelCrew for Windows

This build is a release candidate. It runs locally under your Windows account.
Codex must already be installed. A desktop installer and Android connectivity are not included.

## Start and control

Extract the complete folder to a location you own and run `PixelCrew.cmd`.
The launcher opens the authenticated browser and runs the service in the foreground,
showing developer logs in the terminal. Ctrl+C stops a service started by that terminal.
Closing the browser does not stop the backend.
From the source checkout, use `npm.cmd run service --open` for the same behavior.
Run in the background with `npm.cmd run service --open --detach`.
The installed npm forwards these flags through its environment; it may print an unknown-config warning.
Direct Node commands also accept `-d` as the short form of `--detach`.
Use `--status`, `--stop`, or `--restart` to manage it. `--open` is optional when only starting the backend.
If you attach to an already running service, Ctrl+C stops log viewing and leaves that existing service running.
Active tasks are listed before interruption confirmation. Interrupted tasks require explicit resume.
Use `--open` again after a restart or an expired session to renew browser access.

## Data and accounts

Data and rotating service logs live in `%LOCALAPPDATA%\PixelCrew`.
PixelCrew-owned OAuth credentials use Windows user protection. Keep this directory private.
Codex owns its separate sign-in credentials; PixelCrew does not replace desktop authentication.
Use Settings → Account to connect. Permissions and approvals still apply to each task.
Only your local computer can connect; no Android or LAN access is enabled.

## Migrate the prototype

Stop the old prototype first. For a source checkout, the first launch copies `.data`
automatically. For an extracted package, set `PIXELCREW_LEGACY_DIR` to the old
checkout's absolute `.data` directory before the first launch.
Migration leaves the source untouched and retains `backups\prototype-v1`.
Do not run old and new versions against the same data directory.

## Diagnose and recover

Use `status` for service and Codex connectivity. Logs are developer-only and have
no in-app viewer or export control. Developers can run the controller's `logs`
command or inspect the private data directory. Diagnostic API access requires
the developer controller credential. Logs omit conversation content, credentials, and file contents.
If the port is occupied, stop the other instance with its own launcher.
PixelCrew never kills an unknown process to claim a port.

Back up the complete data directory while PixelCrew is stopped. To restore, stop
PixelCrew, move the current directory aside, and restore the backup as a complete
directory. Use a build compatible with that backup. Do not downgrade a migrated
database in place. An incomplete migration stops startup for inspection rather
than overwriting existing state.

The office provides a visual view of the crew. Chat and task-board status reflect
the actual Codex work.
