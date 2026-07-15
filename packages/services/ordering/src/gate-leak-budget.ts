export interface GateLeakIntakeBudget {
  limit: number;
  windowMs: number;
}

function positiveInt(value: string | undefined, fallback: number, label: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

/** Configuration only; the OrderStore owns the deployment-wide durable counter. */
export function gateLeakIntakeBudgetFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GateLeakIntakeBudget {
  return {
    limit: positiveInt(env.GATE_LEAK_INTAKE_LIMIT, 120, 'GATE_LEAK_INTAKE_LIMIT'),
    windowMs: positiveInt(env.GATE_LEAK_INTAKE_WINDOW_MS, 60_000, 'GATE_LEAK_INTAKE_WINDOW_MS'),
  };
}
