/** Returns an ADR number zero-padded to four digits. */
export function formatAdrNumber(n: number): string {
  return String(n).padStart(4, "0");
}
