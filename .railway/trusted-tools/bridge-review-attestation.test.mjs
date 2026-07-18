import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBridgeAttestation } from './bridge-review-attestation.mjs';

const HEAD = 'a'.repeat(40);

function finding(severity = 'PRAISE') {
  return {
    id: 'BB-001',
    title: 'A grounded finding',
    severity,
    category: 'security',
    file: 'example.ts:1',
    description: 'Evidence-backed description.',
    suggestion: 'Retain the invariant.',
    confidence: 0.99,
    faang_parallel: 'Comparable control.',
    metaphor: 'A precise metaphor.',
    teachable_moment: 'A useful lesson.',
    connection: 'A relevant connection.',
  };
}

function body(findings = [finding()]) {
  return [
    '<!-- bridge-findings-start -->',
    '```json',
    JSON.stringify({ schema_version: 1, findings }),
    '```',
    '<!-- bridge-findings-end -->',
    `<!-- bridgebuilder-review: ${HEAD} -->`,
  ].join('\n');
}

function review(overrides = {}) {
  return {
    id: 1,
    commit_id: HEAD,
    submitted_at: '2026-07-18T00:00:00Z',
    state: 'COMMENTED',
    body: body(),
    user: { login: 'maintainer' },
    ...overrides,
  };
}

function evaluate(reviews, overrides = {}) {
  return evaluateBridgeAttestation({
    reviews,
    headSha: HEAD,
    prAuthor: 'author',
    permissions: { maintainer: 'maintain', author: 'admin' },
    ...overrides,
  });
}

test('accepts a non-author maintainer exact-head review with no blocking findings', () => {
  assert.equal(evaluate([review()]).state, 'success');
});

test('rejects a review from the pull-request author', () => {
  const result = evaluate(
    [review({ user: { login: 'author' } })],
    { permissions: { author: 'admin' } },
  );
  assert.equal(result.state, 'pending');
});

test('rejects a reviewer below maintain permission', () => {
  const result = evaluate([review()], { permissions: { maintainer: 'write' } });
  assert.equal(result.state, 'pending');
});

test('a dismissed latest review revokes an earlier attestation', () => {
  const earlier = review();
  const dismissed = review({
    id: 2,
    submitted_at: '2026-07-18T00:01:00Z',
    state: 'DISMISSED',
  });
  assert.equal(evaluate([earlier, dismissed]).state, 'pending');
});

test('a later non-Bridgebuilder review supersedes an earlier attestation', () => {
  const earlier = review();
  const replacement = review({
    id: 2,
    submitted_at: '2026-07-18T00:01:00Z',
    body: 'review replaced without an attestation marker',
  });
  assert.equal(evaluate([earlier, replacement]).state, 'pending');
});

test('fails closed on an empty findings document', () => {
  const result = evaluate([review({ body: body([]) })]);
  assert.equal(result.state, 'failure');
  assert.match(result.description, /invalid/);
});

test('fails closed on an unknown severity', () => {
  const result = evaluate([review({ body: body([finding('IMPORTANT')]) })]);
  assert.equal(result.state, 'failure');
});

test('fails when a valid exact-head review contains a medium finding', () => {
  const result = evaluate([review({ body: body([finding('MEDIUM')]) })]);
  assert.equal(result.state, 'failure');
  assert.match(result.description, /1 blocking/);
});
