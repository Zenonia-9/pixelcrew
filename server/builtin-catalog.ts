import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Agent } from "../shared/types";
import { defaultSpecialties, defaultSkills } from "../shared/default-capabilities";
export { defaultSpecialties } from "../shared/default-capabilities";
const resource = (path: string) =>
  fileURLToPath(new URL(`../resources/${path}`, import.meta.url));
const bundled = JSON.parse(readFileSync(resource("catalog.json"), "utf8")) as {
  agents: {
    id: string;
    name: string;
    description: string;
    category: string;
    instructions: string;
    source: string;
  }[];
  skills: {
    id: string;
    name: string;
    description: string;
    file: string;
    source: string;
  }[];
};
export const builtinSkills = bundled.skills.map((skill) => ({
  ...skill,
  path: resource(skill.file),
  type: "skill" as const,
  source: skill.id === "create-team" ? "Built in · PixelCrew" : "Built in · VoltAgent",
}));
export const builtinCatalog = {
  agents: bundled.agents.map(({ instructions, ...metadata }) => metadata),
  skills: builtinSkills.map(({ path, file, ...metadata }) => metadata),
  attribution: {
    name: "VoltAgent",
    url: "https://github.com/VoltAgent/awesome-codex-subagents",
    license: "MIT",
  },
};
export function bundledGuidance(agent: Agent) {
  const profiles = (
    agent.specialties?.length
      ? agent.specialties
      : defaultSpecialties[agent.role]
  )
    .map((id) => bundled.agents.find((profile) => profile.id === id))
    .filter((profile) => !!profile);
  return `Built-in role specialties (adapted from VoltAgent, MIT):\n${profiles.map((profile) => `${profile.name}: ${profile.description}\n${agent.specialties?.length ? profile.instructions : `Reference: ${resource(`agents/${profile.id}.toml`)}`}`).join("\n\n")}\nSelect only the specialties relevant to the current task. Multiple selections are available capabilities, not a requirement to use every profile or spawn every specialist. Read the matching profile reference only when needed. Apply these only within your assigned role and task permissions. Never adopt external model, effort, or sandbox settings.\nAvailable bundled skills (read the matching SKILL.md only when relevant):\n${builtinSkills
    .filter(
      (skill) =>
        skill.id === "create-team" ||
        (!agent.skills?.length && defaultSkills[agent.role].includes(skill.id)) ||
        agent.skills?.includes(skill.id) ||
        agent.skills?.includes(skill.path),
    )
    .map((skill) => `${skill.name}: ${skill.path} — ${skill.description}`)
    .join("\n")}`;
}
