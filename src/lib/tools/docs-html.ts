import type { OpenApiDocument, OpenApiOperation } from "./openapi";

/** One row of the parameter table. */
interface Row {
  name: string;
  where: string;
  schema: Record<string, unknown>;
  required: boolean;
  description?: string;
}

/** Escapes text for HTML content and double-quoted attributes. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Short type label of a JSON schema. */
function typeOf(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  if (type === "array") return `${typeOf((schema.items ?? {}) as Record<string, unknown>)}[]`;
  return String(type ?? "any");
}

/** Lists the parameters of an operation, with the request body properties as `body` rows. */
function rowsOf(op: OpenApiOperation): Row[] {
  const body = op.requestBody?.content["application/json"].schema as
    | { properties?: Record<string, Record<string, unknown>>; required?: string[] }
    | undefined;
  const fromParams = op.parameters.map((p) => ({ name: p.name, where: p.in, schema: p.schema, required: p.required, description: p.description }));
  const fromBody = Object.entries(body?.properties ?? {}).map(([name, schema]) => ({
    name,
    where: "body",
    schema,
    required: (body?.required ?? []).includes(name),
    description: typeof schema.description === "string" ? schema.description : undefined,
  }));
  return [...fromParams, ...fromBody];
}

const STYLE = `
:root{--bg:#fff;--fg:#14181c;--muted:#5b6670;--line:#d7dde2;--card:#f5f7f9;--accent:#0e7c86}
@media (prefers-color-scheme:dark){:root{--bg:#101417;--fg:#e6eaee;--muted:#98a3ad;--line:#2a3238;--card:#181e22;--accent:#4fc3cd}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.6rem;margin:0 0 .25rem}
h2{font-size:1.15rem;margin:2.5rem 0 .75rem;border-bottom:1px solid var(--line);padding-bottom:.25rem;text-transform:capitalize}
p{margin:.25rem 0}.muted{color:var(--muted)}
article{background:var(--card);border:1px solid var(--line);padding:.75rem 1rem;margin:.75rem 0}
article h3{font-size:1rem;margin:0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:baseline}
.method{font:600 .75rem ui-monospace,monospace;background:var(--accent);color:var(--bg);padding:.1rem .4rem}
code{font-family:ui-monospace,monospace;font-size:.9em;overflow-wrap:anywhere}
.table{overflow-x:auto}
table{border-collapse:collapse;width:100%;margin-top:.5rem;font-size:.9rem}
th,td{text-align:left;padding:.25rem .5rem;border-top:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
a{color:var(--accent)}
`;

/** Renders a self-contained HTML reference of the API, operations grouped by tag. Every text is escaped. */
export function renderDocsHtml(doc: OpenApiDocument): string {
  const groups = new Map<string, string[]>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const rows = rowsOf(op);
      const table = rows.length
        ? `<div class="table"><table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${rows
            .map(
              (r) =>
                `<tr><td><code>${esc(r.name)}</code></td><td>${esc(r.where)}</td><td>${esc(typeOf(r.schema))}</td><td>${r.required ? "yes" : "no"}</td><td>${esc(r.description)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : "";
      const html = `<article id="op-${esc(op.operationId)}"><h3><span class="method">${esc(method.toUpperCase())}</span><code>${esc(path)}</code><span class="muted">${esc(op.operationId)}</span></h3><p>${esc(op.description)}</p>${table}</article>`;
      const tag = op.tags[0] ?? "api";
      groups.set(tag, [...(groups.get(tag) ?? []), html]);
    }
  }
  const sections = [...groups].map(([tag, items]) => `<section><h2>${esc(tag)}</h2>${items.join("")}</section>`).join("");
  const server = doc.servers[0]?.url ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.info.title)}</title><style>${STYLE}</style></head>
<body><main><h1>${esc(doc.info.title)}</h1><p>${esc(doc.info.description)}</p><p class="muted">Base URL <code>${esc(server)}</code>. Machine-readable: <a href="${esc(server)}/openapi.json">openapi.json</a>.</p>${sections}</main></body></html>
`;
}
