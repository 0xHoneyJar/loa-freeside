/**
 * Worldline coherence · score-api production URL (loa-freeside#417)
 * Platform-domain guard — ADR-007 §D-3 (lives under packages/services/, not network registry).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../../../..');

export const SCORE_API_CANONICAL_PUBLIC_URL = 'https://score.0xhoneyjar.xyz';

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

describe('worldline score-api coherence (#417)', () => {
  it('world-freeside.tf SCORE_API_URL matches canonical public URL', () => {
    const tf = readRepoFile('infrastructure/terraform/world-freeside.tf');
    expect(tf).toMatch(
      new RegExp(
        `SCORE_API_URL\\s*=\\s*"${SCORE_API_CANONICAL_PUBLIC_URL.replace(/\./g, '\\.')}"`,
      ),
    );
  });

  it('world-score-api.tf is marked DORMANT (ECS experiment, not prod)', () => {
    const tf = readRepoFile('infrastructure/terraform/world-score-api.tf');
    expect(tf).toMatch(/DORMANT/i);
    expect(tf).toMatch(/Railway/i);
  });

  it('dns worlds list excludes score-api ALB subdomain', () => {
    const tf = readRepoFile('infrastructure/terraform/dns/honeyjar-xyz-worlds.tf');
    const setMatch = tf.match(
      /world_subdomains\s*=\s*var\.enable_production_api\s*\?\s*toset\(\[([\s\S]*?)\]\)/,
    );
    expect(setMatch).toBeTruthy();
    expect(setMatch![1]).not.toMatch(/"score-api"/);
  });

  it('dns railway file declares score. CNAME to Railway', () => {
    const tf = readRepoFile('infrastructure/terraform/dns/honeyjar-xyz-railway.tf');
    expect(tf).toMatch(/score-api-production\.up\.railway\.app/);
    expect(tf).toMatch(/name\s*=\s*"score\.\$\{var\.domain\}"/);
  });

  it('ordering community-register fallback uses canonical score-api URL', () => {
    const src = readRepoFile('packages/services/ordering/src/composition.ts');
    expect(src).toMatch(
      /endpoint:\s*process\.env\.SCORE_API_URL\?\.trim\(\)\s*\|\|\s*'https:\/\/score\.0xhoneyjar\.xyz'/,
    );
  });
});
