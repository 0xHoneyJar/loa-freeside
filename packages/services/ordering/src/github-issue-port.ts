import type { EnqueueIngredientKey } from './kitchen-types.js';

export interface GitHubIssueResult {
  url: string;
  number: number;
}

export interface GitHubIssuePort {
  ensureIssue(args: {
    repo: string;
    title: string;
    body: string;
    labels: string[];
    idempotencyKey: string;
  }): Promise<GitHubIssueResult>;
}

export class RecordingGitHubIssuePort implements GitHubIssuePort {
  readonly issues: Array<{ repo: string; title: string; body: string; labels: string[]; idempotencyKey: string }> = [];
  private seq = 1;
  private readonly byKey = new Map<string, GitHubIssueResult>();

  async ensureIssue(args: {
    repo: string;
    title: string;
    body: string;
    labels: string[];
    idempotencyKey: string;
  }): Promise<GitHubIssueResult> {
    const existing = this.byKey.get(args.idempotencyKey);
    if (existing) return existing;

    this.issues.push(args);
    const number = this.seq++;
    const result = { url: `https://github.com/${args.repo}/issues/${number}`, number };
    this.byKey.set(args.idempotencyKey, result);
    return result;
  }
}

export class FetchGitHubIssuePort implements GitHubIssuePort {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async ensureIssue(args: {
    repo: string;
    title: string;
    body: string;
    labels: string[];
    idempotencyKey: string;
  }): Promise<GitHubIssueResult> {
    const [owner, repo] = args.repo.split('/');
    if (!owner || !repo) throw new Error(`invalid repo: ${args.repo}`);

    const searchTitle = encodeURIComponent(`[order] ${args.idempotencyKey}`);
    const searchRes = await this.fetchImpl(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+in:title+${searchTitle}&per_page=1`,
      { headers: this.headers() },
    );
    if (searchRes.ok) {
      const searchJson = (await searchRes.json()) as { items?: { html_url: string; number: number }[] };
      const hit = searchJson.items?.[0];
      if (hit) return { url: hit.html_url, number: hit.number };
    }

    const createRes = await this.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        title: args.title,
        body: args.body,
        labels: args.labels,
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`GitHub issue create failed: ${createRes.status} ${text}`);
    }
    const created = (await createRes.json()) as { html_url: string; number: number };
    return { url: created.html_url, number: created.number };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

export function createGitHubIssuePort(): GitHubIssuePort | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  return new FetchGitHubIssuePort(token);
}

export function repoForIngredient(ingredient: EnqueueIngredientKey): string | null {
  switch (ingredient) {
    case 'sonar':
      return process.env.KITCHEN_ISSUE_REPO_SONAR?.trim() ?? '0xHoneyJar/sonar-api';
    case 'score':
      return process.env.KITCHEN_ISSUE_REPO_SCORE?.trim() ?? '0xHoneyJar/score-api';
    case 'worlds_manifest':
      return process.env.KITCHEN_ISSUE_REPO_WORLDS?.trim() ?? '0xHoneyJar/worlds-api';
  }
}

export function buildIssueBody(args: {
  ingredient: EnqueueIngredientKey;
  orderId: string;
  contactEmail: string;
  chainId: string;
  contractAddress: string;
  communityName?: string;
  placedAtIso: string;
}): string {
  const name = args.communityName ? ` (${args.communityName})` : '';
  const base = [
    `## Community onboarding — ${args.ingredient}`,
    '',
    `**Order:** \`${args.orderId}\``,
    `**Placed:** ${args.placedAtIso}`,
    `**Contact:** ${args.contactEmail}${name}`,
    `**Chain:** ${args.chainId}`,
    `**Contract:** \`${args.contractAddress}\``,
    '',
  ];

  const advance = `\`\`\`bash
curl -X POST "$ORDERING_SERVICE_URL/v1/orders/${args.orderId}/advance-ingredient" \\
  -H "Authorization: Bearer $SERVICE_TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"ingredient":"${args.ingredient}","status":"complete"${args.ingredient === 'worlds_manifest' ? ',"world_slug":"YOUR_SLUG"' : ''}}'
\`\`\``;

  return [...base, '### Operator checklist', '', `- [ ] Complete ${args.ingredient} triage`, '- [ ] Run advance curl when done', '', advance].join('\n');
}

export function issueTitle(orderId: string, ingredient: EnqueueIngredientKey): string {
  return `[community-onboarding] ${ingredient} · order ${orderId.slice(0, 8)}`;
}

export function issueLabels(orderId: string, ingredient: EnqueueIngredientKey): string[] {
  return ['community-onboarding', `ingredient/${ingredient}`, `order/${orderId}`];
}
