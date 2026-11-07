import { MemberEditor } from "./MemberEditor";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Agent, Team, Snapshot } from "../shared/types";
import { normalAgent, normalStation } from "../shared/normal-agent";
import { characterLooks } from "../shared/character-assets";
import { CharacterPreview } from "./AppearancePicker";
export function TeamMembers({
  team,
  busy,
  save,
  catalog,
  models,
}: {
  team: Team;
  catalog?: Snapshot["catalog"];
  models: Snapshot["runtime"]["models"];
  busy: boolean;
  save: (team: Team) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string>();
  const [adding, setAdding] = useState<Agent>();
  const nova = normalAgent(
    team.agents.find((agent) => agent.role === "lead")!,
    normalStation(team.agents),
    team.normalAppearance,
  );
  const members = [...team.agents, nova];
  const workstation = Array.from({ length: 12 }, (_, index) => index).find(
    (index) => !members.some((member) => member.workstation === index),
  );
  const full = team.agents.length >= 11 || workstation === undefined;
  const current = adding || members.find((member) => member.id === editing);
  const editorTeam = adding
    ? { ...team, agents: [...team.agents, adding] }
    : team;
  const closeEditor = () => {
    setAdding(undefined);
    setEditing(undefined);
  };
  function addMember() {
    if (full || busy || workstation === undefined) return;
    const source =
      team.agents.find((member) => member.role === "researcher") ||
      team.agents[0];
    setEditing(undefined);
    setAdding({
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: "New crew member",
      title: "Specialist",
      role: "researcher",
      sprite: "pip",
      look:
        characterLooks.find(
          (look) =>
            !members.some(
              (member) =>
                member.sprite === "pip" &&
                (member.look || "classic") === look.id,
            ),
        )?.id || "classic",
      workstation,
      enabled: true,
      access: "read-only",
      biography: "A new face at the workshop.",
      expertise: ["Research"],
      instructions: "Investigate your assigned question and return evidence.",
      expectedOutput: "Findings with supporting evidence.",
      specialties: undefined,
      skills: undefined,
    });
  }
  return (
    <section className="team-members" aria-label="Team members">
      <div className="team-section-heading">
        <div>
          <h3>Members</h3>
          <p>
            Edit the appearance, profile and work capabilities of each member.
          </p>
        </div>
        <span>{members.length} members</span>
      </div>
      <div className="team-member-grid">
        {members.map((member) => (
          <button
            type="button"
            key={member.id}
            className={`team-member-card ${editing === member.id ? "selected" : ""}`}
            disabled={busy}
            aria-expanded={editing === member.id}
            aria-label={`Customize ${member.name}`}
            onClick={() => {
              setAdding(undefined);
              setEditing(member.id);
            }}
          >
            <CharacterPreview appearance={member} />
            <span>
              <strong>{member.name}</strong>
              <small>{member.title}</small>
              <em>
                {
                  characterLooks.find(
                    (look) => look.id === (member.look || "classic"),
                  )?.name
                }
                {!member.enabled ? " · Disabled" : ""}
              </em>
            </span>
            <Pencil size={14} />
          </button>
        ))}
        <button
          type="button"
          className="team-member-card team-member-add"
          aria-label="Add crew member"
          disabled={busy || full}
          onClick={addMember}
        >
          <Plus size={28} aria-hidden="true" />
          <span>
            <strong>Add crew member</strong>
            <small>
              {full
                ? "Team full · 12 members"
                : "Choose a character and profile"}
            </small>
          </span>
        </button>
      </div>
      {current && (
        <MemberEditor
          key={current.id}
          agent={current}
          team={editorTeam}
          catalog={catalog}
          models={models}
          busy={busy}
          onCancel={closeEditor}
          onSave={async (next) => {
            const saved = await save(next);
            if (saved) closeEditor();
            return saved;
          }}
        />
      )}
    </section>
  );
}
