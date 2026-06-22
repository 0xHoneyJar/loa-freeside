/**
 * @freeside/adapters/sonar
 *
 * Belt-gateway Transfer-replay ownership reconstruction for the Shadow Access
 * Audit. Server-side only. The pure core (reconstruct, diff, date→block) is
 * fully unit-tested; the GraphQL transport is a thin, row-validated wrapper.
 */

export {
  ZERO_ADDRESS,
  ReconstructionError,
  type TokenStandard,
  type TransferEvent,
  type HolderBalances,
  type OwnershipAtBlock,
  type HolderDiff,
  type ReconstructionFailure,
} from './types.js';
export {
  reconstructOwnership,
  diffQualification,
  type ReconstructOptions,
} from './reconstruct.js';
export {
  utcBoundaryUnix,
  snapshotDateToBlock,
  type BlockTimeResolver,
  type DateToBlockOptions,
  type SnapshotResolution,
} from './date-to-block.js';
export {
  SonarClient,
  defaultTransferPageFetcher,
  BELT_GATEWAY_ENDPOINT,
  type SonarClientConfig,
  type TransferPageFetcher,
  type TransferPageArgs,
} from './sonar-client.js';
