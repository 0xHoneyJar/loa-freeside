/**
 * CR-204A live Sonar kitchen port — admit + probe via kitchen-api.
 *
 * Deployment digests on work items are resolved through the linked order's
 * confirmed resolution candidate snapshot (network + address).
 */

import type { ResolutionStore } from "./resolution-store.js";
import type { OrderStore } from "./store.js";
import type { SharedPreparationStore } from "./shared-preparation-store.js";
import type { VersionedDigest } from "./shared-preparation-types.js";
import type {
  PublicPreparationSonarPort,
  SonarPrepDispatchRequest,
  SonarPrepDispatchResult,
  SonarPrepStatusResult,
} from "./public-preparation-sonar-port.js";

export interface HttpPublicPreparationSonarPortDeps {
  readonly kitchenBaseUrl: string;
  readonly serviceToken: string;
  readonly preparationStore: SharedPreparationStore;
  readonly orderStore: OrderStore;
  readonly resolutionStore: ResolutionStore;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ResolvedKitchenDeployment {
  readonly network_namespace: string;
  readonly network_reference: string;
  readonly address: string;
  readonly token_standard: "erc721" | "erc1155";
}

function digestKey(d: VersionedDigest): string {
  return `${d.algorithm}:${d.domain}:${d.major_version}:${d.digest}`;
}

export async function resolveKitchenDeploymentForDigest(input: {
  readonly deploymentId: VersionedDigest;
  readonly workId: string;
  readonly preparationStore: SharedPreparationStore;
  readonly orderStore: OrderStore;
  readonly resolutionStore: ResolutionStore;
}): Promise<ResolvedKitchenDeployment | undefined> {
  const links = await input.preparationStore.listActiveLinks(input.workId);
  const want = digestKey(input.deploymentId);
  for (const link of links) {
    const order = await input.orderStore.get(link.order_id);
    if (!order || order.product !== "collection-report") continue;
    const resolutionId = (order.inputs as { resolution_id?: unknown }).resolution_id;
    if (typeof resolutionId !== "string" || resolutionId.length === 0) continue;
    const resolution = await input.resolutionStore.get(resolutionId);
    if (!resolution) continue;
    for (const candidate of resolution.candidate_snapshot.candidates) {
      for (const deployment of candidate.identity.deployments) {
        if (digestKey(deployment.deployment_id) !== want) continue;
        const rawStandard = (candidate as { token_standard?: { value?: string } | string })
          .token_standard;
        const standardValue =
          typeof rawStandard === "string"
            ? rawStandard
            : typeof rawStandard?.value === "string"
              ? rawStandard.value
              : "erc721";
        const tokenStandard = standardValue === "erc1155" ? "erc1155" : "erc721";
        return {
          network_namespace: deployment.network.network_namespace,
          network_reference: deployment.network.network_reference,
          address: deployment.address,
          token_standard: tokenStandard,
        };
      }
    }
  }
  return undefined;
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
      return { status: "indexing" };
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
    const deployment = await resolveKitchenDeploymentForDigest({
      deploymentId: request.deployment_id,
      workId: request.work_id,
      preparationStore: this.deps.preparationStore,
      orderStore: this.deps.orderStore,
      resolutionStore: this.deps.resolutionStore,
    });
    if (!deployment) {
      return { ok: false, retryable: true, error_code: "deployment_unresolved" };
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

export function httpPublicPreparationSonarFromEnv(deps: {
  readonly preparationStore: SharedPreparationStore;
  readonly orderStore: OrderStore;
  readonly resolutionStore: ResolutionStore;
}): HttpPublicPreparationSonarPort | undefined {
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
    preparationStore: deps.preparationStore,
    orderStore: deps.orderStore,
    resolutionStore: deps.resolutionStore,
  });
}
