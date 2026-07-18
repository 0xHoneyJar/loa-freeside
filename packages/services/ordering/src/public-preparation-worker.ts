import { PublicPreparationAdapter } from "./public-preparation-adapter.js";
import { publicPrepWorkerIntervalMs } from "./public-preparation-constants.js";

export class PublicPreparationWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly adapter: PublicPreparationAdapter,
    private readonly intervalMs: number = publicPrepWorkerIntervalMs(),
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
    await this.adapter.tick();
  }
}
