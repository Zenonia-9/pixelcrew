const CHAT_READ_KEY = "pixelcrew-read-completed-chats";
const BOARD_READ_KEY = "pixelcrew-read-board-pins";

function readSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function getReadCompletedChats() {
  return readSet(CHAT_READ_KEY);
}

export function markCompletedChatRead(id: string) {
  const ids = readSet(CHAT_READ_KEY);
  ids.add(id);
  writeSet(CHAT_READ_KEY, ids);
  return ids;
}

export function getReadBoardPins() {
  return readSet(BOARD_READ_KEY);
}

export function markBoardPinsRead(idsToMark: string[]) {
  const ids = readSet(BOARD_READ_KEY);
  idsToMark.forEach(id => ids.add(id));
  writeSet(BOARD_READ_KEY, ids);
  return ids;
}
