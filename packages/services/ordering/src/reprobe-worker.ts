import type { OrderOrchestrator } from './orchestrator.js';
import type { OrderStore } from './store.js';

export function reprobeIntervalMs(): number {
  const sec = Number(process.env.KITCHEN_REPROBE_INTERVAL_SEC ?? 900);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 900_000;
}

export class ReProbeWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: OrderStore,
    private readonly orchestrator: OrderOrchestrator,
    private readonly intervalMs: number = reprobeIntervalMs(),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    const orders = await this.store.listByState('producing');
    for (const order of orders) {
      try {
        await this.orchestrator.process(order.order_id);
      } catch (e) {
        console.error(
          '[ordering-service] reprobe tick failed:',
          order.order_id,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}
