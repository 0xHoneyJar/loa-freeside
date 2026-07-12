import { describe, it, expect } from 'vitest';
import { buildCommunityOnboardingOpsNotice } from '../order-ops-webhook.js';

const INPUTS = {
  chain_id: '8453',
  contract_address: '0x1234567890123456789012345678901234567890',
  contact_email: 'cm@example.com',
  community_name: 'Pythenians',
  source: 'dashboard_onboarding' as const,
};

describe('buildCommunityOnboardingOpsNotice', () => {
  it('builds a sanitized operator notice with ISO placed_at and Slack text', () => {
    const notice = buildCommunityOnboardingOpsNotice({
      order_id: 'ord_test_1',
      placed_by: 'dashboard_onboarding',
      inputs: INPUTS,
      placed_at_unix: 1_700_000_000,
    });

    expect(notice).toEqual({
      event: 'community_onboarding.placed',
      order_id: 'ord_test_1',
      placed_by: 'dashboard_onboarding',
      contact_email: 'cm@example.com',
      contract_address: '0x1234567890123456789012345678901234567890',
      chain_id: '8453',
      community_name: 'Pythenians',
      placed_at: '2023-11-14T22:13:20.000Z',
      text: 'New community-onboarding order ord_test_1: cm@example.com (Pythenians) · 0x1234567890123456789012345678901234567890 on chain 8453',
    });
  });

  it('omits community_name in text when absent', () => {
    const notice = buildCommunityOnboardingOpsNotice({
      order_id: 'ord_test_2',
      placed_by: 'dashboard_onboarding',
      inputs: {
        chain_id: '1',
        contract_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contact_email: 'ops@team.example',
        source: 'dashboard_onboarding',
      },
      placed_at_unix: 1_700_000_000,
    });

    expect(notice?.community_name).toBeUndefined();
    expect(notice?.text).toContain('ops@team.example · 0xaaaaaaaa');
    expect(notice?.text).not.toContain('()');
  });

  it('returns null for invalid inputs', () => {
    expect(
      buildCommunityOnboardingOpsNotice({
        order_id: 'ord_bad',
        placed_by: 'dashboard_onboarding',
        inputs: { chain_id: '1' },
        placed_at_unix: 1_700_000_000,
      }),
    ).toBeNull();
  });
});
