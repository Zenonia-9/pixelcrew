import { roomDividers, officeRoomPlanId, officeFixtures } from "../shared/office-rooms";
import { officeLayout, previousCreativeCommonsLayout } from "../shared/office-layouts";
import { characterLooks } from "../shared/character-assets";
import { officeDesigns } from "../shared/office-designs";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { starterTeam } from "../shared/defaults";
import { securityTeam } from "../shared/security-team";
import {
  preferencesSchema,
  composerPreferencesSchema,
} from "../shared/preferences";
import { normalAgent, normalStation } from "../shared/normal-agent";
import {
  furniture,
  placeFurniture,
  type RoomLayout,
} from "../shared/room-layout";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  teamSchema,
  type Team,
  type Run,
  type StudioEvent,
} from "../shared/types";
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version) > 1) {
      this.db.close(); throw Error("This database requires a newer PixelCrew version.");
    }
    this.db.exec("PRAGMA user_version=1");
    this.db
      .exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,created TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,data TEXT NOT NULL);`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,data TEXT NOT NULL,layout TEXT NOT NULL)",
    );
    if (!this.db.prepare("SELECT value FROM settings WHERE key='team'").get())
      this.saveTeam(structuredClone(starterTeam));
    // Rename the shipped default once; preserve custom team names and run snapshots.
    if (
      !this.db
        .prepare("SELECT value FROM settings WHERE key='pixelcrew-brand-v1'")
        .get()
    ) {
      const team = this.team();
      if (team.name === "The Hearth Guild")
        this.saveTeam({ ...team, name: "General Teams" });
      this.db
        .prepare(
          "INSERT OR REPLACE INTO settings VALUES('pixelcrew-brand-v1','true')",
        )
        .run();
    }
    if (
      !this.db.prepare("SELECT value FROM settings WHERE key='teams-v1'").get()
    ) {
      this.db
        .prepare("INSERT OR REPLACE INTO teams VALUES('default',?,?)")
        .run(JSON.stringify(this.team()), JSON.stringify(this.roomLayout()));
      this.db
        .prepare(
          "INSERT OR REPLACE INTO settings VALUES('active-team','default')",
        )
        .run();
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('teams-v1','done')")
        .run();
    }
    if (!this.db.prepare("SELECT value FROM settings WHERE key='general-team-v1'").get()) {
      const saved = this.db.prepare("SELECT data,layout FROM teams WHERE id='default'").get() as { data: string; layout: string } | undefined;
      const previous = saved && JSON.parse(saved.data) as Team | undefined;
      const shipped = previous && ["General Teams", "The Workshop Crew", "The Hearth Guild"].includes(previous.name);
      const id = shipped ? "default" : "general";
      const general = structuredClone(starterTeam);
      if (shipped) {
        general.normalAppearance = previous.normalAppearance;
        general.agents = general.agents.map(agent => ({ ...agent,
          ...previous.agents.find(member => member.id === agent.id),
          role: agent.role, enabled: true, model: "", reasoning: undefined,
          specialties: agent.specialties, skills: agent.skills,
        }));
      }
      this.db.prepare("INSERT OR REPLACE INTO teams VALUES(?,?,?)")
        .run(id, JSON.stringify(general), saved?.layout || "{}");
      if (id !== "default") {
        for (const key of ["office-design", "room-preset", "room-base-preset"]) {
          const value = this.db.prepare("SELECT value FROM settings WHERE key=?").get(`${key}:default`) as { value: string } | undefined;
          if (value) this.db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(`${key}:${id}`, value.value);
        }
      }
      // General Teams is the selected default after this one-time upgrade.
      // Existing teams and their historical runs remain available.
      this.switchTeam(id);
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES('general-team-v1','done')").run();
    }
    // Select the new built-in crew for databases that already received the
    // crew in the previous release, where another custom crew may be active.
    if (!this.db.prepare("SELECT value FROM settings WHERE key='general-team-default-v2'").get()) {
      const general = this.db.prepare("SELECT id FROM teams WHERE json_extract(data,'$.name')='General Teams' ORDER BY id LIMIT 1").get() as { id: string } | undefined;
      if (general) this.switchTeam(general.id);
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES('general-team-default-v2','done')").run();
    }
    // Add the security crew once without changing the current selection or
    // replacing user profiles. Keep the marker after a deliberate deletion.
    if (!this.db.prepare("SELECT value FROM settings WHERE key='security-team-v1'").get()) {
      this.db.exec("BEGIN");
      try {
        const id = this.db.prepare("SELECT id FROM teams WHERE id='security'").get()
          ? `security-${randomUUID()}` : "security";
        const names = new Set(this.teams().map(team => team.name));
        const team = structuredClone(securityTeam);
        let suffix = 1;
        while (names.has(team.name)) {
          team.name = suffix === 1 ? "Security (built-in)" : `Security (built-in ${suffix})`;
          suffix += 1;
        }
        this.db.prepare("INSERT INTO teams VALUES(?,?,?)")
          .run(id, JSON.stringify(teamSchema.parse(team)), "{}");
        this.db.prepare("INSERT INTO settings VALUES('security-team-v1','done')").run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (!this.db.prepare("SELECT value FROM settings WHERE key='creative-commons-v2'").get()) {
      const canonical = (layout: RoomLayout) => JSON.stringify(Object.entries(layout).sort(([a], [b]) => a.localeCompare(b)));
      for (const row of this.db.prepare("SELECT id,data,layout FROM teams").all() as { id: string; data: string; layout: string }[]) {
        const preset = this.db.prepare("SELECT value FROM settings WHERE key=?").get(`room-preset:${row.id}`) as { value: string } | undefined;
        const team = JSON.parse(row.data) as Team, previous = JSON.parse(row.layout) as RoomLayout;
        if (preset?.value !== "commons" || canonical(previous) !== canonical(officeLayout("commons", team.agents, true))) continue;
        const next = JSON.stringify(officeLayout("commons", team.agents));
        this.db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(`room-undo:${row.id}`, row.layout);
        this.db.prepare("UPDATE teams SET layout=? WHERE id=?").run(next, row.id);
        if (row.id === this.activeTeamId()) this.db.prepare("INSERT OR REPLACE INTO settings VALUES('room-layout',?)").run(next);
      }
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES('creative-commons-v2','1')").run();
    }
    if (!this.db.prepare("SELECT value FROM settings WHERE key='creative-commons-v3'").get()) {
      const canonical = (layout: RoomLayout) => JSON.stringify(Object.entries(layout).sort(([a], [b]) => a.localeCompare(b)));
      for (const row of this.db.prepare("SELECT id,data,layout FROM teams").all() as { id: string; data: string; layout: string }[]) {
        const preset = this.db.prepare("SELECT value FROM settings WHERE key=?").get(`room-preset:${row.id}`) as { value: string } | undefined;
        const team = JSON.parse(row.data) as Team, previous = JSON.parse(row.layout) as RoomLayout;
        if (preset?.value !== "commons" || canonical(previous) !== canonical(previousCreativeCommonsLayout(team.agents))) continue;
        const next = JSON.stringify(officeLayout("commons", team.agents));
        this.db.prepare("INSERT OR REPLACE INTO settings VALUES(?,?)").run(`room-undo:${row.id}`, row.layout);
        this.db.prepare("UPDATE teams SET layout=? WHERE id=?").run(next, row.id);
        if (row.id === this.activeTeamId()) this.db.prepare("INSERT OR REPLACE INTO settings VALUES('room-layout',?)").run(next);
      }
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES('creative-commons-v3','1')").run();
    }
  }
  officeDesign(): string {
    return (
      (
        this.db
          .prepare("SELECT value FROM settings WHERE key=?")
          .get(`office-design:${this.activeTeamId()}`) as
          { value: string } | undefined
      )?.value || "timber"
    );
  }
  saveOfficeDesign(id: string) {
    if (!officeDesigns.some((design) => design.id === id))
      throw Error("Unknown office design.");
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(`office-design:${this.activeTeamId()}`, id);
  }
  deleteTeam(id: string) {
    const teams = this.teams();
    if (!teams.some((team) => team.id === id)) throw Error("Team not found.");
    if (teams.length < 2)
      throw Error(
        "Keep at least one team. Create another team before deleting this one.",
      );
    if (id === this.activeTeamId())
      this.switchTeam(teams.find((team) => team.id !== id)!.id);
    this.db.prepare("DELETE FROM teams WHERE id=?").run(id);
    // Runs, immutable team snapshots and native Codex conversations are retained.
  }
  activeTeamId(): string {
    return (
      (
        this.db
          .prepare("SELECT value FROM settings WHERE key='active-team'")
          .get() as { value: string } | undefined
      )?.value || "default"
    );
  }
  teams() {
    return (
      this.db.prepare("SELECT id,data FROM teams ORDER BY rowid").all() as {
        id: string;
        data: string;
      }[]
    ).map((row) => {
      const team = JSON.parse(row.data) as Team;
      return {
        id: row.id,
        name: team.name,
        members: team.agents.filter((agent) => agent.enabled).length + 1,
      };
    });
  }
  createTeam(name: string, profile?: Team) {
    const team = teamSchema.parse({ ...structuredClone(profile || this.team()), name });
    const used = new Set(
      (
        this.db.prepare("SELECT data FROM teams").all() as { data: string }[]
      ).flatMap((row) => {
        const saved = JSON.parse(row.data) as Team;
        return [
          ...saved.agents.map(
            (agent) => `${agent.sprite}:${agent.look || "classic"}`,
          ),
          `${saved.normalAppearance?.sprite || "nova"}:${saved.normalAppearance?.look || "classic"}`,
        ];
      }),
    );
    const nextLook = (sprite: string, fallback?: string) => {
      const look =
        characterLooks.find((look) => !used.has(`${sprite}:${look.id}`))?.id ||
        fallback ||
        "classic";
      used.add(`${sprite}:${look}`);
      return look;
    };
    team.agents = team.agents.map((agent) => ({
      ...agent,
      look: nextLook(agent.sprite, agent.look),
    }));
    team.normalAppearance = this.team().normalAppearance;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO teams VALUES(?,?,?)")
      .run(id, JSON.stringify(team), "{}");
    this.switchTeam(id);
    return id;
  }
  switchTeam(id: string) {
    const saved = this.db
      .prepare("SELECT data,layout FROM teams WHERE id=?")
      .get(id) as { data: string; layout: string } | undefined;
    if (!saved) throw Error("Team not found.");
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('team',?)")
        .run(saved.data);
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('room-layout',?)")
        .run(saved.layout);
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('active-team',?)")
        .run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  layoutPreset(): string {
    return (
      (
        this.db
          .prepare("SELECT value FROM settings WHERE key=?")
          .get(`room-preset:${this.activeTeamId()}`) as
          { value: string } | undefined
      )?.value || "custom"
    );
  }
  layoutBasePreset(): string | undefined {
    const saved = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(`room-base-preset:${this.activeTeamId()}`) as
      { value: string } | undefined;
    if (saved) return saved.value === "custom" ? undefined : saved.value;
    const preset = this.layoutPreset();
    if (preset !== "custom") return preset;
    const layout = this.roomLayout();
    return (
      officeRoomPlanId(layout) ||
      (Object.keys(layout).length === 0 ? "workshop" : undefined)
    );
  }
  applyLayout(id: string, layout: unknown, basePreset?: string) {
    const previous = this.roomLayout();
    const previousMeta = {
      preset: this.layoutPreset(),
      base: this.layoutBasePreset(),
    };
    const result = this.saveRoomLayout(layout);
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(`room-undo:${this.activeTeamId()}`, JSON.stringify(previous));
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(
        `room-undo-meta:${this.activeTeamId()}`,
        JSON.stringify(previousMeta),
      );
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(`room-preset:${this.activeTeamId()}`, id);
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(
        `room-base-preset:${this.activeTeamId()}`,
        id !== "custom"
          ? id
          : basePreset ||
              officeRoomPlanId(result) ||
              (Object.keys(result).length === 0 ? "workshop" : "custom"),
      );
    return result;
  }
  undoLayout() {
    const previous = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(`room-undo:${this.activeTeamId()}`) as { value: string } | undefined;
    if (!previous) throw Error("No layout change to undo.");
    const savedMeta = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(`room-undo-meta:${this.activeTeamId()}`) as
      { value: string } | undefined;
    const metadata = savedMeta
      ? JSON.parse(savedMeta.value)
      : { preset: "custom" };
    return this.applyLayout(
      metadata.preset,
      JSON.parse(previous.value),
      metadata.base,
    );
  }
  team(): Team {
    const team = JSON.parse(
      (
        this.db
          .prepare("SELECT value FROM settings WHERE key='team'")
          .get() as { value: string }
      ).value,
    ) as Team;
    const shared = this.db.prepare("SELECT value FROM settings WHERE key='normal-profile'").get() as { value: string } | undefined;
    if (shared) team.normalAppearance = JSON.parse(shared.value);
    else {
      const general = this.db.prepare("SELECT data FROM teams WHERE json_extract(data,'$.name')='General Teams' LIMIT 1").get() as { data: string } | undefined;
      const appearance = general ? JSON.parse(general.data).normalAppearance : undefined;
      if (appearance) team.normalAppearance = appearance;
      else delete team.normalAppearance;
    }
    return team;
  }
  preferences() {
    const saved = this.db
      .prepare("SELECT value FROM settings WHERE key='preferences'")
      .get() as { value: string } | undefined;
    return preferencesSchema.parse(saved ? JSON.parse(saved.value) : {});
  }
  savePreference(key: string, value: unknown) {
    const preferences = this.preferences();
    if (key === "pinnedProjects")
      preferences.pinnedProjects = z.array(z.string()).max(500).parse(value);
    else if (key === "followupBehavior") preferences.followupBehavior = z.enum(["queue", "steer"]).parse(value);
    else if (key === "allowChrome") preferences.allowChrome = z.boolean().parse(value);
    else if (key === "allowWindowsComputer") preferences.allowWindowsComputer = z.boolean().parse(value);
    else preferences.composers[key] = composerPreferencesSchema.parse(value);
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('preferences',?)")
      .run(JSON.stringify(preferences));
    return preferences;
  }
  roomLayout(): RoomLayout {
    const saved = this.db
      .prepare("SELECT value FROM settings WHERE key='room-layout'")
      .get() as { value: string } | undefined;
    return saved ? JSON.parse(saved.value) : {};
  }
  saveRoomLayout(input: unknown): RoomLayout {
    const basePreset = this.layoutBasePreset();
    const positions = z
      .record(
        z.string(),
        z.object({
          x: z.number().finite(),
          y: z.number().finite(),
          scale: z.number().min(0.5).max(2).multipleOf(0.25).optional(),
          width: z.number().finite().min(8).max(1280).optional(),
          height: z.number().finite().min(8).max(1280).optional(),
          rotation: z
            .union([
              z.literal(0),
              z.literal(90),
              z.literal(180),
              z.literal(270),
            ])
            .optional(),
        }),
      )
      .parse(input);
    const members = this.team().agents;
    const lead = members.find(
      (agent) => agent.role === "lead" && agent.enabled,
    )!;
    const items = furniture(
      members.length < 12
        ? [...members, normalAgent(lead, normalStation(members))]
        : members,
    );
    const layout: RoomLayout = {};
    for (const [id, position] of Object.entries(positions)) {
      // Keep desks from earlier crew/station configurations editable and saved.
      const station = /^desk-(\d+)$/.exec(id);
      const item =
        items.find((item) => item.id === id) ||
        roomDividers.find((item) => item.id === id) ||
        officeFixtures.find((item) => item.id === id) ||
        (station && Number(station[1]) < 12
          ? furniture([{ ...lead, workstation: Number(station[1]) }]).find(
              (item) => item.id === id,
            )
          : undefined);
      if (!item) throw Error(`Unknown furniture: ${id}`);
      layout[id] = placeFurniture(
        item,
        position.x,
        position.y,
        position.rotation,
        position.scale,
        { width: position.width, height: position.height },
      );
    }
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('room-layout',?)")
      .run(JSON.stringify(layout));
    this.db
      .prepare("UPDATE teams SET layout=? WHERE id=?")
      .run(JSON.stringify(layout), this.activeTeamId());
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(`room-preset:${this.activeTeamId()}`, "custom");
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(`room-base-preset:${this.activeTeamId()}`, basePreset || "custom");
    return layout;
  }
  saveTeam(input: unknown) {
    const team = teamSchema.parse(input);
    this.db.exec("BEGIN");
    try {
      if (team.normalAppearance) this.db.prepare("INSERT OR REPLACE INTO settings VALUES('normal-profile',?)").run(JSON.stringify(team.normalAppearance));
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('team',?)")
        .run(JSON.stringify(team));
      this.db
        .prepare("INSERT INTO profiles(created,data) VALUES(?,?)")
        .run(new Date().toISOString(), JSON.stringify(team));
      this.db
        .prepare("UPDATE teams SET data=? WHERE id=?")
        .run(JSON.stringify(team), this.activeTeamId());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return team;
  }
  saveRun(run: Run) {
    this.db
      .prepare("INSERT OR REPLACE INTO runs VALUES(?,?,?)")
      .run(run.id, run.createdAt, JSON.stringify(run));
  }
  runs(): Run[] {
    return (
      this.db.prepare("SELECT data FROM runs ORDER BY created DESC").all() as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data));
  }
  event(event: Omit<StudioEvent, "seq">) {
    const result = this.db
      .prepare("INSERT INTO events(run_id,data) VALUES(?,?)")
      .run(event.runId, JSON.stringify(event));
    return { ...event, seq: Number(result.lastInsertRowid) };
  }
  events(): StudioEvent[] {
    return (
      this.db
        .prepare("SELECT seq,data FROM events ORDER BY seq DESC LIMIT 400")
        .all() as { seq: number; data: string }[]
    )
      .reverse()
      .map((x) => ({ ...JSON.parse(x.data), seq: x.seq }));
  }
  close() {
    this.db.close();
  }
}
