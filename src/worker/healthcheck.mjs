import { statSync } from "node:fs";

// Exits 0 when the worker's heartbeat file was touched within the last 30 s.
try {
  process.exit(Date.now() - statSync("/tmp/worker-alive").mtimeMs < 30_000 ? 0 : 1);
} catch {
  process.exit(1);
}
