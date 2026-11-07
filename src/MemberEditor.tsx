import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Agent, Team, Snapshot } from "../shared/types";
import { preferredModel } from "../shared/models";
import { AppearancePicker } from "./AppearancePicker";
import { CapabilityPicker } from "./CapabilityPicker";
export function MemberEditor({
  agent,
  team,
  catalog,
  models,
  busy,
  onSave,
  onCancel,
}: {
  agent: Agent;
  team: Team;
  catalog?: Snapshot["catalog"];
  models: Snapshot["runtime"]["models"];
  busy: boolean;
  onSave: (team: Team) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Agent>(() => structuredClone(agent));
  const normal = agent.id === "codex-normal";
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    editor.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  const change = <K extends keyof Agent>(key: K, value: Agent[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      ref={editor}
      aria-label={`Edit ${agent.name} profile`}
      className="profile-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          normal
            ? {
                ...team,
                normalAppearance: {
                  sprite: draft.sprite,
                  look: draft.look,
                  name: draft.name,
                  biography: draft.biography,
                },
              }
            : {
                ...team,
                agents: team.agents.map((member) =>
                  member.id === agent.id ? draft : member,
                ),
              },
        );
      }}
    >
      <h3>Edit character &amp; profile</h3>
      <label>
        Name
        <input
          value={draft.name}
          maxLength={40}
          required
          onChange={(e) => change("name", e.target.value)}
        />
      </label>
      <AppearancePicker
        value={draft}
        onChange={(appearance) =>
          setDraft((current) => ({ ...current, ...appearance }))
        }
        disabled={busy}
      />
      {!normal && (
        <>
          <label>
            Accent
            <input
              type="color"
              value={draft.color}
              onChange={(event) => change("color", event.target.value)}
            />
          </label>
          <label>
            Role
            <select
              value={draft.role}
              disabled={agent.role === "lead"}
              onChange={(e) => change("role", e.target.value as Agent["role"])}
            >
              {["lead", "researcher", "builder", "reviewer"].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              value={draft.title}
              required
              onChange={(e) => change("title", e.target.value)}
            />
          </label>
          <label>
            Expertise · comma separated
            <input
              value={draft.expertise.join(", ")}
              onChange={(e) =>
                change(
                  "expertise",
                  e.target.value.split(",").map((x) => x.trim()),
                )
              }
            />
          </label>
        </>
      )}
      <label>
        Biography
        <textarea
          rows={3}
          value={draft.biography}
          onChange={(e) => change("biography", e.target.value)}
        />
      </label>
      {!normal && (
        <>
          <label>
            Personality
            <textarea
              rows={2}
              value={draft.personality}
              onChange={(e) => change("personality", e.target.value)}
            />
          </label>
          <CapabilityPicker
            agent={draft}
            catalog={catalog}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
          />
          <label>
            Preferred skills / one name or SKILL.md path per line
            <textarea
              rows={3}
              value={(draft.skills || []).join("\n")}
              onChange={(event) =>
                change(
                  "skills",
                  event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
            <small>
              Leave empty to select installed skills automatically for each
              task.
            </small>
          </label>
          <label>
            Working instructions
            <textarea
              rows={6}
              value={draft.instructions}
              onChange={(e) => change("instructions", e.target.value)}
            />
          </label>
          <label>
            Expected output
            <textarea
              rows={3}
              value={draft.expectedOutput}
              onChange={(e) => change("expectedOutput", e.target.value)}
            />
          </label>
          <label>
            Codex model
            <select
              value={draft.model}
              onChange={(e) => {
                change("model", e.target.value);
                change("reasoning", undefined);
              }}
            >
              <option value="">Auto · {preferredModel(draft)}</option>
              {draft.model && !models.some((m) => m.id === draft.model) && (
                <option value={draft.model}>{draft.model} · unavailable</option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning
            <select
              value={draft.reasoning || ""}
              onChange={(e) =>
                change(
                  "reasoning",
                  (e.target.value || undefined) as Agent["reasoning"],
                )
              }
            >
              <option value="">Auto</option>
              {(
                models.find(
                  (m) => m.id === (draft.model || preferredModel(draft)),
                )?.efforts || []
              ).map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label>
            Workspace access
            <select
              value={draft.access}
              onChange={(e) =>
                change("access", e.target.value as Agent["access"])
              }
            >
              <option value="read-only">Read only</option>
              <option value="workspace-write">Workspace write</option>
            </select>
          </label>
          <label>
            Preferred tools · comma separated
            <input
              value={draft.tools.join(", ")}
              onChange={(e) =>
                change(
                  "tools",
                  e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <p className="form-help">
            Tool preferences guide the agent. Available tools and enforced
            permissions come from local Codex configuration.
          </p>
          <label>
            Workstation
            <select
              value={draft.workstation}
              onChange={(e) => change("workstation", Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i)
                .filter(
                  (i) =>
                    i === agent.workstation ||
                    !team.agents.some((a) => a.workstation === i),
                )
                .map((i) => (
                  <option key={i} value={i}>
                    Station {i + 1}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={agent.role === "lead"}
              onChange={(e) => change("enabled", e.target.checked)}
            />
            Available for new tasks
          </label>
        </>
      )}
      <div className="button-row">
        <button className="primary" disabled={busy}>
          <Check size={14} />
          Save profile
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
