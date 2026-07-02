/**
 * Ordering-service HTTP client (fulfillment-surface S2-T1, SDD D2).
 *
 * Config from env — the SAME seam the dashboard uses (NFR-1):
 *   ORDERING_SERVICE_URL    base URL (required)
 *   ORDERING_SERVICE_TOKEN  Bearer for write verbs (advance, reprobe)
 *
 * REDACTION (NFR-1): the token value never appears in any output, error
 * message, or thrown error — pinned by the redaction test.
 */
import { EXIT, isErrorEnvelope, type ErrorEnvelope, type ExitCode } from "./ordering-schemas.js";

const REQUEST_TIMEOUT_MS = Number(process.env.ORDERING_REQUEST_TIMEOUT_MS ?? 35_000);

export interface OrderingConfig {
  baseUrl: string;
  token?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env):
  | { ok: true; config: OrderingConfig }
  | { ok: false; envelope: ErrorEnvelope; code: ExitCode } {
  const baseUrl = env.ORDERING_SERVICE_URL?.trim();
  if (!baseUrl) {
    return {
      ok: false,
      code: EXIT.USAGE,
      envelope: {
        error: "ORDERING_SERVICE_URL is not set",
        hint: "export ORDERING_SERVICE_URL=https://ordering-service-production.up.railway.app",
      },
    };
  }
  return { ok: true, config: { baseUrl: baseUrl.replace(/\/+$/, ""), token: env.ORDERING_SERVICE_TOKEN?.trim() || undefined } };
}

export type ApiResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; envelope: ErrorEnvelope; code: ExitCode };

/**
 * One request → classified result. Transport failures map to UNREACHABLE (exit 2);
 * HTTP failures carry the server's error envelope verbatim where present (FR-1:
 * e.g. unknown-preset 400 lists available_presets). Never throws with the token
 * in the message — errors are summarized, not interpolated from headers.
 */
export async function apiRequest(
  config: OrderingConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth) {
    if (!config.token) {
      return {
        ok: false,
        code: EXIT.USAGE,
        envelope: { error: "ORDERING_SERVICE_TOKEN is not set (required for write verbs)", hint: "export ORDERING_SERVICE_TOKEN=<token>" },
      };
    }
    headers.authorization = `Bearer ${config.token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const kind = err instanceof Error && err.name === "TimeoutError" ? "request timed out" : "service unreachable";
    // Redaction: never interpolate the raw error (it can echo request headers).
    return { ok: false, code: EXIT.UNREACHABLE, envelope: { error: `${kind}: ${method} ${path}` } };
  }

  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      code: EXIT.API_ERROR,
      envelope: { error: `non-JSON response (HTTP ${res.status}) from ${method} ${path}`, http_status: res.status },
    };
  }

  if (!res.ok) {
    const envelope: ErrorEnvelope = isErrorEnvelope(parsed)
      ? { ...parsed, http_status: res.status }
      : { error: `HTTP ${res.status} from ${method} ${path}`, http_status: res.status };
    return { ok: false, code: EXIT.API_ERROR, envelope };
  }

  return { ok: true, status: res.status, body: parsed };
}
