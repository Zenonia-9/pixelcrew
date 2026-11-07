import { createContext } from "react";
import type { ChatPermissions } from "../shared/chat-permissions";
export const ChatPermissionsContext = createContext<
  { settings?: ChatPermissions; loaded: boolean; active: boolean } | undefined
>(undefined);
