import { shortNote } from "./chat-presentation";
export function officeActivity(text: string) {
  if (/^commandExecution:/i.test(text)) {
    if (
      /npm\S*\s+(?:run\s+)?(?:test|build)|pytest|--test|py_compile/i.test(text)
    )
      return "Running checks";
    if (/Get-Content|\brg\b|\bcat\b|read_file/i.test(text))
      return "Reading project files";
    if (/Set-Content|apply_patch|write_file/i.test(text))
      return "Updating project files";
    return "Running a command";
  }
  if (/^webSearch:/i.test(text)) return "Searching the web";
  if (/^fileChange:/i.test(text)) return "Editing files";
  if (/^(?:mcpToolCall|dynamicToolCall):/i.test(text)) return "Using a tool";
  return shortNote(
    text.replace(/^(?:Atlas|Pip|Bolt|Mira)\s*[:·—-]\s*/i, ""),
    64,
  );
}
