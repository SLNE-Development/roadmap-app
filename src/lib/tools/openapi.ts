import { z } from "zod";
import { inputSchema, type ToolDef } from "./registry";

/** A JSON schema fragment. */
export type JsonSchema = Record<string, unknown>;

/** One OpenAPI parameter. */
export interface OpenApiParameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

/** One OpenAPI operation. */
export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestBody?: { required: boolean; content: { "application/json": { schema: JsonSchema } } };
  responses: Record<string, { description: string; content?: { "application/json": { schema: JsonSchema } } }>;
}

/** The subset of OpenAPI 3.1 this app produces. */
export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, JsonSchema> };
}

/** Error responses every operation can return, with their descriptions. */
const ERROR_RESPONSES: Record<string, string> = {
  "400": "Invalid input",
  "401": "Missing or invalid API key",
  "403": "Role too low",
  "404": "Unknown or invisible",
  "409": "Planning gate or ADR immutability",
  "429": "Rate limited",
};

/** Returns the first path segment after `/projects/:project`, or the first segment. */
function tagOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const rest = parts[0] === "projects" && parts[1]?.startsWith(":") ? parts.slice(2) : parts;
  return rest[0]?.startsWith(":") ? (parts[0] ?? "api") : (rest[0] ?? parts[0] ?? "api");
}

/** Converts a tool's input to JSON schema properties; preprocess steps read as their inner schema. */
function inputJsonSchema(def: ToolDef): { properties: Record<string, JsonSchema>; required: string[] } {
  const json = z.toJSONSchema(inputSchema(def), { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return { properties: json.properties ?? {}, required: json.required ?? [] };
}

/** Splits the description off a property schema, since OpenAPI parameters carry it beside the schema. */
function splitDescription(schema: JsonSchema): { description?: string; schema: JsonSchema } {
  const { description, ...inner } = schema;
  return { ...(typeof description === "string" ? { description } : {}), schema: inner };
}

/** Builds the OpenAPI operation of one tool. */
function operationOf(def: ToolDef): OpenApiOperation {
  const { properties, required } = inputJsonSchema(def);
  const pathKeys = new Set(
    def.path
      .split("/")
      .filter((s) => s.startsWith(":"))
      .map((s) => s.slice(1)),
  );
  const parameters: OpenApiParameter[] = [...pathKeys].map((name) => ({
    name,
    in: "path",
    required: true,
    ...splitDescription(properties[name] ?? { type: "string" }),
  }));
  const rest = Object.entries(properties).filter(([name]) => !pathKeys.has(name));
  const operation: OpenApiOperation = {
    operationId: def.name,
    summary: def.name,
    description: def.description,
    tags: [tagOf(def.path)],
    parameters,
    responses: {
      "200": { description: "Result" },
      ...Object.fromEntries(
        Object.entries(ERROR_RESPONSES).map(([status, description]) => [
          status,
          { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ]),
      ),
    },
  };
  if (def.method === "GET" || def.method === "DELETE") {
    for (const [name, schema] of rest) {
      parameters.push({ name, in: "query", required: required.includes(name), ...splitDescription(schema) });
    }
  } else {
    const bodyRequired = required.filter((name) => !pathKeys.has(name));
    operation.requestBody = {
      required: bodyRequired.length > 0,
      content: {
        "application/json": {
          schema: { type: "object", properties: Object.fromEntries(rest), ...(bodyRequired.length ? { required: bodyRequired } : {}) },
        },
      },
    };
  }
  return operation;
}

/** Builds the OpenAPI 3.1 document of the REST API from the given tools; `serverUrl` is the `/api/v1` base. */
export function buildOpenApi(tools: readonly ToolDef[], serverUrl: string): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  for (const def of tools) {
    const path = def.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    (paths[path] ??= {})[def.method.toLowerCase()] = operationOf(def);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Roadmap API",
      version: "1.0.0",
      description: "REST API of the roadmap app, the same operations as the MCP tools. Authenticate with an API key as a bearer token.",
    },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: { Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] } },
    },
  };
}
