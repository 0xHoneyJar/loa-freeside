/**
 * HTTP client for Sonar Kitchen `POST /v1/collections/resolve-probe`.
 * Service-token only — never browser-reachable credentials.
 */

import type { CapabilityRegistryVersion, CollectionCandidate } from "@freeside/collection-protocol";
import type { CandidateSnapshot } from "@freeside/collection-resolution-protocol";
import type { SonarResolveProbePort } from "./resolution-service.js";

export interface SonarResolveProbeClientOptions {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class SonarResolveProbeUnavailableError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SonarResolveProbeUnavailableError";
    this.status = status;
  }
}

export function createHttpSonarResolveProbePort(
  options: SonarResolveProbeClientOptions,
): SonarResolveProbePort {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  return {
    async resolveProbe(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${base}/v1/collections/resolve-probe`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${options.serviceToken}`,
          },
          body: JSON.stringify({
            schema_version: 1,
            identifier: input.identifier,
            environment: input.environment,
            report_type: input.report_type,
            report_version: input.report_version,
          }),
          signal: controller.signal,
        });

        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new SonarResolveProbeUnavailableError(res.status, "sonar probe returned non-JSON");
        }

        if (res.status === 503) {
          throw new SonarResolveProbeUnavailableError(503, "sonar probe unavailable");
        }
        if (!res.ok) {
          throw new SonarResolveProbeUnavailableError(
            res.status,
            `sonar probe HTTP ${res.status}`,
          );
        }

        if (!json || typeof json !== "object") {
          throw new SonarResolveProbeUnavailableError(502, "sonar probe body invalid");
        }
        const body = json as Record<string, unknown>;
        if (body.schema_version !== 1) {
          throw new SonarResolveProbeUnavailableError(502, "sonar probe schema_version mismatch");
        }
        if (!body.capability_snapshot_version || !Array.isArray(body.candidates) || !body.diagnostics) {
          throw new SonarResolveProbeUnavailableError(502, "sonar probe missing fields");
        }

        const diagnosticsRaw = body.diagnostics as Record<string, unknown>;
        // Kitchen bounded-core diagnostics omit schema_version; Ordering
        // CandidateSnapshot requires it. Normalize at the service boundary.
        const diagnostics = {
          schema_version: 1 as const,
          searched: Array.isArray(diagnosticsRaw?.searched) ? diagnosticsRaw.searched : [],
          timed_out: Array.isArray(diagnosticsRaw?.timed_out) ? diagnosticsRaw.timed_out : [],
          unavailable: Array.isArray(diagnosticsRaw?.unavailable)
            ? diagnosticsRaw.unavailable
            : [],
        } as CandidateSnapshot["diagnostics"];

        return {
          capability_snapshot_version: body.capability_snapshot_version as CapabilityRegistryVersion,
          candidates: body.candidates as ReadonlyArray<CollectionCandidate>,
          diagnostics,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function sonarResolveProbeFromEnv(): SonarResolveProbePort | undefined {
  const baseUrl =
    process.env.SONAR_RESOLVE_PROBE_URL?.trim() ||
    process.env.SONAR_KITCHEN_URL?.trim() ||
    process.env.SONAR_API_URL?.trim();
  const token =
    process.env.SONAR_SERVICE_TOKEN?.trim() ||
    process.env.KITCHEN_SERVICE_TOKEN?.trim() ||
    process.env.SERVICE_TOKEN?.trim();
  if (!baseUrl || !token) return undefined;
  return createHttpSonarResolveProbePort({ baseUrl, serviceToken: token });
}
