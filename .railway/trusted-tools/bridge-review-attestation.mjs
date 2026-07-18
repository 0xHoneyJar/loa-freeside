#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TRUSTED_PERMISSIONS = new Set(['admin', 'maintain']);
const ACCEPTED_REVIEW_STATES = new Set(['APPROVED', 'COMMENTED']);
const SEVERITIES = new Set([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'PRAISE',
  'SPECULATION',
  'REFRAME',
]);
const BLOCKING = new Set(['CRITICAL', 'HIGH', 'MEDIUM']);
const DOCUMENT_KEYS = new Set(['schema_version', 'findings']);
const FINDING_KEYS = new Set([
  'id',
  'title',
  'severity',
  'category',
  'file',
  'description',
  'suggestion',
  'confidence',
  'faang_parallel',
  'metaphor',
  'teachable_moment',
  'connection',
  'decision_trail',
]);
const REQUIRED_STRING_FIELDS = [
  'id',
  'title',
  'severity',
  'category',
  'file',
  'description',
  'suggestion',
];
const OPTIONAL_STRING_FIELDS = [
  'faang_parallel',
  'metaphor',
  'teachable_moment',
  'connection',
  'decision_trail',
];

const pending = (description) => ({ state: 'pending', description });
const failure = (description) => ({ state: 'failure', description });
const success = (description) => ({ state: 'success', description });

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function reviewOrder(review) {
  const timestamp = Date.parse(review?.submitted_at ?? '');
  const id = Number(review?.id);
  return [
    Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
    Number.isSafeInteger(id) ? id : Number.NEGATIVE_INFINITY,
  ];
}

function isLaterReview(candidate, previous) {
  const [candidateTime, candidateId] = reviewOrder(candidate);
  const [previousTime, previousId] = reviewOrder(previous);
  return candidateTime > previousTime || (candidateTime === previousTime && candidateId > previousId);
}

function parseFindings(body) {
  const match = body.match(
    /<!-- bridge-findings-start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- bridge-findings-end -->/,
  );
  if (!match) return null;

  let document;
  try {
    document = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (
    !isRecord(document) ||
    !hasOnlyKeys(document, DOCUMENT_KEYS) ||
    document.schema_version !== 1 ||
    !Array.isArray(document.findings) ||
    document.findings.length === 0
  ) {
    return null;
  }

  const ids = new Set();
  for (const finding of document.findings) {
    if (
      !isRecord(finding) ||
      !hasOnlyKeys(finding, FINDING_KEYS) ||
      REQUIRED_STRING_FIELDS.some(
        (field) => typeof finding[field] !== 'string' || finding[field].length === 0,
      ) ||
      !SEVERITIES.has(finding.severity) ||
      (finding.confidence !== undefined &&
        (typeof finding.confidence !== 'number' ||
          !Number.isFinite(finding.confidence) ||
          finding.confidence < 0 ||
          finding.confidence > 1)) ||
      OPTIONAL_STRING_FIELDS.some(
        (field) =>
          finding[field] !== undefined &&
          (typeof finding[field] !== 'string' || finding[field].length === 0),
      ) ||
      ids.has(finding.id)
    ) {
      return null;
    }
    ids.add(finding.id);
  }
  return document.findings;
}

/**
 * Resolve current authorization state for an exact PR head.
 *
 * The latest review from each reviewer supersedes their earlier history. A
 * candidate must be independent of the PR author, currently APPROVED or
 * COMMENTED (never DISMISSED), carry the exact Bridgebuilder marker, and hold
 * effective maintain/admin permission.
 */
export function evaluateBridgeAttestation({
  reviews,
  headSha,
  prAuthor,
  permissions,
}) {
  if (
    !Array.isArray(reviews) ||
    typeof headSha !== 'string' ||
    typeof prAuthor !== 'string' ||
    !isRecord(permissions)
  ) {
    return failure('Bridgebuilder attestation inputs are malformed');
  }

  const latestByReviewer = new Map();
  for (const review of reviews) {
    const login = review?.user?.login;
    if (review?.commit_id !== headSha || typeof login !== 'string') continue;
    const previous = latestByReviewer.get(login);
    if (!previous || isLaterReview(review, previous)) latestByReviewer.set(login, review);
  }

  const marker = `<!-- bridgebuilder-review: ${headSha} -->`;
  const candidates = [...latestByReviewer.values()]
    .filter((review) => {
      const login = review.user.login;
      return (
        login.toLowerCase() !== prAuthor.toLowerCase() &&
        ACCEPTED_REVIEW_STATES.has(review.state) &&
        TRUSTED_PERMISSIONS.has(permissions[login]) &&
        typeof review.body === 'string' &&
        review.body.includes(marker)
      );
    })
    .sort((a, b) => (isLaterReview(a, b) ? -1 : isLaterReview(b, a) ? 1 : 0));

  const review = candidates[0];
  if (!review) {
    return pending('Awaiting exact-head independent maintainer Bridgebuilder review');
  }

  const findings = parseFindings(review.body);
  if (!findings) return failure('Bridgebuilder findings document is invalid');
  const blocking = findings.filter((finding) => BLOCKING.has(finding.severity));
  if (blocking.length > 0) {
    return failure(`Bridgebuilder found ${blocking.length} blocking trust-root issue(s)`);
  }
  return success('Independent exact-head Bridgebuilder trust-root review passed');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  const reviews = JSON.parse(readFileSync(process.env.REVIEWS_FILE, 'utf8')).flat();
  const permissions = JSON.parse(readFileSync(process.env.PERMISSIONS_FILE, 'utf8'));
  const result = evaluateBridgeAttestation({
    reviews,
    headSha: process.env.HEAD_SHA,
    prAuthor: process.env.PR_AUTHOR,
    permissions,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
