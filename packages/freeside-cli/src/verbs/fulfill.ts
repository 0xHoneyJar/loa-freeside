/**
 * `freeside-cli fulfill watch <order_id>` (fulfillment-surface S2-T4, SDD §3.1).
 *
 * Poll loop, STATELESS client: safe to interrupt and re-invoke — all state lives
 * server-side. Emits one JSON line per state/ingredient CHANGE only (no
 * repeated-state spam). Terminal exits: fulfilled→0, failed→6, timeout→5.
 * Transient poll failures retry up to MAX_TRANSIENT before exit 2 (G-5: surfaced,
 * never swallowed). `--once` prints the current snapshot line and exits.
 */
import { apiRequest, configFromEnv } from "../lib/ordering-client.js";
import { EXIT, emit, emitError, isPublicOrder, type ExitCode, type PublicOrder } from "../lib/ordering-schemas.js";

const MAX_TRANSIENT = 3;

const flagNum = (args: string[], name: string, dflt: number): number => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

function snapshotLine(order: PublicOrder): Record<string, unknown> {
  return {
    order_id: order.order_id,
    state: order.state,
    ingredients: order.ingredients ?? {},
    world_slug: order.fulfillment?.world_slug,
  };
}

const changeKey = (order: PublicOrder): string => JSON.stringify([order.state, order.ingredients ?? {}]);

export async function fulfillVerb(args: string[], sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<ExitCode> {
  const sub = args[0];
  if (sub !== "watch") return emitError({ error: `usage: fulfill watch <order_id> [--interval <s>] [--timeout <s>] [--once]` }, EXIT.USAGE);
  const orderId = args[1];
  if (!orderId || orderId.startsWith("--")) return emitError({ error: "usage: fulfill watch <order_id>" }, EXIT.USAGE);

  const cfg = configFromEnv();
  if (!cfg.ok) return emitError(cfg.envelope, cfg.code);

  const intervalMs = flagNum(args, "--interval", 15) * 1000;
  const timeoutMs = flagNum(args, "--timeout", 1800) * 1000;
  const once = args.includes("--once");

  const startedAt = Date.now();
  let lastKey: string | undefined;
  let transientFailures = 0;

  for (;;) {
    const res = await apiRequest(cfg.config, "GET", `/v1/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) {
      if (res.code === EXIT.UNREACHABLE && !once) {
        transientFailures += 1;
        if (transientFailures >= MAX_TRANSIENT) {
          return emitError({ ...res.envelope, order_id: orderId, hint: `${MAX_TRANSIENT} consecutive poll failures` }, EXIT.UNREACHABLE);
        }
        await sleep(intervalMs);
        continue;
      }
      return emitError(res.envelope, res.code);
    }
    transientFailures = 0;

    if (!isPublicOrder(res.body)) {
      return emitError({ error: "response did not match the PublicOrder contract (shape drift?)", order_id: orderId }, EXIT.API_ERROR);
    }
    const order = res.body;

    const key = changeKey(order);
    if (key !== lastKey) {
      emit(snapshotLine(order));
      lastKey = key;
    }

    if (once) return EXIT.OK;
    if (order.state === "fulfilled") return EXIT.OK;
    if (order.state === "failed") return EXIT.ORDER_FAILED;
    if (Date.now() - startedAt >= timeoutMs) {
      emit({ order_id: orderId, watch: "timeout", elapsed_s: Math.round((Date.now() - startedAt) / 1000) });
      return EXIT.WATCH_TIMEOUT;
    }
    await sleep(intervalMs);
  }
}
