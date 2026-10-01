import { siteUrl } from "@/lib/site";
import { buildOpenApi } from "@/lib/tools/openapi";
import "@/lib/tools/definitions";
import { registeredTools } from "@/lib/tools/registry";

/** Serves the OpenAPI document of the REST API; it holds no secrets, so it needs no key. */
export function GET(): Response {
  return Response.json(buildOpenApi(registeredTools(), `${siteUrl().origin}/api/v1`), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
