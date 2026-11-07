---
name: create-team
description: Create a purpose-built team in the local PixelCrew app with distinct specialists, relevant built-in skills, and automatic model selection.
---

# Create a PixelCrew team

Use the running app API at http://127.0.0.1:4318 rather than changing shipped presets or writing SQLite directly. A successful team must be visible in the running app without a service restart.

Read GET /api/state for existing teams and its catalog field for available specialties and skills. Inspect shared/types.ts for the Team schema and shared/security-team.ts for a specialist profile example. Use the user's purpose to choose distinct specialist names, responsibilities, instructions and appearances. Include one enabled lead, plus researcher, builder and reviewer unless the requested team needs a different composition. IDs and workstations must be unique within the team. Use model "" and omit reasoning for Auto unless the user specifies otherwise. Prefer existing catalog IDs for specialties and skills. Preserve role access: investigation and review read-only, implementation workspace-write.

Normal Codex is the same shared Nova character across all teams. Do not add codex-normal to agents, invent a replacement Normal persona, or set normalAppearance while creating a team.

POST /api/teams with Content-Type application/json and body {"name":"<team name>","team":<complete Team object>}. The API validates, persists and activates the team. If the intended team already exists, inspect it before creating a duplicate; do not overwrite unrelated teams. If the API is unavailable, report the blocker instead of silently changing source presets. If a request times out, reread state before retrying to avoid duplicate creation.

Verify GET /api/state lists the new team and its intended members. Report the team name and where to select it. Do not start tasks, send model prompts or claim execution checks merely to verify team creation.
