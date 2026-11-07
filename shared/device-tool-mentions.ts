export type DeviceToolMention = "browser" | "chrome" | "computer";

const mentionPattern = /(?:^|\s)@(browser|chrome|computer)\b/gi;

export function deviceToolMentions(text: string): DeviceToolMention[] {
  const found = new Set<DeviceToolMention>();
  for (const match of text.matchAll(mentionPattern))
    found.add(match[1].toLowerCase() as DeviceToolMention);
  return [...found];
}

export function deviceToolMentionText(tools: readonly DeviceToolMention[]) {
  return tools.map(tool => `@${tool}`).join(" ");
}

export function insertDeviceToolMention(
  text: string,
  tool: DeviceToolMention,
  start = text.length,
  end = start,
) {
  if (deviceToolMentions(text).includes(tool)) return text;
  const before = text.slice(0, start);
  const after = text.slice(end);
  const leftSpace = before && !/\s$/.test(before) ? " " : "";
  const rightSpace = after && !/^\s/.test(after) ? " " : "";
  return `${before}${leftSpace}@${tool}${rightSpace}${after}`;
}

export function removeDeviceToolMention(text: string, tool: DeviceToolMention) {
  return text
    .replace(new RegExp(`(^|\\s)@${tool}\\b`, "gi"), (_match, prefix: string) => prefix)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n");
}
