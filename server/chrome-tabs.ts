export interface ChromeTab { elementIndex: number; description: string }

/** Only native tab-strip entries, before Chrome's page document subtree. */
export function chromeTabs(tree: string): ChromeTab[] {
  const tabs: ChromeTab[] = [];
  for (const line of tree.split(/\r?\n/)) {
    if (/^\s*\d+\s+(?:document|webarea|web area)\b/i.test(line)) break;
    const tab = /^\s*(\d+)\s+(?:tab item|tab)(?!\s+(?:list|strip)\b)\s+(.+)$/i.exec(line);
    if (tab) tabs.push({ elementIndex: Number(tab[1]), description: tab[2].trim() });
  }
  return tabs;
}
