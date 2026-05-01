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

// Bridgebuilder F2: version-string allowlist. KV value MUST match this shape
// before being interpolated into a URI. Guards against:
//   - empty / undefined values (defensive even if kvs.get's contract is to throw)
//   - malformed pointers containing `/`, `..`, whitespace, control chars
//   - any value that could escape the path or produce an invalid S3 key
const VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;

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
    return notFound();
  }

  // Bridgebuilder F2: explicit validation. Even if kvs.get resolves successfully,
  // the value must match VERSION_PATTERN before being used in the URI rewrite.
  // A malformed pointer would produce a broken or unsafe path; defensive 404
  // is the safe failure mode.
  if (!version || !VERSION_PATTERN.test(version)) {
    return notFound();
  }

  // Rewrite to immutable versioned bytes path on S3 origin.
  // Note: CloudFront Functions on viewer-request rewrite the URI BEFORE the
  // cache lookup, so the cache key uses the rewritten path. This means the
  // same versioned bytes URL caches identically whether reached through the
  // manifest pointer or directly via the versioned URL — intentional.
  request.uri = `/${collection}/metadata/v/${version}/${tokenId}.json`;
  return request;
}

function notFound() {
  // Bridgebuilder F7: status-only response (no body) — the most reliable
  // shape for cloudfront-js-2.0 viewer-request generated responses.
  return {
    statusCode: 404,
    statusDescription: 'Not Found',
  };
}

// Note: cloudfront-js-2.0 auto-discovers a top-level `handler` function by
// name. An explicit `export { handler };` was tried (Bridgebuilder F1) but
// causes the runtime to error with "The CloudFront function associated with
// the CloudFront distribution is invalid or could not run." Confirmed via
// 2026-05-01 production smoke (503 on metadata.* requests). Convention: no
// export statement; the runtime discovers `handler` automatically.
