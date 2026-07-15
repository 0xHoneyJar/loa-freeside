import { z } from 'zod';
import {
  PublicJourneyProjectionSchema,
  type PublicJourneyProjection,
} from '@freeside/shadow-audit-protocol';
import type { IngredientStatus } from '@freeside/ordering-protocol';
import { normalizeChainId, normalizeContractAddress } from './contract-address.js';

export interface GateLeakSubmission {
  chain: string;
  contract: string;
  access_started_at?: string;
  /** Server-issued retry capability. Omit on the first submission. */
  journey_token?: string;
}

export interface GateLeakSubmissionResult {
  journey: PublicJourneyProjection;
  report?: unknown;
}

export interface GateLeakPort {
  submit(input: GateLeakSubmission): Promise<GateLeakSubmissionResult>;
  resume(runId: string, accessStartedAt: string): Promise<GateLeakSubmissionResult>;
}

export interface GateLeakIndexPort {
  probe(chainId: string, contract: string): Promise<IngredientStatus>;
  enqueue(input: { orderId: string; chainId: string; contract: string }): Promise<boolean>;
}

const GateLeakResponseSchema = z
  .object({
    journey: PublicJourneyProjectionSchema,
    report: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .strict();

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Public shadow-audit HTTP adapter. Typed 428/refusal bodies are results, not transport errors. */
export class HttpGateLeakPort implements GateLeakPort {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchFn = fetchImpl ?? fetch;
  }

  async submit(input: GateLeakSubmission): Promise<GateLeakSubmissionResult> {
    const response = await this.fetchFn(`${trimBase(this.baseUrl)}/v1/access-risk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return this.parseResponse(response);
  }

  async resume(runId: string, accessStartedAt: string): Promise<GateLeakSubmissionResult> {
    const response = await this.fetchFn(
      `${trimBase(this.baseUrl)}/v1/access-risk/${encodeURIComponent(runId)}/resume`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_started_at: accessStartedAt }),
      },
    );
    return this.parseResponse(response);
  }

  private async parseResponse(response: Response): Promise<GateLeakSubmissionResult> {
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error(`shadow gate-leak returned non-JSON status ${response.status}`);
    }
    const parsed = GateLeakResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`shadow gate-leak contract mismatch at status ${response.status}`);
    return { journey: parsed.data.journey, report: parsed.data.report };
  }
}

/** Sonar status + idempotent ingest adapter for valid-but-unknown subjects. */
export class HttpGateLeakIndexPort implements GateLeakIndexPort {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: { sonarApiUrl: string; serviceToken: string },
    fetchImpl?: typeof fetch,
  ) {
    this.fetchFn = fetchImpl ?? fetch;
  }

  async probe(chainId: string, contract: string): Promise<IngredientStatus> {
    const pair = this.normalize(chainId, contract);
    if (!pair) return 'blocked';
    try {
      const response = await this.fetchFn(
        `${trimBase(this.config.sonarApiUrl)}/v1/collections/${pair.chainId}/${pair.contract}/status`,
        { headers: { Authorization: `Bearer ${this.config.serviceToken}` } },
      );
      if (response.status === 404) return 'pending';
      if (response.status < 200 || response.status >= 300) return 'blocked';
      const raw = (await response.json().catch(() => null)) as { status?: string } | null;
      if (raw?.status === 'indexed') return 'complete';
      if (raw?.status === 'indexing' || raw?.status === 'queued') return 'in_progress';
      if (raw?.status === 'failed') return 'blocked';
      return 'pending';
    } catch {
      return 'blocked';
    }
  }

  async enqueue(input: { orderId: string; chainId: string; contract: string }): Promise<boolean> {
    const pair = this.normalize(input.chainId, input.contract);
    if (!pair) return false;
    try {
      const response = await this.fetchFn(
        `${trimBase(this.config.sonarApiUrl)}/v1/collections/${pair.chainId}/${pair.contract}/ingest`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.serviceToken}`,
            'content-type': 'application/json',
            'idempotency-key': `${input.orderId}:gate-leak:index`,
          },
          body: JSON.stringify({ order_id: input.orderId, source: 'public_gate_leak' }),
        },
      );
      return response.status === 200 || response.status === 202;
    } catch {
      return false;
    }
  }

  private normalize(chainId: string, contract: string): { chainId: string; contract: string } | null {
    const chain = normalizeChainId(chainId);
    const address = normalizeContractAddress(contract);
    return chain && address ? { chainId: chain, contract: address } : null;
  }
}

export function gateLeakPortsFromEnv(fetchImpl?: typeof fetch): {
  gateLeak?: GateLeakPort;
  index?: GateLeakIndexPort;
} {
  const shadowAuditApiUrl = process.env.SHADOW_AUDIT_API_URL?.trim();
  const sonarApiUrl = process.env.SONAR_API_URL?.trim();
  const serviceToken = process.env.SERVICE_TOKEN?.trim() || process.env.ORDERING_SERVICE_TOKEN?.trim();
  return {
    gateLeak: shadowAuditApiUrl ? new HttpGateLeakPort(shadowAuditApiUrl, fetchImpl) : undefined,
    index:
      sonarApiUrl && serviceToken
        ? new HttpGateLeakIndexPort({ sonarApiUrl, serviceToken }, fetchImpl)
        : undefined,
  };
}
