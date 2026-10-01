import { siteUrl } from "@/lib/site";
import { renderDocsHtml } from "@/lib/tools/docs-html";
import { buildOpenApi } from "@/lib/tools/openapi";
import "@/lib/tools/definitions";
import { registeredTools } from "@/lib/tools/registry";

/** Serves the API reference page; it holds no secrets, so it needs no key. */
export function GET(): Response {
  const html = renderDocsHtml(buildOpenApi(registeredTools(), `${siteUrl().origin}/api/v1`));
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
