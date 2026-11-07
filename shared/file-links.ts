import { isLocalFilesystemPath } from "./local-paths";
export interface LocalFileReference {
  path: string;
  line?: number;
}
// VS Code's documented file URL handler: https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls
export function editorFileUri(path: string, line?: number) {
  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/+(?=[a-z]:|[^/])/i, "");
  return `vscode://file/${encodeURI(normalized).replace(/#/g, "%23").replace(/\?/g, "%3F")}${line ? `:${line}:1` : ""}`;
}
export function localFileReference(
  url: string,
): LocalFileReference | undefined {
  let value = url;
  try {
    value = decodeURIComponent(value);
  } catch {}
  value = value.replace(/^\/([a-z]:[\\/])/i, "$1");
  if (
    !isLocalFilesystemPath(value) ||
    /[\r\n\0]/.test(value) ||
    (/^(?:[a-z][a-z\d+.-]*:)/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) ||
    value.startsWith("//") ||
    value.startsWith("/api/")
  )
    return;
  const location = /(?:#L?(\d+)(?:C\d+)?|:(\d+)(?::\d+)?)$/i.exec(value);
  const line = location ? Number(location[1] || location[2]) : undefined;
  if (location) value = value.slice(0, location.index);
  const absolute = /^(?:[a-z]:[\\/]|\/(?!\/))/i.test(value);
  const relative =
    /^(?:\.\.?[\\/])/.test(value) || /^[^?#:]+\.[a-z\d]{1,12}$/i.test(value);
  return value && (absolute || relative)
    ? { path: value, ...(line && Number.isSafeInteger(line) ? { line } : {}) }
    : undefined;
}
export function localFileReferences(markdown: string): LocalFileReference[] {
  const result: LocalFileReference[] = [];
  for (const match of markdown.matchAll(
    /(?<!!)\[[^\]]*\]\((?:<([^>\r\n]+)>|([^\s)]+))(?:\s+["'][^\r\n]*?["'])?\s*\)/g,
  )) {
    const file = localFileReference(match[1] || match[2]);
    if (file && !result.some((item) => item.path === file.path))
      result.push(file);
  }
  return result;
}
