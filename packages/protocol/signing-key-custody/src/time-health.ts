import type { TimeHealthSnapshot, TimeSourceReading } from "./contracts.js";
import { KeyCustodyRejectedError } from "./errors.js";
import {
  MIN_INDEPENDENT_TIME_SOURCES,
  ORDERING_DATABASE_MAX_SKEW_MS,
  SIGNING_KEY_CUSTODY_SCHEMA_VERSION,
} from "./version.js";

export interface EvaluateDatabaseClockSkewInput {
  readonly databaseUnixMs: number;
  readonly evaluatedAtMs: number;
  readonly authoritativeSources: readonly TimeSourceReading[];
  readonly maxSkewMs?: number;
  readonly minSources?: number;
  readonly maxRegionalDivergenceMs?: number;
  readonly lastGoodAt?: string;
}

export interface DatabaseClockSkewVerdict {
  readonly intakeBlocked: boolean;
  readonly blockReason?: TimeHealthSnapshot["block_reason"];
  readonly measuredOffsetMs?: number;
  readonly offsetUncertaintyMs?: number;
  readonly regionalDivergenceMs?: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[sorted.length - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
};

export const evaluateDatabaseClockSkew = ({
  databaseUnixMs,
  evaluatedAtMs,
  authoritativeSources,
  maxSkewMs = ORDERING_DATABASE_MAX_SKEW_MS,
  minSources = MIN_INDEPENDENT_TIME_SOURCES,
  maxRegionalDivergenceMs = 500,
  lastGoodAt,
}: EvaluateDatabaseClockSkewInput): DatabaseClockSkewVerdict => {
  if (authoritativeSources.length < minSources) {
    return {
      intakeBlocked: true,
      blockReason: "insufficient_time_sources",
    };
  }

  const offsets = authoritativeSources.map((source) => databaseUnixMs - source.unix_ms);
  const measuredOffsetMs = median(offsets);
  const offsetUncertaintyMs = Math.max(
    ...authoritativeSources.map((source) => source.uncertainty_ms),
  );

  const regions = new Map<string, number[]>();
  for (const source of authoritativeSources) {
    const region = source.region ?? "global";
    const bucket = regions.get(region) ?? [];
    bucket.push(source.unix_ms);
    regions.set(region, bucket);
  }

  let regionalDivergenceMs = 0;
  if (regions.size > 1) {
    const regionMedians = [...regions.values()].map(median);
    regionalDivergenceMs = Math.max(...regionMedians) - Math.min(...regionMedians);
    if (regionalDivergenceMs > maxRegionalDivergenceMs) {
      return {
        intakeBlocked: true,
        blockReason: "time_source_divergence",
        measuredOffsetMs,
        offsetUncertaintyMs,
        regionalDivergenceMs,
      };
    }
  }

  const effectiveSkew = Math.abs(measuredOffsetMs) + offsetUncertaintyMs;

  if (lastGoodAt !== undefined) {
    const lastGoodAgeMs = evaluatedAtMs - Date.parse(lastGoodAt);
    if (lastGoodAgeMs > maxSkewMs * 15) {
      return {
        intakeBlocked: true,
        blockReason: "database_clock_unknown",
        measuredOffsetMs,
        offsetUncertaintyMs,
        regionalDivergenceMs,
      };
    }
  }

  if (effectiveSkew > maxSkewMs) {
    return {
      intakeBlocked: true,
      blockReason: "database_clock_skew_exceeded",
      measuredOffsetMs,
      offsetUncertaintyMs,
      regionalDivergenceMs,
    };
  }

  return {
    intakeBlocked: false,
    measuredOffsetMs,
    offsetUncertaintyMs,
    regionalDivergenceMs,
  };
};

export const buildTimeHealthSnapshot = (
  input: EvaluateDatabaseClockSkewInput,
): TimeHealthSnapshot => {
  const verdict = evaluateDatabaseClockSkew(input);
  return {
    schema_version: SIGNING_KEY_CUSTODY_SCHEMA_VERSION,
    evaluated_at: new Date(input.evaluatedAtMs).toISOString(),
    database_unix_ms: input.databaseUnixMs,
    authoritative_sources: [...input.authoritativeSources],
    measured_offset_ms: verdict.measuredOffsetMs,
    offset_uncertainty_ms: verdict.offsetUncertaintyMs,
    regional_divergence_ms: verdict.regionalDivergenceMs,
    last_good_at: verdict.intakeBlocked ? input.lastGoodAt : new Date(input.evaluatedAtMs).toISOString(),
    intake_blocked: verdict.intakeBlocked,
    block_reason: verdict.blockReason,
  };
};

export const assertSignedIntakeTimeHealthy = (snapshot: TimeHealthSnapshot): void => {
  if (snapshot.intake_blocked) {
    throw new KeyCustodyRejectedError({
      reason: snapshot.block_reason ?? "database_clock_unknown",
      remediation: snapshot.block_reason === "insufficient_time_sources"
        ? "restore_time_sources"
        : "quarantine_dependency_intake",
    });
  }
};

export const timeHealthObservability = (
  snapshot: TimeHealthSnapshot,
): {
  readonly measured_offset_ms: number | undefined;
  readonly offset_uncertainty_ms: number | undefined;
  readonly regional_divergence_ms: number | undefined;
  readonly last_good_at: string | undefined;
  readonly intake_blocked: boolean;
  readonly block_reason: TimeHealthSnapshot["block_reason"];
  readonly source_count: number;
} => ({
  measured_offset_ms: snapshot.measured_offset_ms,
  offset_uncertainty_ms: snapshot.offset_uncertainty_ms,
  regional_divergence_ms: snapshot.regional_divergence_ms,
  last_good_at: snapshot.last_good_at,
  intake_blocked: snapshot.intake_blocked,
  block_reason: snapshot.block_reason,
  source_count: snapshot.authoritative_sources.length,
});
