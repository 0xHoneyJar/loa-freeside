/**
 * `freeside-cli order <place|status|ingredients>` (fulfillment-surface S2-T2).
 *
 * Reads/writes the deployed ordering-service via env config (SDD §3.1 rows 1-3).
 * The CLI ships NO preset table (ADR-007 — presets live in the platform's
 * ordering-protocol): unknown presets surface the server's 400 + available_presets
 * verbatim (FR-1).
 */
import { readFileSync } from "node:fs";
import { apiRequest, configFromEnv } from "../lib/ordering-client.js";
import { EXIT, emit, emitError, isPublicOrder, type ExitCode, type PublicOrder } from "../lib/ordering-schemas.js";

function parseInputsArg(raw: string): { ok: true; inputs: unknown } | { ok: false; message: string } {
  try {
    const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
    return { ok: true, inputs: JSON.parse(text) };
  } catch (err) {
    return { ok: false, message: `--inputs is not valid JSON${raw.startsWith("@") ? ` (file ${raw.slice(1)})` : ""}` };
  }
}

const flagValue = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export function guardOrderBody(body: unknown, orderId?: string): { ok: true; order: PublicOrder } | { ok: false; code: ExitCode } {
  if (!isPublicOrder(body)) {
    return {
      ok: false,
      code: emitError(
        { error: "response did not match the PublicOrder contract (shape drift?)", order_id: orderId, hint: "run the differential test: ORDERING_DIFFERENTIAL=1" },
        EXIT.API_ERROR,
      ),
    };
  }
  return { ok: true, order: body };
}

export async function orderVerb(args: string[]): Promise<ExitCode> {
  const sub = args[0];
  const cfg = configFromEnv();
  if (!cfg.ok) return emitError(cfg.envelope, cfg.code);

  switch (sub) {
    case "place": {
      const preset = flagValue(args, "--preset");
      const inputsRaw = flagValue(args, "--inputs");
      if (!preset || !inputsRaw) {
        return emitError(
          { error: "usage: order place --preset <product> --inputs <@file|json>", hint: "inputs must be the preset's input object" },
          EXIT.USAGE,
        );
      }
      const inputs = parseInputsArg(inputsRaw);
      if (!inputs.ok) return emitError({ error: inputs.message }, EXIT.USAGE);

      const placedBy = flagValue(args, "--placed-by") ?? "freeside-cli";
      const res = await apiRequest(cfg.config, "POST", "/v1/orders", {
        product: preset,
        placed_by: placedBy,
        inputs: inputs.inputs,
      });
      if (!res.ok) return emitError(res.envelope, res.code);
      emit(res.body); // { order_id }
      return EXIT.OK;
    }

    case "status": {
      const orderId = args[1];
      if (!orderId || orderId.startsWith("--")) return emitError({ error: "usage: order status <order_id>" }, EXIT.USAGE);
      const res = await apiRequest(cfg.config, "GET", `/v1/orders/${encodeURIComponent(orderId)}`);
      if (!res.ok) return emitError(res.envelope, res.code);
      const guarded = guardOrderBody(res.body, orderId);
      if (!guarded.ok) return guarded.code;
      emit(guarded.order);
      return EXIT.OK;
    }

    case "ingredients": {
      const orderId = args[1];
      if (!orderId || orderId.startsWith("--")) return emitError({ error: "usage: order ingredients <order_id>" }, EXIT.USAGE);
      const res = await apiRequest(cfg.config, "GET", `/v1/orders/${encodeURIComponent(orderId)}`);
      if (!res.ok) return emitError(res.envelope, res.code);
      const guarded = guardOrderBody(res.body, orderId);
      if (!guarded.ok) return guarded.code;
      const order = guarded.order;
      const view: Record<string, unknown> = {};
      for (const [name, status] of Object.entries(order.ingredients ?? {})) {
        const meta = order.probe_meta?.[name];
        view[name] = { status, probed_at_unix: meta?.probed_at_unix, source: meta?.source };
      }
      emit({ order_id: order.order_id, state: order.state, ingredients: view });
      return EXIT.OK;
    }

    default:
      return emitError({ error: `usage: order <place|status|ingredients> — got '${sub ?? ""}'` }, EXIT.USAGE);
  }
}
