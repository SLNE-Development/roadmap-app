import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderDocsHtml } from "./docs-html";
import "./definitions";
import { buildOpenApi, type OpenApiDocument } from "./openapi";
import { defineTool, registeredTools } from "./registry";

const doc = buildOpenApi(registeredTools(), "http://test/api/v1");

/** Collects every `$ref` in a value. */
function refs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => refs(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

/** Resolves a local `$ref` pointer against the document. */
function resolve(d: OpenApiDocument, ref: string): unknown {
  return ref
    .replace(/^#\//, "")
    .split("/")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], d);
}

describe("buildOpenApi", () => {
  it("lists every registered tool exactly once by operationId", () => {
    const ids = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId));
    expect([...ids].sort()).toEqual(registeredTools().map((t) => t.name).sort());
  });

  it("describes get_system with path parameters and a boolean brief query parameter", () => {
    const op = doc.paths["/projects/{project}/systems/{system}"].get;
    expect(op.operationId).toBe("get_system");
    expect(op.parameters.filter((p) => p.in === "path").map((p) => [p.name, p.required])).toEqual([
      ["project", true],
      ["system", true],
    ]);
    expect(op.parameters.find((p) => p.name === "brief")).toMatchObject({ in: "query", schema: { type: "boolean" } });
  });

  it("gives add_tasks a body with required tasks and no path properties", () => {
    const op = doc.paths["/projects/{project}/systems/{system}/tasks"].post;
    const schema = op.requestBody?.content["application/json"].schema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain("tasks");
    expect(schema.properties).not.toHaveProperty("project");
    expect(schema.properties).not.toHaveProperty("system");
  });

  it("is structurally valid with resolvable refs", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.bearer).toEqual({ type: "http", scheme: "bearer" });
    for (const ref of refs(doc)) expect(resolve(doc, ref), ref).toBeDefined();
  });

  it("maps a preprocess integer to an integer schema without throwing", () => {
    const tool = defineTool({
      name: "probe",
      description: "Probe.",
      input: { n: z.preprocess((v) => v, z.number().int().min(1)) },
      write: false,
      method: "GET",
      path: "/probe",
      run: async () => null,
    });
    const probe = buildOpenApi([tool], "http://test").paths["/probe"].get;
    expect(probe.parameters[0].schema).toMatchObject({ type: "integer", minimum: 1 });
  });
});

describe("renderDocsHtml", () => {
  it("anchors each operation and escapes descriptions", () => {
    expect(renderDocsHtml(doc)).toContain('id="op-get_system"');
    const evil = structuredClone(doc);
    evil.paths["/projects/{project}/systems/{system}"].get.description = "<script>alert(1)</script>";
    const html = renderDocsHtml(evil);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
