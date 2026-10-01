/** Characters that make a spreadsheet read a cell as a formula when they start it. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Returns `value` as one CSV cell: quoted when it holds a comma, quote or line break (quotes doubled),
 * and text that starts like a formula prefixed with `'` so spreadsheets show it instead of running it.
 * `null` is an empty cell; numbers are written as they are.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Returns `values` as one CSV row, ending in `\r\n`. */
export function csvRow(values: (string | number | null)[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
