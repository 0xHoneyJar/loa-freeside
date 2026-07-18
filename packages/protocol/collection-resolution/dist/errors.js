import { Data } from "effect";
export class SelectionStaleError extends Data.TaggedError("SelectionStaleError") {
}
export class IdempotencyConflictError extends Data.TaggedError("IdempotencyConflictError") {
}
export class ConcurrentConfirmationError extends Data.TaggedError("ConcurrentConfirmationError") {
}
export class ResolutionNotFoundError extends Data.TaggedError("ResolutionNotFoundError") {
}
export class ResolutionExpiredError extends Data.TaggedError("ResolutionExpiredError") {
}
export class SelectionRejectedError extends Data.TaggedError("SelectionRejectedError") {
}
export class AuthorizationScopeMismatchError extends Data.TaggedError("AuthorizationScopeMismatchError") {
}
export class ConfirmationVersionConflictError extends Data.TaggedError("ConfirmationVersionConflictError") {
}
export class CapabilityViewStaleError extends Data.TaggedError("CapabilityViewStaleError") {
}
export class OrderBindingRejectedError extends Data.TaggedError("OrderBindingRejectedError") {
}
export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError") {
}
export class ImmutableRequestMismatchError extends Data.TaggedError("ImmutableRequestMismatchError") {
}
