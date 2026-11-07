import type { CodexProject } from "./types";
export function projectContains(project: CodexProject, workspace: string) {
  const normalize = (path: string) => {
    const p = path.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
  };
  const folder = normalize(workspace);
  return project.roots.some((root) => {
    const r = normalize(root);
    return folder === r || folder.startsWith(r + "/");
  });
}
