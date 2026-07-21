import { Effect } from "effect";
import type { VersionedDigest } from "@freeside/collection-protocol";
import type { CandidateSnapshot } from "./contracts.js";
import { SelectionRejectedError } from "./errors.js";
export interface ValidatedSelection {
    readonly selected_deployment_ids: ReadonlyArray<VersionedDigest>;
    readonly selected_collection_id: VersionedDigest | undefined;
    readonly candidate_index: number;
}
/**
 * A valid selection is exactly one candidate deployment, or a non-empty subset
 * of one explicitly evidenced logical-equivalence group. Cross-candidate
 * composition, address-only identity, and alias guessing are refused.
 */
export declare const validateSelection: (snapshot: CandidateSnapshot, selectedDeploymentIds: ReadonlyArray<VersionedDigest>) => Effect.Effect<ValidatedSelection, SelectionRejectedError>;
/** Refuse address-only or client-invented identity material at the selection boundary. */
export declare const rejectAddressOnlyIdentity: (input: Readonly<Record<string, unknown>>) => Effect.Effect<void, SelectionRejectedError>;
//# sourceMappingURL=selection.d.ts.map