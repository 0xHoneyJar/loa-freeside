import type { Context } from "hono";
import type { PublicAuthorizationService } from "./public-authorization-service.js";

export function requireServiceBearer(c: Context, token: string | undefined): boolean {
  if (!token) return true;
  return c.req.header("authorization") === `Bearer ${token}`;
}

export function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

export interface AuthorizedBody {
  authorization_scope: unknown;
  [key: string]: unknown;
}

export async function readAuthorizedBody(
  c: Context,
): Promise<{ ok: true; body: AuthorizedBody } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json(
        { schema_version: 1, code: "invalid_request" },
        400,
        noStoreHeaders(),
      ),
    };
  }
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      response: c.json(
        { schema_version: 1, code: "invalid_request" },
        400,
        noStoreHeaders(),
      ),
    };
  }
  const body = raw as AuthorizedBody;
  if (body.authorization_scope === undefined) {
    return {
      ok: false,
      response: c.json(
        { schema_version: 1, code: "invalid_request" },
        400,
        noStoreHeaders(),
      ),
    };
  }
  return { ok: true, body };
}

export function authorizeOrRespond(
  auth: PublicAuthorizationService,
  run: () => void,
): Response | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    const mapped = auth.mapDenial(err);
    return new Response(JSON.stringify(mapped.body), {
      status: mapped.status,
      headers: { "Content-Type": "application/json", ...noStoreHeaders() },
    });
  }
}
