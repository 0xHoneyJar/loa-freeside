import type { IngredientStatus } from '@freeside/ordering-protocol';

import { normalizeChainId, normalizeContractAddress } from './contract-address.js';
import type { WorldsProbeDetail } from './triage-ports.js';

export type { WorldsProbeDetail };

export interface HttpBuildingProbesConfig {
  sonarApiUrl: string;
  scoreApiUrl: string;
  worldsApiUrl: string;
  serviceToken: string;
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
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return false;

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
      return res.status === 200 || res.status === 202;
    } catch {
      return false;
    }
  }

  async enqueueScore(payload: HttpEnqueuePayload): Promise<boolean> {
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return false;

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
      return res.status === 200 || res.status === 201;
    } catch {
      return false;
    }
  }

  async enqueueWorlds(payload: HttpEnqueuePayload): Promise<boolean> {
    const normalized = this.normalizePair(payload.chainId, payload.contractAddress);
    if (!normalized) return false;

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
      return res.status === 200 || res.status === 201;
    } catch {
      return false;
    }
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
    fetchImpl,
  });
}
