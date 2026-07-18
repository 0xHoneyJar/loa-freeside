import {
  buildDependencyLedgerFixtureRegistryDocument,
} from "@freeside/dependency-ledger-protocol";
import {
  buildTimeHealthSnapshot,
  PinnedKeyRegistry,
  type KeyCustodyClass,
} from "@freeside/signing-key-custody-protocol";
import type { TrustEnvelope } from "@freeside/trust-envelope-protocol";
import type { DependencyLedgerStore } from "./dependency-ledger-store.js";

export interface DependencyLedgerServiceOptions {
  readonly store: DependencyLedgerStore;
  readonly now: () => number;
  readonly intakeContext?: KeyCustodyClass;
  readonly registryDocument?: ReturnType<typeof buildDependencyLedgerFixtureRegistryDocument>;
}

export class DependencyLedgerService {
  private readonly store: DependencyLedgerStore;
  private readonly now: () => number;
  private readonly intakeContext: KeyCustodyClass;
  private readonly pinnedRegistry: PinnedKeyRegistry;

  constructor(options: DependencyLedgerServiceOptions) {
    this.store = options.store;
    this.now = options.now;
    this.intakeContext = options.intakeContext ?? "fixture";
    this.pinnedRegistry = new PinnedKeyRegistry(
      options.registryDocument ?? buildDependencyLedgerFixtureRegistryDocument(),
    );
  }

  ingestEnvelope(envelope: TrustEnvelope) {
    const acceptedAtMs = this.now();
    const timeHealth = buildTimeHealthSnapshot({
      evaluatedAtMs: acceptedAtMs,
      databaseUnixMs: acceptedAtMs,
      authoritativeSources: [
        {
          source_id: "ordering-db",
          observed_at: new Date(acceptedAtMs).toISOString(),
          unix_ms: acceptedAtMs,
          uncertainty_ms: 0,
        },
        {
          source_id: "ordering-ntp",
          observed_at: new Date(acceptedAtMs).toISOString(),
          unix_ms: acceptedAtMs,
          uncertainty_ms: 5,
        },
      ],
    });

    return this.store.ingestEnvelope({
      envelope,
      pinnedRegistry: this.pinnedRegistry,
      timeHealth,
      acceptedAtMs,
      intakeContext: this.intakeContext,
    });
  }

  getDerivative(derivativeKey: string) {
    return this.store.getDerivative(derivativeKey);
  }

  metrics() {
    return this.store.snapshotMetrics();
  }
}

export const createFixtureDependencyLedgerService = (
  store: DependencyLedgerStore,
  now: () => number = () => Date.now(),
): DependencyLedgerService =>
  new DependencyLedgerService({ store, now, intakeContext: "fixture" });
