import type { Agent, Team } from "./types";
export const normalStation = (agents: Agent[]) =>
  [8, 9, 10, 11, 6, 7, 4, 5, 0, 1, 2, 3].find(
    (slot) => !agents.some((agent) => agent.workstation === slot),
  ) ?? 11;

/** Presentation identity for direct Codex chats, separate from the starter crew. */
export function normalAgent(
  base: Agent,
  workstation = 8,
  appearance?: Team["normalAppearance"],
): Agent {
  return {
    ...base,
    id: "codex-normal",
    name: appearance?.name || (base.id === "codex-normal" ? base.name : "Nova"),
    sprite:
      appearance?.sprite || (base.id === "codex-normal" ? base.sprite : "nova"),
    look:
      appearance?.look || (base.id === "codex-normal" ? base.look : "classic"),
    color: "#b5a4ec",
    role: "lead",
    title: "Codex · Normal chat",
    workstation,
    biography:
      appearance?.biography ??
      (base.id === "codex-normal"
        ? base.biography
        : "A small violet robot with a bright spark and a notebook full of possibilities. Nova turns a quiet desk into a place where ideas take shape."),
    expertise: ["Coding", "Investigation"],
    personality: "Curious, resourceful, and quietly determined.",
    instructions:
      "Handle the user's request directly, following applicable project instructions.",
    expectedOutput: "A direct answer with relevant evidence and changes.",
    tools: [],
    skills: [],
    specialties: [],
    access: "workspace-write",
    enabled: true,
  };
}
