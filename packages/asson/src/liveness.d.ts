export interface LivenessPolicy {
  budget: { tool_calls: number; wall_s: number };
  soft_walls: { warn: number; compact: number };
  stall: { no_moves_s: number };
  spin: { repeat_window: number; threshold: number };
  pace: { p95_s: number | null };
  rotation: { after_evictions: number };
}

export const DEFAULT_POLICY: LivenessPolicy;

export function budgetStatus(
  log: any[],
  policy?: LivenessPolicy,
  opts?: { nowMs?: number }
): { calls: number; wall_s: number; fraction: number; phase: string };

export function detectStall(
  log: any[],
  policy?: LivenessPolicy,
  opts?: { nowMs?: number }
): { stalled: boolean; silent_s: number; reason?: string };

export function detectSpin(
  log: any[],
  policy?: LivenessPolicy
): { spinning: boolean; max_repeats: number; repeated: string[] };

export function paceCheck(
  log: any[],
  policy?: LivenessPolicy,
  opts?: { nowMs?: number }
): { tracked: boolean; wall_s?: number; p95_s?: number; off_pace?: boolean };

export function checkpointPacket(
  spanMeta: any,
  log: any[],
  reason: string
): any;

export function livenessVerdict(
  log: any[],
  policy?: LivenessPolicy,
  opts?: { nowMs?: number }
): {
  action: string;
  stall: any;
  spin: any;
  budget: any;
  pace: any;
};
