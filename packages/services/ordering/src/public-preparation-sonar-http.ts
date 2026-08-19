/**
 * CR-204A live Sonar kitchen port — thin HTTP client.
 *
 * Kitchen deployment coords must already be on the dispatch request (baked at admit).
 */

import type {
  PublicPreparationSonarPort,
  SonarPrepDispatchRequest,
  SonarPrepDispatchResult,
  SonarPrepStatusResult,
} from "./public-preparation-sonar-port.js";

export interface HttpPublicPreparationSonarPortDeps {
  readonly kitchenBaseUrl: string;
  readonly serviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function mapKitchenStatus(status: string): SonarPrepStatusResult {
  switch (status) {
    case "completed":
      return { status: "indexed" };
    case "indexing":
      return { status: "indexing" };
    case "queued":
      return { status: "queued" };
    case "failed":
      return { status: "failed", retryable: true, error_code: "kitchen_job_failed" };
    default:
      // Fail closed — unknown status is not progress.
      return { status: "failed", retryable: true, error_code: "kitchen_status_unknown" };
  }
}

export class HttpPublicPreparationSonarPort implements PublicPreparationSonarPort {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly base: string;
  private readonly token: string;

  constructor(private readonly deps: HttpPublicPreparationSonarPortDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 15_000;
    this.base = deps.kitchenBaseUrl.replace(/\/+$/, "");
    this.token = deps.serviceToken;
  }

  async dispatchChildJob(request: SonarPrepDispatchRequest): Promise<SonarPrepDispatchResult> {
    const deployment = request.kitchen_deployment;
    if (!deployment) {
      return { ok: false, retryable: false, error_code: "deployment_unresolved" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.base}/v2/collection-preparations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schema_version: 1,
          network: {
            schema_version: 1,
            network_namespace: deployment.network_namespace,
            network_reference: deployment.network_reference,
          },
          address: deployment.address,
          token_standard: deployment.token_standard,
          correlation: {
            source: "ordering.public-prep.v1",
            correlation_id: request.command_inbox_key,
          },
        }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as {
        physical_job_id?: string;
        error?: { code?: string };
      } | null;
      if ((res.status === 200 || res.status === 202) && json?.physical_job_id) {
        return { ok: true, external_job_ref: json.physical_job_id };
      }
      const code = json?.error?.code ?? `http_${res.status}`;
      return {
        ok: false,
        retryable: res.status >= 500 || res.status === 429,
        error_code: code,
      };
    } catch {
      return { ok: false, retryable: true, error_code: "sonar_unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }

  async probeChildJob(externalJobRef: string): Promise<SonarPrepStatusResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(
        `${this.base}/v2/collection-preparations/${encodeURIComponent(externalJobRef)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        },
      );
      if (res.status === 404) {
        return { status: "failed", retryable: true, error_code: "job_not_found" };
      }
      const json = (await res.json().catch(() => null)) as { status?: string } | null;
      if (!res.ok || !json?.status) {
        return { status: "failed", retryable: true, error_code: `http_${res.status}` };
      }
      return mapKitchenStatus(json.status);
    } catch {
      return { status: "failed", retryable: true, error_code: "sonar_unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function httpPublicPreparationSonarFromEnv(): HttpPublicPreparationSonarPort | undefined {
  const base =
    process.env.SONAR_API_URL?.trim() ||
    process.env.SONAR_KITCHEN_URL?.trim() ||
    "";
  const token =
    process.env.SONAR_SERVICE_TOKEN?.trim() ||
    process.env.SERVICE_TOKEN?.trim() ||
    "";
  if (!base || !token) return undefined;
  return new HttpPublicPreparationSonarPort({
    kitchenBaseUrl: base,
    serviceToken: token,
  });
}
