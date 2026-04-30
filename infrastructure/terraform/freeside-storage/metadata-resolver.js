// =============================================================================
// metadata-resolver — CloudFront Function (viewer-request)
// =============================================================================
//
// Resolves stable metadata URLs to versioned S3 paths via KeyValueStore.
//
// Design (Cutover B per migrate-mibera-sovereignty-2026-04-30):
//
//   GET https://metadata.0xhoneyjar.xyz/{collection}/{tokenId}
//        │
//        ▼  (this function reads KV at the edge)
//        kvs.get(`${collection}:current_version`)  →  e.g.  "2026-04-30"
//        │
//        ▼  (rewrite request URI)
//   GET https://metadata.0xhoneyjar.xyz/{collection}/metadata/v/{version}/{tokenId}.json
//        │
//        ▼  (CloudFront caches on rewritten path; S3 origin serves bytes)
//   s3://thj-assets/{collection}/metadata/v/{version}/{tokenId}.json
//
// Pass-through: any request that doesn't match the {collection}/{tokenId} shape
// (e.g. /manifest.json, static/versioned paths) is left untouched. Same function
// runs for both metadata.0xhoneyjar.xyz and assets.0xhoneyjar.xyz aliases —
// the path regex acts as the host-implicit gate (assets paths never match it).
//
// Constraints (CloudFront Functions):
//   - Hard 10ms execution time
//   - 2 KB max compiled code size
//   - No subrequests (only KV reads + URI rewrite + header set)
//   - cloudfront-js-2.0 runtime required for KV access
//
// =============================================================================

import cf from 'cloudfront';

// KV handle is bound at function-association time (Function-Association.KeyValueStoreAssociations).
const kvs = cf.kvs();

async function handler(event) {
  const request = event.request;

  // Match /{collection}/{tokenId} — lowercase collection slug, numeric token id.
  // Any path that doesn't match (versioned paths, static files) passes through.
  const match = request.uri.match(/^\/([a-z][a-z0-9-]*)\/(\d+)$/);
  if (!match) {
    return request;
  }

  const collection = match[1];
  const tokenId = match[2];

  // Resolve current version pointer for this collection.
  let version;
  try {
    version = await kvs.get(`${collection}:current_version`);
  } catch (e) {
    // Pointer missing for this collection — return 404 rather than serve a
    // stale or unrelated path.
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: {
        'content-type': { value: 'text/plain' },
      },
      body: `No current_version pointer for collection: ${collection}`,
    };
  }

  // Rewrite to immutable versioned bytes path on S3 origin.
  request.uri = `/${collection}/metadata/v/${version}/${tokenId}.json`;
  return request;
}
