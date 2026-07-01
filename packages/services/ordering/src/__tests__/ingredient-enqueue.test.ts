import { describe, expect, it } from 'vitest';
import { INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS, ORDER_LIFECYCLE_SUBJECTS } from '@freeside/ordering-protocol';

import { RecordingGitHubIssuePort } from '../github-issue-port.js';
import { IngredientEnqueueService } from '../ingredient-enqueue.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';

function communityOrder(orderId = 'ord_kitchen_1'): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'a'.repeat(64),
    inputs: {
      chain_id: '1',
      contract_address: '0xabc',
      contact_email: 'cm@example.com',
      community_name: 'Test',
      source: 'dashboard_onboarding',
    },
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

describe('IngredientEnqueueService', () => {
  it('files github issues for pending sonar/score/worlds_manifest and marks in_progress', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const github = new RecordingGitHubIssuePort();
    const enqueue = new IngredientEnqueueService(store, github);

    await store.placeOrder(communityOrder(), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_kitchen_1', product: 'community-onboarding', inputs_digest: 'a'.repeat(64) },
    });
    await store.transition('ord_kitchen_1', 'placed', 'routing');
    await store.transition('ord_kitchen_1', 'routing', 'producing', {
      patch: { ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS } },
    });

    await enqueue.enqueueMissing('ord_kitchen_1');

    expect(github.issues).toHaveLength(3);
    const record = await store.get('ord_kitchen_1');
    expect(record?.ingredient_jobs).toHaveLength(3);
    expect(record?.ingredients?.sonar).toBe('in_progress');
    expect(record?.ingredients?.score).toBe('in_progress');
    expect(record?.ingredients?.worlds_manifest).toBe('in_progress');
  });

  it('does not duplicate issues on second enqueue', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const github = new RecordingGitHubIssuePort();
    const enqueue = new IngredientEnqueueService(store, github);

    await store.placeOrder(communityOrder('ord_kitchen_2'), {
      subject: ORDER_LIFECYCLE_SUBJECTS.placed,
      payload: { order_id: 'ord_kitchen_2', product: 'community-onboarding', inputs_digest: 'a'.repeat(64) },
    });
    await store.transition('ord_kitchen_2', 'placed', 'routing');
    await store.transition('ord_kitchen_2', 'routing', 'producing');

    await enqueue.enqueueMissing('ord_kitchen_2');
    await enqueue.enqueueMissing('ord_kitchen_2');

    expect(github.issues).toHaveLength(3);
    expect((await store.get('ord_kitchen_2'))?.ingredient_jobs).toHaveLength(3);
  });
});
