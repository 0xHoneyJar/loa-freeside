/**
 * Alerts Embed Builder
 *
 * Creates Discord embeds for notification preferences display.
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { NotificationPreferences, AlertFrequency } from '../data/index.js';

/**
 * Frequency display names
 */
const FREQUENCY_LABELS: Record<AlertFrequency, string> = {
  '1_per_week': '1x per week',
  '2_per_week': '2x per week',
  '3_per_week': '3x per week',
  daily: 'Daily',
};

/**
 * Get max alerts per week for frequency
 */
function getMaxAlerts(frequency: AlertFrequency): number {
  const limits: Record<AlertFrequency, number> = {
    '1_per_week': 1,
    '2_per_week': 2,
    '3_per_week': 3,
    daily: 7,
  };
  return limits[frequency];
}

/**
 * Build alerts preferences embed
 */
export function buildAlertsEmbed(
  prefs: NotificationPreferences,
  isNaib: boolean
): DiscordEmbed {
  const maxAlerts = getMaxAlerts(prefs.frequency);
  const statusEmoji = (enabled: boolean) => (enabled ? '✅' : '❌');

  const fields = [
    {
      name: '📊 Position Updates',
      value:
        `${statusEmoji(prefs.positionUpdates)} ${prefs.positionUpdates ? 'Enabled' : 'Disabled'}\n` +
        'Regular updates about your ranking position',
      inline: true,
    },
    {
      name: '⚠️ At-Risk Warnings',
      value:
        `${statusEmoji(prefs.atRiskWarnings)} ${prefs.atRiskWarnings ? 'Enabled' : 'Disabled'}\n` +
        "Alerts when you're in the bottom 10%",
      inline: true,
    },
  ];

  // Add Naib alerts for Naib members
  if (isNaib) {
    fields.push({
      name: '👑 Naib Alerts',
      value:
        `${statusEmoji(prefs.naibAlerts)} ${prefs.naibAlerts ? 'Enabled' : 'Disabled'}\n` +
        'Seat threat and status notifications',
      inline: true,
    });
  }

  // Frequency field
  fields.push({
    name: '📅 Frequency',
    value:
      `**${FREQUENCY_LABELS[prefs.frequency]}**\n` +
      `${prefs.alertsSentThisWeek}/${maxAlerts} alerts sent this week`,
    inline: false,
  });

  return createEmbed({
    title: '🔔 Alert Preferences',
    description:
      'Configure which notifications you receive and how often.\n' +
      'Toggle settings below to customize your experience.',
    color: Colors.BLUE,
    fields,
    footer: 'Changes take effect immediately • Critical alerts (bumps, new seats) are always sent',
    timestamp: true,
  });
}

/**
 * Alert toggle button custom IDs
 */
export const ALERT_INTERACTIONS = {
  togglePosition: 'alerts_toggle_position',
  toggleAtRisk: 'alerts_toggle_atrisk',
  toggleNaib: 'alerts_toggle_naib',
  frequency: 'alerts_frequency',
  disableAll: 'alerts_disable_all',
} as const;

/**
 * Build alerts components for REST API
 */
export function buildAlertsComponents(
  prefs: NotificationPreferences,
  isNaib: boolean,
  memberId: string
): object[] {
  const rows: object[] = [];

  // Row 1: Toggle buttons
  const toggleComponents: object[] = [
    {
      type: 2, // BUTTON
      style: prefs.positionUpdates ? 2 : 3, // SECONDARY or SUCCESS
      custom_id: `${ALERT_INTERACTIONS.togglePosition}_${memberId}`,
      label: prefs.positionUpdates ? 'Disable Position' : 'Enable Position',
      emoji: { name: '📊' },
    },
    {
      type: 2,
      style: prefs.atRiskWarnings ? 2 : 3,
      custom_id: `${ALERT_INTERACTIONS.toggleAtRisk}_${memberId}`,
      label: prefs.atRiskWarnings ? 'Disable At-Risk' : 'Enable At-Risk',
      emoji: { name: '⚠️' },
    },
  ];

  // Add Naib toggle for Naib members
  if (isNaib) {
    toggleComponents.push({
      type: 2,
      style: prefs.naibAlerts ? 2 : 3,
      custom_id: `${ALERT_INTERACTIONS.toggleNaib}_${memberId}`,
      label: prefs.naibAlerts ? 'Disable Naib' : 'Enable Naib',
      emoji: { name: '👑' },
    });
  }

  rows.push({
    type: 1, // ACTION_ROW
    components: toggleComponents,
  });

  // Row 2: Frequency select menu
  rows.push({
    type: 1,
    components: [
      {
        type: 3, // STRING_SELECT
        custom_id: `${ALERT_INTERACTIONS.frequency}_${memberId}`,
        placeholder: 'Change alert frequency',
        options: [
          {
            label: '1x per week',
            description: 'Receive at most 1 position update per week',
            value: '1_per_week',
            default: prefs.frequency === '1_per_week',
          },
          {
            label: '2x per week',
            description: 'Receive at most 2 position updates per week',
            value: '2_per_week',
            default: prefs.frequency === '2_per_week',
          },
          {
            label: '3x per week',
            description: 'Receive at most 3 position updates per week',
            value: '3_per_week',
            default: prefs.frequency === '3_per_week',
          },
          {
            label: 'Daily',
            description: 'Receive position updates every day',
            value: 'daily',
            default: prefs.frequency === 'daily',
          },
        ],
      },
    ],
  });

  // Row 3: Disable all button
  rows.push({
    type: 1,
    components: [
      {
        type: 2,
        style: 4, // DANGER
        custom_id: `${ALERT_INTERACTIONS.disableAll}_${memberId}`,
        label: 'Disable All Alerts',
        emoji: { name: '🔕' },
      },
    ],
  });

  return rows;
}
