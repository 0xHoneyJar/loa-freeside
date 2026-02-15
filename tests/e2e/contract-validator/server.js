/**
 * Contract Validator Service
 *
 * Lightweight JSON Schema validator for cross-system contract testing.
 * Validates payloads against loa-hounfour protocol schemas.
 *
 * Sprint 256, Task 5.1
 *
 * POST /validate — Validate a payload against a named schema
 * GET /health — Health check
 * GET /schemas — List available schemas
 */

import express from 'express';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const app = express();
app.use(express.json());

// =============================================================================
// Schema Loading
// =============================================================================

const SCHEMAS_DIR = process.env.SCHEMAS_DIR || '/schemas';
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemas = new Map();

function loadSchemas() {
  if (!existsSync(SCHEMAS_DIR)) {
    console.warn(`Schemas directory not found: ${SCHEMAS_DIR}`);
    // Load built-in schemas
    loadBuiltinSchemas();
    return;
  }

  const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf-8'));
      const name = basename(file, '.json');
      ajv.addSchema(schema, name);
      schemas.set(name, schema);
      console.log(`Loaded schema: ${name}`);
    } catch (err) {
      console.error(`Failed to load schema ${file}:`, err.message);
    }
  }

  // Always load built-in schemas (they won't override mounted ones)
  loadBuiltinSchemas();
}

function loadBuiltinSchemas() {
  // BillingEntry schema (loa-hounfour protocol)
  if (!schemas.has('billing-entry')) {
    const billingEntrySchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'billing-entry',
      title: 'BillingEntry',
      description: 'loa-hounfour BillingEntry protocol type',
      type: 'object',
      required: ['entry_id', 'account_id', 'total_micro', 'entry_type', 'created_at', 'contract_version'],
      properties: {
        entry_id: { type: 'string', minLength: 1 },
        account_id: { type: 'string', minLength: 1 },
        total_micro: { type: 'string', pattern: '^[0-9]+$' },
        entry_type: {
          type: 'string',
          enum: [
            'deposit', 'reserve', 'finalize', 'release', 'refund',
            'grant', 'shadow_charge', 'shadow_reserve', 'shadow_finalize',
            'commons_contribution', 'revenue_share',
            'marketplace_sale', 'marketplace_purchase',
            'escrow', 'escrow_release',
          ],
        },
        reference_id: { type: ['string', 'null'] },
        created_at: { type: 'string', format: 'date-time' },
        metadata: { type: ['string', 'null'] },
        contract_version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
      },
      additionalProperties: false,
    };
    ajv.addSchema(billingEntrySchema, 'billing-entry');
    schemas.set('billing-entry', billingEntrySchema);
    console.log('Loaded built-in schema: billing-entry');
  }

  // Anchor verification response schema
  if (!schemas.has('anchor-verification')) {
    const anchorVerificationSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'anchor-verification',
      title: 'AnchorVerificationResponse',
      description: 'S2S anchor verification response',
      type: 'object',
      required: ['verified'],
      properties: {
        verified: { type: 'boolean' },
        anchor_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
        checked_at: { type: 'string', format: 'date-time' },
        reason: {
          type: 'string',
          enum: ['anchor_mismatch', 'no_anchor_bound', 'account_not_found'],
        },
      },
      if: { properties: { verified: { const: true } } },
      then: { required: ['verified', 'anchor_hash', 'checked_at'] },
      else: { required: ['verified', 'reason', 'checked_at'] },
    };
    ajv.addSchema(anchorVerificationSchema, 'anchor-verification');
    schemas.set('anchor-verification', anchorVerificationSchema);
    console.log('Loaded built-in schema: anchor-verification');
  }
}

loadSchemas();

// =============================================================================
// Routes
// =============================================================================

app.post('/validate', (req, res) => {
  const { schema, payload } = req.body;

  if (!schema || !payload) {
    return res.status(400).json({
      valid: false,
      errors: ['Missing required fields: schema, payload'],
    });
  }

  const validate = ajv.getSchema(schema);
  if (!validate) {
    return res.status(404).json({
      valid: false,
      errors: [`Unknown schema: ${schema}. Available: ${[...schemas.keys()].join(', ')}`],
    });
  }

  const valid = validate(payload);

  if (valid) {
    res.json({ valid: true });
  } else {
    res.json({
      valid: false,
      errors: validate.errors?.map(e => `${e.instancePath || '/'}: ${e.message}`) ?? [],
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'contract-validator',
    schemas: [...schemas.keys()],
    timestamp: new Date().toISOString(),
  });
});

app.get('/schemas', (_req, res) => {
  res.json({
    schemas: Object.fromEntries(schemas),
  });
});

// =============================================================================
// Server
// =============================================================================

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`Contract validator listening on port ${PORT}`);
  console.log(`Available schemas: ${[...schemas.keys()].join(', ')}`);
});
