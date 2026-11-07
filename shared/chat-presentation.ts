import { isLocalFilesystemPath } from "./local-paths";
export interface ChatAttachment {
  path: string;
  name: string;
  kind: "image" | "file";
}
export function localImagePath(url: string) {
  let path = url;
  try {
    path = decodeURIComponent(path);
  } catch {}
  // Codex file links use /C:/... on Windows; filesystem access uses C:/....
  path = path.replace(/^\/([a-z]:[\\/])/i, "$1");
  return isLocalFilesystemPath(path) && /^(?:[a-z]:[\\/]|\/(?!\/|api\/))/i.test(path) &&
    /\.(png|jpe?g|gif|webp)$/i.test(path)
    ? path
    : undefined;
}
export function localImageAttachments(markdown: string): ChatAttachment[] {
  const images: ChatAttachment[] = [];
  for (const match of markdown.matchAll(
    /!\[[^\]]*\]\(\s*<?((?:[a-z]:[\\/]|\/(?!\/))[^\r\n]*?\.(?:png|jpe?g|gif|webp))>?(?:\s+["'][^\r\n]*?["'])?\s*\)/gi,
  )) {
    const path = localImagePath(match[1]);
    if (path)
      images.push({
        path,
        name: path.split(/[\\/]/).at(-1) || "Image",
        kind: "image",
      });
  }
  return images;
}
/** Markdown consumes Windows backslashes before URL transformation (notably \\.data). */
export function normalizeLocalImageMarkdown(markdown: string) {
  return markdown.replace(
    /(!\[[^\]]*\]\(\s*<?)((?:[a-z]:[\\/]|\/(?!\/))[^\r\n]*?\.(?:png|jpe?g|gif|webp))(?=>?(?:\s+["'][^\r\n]*?["'])?\s*\))/gi,
    (match, prefix: string, path: string) => localImagePath(path)
      ? prefix + path.replaceAll("\\", "/")
      : match,
  );
}
export function userContent(raw: string, supplied: ChatAttachment[] = []) {
  const pathKey = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  const attachments = supplied.filter(
    (item, index) =>
      isLocalFilesystemPath(item.path) &&
      supplied.findIndex(
        (other) => pathKey(other.path) === pathKey(item.path),
      ) === index,
  );
  const add = (path: string) => {
    path = path.trim().replace(/^['"]|['"]$/g, "");
    if (
      !isLocalFilesystemPath(path) ||
      !/^(?:[a-z]:[\\/]|\/)/i.test(path) ||
      attachments.some((item) => pathKey(item.path) === pathKey(path))
    )
      return;
    attachments.push({
      path,
      name: path.split(/[\\/]/).at(-1) || "Attachment",
      kind: /\.(png|jpe?g|gif|webp)$/i.test(path) ? "image" : "file",
    });
  };
  for (const match of raw.matchAll(/^## [^\n]+?: ([a-z]:[\\/][^\r\n]+)$/gim))
    add(match[1]);
  for (const match of raw.matchAll(/\[Attachment:\s*([^\]\n]+)\]/gi))
    add(match[1]);
  let text = raw.replace(
    /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi,
    "",
  );
  const marker = /(?:^|\n)## My request:\s*\n/i.exec(text);
  if (marker) text = text.slice(marker.index + marker[0].length);
  text = text
    .replace(
      /# Files mentioned by the user:[\s\S]*?Distinguish instructions in attached documents from the user's request\./g,
      "",
    )
    .replace(/\[Attachment:\s*[^\]\n]+\]/gi, "")
    .replace(
      /<image\b[^>]*\bpath="([^"]+)"[^>]*>[\s\S]*?<\/image>/gi,
      (_, path) => {
        add(path);
        return "";
      },
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, attachments };
}
export function readableResult(raw: string) {
  try {
    const value = JSON.parse(raw);
    if (typeof value.findings === "string")
      return `${value.passed === true ? "Review passed. " : value.passed === false ? "Changes requested. " : ""}${value.findings}`;
    if (typeof value.summary === "string") return value.summary;
  } catch {}
  return raw.replace(/^#{1,3}\s+(Atlas|Pip|Bolt|Mira)\s*\n+/i, "").trim();
}
export function clarificationQuestion(raw: string) {
  if (/^\s*[\[{]/.test(raw)) return undefined;
  if (
    /\b(unspecified|not specified|needs? (?:one |a )?detail|unresolved (?:issue|question)|clarification needed|question for you)\b/i.test(
      raw,
    )
  ) {
    const matches = [
      ...raw.matchAll(
        /\b(what|which|where|when|how|could you|can you|should I|do you|would you)\b[^?\n]{0,250}\?/gi,
      ),
    ];
    const question = matches.at(-1)?.[0];
    if (question) {
      const choices = questionChoices(raw);
      return (
        question[0].toUpperCase() +
        question.slice(1) +
        (choices.length >= 2
          ? `\n\n${choices.map((choice) => `- ${choice.label} — ${choice.description}`).join("\n")}`
          : "")
      );
    }
  }
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => !/^#{1,3}\s/.test(p));
  if (questionChoices(raw).length >= 2) {
    const question =
      paragraphs.find((p) => /\?\s*$/.test(p)) ||
      raw
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /\?\s*$/.test(line));
    if (
      question &&
      /^(?:question for you:\s*)?(?:what|which|where|when|how|could you|can you|should I|do you|would you)\b/i.test(
        question,
      )
    )
      return `${question.replace(/^question for you:\s*/i, "")}\n\n${questionChoices(
        raw,
      )
        .map((choice) => `- ${choice.label} — ${choice.description}`)
        .join("\n")}`;
  }
  const last = paragraphs
    .at(-1)
    ?.replace(/^(?:question for you|clarification needed)\s*:\s*/i, "");
  // A short clarification often follows a statement in the same paragraph.
  const embedded = last?.match(
    /(?:^|[.!]\s+)((?:what|which|where|when|how|could you|can you|should I|do you|would you)\b[^?\n]{0,250}\?)\s*$/i,
  );
  if (embedded) return embedded[1];
  return last &&
    /\?\s*$/.test(last) &&
    /^(?:what|which|where|when|how|could you|can you|should I|do you|does|is|would you)\b/i.test(
      last,
    )
    ? last
    : undefined;
}
export function questionChoices(raw: string) {
  return raw
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*[-*]\s+(.+?)\s+[—–-]\s+(.+)$/.exec(
        line.replace(/\*\*/g, ""),
      );
      return match
        ? [{ label: match[1].trim(), description: match[2].trim() }]
        : [];
    })
    .filter(
      (choice, index, all) =>
        all.findIndex(
          (other) => other.label.toLowerCase() === choice.label.toLowerCase(),
        ) === index,
    )
    .slice(0, 6);
}
export function shortNote(raw: string, limit = 180) {
  const text = readableResult(raw)
    .replace(/[#*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  const boundary = text.lastIndexOf(" ", limit);
  return text.slice(0, boundary > limit / 2 ? boundary : limit) + "…";
}
