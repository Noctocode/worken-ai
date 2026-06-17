import type { TranslationKey } from "../en";
import { common } from "./common";
import { auth } from "./auth";
import { onboarding } from "./onboarding";
import { management } from "./management";
import { knowledge } from "./knowledge";
import { teams } from "./teams";
import { users } from "./users";
import { tenders } from "./tenders";
import { projects } from "./projects";
import { arena } from "./arena";
import { prompts } from "./prompts";
import { shortcuts } from "./shortcuts";
import { learnAcademy } from "./learnAcademy";
import { resources } from "./resources";
import { docs } from "./docs";
import { drive } from "./drive";
import { sharepoint } from "./sharepoint";
import { onedrive } from "./onedrive";
import { msConnect } from "./msConnect";
import { confluence } from "./confluence";
import { observability } from "./observability";
import { notifications } from "./notifications";
import { guardrails } from "./guardrails";
import { chat } from "./chat";
import { dialogs } from "./dialogs";

export const sl: Record<TranslationKey, string> = {
  ...common,
  ...auth,
  ...onboarding,
  ...management,
  ...knowledge,
  ...teams,
  ...users,
  ...tenders,
  ...projects,
  ...arena,
  ...prompts,
  ...shortcuts,
  ...learnAcademy,
  ...resources,
  ...docs,
  ...drive,
  ...sharepoint,
  ...onedrive,
  ...msConnect,
  ...confluence,
  ...observability,
  ...notifications,
  ...guardrails,
  ...chat,
  ...dialogs,
};
