import { greetingV1 } from "./greeting";
import { helpV1 } from "./help";
import { summaryNarrationV1, summaryTriageV1 } from "./summary";
import { talkV1 } from "./talk";
import { teachV1 } from "./teach";

export * from "./types";
export * from "./summary";
export * from "./talk";
export * from "./help";
export * from "./teach";
export * from "./greeting";

/** The versions the server actually uses. Change a pointer here to roll a prompt forward or back. */
export const activePrompts = {
  summaryTriage: summaryTriageV1,
  summaryNarration: summaryNarrationV1,
  talk: talkV1,
  help: helpV1,
  teach: teachV1,
  greeting: greetingV1
} as const;
