import type { RunOptions } from "./types";
export interface ComposerDraft { text: string; criteria: string; references: string; goalTokenBudget?: number; attachments: (RunOptions["attachments"][number] & { preview?: string })[]; mentions: RunOptions["mentions"]; deviceTools?: RunOptions["deviceTools"]; deviceSessionId?: string }
const prefix = "pixelcrew-draft:";
export const draftKey = (team?: string, chat?: string, project?: string) => `${team || "default"}:${chat ? `chat:${chat}` : `project:${project || "local"}`}`;
export function readDraft(key: string): ComposerDraft | undefined {
  try { const value = JSON.parse(localStorage.getItem(prefix + key) || "null"); return value && typeof value.text === "string" && Array.isArray(value.attachments) && Array.isArray(value.mentions) ? value : undefined; } catch { return undefined; }
}
export function writeDraft(key: string, draft: ComposerDraft) {
  try { if (!draft.text && !draft.attachments.length && !draft.mentions.length && !draft.criteria && !draft.references && !draft.goalTokenBudget && !draft.deviceSessionId) localStorage.removeItem(prefix + key); else localStorage.setItem(prefix + key, JSON.stringify(draft)); } catch {
    // Keep the text and file references if inline image previews exceed storage.
    try { localStorage.setItem(prefix + key, JSON.stringify({ ...draft, attachments: draft.attachments.map(({ preview: _preview, ...attachment }) => attachment) })); } catch { /* A browser with storage disabled still retains the current editor. */ }
  }
}
