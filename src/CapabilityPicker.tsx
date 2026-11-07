import { useState } from "react";
import type { Agent, Snapshot } from "../shared/types";

export function CapabilityPicker({
  agent,
  catalog,
  onChange,
}: {
  agent: Agent;
  catalog?: Snapshot["catalog"];
  onChange: (patch: Partial<Agent>) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = (item: { name: string; description: string }) =>
    `${item.name} ${item.description}`
      .toLowerCase()
      .includes(search.toLowerCase());
  return (
    <details className="builtin-picker">
      <summary>Agent specialties & skills</summary>
      <p>
        Select the capabilities this character can use when the work calls for
        them. Empty selections use automatic role defaults.
      </p>
      <input
        aria-label="Find agent specialties and skills"
        placeholder="Find a capability…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <fieldset className="capability-options">
        <legend>Agent specialties · up to eight</legend>
        {catalog?.agents.filter(matches).map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={agent.specialties?.includes(item.id) || false}
              disabled={
                !agent.specialties?.includes(item.id) &&
                (agent.specialties?.length || 0) >= 8
              }
              onChange={(event) =>
                onChange({
                  specialties: event.target.checked
                    ? [...(agent.specialties || []), item.id]
                    : agent.specialties?.filter((id) => id !== item.id),
                })
              }
            />
            <span>
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="capability-options">
        <legend>Skills</legend>
        {catalog?.skills.filter(matches).map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={agent.skills?.includes(item.id) || false}
              onChange={(event) =>
                onChange({
                  skills: event.target.checked
                    ? [...(agent.skills || []), item.id]
                    : agent.skills?.filter((id) => id !== item.id),
                })
              }
            />
            <span>
              <strong>{item.name}</strong>
              <small>{item.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
