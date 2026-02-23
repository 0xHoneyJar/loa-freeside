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
  // Cycle 037: Economic ledger schemas
  'CreditLot',
  'LotEntry',
  'UsageEvent',
  'ConservationInvariant',
  'BudgetReservation',
];

// Lazy-initialized discovery document (medium-3: avoids module-level side effects).
// Built on first request, then cached for subsequent calls.
let cachedDiscoveryDocument: ReturnType<typeof buildDiscoveryDocument> | null = null;

function getDiscoveryDocument() {
  if (!cachedDiscoveryDocument) {
    cachedDiscoveryDocument = buildDiscoveryDocument(
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
  }
  return cachedDiscoveryDocument;
}

export const discoveryRouter = Router();

/**
 * GET /.well-known/loa-hounfour
 *
 * Returns the protocol discovery document. No authentication required.
 * Response is cacheable (static content, changes only on deploy).
 */
discoveryRouter.get('/', (_req, res) => {
  try {
    const doc = getDiscoveryDocument();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('ETag', `"hounfour-${CONTRACT_VERSION}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(doc);
  } catch {
    res.status(500).json({ error: 'discovery_document_unavailable' });
  }
});
