/**
 * Protocol Discovery Endpoint — /.well-known/loa-hounfour
 * Sprint 324, Task 3.1: Canonical protocol discovery via hounfour v7.0.0
 *
 * Public endpoint that advertises Freeside's protocol capabilities,
 * supported versions, and available features. Enables cross-system
 * protocol negotiation per the v7.0.0 ProtocolDiscovery schema.
 *
 * @see hounfour v7.0.0 ProtocolDiscovery schema
 * @see Sprint 324 Task 3.1 acceptance criteria
 */

import { Router } from 'express';
import {
  buildDiscoveryDocument,
  CONTRACT_VERSION,
  SCHEMA_BASE_URL,
} from '@0xhoneyjar/loa-hounfour';

/** Canonical schema names advertised by this endpoint. */
const ADVERTISED_SCHEMAS = [
  'DomainEvent',
  'DomainEventBatch',
  'StreamEvent',
  'CompletionRequest',
  'CompletionResult',
  'RoutingPolicy',
  'Conversation',
  'EscrowEntry',
  'MonetaryPolicy',
  'MintingPolicy',
  'AgentIdentity',
  'ProtocolDiscovery',
];

// Build the discovery document once at import time (static content).
// Schema IDs follow canonical format: {SCHEMA_BASE_URL}/{CONTRACT_VERSION}/{schema-name}
const discoveryDocument = buildDiscoveryDocument(
  ADVERTISED_SCHEMAS.map(name => `${SCHEMA_BASE_URL}/${CONTRACT_VERSION}/${name}`),
  {
    aggregateTypes: [
      'billing',
      'agent',
      'conversation',
      'transfer',
      'tool',
    ],
  },
);

export const discoveryRouter = Router();

/**
 * GET /.well-known/loa-hounfour
 *
 * Returns the protocol discovery document. No authentication required.
 * Response is cacheable (static content, changes only on deploy).
 */
discoveryRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('ETag', `"hounfour-${CONTRACT_VERSION}"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(discoveryDocument);
});
