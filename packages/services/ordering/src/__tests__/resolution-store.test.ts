import { describe, expect, it } from "vitest";
import type {
  ConfirmedResolutionRecord,
  ResolutionCreateCommand,
  ResolutionRefreshCommand,
} from "@freeside/collection-resolution-protocol";
import { isDeepFrozen } from "@freeside/collection-resolution-protocol";
import {
  InMemoryResolutionStore,
  type ResolutionSelectionStaleOutcome,
} from "../resolution-store.js";

const baseRecord = (overrides: Partial<ConfirmedResolutionRecord> = {}): ConfirmedResolutionRecord =>
  ({
    schema_version: 1,
    resolution_id: "res_store_1",
    requester_subject: "subject-alice",
    authorization_scope: {
      schema_version: 1,
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "report:create",
    },
    original_request: {
      schema_version: 1,
      identifier: "0xabc",
      environment: "mainnet",
      report_type: "gate_leak",
      report_version: "v1",
      community_ref: "community-alpha",
    },
    request_digest: {
      algorithm: "sha-256",
      domain: "collection-resolution.request",
      major_version: 1,
      digest: "1".repeat(64),
    },
    capability_snapshot_version: {
      registry_epoch: "11111111-1111-4111-8111-111111111111",
      registry_sequence: "1",
    },
    candidate_snapshot: {
      schema_version: 1,
      candidates: [],
      diagnostics: {
        schema_version: 1,
        searched: [],
        timed_out: [],
        unavailable: [],
      },
    },
    candidate_snapshot_digest: {
      algorithm: "sha-256",
      domain: "collection-resolution.candidate-snapshot",
      major_version: 1,
      digest: "2".repeat(64),
    },
    confirmation_version: 0,
    expires_at: "2026-07-16T08:15:00Z",
    created_at: "2026-07-16T08:00:00Z",
    updated_at: "2026-07-16T08:00:00Z",
    ...overrides,
  }) as ConfirmedResolutionRecord;

describe("InMemoryResolutionStore CAS and idempotency", () => {
  it("keeps resolution ids insert-only and does not poison retry idempotency", async () => {
    const store = new InMemoryResolutionStore();
    const first = await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "collision-first",
      },
      command_digest: "digest-collision-first",
      now_ms: 1,
    });
    expect(first.kind).toBe("created");

    const collisionCommand: ResolutionCreateCommand = {
      schema_version: 1,
      identifier: "0xdef",
      environment: "mainnet",
      report_type: "gate_leak",
      report_version: "v1",
      idempotency_key: "collision-second",
    };
    const collision = await store.createAtomic({
      record: baseRecord({
        original_request: {
          ...baseRecord().original_request,
          identifier: "0xdef",
        },
      }),
      command: collisionCommand,
      command_digest: "digest-collision-second",
      now_ms: 2,
    });
    expect(collision.kind).toBe("resolution_id_conflict");
    expect((await store.get("res_store_1"))?.original_request.identifier).toBe("0xabc");

    const retry = await store.createAtomic({
      record: baseRecord({
        resolution_id: "res_store_2",
        original_request: {
          ...baseRecord().original_request,
          identifier: "0xdef",
        },
      }),
      command: collisionCommand,
      command_digest: "digest-collision-second",
      now_ms: 3,
    });
    expect(retry.kind).toBe("created");
    expect(retry.kind === "created" ? retry.record.resolution_id : undefined).toBe(
      "res_store_2",
    );
  });

  it("confirm CAS rejects stale expected versions and retains expires_at", async () => {
    const store = new InMemoryResolutionStore();
    await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "c1",
      },
      command_digest: "digest-create",
      now_ms: 1,
    });

    const first = await store.confirmCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        candidate_snapshot_digest: baseRecord().candidate_snapshot_digest,
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        expected_confirmation_version: 0,
        idempotency_key: "confirm-1",
      },
      command_digest: "digest-confirm-1",
      subject_id: "subject-alice",
      patch: {
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        confirmed_at: "2026-07-16T08:01:00Z",
        updated_at: "2026-07-16T08:01:00Z",
        confirmation_version: 1,
      },
      now_ms: 2,
    });
    expect(first.kind).toBe("confirmed");
    if (first.kind === "confirmed") {
      expect(first.record.expires_at).toBe("2026-07-16T08:15:00Z");
      expect(isDeepFrozen(first.record)).toBe(true);
    }

    const second = await store.confirmCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        candidate_snapshot_digest: baseRecord().candidate_snapshot_digest,
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        expected_confirmation_version: 0,
        idempotency_key: "confirm-2",
      },
      command_digest: "digest-confirm-2",
      subject_id: "subject-alice",
      patch: {
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        confirmed_at: "2026-07-16T08:01:00Z",
        updated_at: "2026-07-16T08:01:00Z",
        confirmation_version: 1,
      },
      now_ms: 3,
    });
    expect(second.kind).toBe("version_conflict");
  });

  it("get returns a frozen clone so callers cannot mutate store truth", async () => {
    const store = new InMemoryResolutionStore();
    await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "c-freeze",
      },
      command_digest: "digest-create-freeze",
      now_ms: 1,
    });

    const first = await store.get("res_store_1");
    expect(first).toBeDefined();
    expect(isDeepFrozen(first)).toBe(true);
    expect(() => {
      (first as { expires_at: string }).expires_at = "tampered";
    }).toThrow();

    const second = await store.get("res_store_1");
    expect(second?.expires_at).toBe("2026-07-16T08:15:00Z");
  });

  it("refresh idempotency lookup conflicts before mutation on digest mismatch", async () => {
    const store = new InMemoryResolutionStore();
    await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "c-refresh",
      },
      command_digest: "digest-create-refresh",
      now_ms: 1,
    });

    const refreshed = await store.refreshCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        expected_confirmation_version: 0,
        idempotency_key: "refresh-1",
      },
      command_digest: "digest-refresh-input",
      accepted_digest: "digest-refresh-accepted",
      subject_id: "subject-alice",
      patch: {
        confirmation_version: 1,
        updated_at: "2026-07-16T08:16:00Z",
        expires_at: "2026-07-16T08:31:00Z",
      },
      now_ms: 2,
    });
    expect(refreshed.kind).toBe("refreshed");

    const conflict = await store.lookupIdempotency({
      operation: "refresh",
      subject_id: "subject-alice",
      idempotency_key: "refresh-1",
      command_digest: "digest-refresh-changed",
      now_ms: 3,
    });
    expect(conflict.kind).toBe("conflict");

    const replay = await store.lookupIdempotency({
      operation: "refresh",
      subject_id: "subject-alice",
      idempotency_key: "refresh-1",
      command_digest: "digest-refresh-input",
      now_ms: 4,
    });
    expect(replay.kind).toBe("replay");
  });

  it("idempotency replay returns historical sealed snapshot after later CAS", async () => {
    const store = new InMemoryResolutionStore();
    const created = await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "create-hist",
      },
      command_digest: "digest-create-hist",
      now_ms: 1,
    });
    expect(created.kind).toBe("created");

    const confirmed = await store.confirmCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        candidate_snapshot_digest: baseRecord().candidate_snapshot_digest,
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        expected_confirmation_version: 0,
        idempotency_key: "confirm-hist",
      },
      command_digest: "digest-confirm-hist",
      subject_id: "subject-alice",
      patch: {
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "3".repeat(64),
          },
        ],
        confirmed_at: "2026-07-16T08:01:00Z",
        updated_at: "2026-07-16T08:01:00Z",
        confirmation_version: 1,
      },
      now_ms: 2,
    });
    expect(confirmed.kind).toBe("confirmed");

    const current = await store.get("res_store_1");
    expect(current?.confirmation_version).toBe(1);

    const replay = await store.lookupIdempotency({
      operation: "create",
      subject_id: "subject-alice",
      idempotency_key: "create-hist",
      command_digest: "digest-create-hist",
      now_ms: 3,
    });
    expect(replay.kind).toBe("replay");
    if (replay.kind === "replay") {
      expect(replay.record.confirmation_version).toBe(0);
      expect(replay.record.selected_deployment_ids).toBeUndefined();
      expect(isDeepFrozen(replay.record)).toBe(true);
    }

    // Current truth remains confirmed — historical replay did not roll back.
    expect((await store.get("res_store_1"))?.confirmation_version).toBe(1);
  });

  it("concurrent stale refresh loser replays the winner's exact observed outcome", async () => {
    const store = new InMemoryResolutionStore();
    await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "create-stale-race",
      },
      command_digest: "digest-create-stale-race",
      now_ms: 1,
    });

    const previousDigest = baseRecord().candidate_snapshot_digest;
    const firstDigest = { ...previousDigest, digest: "4".repeat(64) };
    const secondDigest = { ...previousDigest, digest: "5".repeat(64) };
    const firstStale: ResolutionSelectionStaleOutcome = {
      reason: "deployment_changed",
      previous_candidate_snapshot_digest: previousDigest,
      current_candidate_snapshot_digest: firstDigest,
    };
    const secondStale: ResolutionSelectionStaleOutcome = {
      reason: "recognition_changed",
      previous_candidate_snapshot_digest: previousDigest,
      current_candidate_snapshot_digest: secondDigest,
    };
    const command: ResolutionRefreshCommand = {
      schema_version: 1,
      expected_confirmation_version: 0,
      idempotency_key: "refresh-stale-race",
    };

    const outcomes = await Promise.all([
      store.refreshCas({
        resolution_id: "res_store_1",
        expected_confirmation_version: 0,
        command,
        command_digest: "digest-refresh-stale-race",
        accepted_digest: "accepted-first",
        selection_stale: firstStale,
        subject_id: "subject-alice",
        patch: {
          candidate_snapshot_digest: firstDigest,
          confirmation_version: 1,
          updated_at: "2026-07-16T08:01:00Z",
          clear_selection: true,
        },
        now_ms: 2,
      }),
      store.refreshCas({
        resolution_id: "res_store_1",
        expected_confirmation_version: 0,
        command,
        command_digest: "digest-refresh-stale-race",
        accepted_digest: "accepted-second",
        selection_stale: secondStale,
        subject_id: "subject-alice",
        patch: {
          candidate_snapshot_digest: secondDigest,
          confirmation_version: 1,
          updated_at: "2026-07-16T08:02:00Z",
          clear_selection: true,
        },
        now_ms: 2,
      }),
    ]);
    const winner = outcomes.find((outcome) => outcome.kind === "refreshed");
    const loser = outcomes.find((outcome) => outcome.kind === "replay");
    if (winner?.kind !== "refreshed" || loser?.kind !== "replay") {
      throw new Error("expected one stale refresh winner and one replaying loser");
    }

    expect(loser.selection_stale).toEqual(winner.selection_stale);
    expect(loser.record).toEqual(winner.record);
    expect(await store.get("res_store_1")).toEqual(winner.record);
  });

  it("rejects cross-subject confirm and refresh at the CAS boundary", async () => {
    const store = new InMemoryResolutionStore();
    await store.createAtomic({
      record: baseRecord(),
      command: {
        schema_version: 1,
        identifier: "0xabc",
        environment: "mainnet",
        report_type: "gate_leak",
        report_version: "v1",
        idempotency_key: "create-subject-boundary",
      },
      command_digest: "digest-create-subject-boundary",
      now_ms: 1,
    });

    const confirm = await store.confirmCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        candidate_snapshot_digest: baseRecord().candidate_snapshot_digest,
        selected_deployment_ids: [],
        expected_confirmation_version: 0,
        idempotency_key: "cross-subject-confirm",
      },
      command_digest: "digest-cross-subject-confirm",
      subject_id: "subject-bob",
      patch: {
        selected_deployment_ids: [],
        confirmed_at: "2026-07-16T08:01:00Z",
        updated_at: "2026-07-16T08:01:00Z",
        confirmation_version: 1,
      },
      now_ms: 2,
    });
    const refresh = await store.refreshCas({
      resolution_id: "res_store_1",
      expected_confirmation_version: 0,
      command: {
        schema_version: 1,
        expected_confirmation_version: 0,
        idempotency_key: "cross-subject-refresh",
      },
      command_digest: "digest-cross-subject-refresh",
      subject_id: "subject-bob",
      patch: {
        confirmation_version: 1,
        updated_at: "2026-07-16T08:01:00Z",
      },
      now_ms: 2,
    });

    expect(confirm.kind).toBe("subject_mismatch");
    expect(refresh.kind).toBe("subject_mismatch");
    expect(store.idempotencySize()).toBe(1);
    expect((await store.get("res_store_1"))?.confirmation_version).toBe(0);
  });
});
