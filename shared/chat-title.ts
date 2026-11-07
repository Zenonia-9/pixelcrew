const titleCase = (value: string) => value
  .replace(/[_-]+/g, " ")
  .replace(/\b(pixelcrew)\b/gi, "PixelCrew")
  .replace(/\b(tha|odoo|vhg|omuk|api|ui|3d|codex)\b/gi, (word) => word.toUpperCase())
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace(/\bPixelcrew\b/g, "PixelCrew");

const filenameTitle = (value: string) => {
  const filename = value.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "";
  return titleCase(filename.replace(/\.[^.]+$/, ""));
};

/** Compact descriptive titles for PixelCrew chats, independent of agent/stage names. */
export function chatTitle(prompt: string): string {
  const text = prompt.trim();
  const source = text.match(/^Source:\s*(.+)$/im)?.[1]?.trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sourceStem = source ? filenameTitle(source) : "";
  const body = lines.filter((line) => !/^Source:\s*/i.test(line));
  const request = body.find((line) => !/^ask anything you need\.?$/i.test(line)) || "";
  const lower = text.toLowerCase();

  if (/pixelcrew/.test(lower) && /(?:showing|marked|returning|says?).{0,30}failed|failed.{0,30}(?:chat|message)/.test(lower))
    return "Fix PixelCrew chat failures";
  if (/pixelcrew/.test(lower) && /one chat for one message|one chat per message/.test(lower))
    return "Keep PixelCrew messages in one chat";
  if (/chat naming|name of (?:a )?new chat|new chat.*(?:name|naming)/.test(lower))
    return "Improve new chat titles";
  if (sourceStem && /\bfix this issue log\b|\bupdate this issue log\b/i.test(request))
    return `Update ${sourceStem}`.slice(0, 72);

  if (!request && sourceStem) return sourceStem.slice(0, 72);
  const firstSentence = request.split(/(?<=[.!?])\s+/)[0] || request;
  let candidate = firstSentence
    .replace(/^(?:please\s+)?(?:could you|can you|would you)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+(?:it is|it's|now|actually),?\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sourceStem && /\b(issue log|this issue)\b/i.test(candidate))
    candidate = candidate.replace(/this issue log/ig, sourceStem).replace(/this issue/ig, sourceStem);
  if (/^(?:what can you do|hello|test chat|reply ok only)\b/i.test(candidate))
    candidate = "Test PixelCrew chat";
  candidate = titleCase(candidate);
  return candidate.length > 72 ? `${candidate.slice(0, 69).trimEnd()}…` : candidate || "New Codex chat";
}
