import { PENDING_ACCOUNT } from "./pending/account";
import { PENDING_BOARD } from "./pending/board";
import { PENDING_REPORTS } from "./pending/reports";
import { PENDING_SETTINGS } from "./pending/settings";
import { PENDING_SHELL } from "./pending/shell";
import { PENDING_SYSTEM } from "./pending/system";

/** Files under src/app and src/components not yet migrated to next-intl, one list per area in `pending/`; each area task empties its own file, Task 9.15 leaves all of them empty; the combined list is sorted for the guard test. */
export const PENDING_FILES: string[] = [
  ...PENDING_SHELL,
  ...PENDING_ACCOUNT,
  ...PENDING_BOARD,
  ...PENDING_SYSTEM,
  ...PENDING_REPORTS,
  ...PENDING_SETTINGS,
].sort();
