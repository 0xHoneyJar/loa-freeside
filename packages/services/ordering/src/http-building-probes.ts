import type { IngredientStatus } from '@freeside/ordering-protocol';

import { normalizeChainId, normalizeContractAddress } from './contract-address.js';
import type { WorldsProbeDetail } from './triage-ports.js';

export type { WorldsProbeDetail };

export interface HttpBuildingProbesConfig {
  sonarApiUrl: string;
  scoreApiUrl: string;
  worldsApiUrl: string;
  serviceToken: string;
  /** shadow-audit base URL (optional — its absence leaves shadow_preview on the policy path). */
  shadowAuditApiUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface HttpEnqueuePayload {
  orderId: string;
  chainId: string;
  contractAddress: string;
  displayName: string;
  contactEmail: string;
  source: string;
}

/** Result of an idempotent upstream dispatch. `world_slug` is present when the surface
 *  returns one (worlds manifest always; score register when it echoes its internal slug). */
export interface DispatchResult {
  ok: boolean;
  world_slug?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function mapSonarStatus(statusCode: number, body: unknown): IngredientStatus {
  if (statusCode === 404) return 'pending';
  if (statusCode < 200 || statusCode >= 300) return 'blocked';

  const status = typeof body === 'object' && body !== null ? (body as { status?: string }).status : undefined;
  switch (status) {
    case 'indexed':
      return 'complete';
    case 'indexing':
    case 'queued':
      return 'in_progress';
    case 'failed':
      return 'blocked';
    default:
      return 'pending';
  }
}

function mapLookupStatus(statusCode: number): IngredientStatus {
  if (statusCode === 200) return 'complete';
  if (statusCode === 404) return 'pending';
  return 'blocked';
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export class HttpBuildingProbes {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: HttpBuildingProbesConfig) {
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  async probeSonar(chainId: string, contract: string): Promise<IngredientStatus> {
    const normalized = this.normalizePair(chainId, contract);
    if (!normalized) return 'blocked';

    const url = `${trimBase(this.config.sonarApiUrl)}/v1/collections/${normalized.chainId}/${normalized.contract}/status`;
    try {
      const res = await this.fetchFn(url, { headers: authHeaders(this.config.serviceToken) });
      const body = await this.readJson(res);
      return mapSonarStatus(res.status, body);
    } catch {
      return 'blocked';
    }
  }

  async probeScore(chainId: string, contract: string): Promise<IngredientStatus> {
    const normalized = this.normalizePair(chainId, contract);
    if (!normalized) return 'blocked';

    const params = new URLSearchParams({
      chain_id: normalized.chainId,
      contract_address: normalized.contract,
    });
    const url = `${trimBase(this.config.scoreApiUrl)}/v1/communities/lookup?${params}`;
    try {
      const res = await this.fetchFn(url, { headers: authHeaders(this.config.serviceToken) });
      return mapLookupStatus(res.status);
    } catch {
      return 'blocked';
    }
  }

  /**
   * shadow_preview capability probe (SDD sandwich-line FR-2). Hits the audit's
   * OPEN membership read `GET /v1/collections/:chain/:contract`:
   *   200 → the audit CAN cover this collection → `complete` (the preview is producible)
   *   404 → not auditable here → `pending` (operator/onboarding follow-up)
   *   else/network → `blocked`
   * Only wired when `shadowAuditApiUrl` is configured; else callers use the policy path.
   */
  async probeShadow(chainId: string, contract: string): Promise<IngredientStatus> {
    if (!this.config.shadowAuditApiUrl) return 'blocked';
    const normalized = this.normalizePair(chainId, contract);
    if (!normalized) return 'blocked';

    const url = `${trimBase(this.config.shadowAuditApiUrl)}/v1/collections/${normalized.chainId}/${normalized.contract}`;
    try {
      const res = await this.fetchFn(url);
      if (res.status === 404) return 'pending'; // not auditable here
      if (res.status < 200 || res.status >= 300) return 'blocked';
      // A 200 only means 'complete' if the body IS the FR-2 capability contract
      // ({collection, standard}); a 200 with a malformed/empty body is not a
      // producible preview (FAGAN S3 — never trust a bare 200).
      const body = await this.readJson(res);
      const ok =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { collection?: unknown }).collection === 'string' &&
        typeof (body as { standard?: unknown }).standard === 'string';
      return ok ? 'complete' : 'blocked';
    } catch {
      return 'blocked';
    }
  }

  get hasShadowProbe(): boolean {
    return Boolean(this.config.shadowAuditApiUrl);
  }

  async probeWorlds(chainId: string, contract: string): Promise<WorldsProbeDetail> {
    const normalized = this.normalizePair(chainId, contract);
    if (!normalized) return { status: 'blocked' };

    const params = new URLSearchParams({
      chain_id: normalized.chainId,
      contract_address: normalized.contract,
    });
    const url = `${trimBase(this.config.worldsApiUrl)}/v1/worlds/lookup?${params}`;
    try {
      const res = await this.fetchFn(url, { headers: authHeaders(this.config.serviceToken) });
      const status = mapLookupStatus(res.status);
      if (status !== 'complete') return { status };

      const body = await this.readJson(res);
      const world_slug =
        typeof body === 'object' && body !== null && typeof (body as { world_slug?: string }).world_slug === 'string'
          ? (body as { world_slug: string }).world_slug
          : undefined;
      return { status, world_slug };
    } catch {
      return { status: 'blocked' };
    }
  }

  async enqueueSonar(payload: HttpEnqueuePayload): Promise<boolean> {
    return (await this.ingestSonar(payload)).ok;
  }

  async enqueueScore(payload: HttpEnqueuePayload): Promise<boolean> {
    return (await this.registerScore(payload)).ok;
  }

  async enqueueWorlds(payload: HttpEnqueuePayload): Promise<boolean> {
    return (await this.manifestWorlds(payload)).ok;
  }

  /** POST sonar ingest. Poll-only surface — no slug is produced.
   *  Idempotency contract: sonar upserts on the natural key (chain_id, contract_address),
   *  so re-dispatch after a crash is a no-op — this is what makes re-dispatch crash-safe. */
  async ingestSonar(payload: HttpEnqueuePayload): Promise<DispatchResult> {
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return { ok: false };

    const url = `${trimBase(this.config.sonarApiUrl)}/v1/collections/${normalized.chainId}/${normalized.contract}/ingest`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { ...authHeaders(this.config.serviceToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: payload.orderId,
          source: payload.source,
          contact_email: payload.contactEmail,
          community_name: payload.displayName,
        }),
      });
      return { ok: res.status === 200 || res.status === 202 };
    } catch {
      return { ok: false };
    }
  }

  /** POST score register. Echoes score's INTERNAL `world_slug` — surfaced only for the
   *  D-5 divergence check; worlds-api remains canonical.
   *  Idempotency contract: score's register takes an advisory lock on (chain_id,
   *  contract_address), so concurrent or duplicate registers collapse to one community —
   *  this is what makes re-dispatch crash-safe. */
  async registerScore(payload: HttpEnqueuePayload): Promise<DispatchResult> {
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return { ok: false };

    const url = `${trimBase(this.config.scoreApiUrl)}/v1/communities/register`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { ...authHeaders(this.config.serviceToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain_id: normalized.chainId,
          contract_address: normalized.contract,
          display_name: payload.displayName,
          contact_email: payload.contactEmail,
          order_id: payload.orderId,
          source: payload.source,
        }),
      });
      return { ok: res.status === 200 || res.status === 201, world_slug: await this.readWorldSlug(res) };
    } catch {
      return { ok: false };
    }
  }

  /** POST worlds manifest. Source of the CANONICAL `world_slug` (D-5).
   *  Idempotency contract: worlds manifests on the natural key (chain_id, contract_address,
   *  order_id), returning the existing world_slug on replay — this is what makes re-dispatch
   *  crash-safe. */
  async manifestWorlds(payload: HttpEnqueuePayload): Promise<DispatchResult> {
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return { ok: false };

    const url = `${trimBase(this.config.worldsApiUrl)}/v1/worlds/manifest`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { ...authHeaders(this.config.serviceToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain_id: normalized.chainId,
          contract_address: normalized.contract,
          display_name: payload.displayName,
          contact_email: payload.contactEmail,
          order_id: payload.orderId,
          source: payload.source,
        }),
      });
      return { ok: res.status === 200 || res.status === 201, world_slug: await this.readWorldSlug(res) };
    } catch {
      return { ok: false };
    }
  }

  private async readWorldSlug(res: Response): Promise<string | undefined> {
    const body = await this.readJson(res);
    return typeof body === 'object' && body !== null && typeof (body as { world_slug?: string }).world_slug === 'string'
      ? (body as { world_slug: string }).world_slug
      : undefined;
  }

  private normalizePair(chainId: string, contract: string): { chainId: string; contract: string } | null {
    const normalizedChain = normalizeChainId(chainId);
    const normalizedContract = normalizeContractAddress(contract);
    if (!normalizedChain || !normalizedContract) return null;
    return { chainId: normalizedChain, contract: normalizedContract };
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
}

export function httpBuildingProbesFromEnv(fetchImpl?: typeof fetch): HttpBuildingProbes | null {
  if (process.env.KITCHEN_PROBE_HTTP_ENABLED !== 'true') return null;

  const serviceToken = process.env.SERVICE_TOKEN?.trim() || process.env.ORDERING_SERVICE_TOKEN?.trim();
  const sonarApiUrl = process.env.SONAR_API_URL?.trim();
  const scoreApiUrl = process.env.SCORE_API_URL?.trim();
  const worldsApiUrl = process.env.WORLDS_API_URL?.trim();
  if (!serviceToken || !sonarApiUrl || !scoreApiUrl || !worldsApiUrl) {
    console.warn(
      '[ordering-service] KITCHEN_PROBE_HTTP_ENABLED=true but missing SERVICE_TOKEN or upstream URLs — HTTP probes disabled',
    );
    return null;
  }

  return new HttpBuildingProbes({
    sonarApiUrl,
    scoreApiUrl,
    worldsApiUrl,
    serviceToken,
    shadowAuditApiUrl: process.env.SHADOW_AUDIT_API_URL?.trim() || undefined,
    fetchImpl,
  });
}
