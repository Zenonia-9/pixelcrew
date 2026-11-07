export function completionAt(text: string, caret: number) {
  const match = /(?:^|\s)([@/$])([^\s@$]*)$/.exec(text.slice(0, caret));
  return match
    ? {
        kind: match[1],
        query: match[2].toLowerCase(),
        start: caret - match[2].length - 1,
        end: caret,
      }
    : undefined;
}
