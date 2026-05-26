import { serve } from "@hono/node-server";
import app from "../src/app.js";

process.on("unhandledRejection", (reason) => {
  console.error("[freeside-operator-dash] unhandledRejection:", reason);
});

const port = Number.parseInt(process.env.PORT ?? "3030", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[freeside-operator-dash] listening on http://0.0.0.0:${info.port} · operator-wallet=${process.env.OPERATOR_WALLET ? `${process.env.OPERATOR_WALLET.slice(0, 6)}…${process.env.OPERATOR_WALLET.slice(-4)}` : "(unset — Soju-lens disabled)"}`,
  );
});
