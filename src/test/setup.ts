import { afterEach, beforeEach } from "vitest";
import { beginTestDbScope, endTestDbScope } from "./db";

// Registered before every test file's own hooks, so this afterEach runs after theirs: the file's cleanup can still
// use its database before the clone is closed. Without closing, a worker keeps every clone of its file in memory.
beforeEach(beginTestDbScope);
afterEach(endTestDbScope);
