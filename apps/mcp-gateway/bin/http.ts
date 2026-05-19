import { serve } from "@hono/node-server";
import app from "../src/app.js";

// Hotfix 2026-05-04: process-level safety net. The cycle-C broadcast layer
// fires beacon fetches at module load. Even with .catch() wrapping at the
// call sites, a defense-in-depth handler prevents any future unhandled
// rejection from killing the gateway. Logs to stderr so Railway captures it.
process.on("unhandledRejection", (reason) => {
  console.error("[freeside-mcp-gateway] unhandledRejection:", reason);
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[freeside-mcp-gateway] listening on http://0.0.0.0:${info.port} · gateway-origin=${process.env.GATEWAY_ORIGIN ?? "https://mcp.0xhoneyjar.xyz"}`,
  );
});
