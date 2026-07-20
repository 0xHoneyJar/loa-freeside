import type { PublicPrepCapability, VersionedDigest } from "./shared-preparation-types.js";
import { sonarPhysicalJobRef } from "./public-preparation-dispatch-key.js";

export type SonarPrepJobStatus = "queued" | "indexing" | "indexed" | "failed";

export interface SonarPrepDispatchRequest {
  readonly command_inbox_key: string;
  readonly deployment_id: VersionedDigest;
  readonly capability: PublicPrepCapability;
  readonly adapter_version: string;
  readonly generation: number;
  readonly lease_epoch: number;
  /** Owning shared-prep work — required for live kitchen deployment resolution. */
  readonly work_id: string;
}

export interface SonarPrepDispatchResult {
  readonly ok: boolean;
  readonly external_job_ref?: string;
  readonly retryable?: boolean;
  readonly error_code?: string;
}

export interface SonarPrepStatusResult {
  readonly status: SonarPrepJobStatus;
  readonly retryable?: boolean;
  readonly error_code?: string;
}

/** Idempotent Sonar Kitchen dispatch + status probe (CR-204A). */
export interface PublicPreparationSonarPort {
  dispatchChildJob(request: SonarPrepDispatchRequest): Promise<SonarPrepDispatchResult>;
  probeChildJob(externalJobRef: string): Promise<SonarPrepStatusResult>;
}

/** Fixture Sonar — records inbox keys and returns stable job refs on replay. */
export class FixturePublicPreparationSonarPort implements PublicPreparationSonarPort {
  readonly dispatchCalls: SonarPrepDispatchRequest[] = [];
  readonly probeCalls: string[] = [];
  private readonly inbox = new Map<string, string>();
  private outage = false;
  private jobStatus = new Map<string, SonarPrepJobStatus>();

  setOutage(active: boolean): void {
    this.outage = active;
  }

  setJobStatus(externalJobRef: string, status: SonarPrepJobStatus): void {
    this.jobStatus.set(externalJobRef, status);
  }

  async dispatchChildJob(request: SonarPrepDispatchRequest): Promise<SonarPrepDispatchResult> {
    this.dispatchCalls.push(request);
    if (this.outage) {
      return { ok: false, retryable: true, error_code: "sonar_unavailable" };
    }
    const prior = this.inbox.get(request.command_inbox_key);
    if (prior) {
      return { ok: true, external_job_ref: prior };
    }
    const ref = sonarPhysicalJobRef(request.command_inbox_key);
    this.inbox.set(request.command_inbox_key, ref);
    this.jobStatus.set(ref, "queued");
    return { ok: true, external_job_ref: ref };
  }

  async probeChildJob(externalJobRef: string): Promise<SonarPrepStatusResult> {
    this.probeCalls.push(externalJobRef);
    if (this.outage) {
      return { status: "failed", retryable: true, error_code: "sonar_unavailable" };
    }
    return { status: this.jobStatus.get(externalJobRef) ?? "indexing", retryable: false };
  }

  markIndexed(externalJobRef: string): void {
    this.jobStatus.set(externalJobRef, "indexed");
  }
}
