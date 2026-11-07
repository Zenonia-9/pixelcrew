import type { Agent } from "./types";

export const defaultSpecialties: Record<Agent["role"], string[]> = {
  lead: ["multi-agent-coordinator", "task-distributor", "knowledge-synthesizer"],
  researcher: ["research-analyst", "docs-researcher"],
  builder: ["fullstack-developer", "frontend-developer", "debugger"],
  reviewer: ["code-reviewer", "test-automator", "security-auditor"],
};
export const defaultSkills: Record<Agent["role"], string[]> = {
  lead: ["crew-planning"],
  researcher: ["crew-research"],
  builder: ["crew-frontend", "crew-backend", "crew-debugging", "crew-testing"],
  reviewer: ["crew-review", "crew-testing", "crew-security"],
};
