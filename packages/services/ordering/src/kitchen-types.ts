/**
 * Kitchen types — canonical schemas moved to `@freeside/ordering-protocol` (SDD D7:
 * the public contract lives in the protocol package). Re-exported here so existing
 * service-side imports keep working unchanged.
 */
export {
  EnqueueIngredientKey,
  IngredientJob,
  ProbeSource,
  IngredientProbeMeta,
  OrderProbeMeta,
  OperatorAuditEntry,
  ingredientJobIdempotencyKey,
} from '@freeside/ordering-protocol';
