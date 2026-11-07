/** Reject UNC and Windows device paths before any filesystem access.
 * Normalize separators and URL escapes because Markdown and browser URLs can
 * disguise a network path with mixed slash styles. This performs no I/O.
 */
export function isLocalFilesystemPath(path: string) {
  let decoded = path;
  try { decoded = decodeURIComponent(decoded); } catch { /* Literal percent signs are valid local names. */ }
  const normalized = decoded.trimStart().replaceAll("\\", "/");
  return !/[\0\r\n]/.test(decoded) &&
    !normalized.startsWith("//") && !normalized.startsWith("/??/");
}

export function requireLocalFilesystemPath(path: string) {
  if (!isLocalFilesystemPath(path))
    throw Error("Network and device filesystem paths are not supported.");
  return path;
}
