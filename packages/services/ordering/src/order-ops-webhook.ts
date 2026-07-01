import { CommunityOnboardingInputs } from '@freeside/ordering-protocol';

import type { IngredientJob } from './kitchen-types.js';

/** Sanitized operator notice for a newly placed community-onboarding order. */
export type CommunityOnboardingOpsNotice = {
  event: 'community_onboarding.placed' | 'community_onboarding.ingredients_enqueued';
  order_id: string;
  placed_by: string;
  contact_email: string;
  contract_address: string;
  chain_id: string;
  community_name?: string;
  placed_at: string;
  /** One-line summary for Slack incoming webhooks (unknown fields are ignored). */
  text: string;
  ingredient_jobs?: Pick<IngredientJob, 'ingredient' | 'external_ref'>[];
};

export function opsWebhookUrl(): string | null {
  const raw = process.env.ORDER_OPS_WEBHOOK_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function buildCommunityOnboardingOpsNotice(args: {
  order_id: string;
  placed_by: string;
  inputs: Record<string, unknown>;
  placed_at_unix: number;
}): CommunityOnboardingOpsNotice | null {
  const parsed = CommunityOnboardingInputs.safeParse(args.inputs);
  if (!parsed.success) return null;

  const { chain_id, contract_address, contact_email, community_name } = parsed.data;
  const placed_at = new Date(args.placed_at_unix * 1000).toISOString();
  const namePart = community_name ? ` (${community_name})` : '';

  return {
    event: 'community_onboarding.placed',
    order_id: args.order_id,
    placed_by: args.placed_by,
    contact_email,
    contract_address,
    chain_id,
    community_name,
    placed_at,
    text: `New community-onboarding order ${args.order_id}: ${contact_email}${namePart} · ${contract_address} on chain ${chain_id}`,
  };
}

export function fireCommunityOnboardingOpsWebhook(
  notice: CommunityOnboardingOpsNotice,
  webhookUrl: string | null = opsWebhookUrl(),
): void {
  if (!webhookUrl) return;

  void fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notice),
  }).catch((err) => {
    console.error(
      '[ordering-service] ORDER_OPS_WEBHOOK_URL delivery failed:',
      err instanceof Error ? err.message : err,
    );
  });
}

export function fireCommunityOnboardingIssueLinks(args: {
  order_id: string;
  contact_email: string;
  contract_address: string;
  chain_id: string;
  jobs: IngredientJob[];
  webhookUrl?: string | null;
}): void {
  if (args.jobs.length === 0) return;
  const links = args.jobs.map((j) => `${j.ingredient}: ${j.external_ref}`).join('\n');
  fireCommunityOnboardingOpsWebhook(
    {
      event: 'community_onboarding.ingredients_enqueued',
      order_id: args.order_id,
      placed_by: 'ordering-service',
      contact_email: args.contact_email,
      contract_address: args.contract_address,
      chain_id: args.chain_id,
      placed_at: new Date().toISOString(),
      text: `Triage issues filed for order ${args.order_id}:\n${links}`,
      ingredient_jobs: args.jobs.map((j) => ({ ingredient: j.ingredient, external_ref: j.external_ref })),
    },
    args.webhookUrl,
  );
}
