import { mkdirSync, writeFileSync } from "node:fs";
import { officeLayout } from "../shared/office-layouts";
import type { Snapshot } from "../shared/types";

const origin = "http://127.0.0.1:4318";
const state = (await fetch(`${origin}/api/state`).then((r) =>
  r.json(),
)) as Snapshot;
const layout = officeLayout("commons", state.team.agents);
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/room-remodel-preview.json",
  JSON.stringify(
    { teamId: state.activeTeamId, team: state.team.name, layout },
    null,
    2,
  ),
);
if (process.argv.includes("--apply")) {
  const fresh = (await fetch(`${origin}/api/state`).then((r) =>
    r.json(),
  )) as Snapshot;
  if (fresh.activeTeamId !== state.activeTeamId)
    throw Error("Active team changed; no layout was applied.");
  const backup = `test-results/room-remodel-before-${Date.now()}.json`;
  writeFileSync(
    backup,
    JSON.stringify(
      {
        teamId: state.activeTeamId,
        team: state.team.name,
        layout: state.layout,
      },
      null,
      2,
    ),
  );
  const response = await fetch(`${origin}/api/layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
  });
  if (!response.ok)
    throw Error(
      `Room layout was not applied: ${response.status} ${await response.text()}`,
    );
  const saved = (await fetch(`${origin}/api/state`).then((r) =>
    r.json(),
  )) as Snapshot;
  if (saved.activeTeamId !== state.activeTeamId)
    throw Error("Team changed after save; inspect backup before continuing.");
  console.log(
    JSON.stringify({
      applied: true,
      team: saved.team.name,
      backup,
      items: Object.keys(saved.layout || {}).length,
    }),
  );
} else
  console.log(
    JSON.stringify({
      prepared: true,
      team: state.team.name,
      items: Object.keys(layout).length,
    }),
  );
