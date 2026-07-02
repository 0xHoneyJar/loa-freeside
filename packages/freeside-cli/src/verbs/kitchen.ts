/**
 * `freeside-cli kitchen <probe|advance>` (fulfillment-surface S2-T3).
 *
 * probe   — on-demand fresh probe via POST /v1/orders/:id/reprobe (SDD D1).
 *           Any ambiguous ingredient → exit 4 (agents must not treat stale/errored
 *           probe truth as green).
 * advance — the single mutating verb (FR-5). Client-side bounds: --status must be
 *           in the server enum; --ingredient must exist on the order (fetched, not
 *           hardcoded). Evidence + actor are SERVER-derived (SDD D3) — no evidence
 *           flag exists; --note maps to the untrusted caller_note.
 */
import { apiRequest, configFromEnv } from "../lib/ordering-client.js";
import {
  EXIT,
  INGREDIENT_STATUSES,
  emit,
  emitError,
  isPublicOrder,
  type ExitCode,
  type IngredientStatus,
  type ReprobeOutcome,
} from "../lib/ordering-schemas.js";

const flagValue = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function kitchenVerb(args: string[]): Promise<ExitCode> {
  const sub = args[0];
  const orderId = args[1];
  const cfg = configFromEnv();
  if (!cfg.ok) return emitError(cfg.envelope, cfg.code);

  if (!orderId || orderId.startsWith("--")) {
    return emitError({ error: `usage: kitchen ${sub === "advance" ? "advance" : "probe"} <order_id> [flags]` }, EXIT.USAGE);
  }

  switch (sub) {
    case "probe": {
      const ingredient = flagValue(args, "--ingredient");
      const res = await apiRequest(
        cfg.config,
        "POST",
        `/v1/orders/${encodeURIComponent(orderId)}/reprobe`,
        ingredient ? { ingredient } : {},
        { auth: true },
      );
      if (!res.ok) {
        // Cooldown (429) is a distinct, retryable condition — surface retry_after_unix.
        if (res.envelope.http_status === 429) return emitError({ ...res.envelope, hint: "reprobe cooldown — retry after retry_after_unix" }, EXIT.API_ERROR);
        return emitError(res.envelope, res.code);
      }
      const body = res.body as { order_id?: string; probes?: Record<string, ReprobeOutcome> };
      const probes = body.probes ?? {};
      emit({ order_id: body.order_id ?? orderId, probes });
      const anyAmbiguous = Object.values(probes).some((p) => p.freshness === "ambiguous");
      return anyAmbiguous ? EXIT.AMBIGUOUS : EXIT.OK;
    }

    case "advance": {
      const ingredient = flagValue(args, "--ingredient");
      const status = flagValue(args, "--status");
      const note = flagValue(args, "--note");
      const worldSlug = flagValue(args, "--world-slug");
      if (!ingredient || !status) {
        return emitError({ error: "usage: kitchen advance <order_id> --ingredient <i> --status <s> [--note <text>] [--world-slug <slug>]" }, EXIT.USAGE);
      }
      // Client-side bound: status ∈ server enum — rejected BEFORE any HTTP call (FR-5).
      if (!(INGREDIENT_STATUSES as readonly string[]).includes(status)) {
        return emitError(
          { error: `invalid --status '${status}'`, hint: `one of: ${INGREDIENT_STATUSES.join("|")}` },
          EXIT.USAGE,
        );
      }
      // Client-side bound: ingredient ∈ the order's OWN ingredient set (fetched, never
      // hardcoded). FAIL CLOSED (DISS-001): a drifted or checklist-less GET response must
      // never let the mutating POST proceed unguarded.
      const current = await apiRequest(cfg.config, "GET", `/v1/orders/${encodeURIComponent(orderId)}`);
      if (!current.ok) return emitError(current.envelope, current.code);
      if (!isPublicOrder(current.body)) {
        return emitError(
          { error: "response did not match the PublicOrder contract (shape drift?)", order_id: orderId, hint: "run the differential test: ORDERING_DIFFERENTIAL=1" },
          EXIT.API_ERROR,
        );
      }
      if (!current.body.ingredients) {
        return emitError(
          { error: "order has no ingredients checklist — advance is not applicable", order_id: orderId, hint: "kitchen advance applies to community-onboarding orders" },
          EXIT.AMBIGUOUS,
        );
      }
      if (!(ingredient in current.body.ingredients)) {
        return emitError(
          { error: `ingredient '${ingredient}' not on order`, order_id: orderId, hint: `order has: ${Object.keys(current.body.ingredients).join(", ")}` },
          EXIT.USAGE,
        );
      }

      const res = await apiRequest(
        cfg.config,
        "POST",
        `/v1/orders/${encodeURIComponent(orderId)}/advance-ingredient`,
        {
          ingredient,
          status: status as IngredientStatus,
          ...(worldSlug ? { world_slug: worldSlug } : {}),
          ...(note ? { caller_note: note } : {}),
        },
        { auth: true },
      );
      if (!res.ok) {
        // CAS-lost / state conflicts surface as exit 4 with the server truth attached.
        if (res.envelope.http_status === 409 || /terminal|conflict/i.test(res.envelope.error)) {
          return emitError({ ...res.envelope, order_id: orderId }, EXIT.AMBIGUOUS);
        }
        return emitError(res.envelope, res.code);
      }
      const order = res.body as Record<string, unknown>;
      const audit = Array.isArray(order.operator_audit) ? (order.operator_audit as unknown[]) : [];
      emit({
        order_id: order.order_id,
        state: order.state,
        ingredients: order.ingredients,
        operator_audit_tail: audit.slice(-1)[0] ?? null,
      });
      return EXIT.OK;
    }

    default:
      return emitError({ error: `usage: kitchen <probe|advance> — got '${sub ?? ""}'` }, EXIT.USAGE);
  }
}
