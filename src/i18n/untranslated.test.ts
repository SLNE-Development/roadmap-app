import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PENDING_FILES } from "./untranslated-pending";

const ROOT = join(__dirname, "..", "..");

/** Literals that need no translation; one comment per entry. */
const ALLOWED_LITERALS = new Set<string>([
  "Roadmap", // the product name
  "GitHub", // a third-party product name
  "Discord", // a third-party product name
]);

/** The attributes whose string values are shown to users. */
const ATTRIBUTES = new Set(["placeholder", "aria-label", "title", "alt", "label"]);

/** Returns every `.tsx` file under `dir`, as a sorted list of `/`-separated paths relative to the repository root. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out.sort();
}

/** The files the guard covers. */
function scannedFiles(): string[] {
  return [...tsxFiles(join(ROOT, "src", "app")), ...tsxFiles(join(ROOT, "src", "components"))].filter(
    (f) => !f.startsWith("src/components/ui/") && !f.endsWith(".test.tsx") && f !== "src/app/opengraph-image.tsx",
  );
}

/** Returns true for text with no letter worth translating: symbols, glyphs, allowed literals. */
function isAllowed(text: string): boolean {
  const t = text.trim();
  return !/[A-Za-zÄÖÜäöü]/.test(t) || ALLOWED_LITERALS.has(t) || /^⌘[A-Za-z]$/.test(t); // ⌘ plus a key
}

/** Returns the string a literal-like node holds (`"x"`, `{"x"}`, a template without substitutions), or `null`. */
function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  return null;
}

/** Returns the untranslated literals of a source file: JSX text, listed attribute strings and toast messages. */
function offenders(source: string): string[] {
  const file = ts.createSourceFile("file.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const add = (text: string | null) => {
    if (text !== null && !isAllowed(text)) found.push(text.trim().replace(/\s+/g, " "));
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node.text);
    else if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(file))) add(literalText(node.initializer));
    else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === "toast"
    )
      add(literalText(node.arguments[0]));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("untranslated strings", () => {
  const pending = new Set(PENDING_FILES);
  const files = scannedFiles();

  it("flags text nodes and attribute literals", () => {
    expect(offenders("const a = <p>Hello there</p>;")).toEqual(["Hello there"]);
    expect(offenders('const a = <Input placeholder="Search" />;')).toEqual(["Search"]);
    expect(offenders('const a = <b>Roadmap</b>;\n// <p>comment</p>\nconst c = <i>{t("x")}</i>;')).toEqual([]);
    expect(offenders("const a = <kbd>⌘K</kbd>;")).toEqual([]);
  });

  it("flags text on its own line, text before an expression, {...} attributes and toasts", () => {
    expect(offenders("const a = (\n  <label>\n    Board name\n    <Input />\n  </label>\n);")).toEqual(["Board name"]);
    expect(offenders("const a = <p>Delete {name}?</p>;")).toEqual(["Delete"]);
    expect(offenders('const a = <Input aria-label={"Close"} />;')).toEqual(["Close"]);
    expect(offenders('toast.success("Board renamed");')).toEqual(["Board renamed"]);
  });

  it("keeps PENDING_FILES to existing, sorted files", () => {
    expect(PENDING_FILES.filter((f) => !files.includes(f))).toEqual([]);
    expect(PENDING_FILES).toEqual([...PENDING_FILES].sort());
  });

  it("finds no untranslated strings outside PENDING_FILES", () => {
    const bad = files
      .filter((f) => !pending.has(f))
      .map((f) => [f, offenders(readFileSync(join(ROOT, f), "utf8"))] as const)
      .filter(([, list]) => list.length > 0)
      .map(([f, list]) => `${f}: ${list.slice(0, 3).join(" | ")}`);
    expect(bad).toEqual([]);
  });

  it("lists no file in PENDING_FILES that is already clean", () => {
    const clean = PENDING_FILES.filter(
      (f) => files.includes(f) && offenders(readFileSync(join(ROOT, f), "utf8")).length === 0,
    ).map((f) => `remove ${f} from PENDING_FILES`);
    expect(clean).toEqual([]);
  });
});
