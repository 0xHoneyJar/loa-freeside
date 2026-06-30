/**
 * order-intake composition root (MVP thin slice).
 *
 * Serves the intake HTTP edge over an in-memory store — the fastest path to a placeable order
 * + polling status. The OrderNatsConsumer runtime mount (subscribe `placed`, drive the
 * orchestrator, drain the outbox) and the concrete audit `AuditDeps` wiring are the deploy
 * step (SDD §13 M-10 / §8) — see `OrderOrchestrator` + `DeclaredLocalAuditAdapter`.
 */
import { serve } from '@hono/node-server';
import { createIntakeApp, InMemoryOrderStore } from '../src/index.js';

const store = new InMemoryOrderStore();
const app = createIntakeApp({ store, now: () => Date.now() });

const port = Number(process.env.PORT ?? 8090);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.log(`order-intake listening on :${port}`);
