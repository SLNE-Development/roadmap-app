import { getAuth } from "@/lib/auth/server";

/** Better Auth GET endpoints (session, OAuth callback). */
export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

/** Better Auth POST endpoints (sign-in, sign-out, API keys). */
export async function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
