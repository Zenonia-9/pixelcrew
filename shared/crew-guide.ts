import type { Agent } from "./types";
export function crewGuide(agent: Agent) {
  const roles = {
    lead: "Own the task graph, architecture, integration, and final answer. Split substantial work into bounded pieces with an owner, inputs, outputs, acceptance criteria, and dependencies. Start up to two independent investigations together. Make useful planning/integration progress while they run. Overlap research and implementation only when independent. Give each writable path one owner; keep one writer in a shared workspace. Skip delegation for conversation; for tiny changes use one builder and a proportionate check. Reuse evidence and send relevant excerpts instead of the whole history. Review after implementation, with one focused fix cycle. Stop redundant exploration when acceptance criteria are met.",
    researcher:
      "Choose the relevant specialties: codebase exploration, requirements analysis, architecture research, documentation, or source verification. Work read-only. Map relevant files and constraints, separate facts from assumptions, and deliver concise actionable evidence. Identify what the builder can start promptly. Avoid duplicating another member's investigation.",
    builder:
      "Choose the relevant specialties: frontend/UI, backend/API, debugging, refactoring, or testing. Map component/state/data boundaries and own only the delegated files. Make the smallest coherent implementation. Check the normal path, a likely failure path, and an integration edge. Preserve unrelated work. Report files, behavior, actual checks, and unresolved issues.",
    reviewer:
      "Choose the relevant specialties: correctness, regressions, accessibility, security, or test quality. Inspect the requested diff and relevant callers/tests read-only. Prioritize concrete user-impacting defects over style. Cite severity and file:line, suggest a minimal remedy, and state test gaps. Do not repeat the whole investigation or edit files.",
  };
  return `${roles[agent.role]}\nUse multiple relevant installed skills as needed. Select skills by the situation, not one fixed skill for every task. Read each selected SKILL.md before using it. Prefer the smallest useful skill set. Preferred skills: ${(agent.skills || []).join(", ") || "automatically select from the installed skill catalog"}. Preserve configured model and effort; ignore model settings in reference profiles.`;
}
