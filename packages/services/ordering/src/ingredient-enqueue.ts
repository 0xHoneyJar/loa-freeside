import { CommunityOnboardingInputs, INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS } from '@freeside/ordering-protocol';

import {
  buildIssueBody,
  issueLabels,
  issueTitle,
  repoForIngredient,
  type GitHubIssuePort,
} from './github-issue-port.js';
import {
  type EnqueueIngredientKey,
  type IngredientJob,
  ingredientJobIdempotencyKey,
} from './kitchen-types.js';
import { fireCommunityOnboardingIssueLinks } from './order-ops-webhook.js';
import type { OrderStore } from './store.js';

const ENQUEUE_INGREDIENTS: EnqueueIngredientKey[] = ['sonar', 'score', 'worlds_manifest'];

export function kitchenEnqueueEnabled(): boolean {
  const raw = process.env.KITCHEN_ENQUEUE_ENABLED?.trim();
  if (raw === 'false') return false;
  return true;
}

export class IngredientEnqueueService {
  constructor(
    private readonly store: OrderStore,
    private readonly github: GitHubIssuePort | null,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async enqueueMissing(orderId: string): Promise<void> {
    if (!kitchenEnqueueEnabled() || !this.github) return;

    const record = await this.store.get(orderId);
    if (!record || record.product !== 'community-onboarding') return;

    const parsed = CommunityOnboardingInputs.safeParse(record.inputs);
    if (!parsed.success) return;

    const inputs = parsed.data;
    const ingredients = record.ingredients ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS;
    const existingJobs = record.ingredient_jobs ?? [];
    const jobsByIngredient = new Map(existingJobs.map((j) => [j.ingredient, j]));

    let jobs = [...existingJobs];
    let dirty = false;
    const newJobs: IngredientJob[] = [];
    const nextIngredients = { ...ingredients };

    for (const ingredient of ENQUEUE_INGREDIENTS) {
      if (ingredients[ingredient] !== 'pending') continue;
      if (jobsByIngredient.has(ingredient)) continue;

      const repo = repoForIngredient(ingredient);
      if (!repo) continue;

      const idempotencyKey = ingredientJobIdempotencyKey(orderId, ingredient);
      const placedAtIso = new Date(record.placed_at_unix * 1000).toISOString();

      try {
        const issue = await this.github.ensureIssue({
          repo,
          title: issueTitle(orderId, ingredient),
          body: buildIssueBody({
            ingredient,
            orderId,
            contactEmail: inputs.contact_email,
            chainId: inputs.chain_id,
            contractAddress: inputs.contract_address,
            communityName: inputs.community_name,
            placedAtIso,
          }),
          labels: issueLabels(orderId, ingredient),
          idempotencyKey,
        });

        const job: IngredientJob = {
          ingredient,
          kind: 'github_issue',
          external_ref: issue.url,
          external_id: String(issue.number),
          repo,
          idempotency_key: idempotencyKey,
          enqueued_at_unix: this.now(),
        };
        jobs = [...jobs, job];
        newJobs.push(job);
        jobsByIngredient.set(ingredient, job);
        nextIngredients[ingredient] = 'in_progress';
        dirty = true;
      } catch (e) {
        console.error(
          '[ordering-service] ingredient enqueue failed:',
          ingredient,
          e instanceof Error ? e.message : e,
        );
      }
    }

    if (dirty) {
      await this.store.patchRecord(orderId, {
        ingredient_jobs: jobs,
        ingredients: nextIngredients,
      });
      fireCommunityOnboardingIssueLinks({
        order_id: orderId,
        contact_email: inputs.contact_email,
        contract_address: inputs.contract_address,
        chain_id: inputs.chain_id,
        jobs: newJobs,
      });
    }
  }
}

export function fireEnqueue(orderId: string, service: IngredientEnqueueService | undefined): void {
  if (!service) return;
  void service.enqueueMissing(orderId).catch((e) => {
    console.error('[ordering-service] enqueueMissing failed:', e instanceof Error ? e.message : e);
  });
}
