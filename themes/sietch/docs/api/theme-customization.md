# Theme Customization API

> Sprint 36-37: Theme Interface & Implementations

This document describes the IThemeProvider interface and how to create custom themes for the Arrakis multi-tenant system.

## Overview

The theme system enables communities to customize their Discord server experience through:

- **Tiers**: Rank-based roles with colors and permissions
- **Badges**: Achievement and tenure-based rewards
- **Naming**: Server branding and terminology
- **Channels**: Discord channel structure templates

## Subscription Tiers

Themes are gated by subscription level:

| Tier | Access |
|------|--------|
| `free` | BasicTheme only |
| `premium` | BasicTheme + SietchTheme |
| `enterprise` | All themes + custom themes |

## IThemeProvider Interface

```typescript
interface IThemeProvider {
  readonly themeId: string;      // Unique identifier
  readonly themeName: string;    // Display name
  readonly tier: SubscriptionTier;

  getTierConfig(): TierConfig;
  getBadgeConfig(): BadgeConfig;
  getNamingConfig(): NamingConfig;
  getChannelTemplate(): ChannelTemplate;
  evaluateTier(rank: number, totalHolders?: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}
```

## Tier Configuration

### TierConfig Structure

```typescript
interface TierConfig {
  tiers: TierDefinition[];
  rankingStrategy: 'absolute' | 'percentage' | 'threshold';
  demotionGracePeriod?: number; // Hours before demotion
}

interface TierDefinition {
  id: string;
  name: string;
  displayName: string;
  minRank?: number;
  maxRank?: number | null;
  roleColor: string;      // Hex color
  permissions: string[];
}
```

### Ranking Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `absolute` | Fixed rank ranges | Small communities with stable rankings |
| `percentage` | Top N% of holders | Growing communities |
| `threshold` | Score-based thresholds | Token/BGT-weighted systems |

### Example: BasicTheme Tiers (3 tiers)

```typescript
{
  tiers: [
    { id: 'gold', minRank: 1, maxRank: 10, roleColor: '#FFD700' },
    { id: 'silver', minRank: 11, maxRank: 100, roleColor: '#C0C0C0' },
    { id: 'bronze', minRank: 101, maxRank: null, roleColor: '#CD7F32' }
  ],
  rankingStrategy: 'absolute'
}
```

### Example: SietchTheme Tiers (9 tiers)

The SietchTheme uses a hybrid approach:
- **Rank-based**: Naib (1-7), Fedaykin (8-69)
- **BGT threshold-based**: Usul, Sayyadina, Mushtamal, Sihaya, Qanat, Ichwan, Hajra

```typescript
const BGT_THRESHOLDS = {
  hajra: 6.9,
  ichwan: 69,
  qanat: 222,
  sihaya: 420,
  mushtamal: 690,
  sayyadina: 888,
  usul: 1111,
};

const RANK_BOUNDARIES = {
  naib: { min: 1, max: 7 },
  fedaykin: { min: 8, max: 69 },
};
```

## Badge Configuration

### BadgeConfig Structure

```typescript
interface BadgeConfig {
  categories: BadgeCategory[];
  badges: BadgeDefinition[];
}

interface BadgeDefinition {
  id: string;
  displayName: string;
  emoji: string;
  category: 'tenure' | 'achievement' | 'activity' | 'special';
  criteria: BadgeCriteria;
  description?: string;
  revocable?: boolean;
}
```

### Badge Criteria Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `tenure` | Days holding tokens | `threshold` (days) |
| `tier_reached` | Reached specific tier | `tierRequired` |
| `tier_maintained` | Maintained tier for duration | `tierRequired`, `durationDays` |
| `activity` | Activity score threshold | `threshold` |
| `conviction` | Conviction score threshold | `threshold` |
| `custom` | Custom evaluator function | `customEvaluator` |

### Example: Tenure Badge

```typescript
{
  id: 'veteran',
  displayName: 'Veteran',
  emoji: '🎖️',
  category: 'tenure',
  criteria: {
    type: 'tenure',
    threshold: 180  // 180 days
  }
}
```

### Example: Tier-Based Badge

```typescript
{
  id: 'naib-ascended',
  displayName: 'Naib Ascended',
  emoji: '👑',
  category: 'achievement',
  criteria: {
    type: 'tier_reached',
    tierRequired: 'naib'
  }
}
```

### Example: Custom Evaluator Badge

```typescript
{
  id: 'water-sharer',
  displayName: 'Water Sharer',
  emoji: '💧',
  category: 'special',
  criteria: {
    type: 'custom',
    customEvaluator: 'waterSharer'
  },
  description: 'Shared water with a fellow Fremen'
}
```

Custom evaluators receive `MemberContext.customContext` for evaluation:

```typescript
// In evaluateBadges implementation
if (badge.criteria.customEvaluator === 'waterSharer') {
  const waterSharerContext = member.customContext?.waterSharer as {
    isSharer?: boolean;
    recipientAddress?: string;
    granterAddress?: string;
    sharedAt?: Date;
  };

  if (waterSharerContext?.isSharer || waterSharerContext?.recipientAddress) {
    earnedBadges.push({
      badgeId: badge.id,
      emoji: badge.emoji,
      context: waterSharerContext
    });
  }
}
```

## Naming Configuration

```typescript
interface NamingConfig {
  serverNameTemplate: string;
  categoryNames: {
    info: string;
    council: string;
    general: string;
    operations: string;
  };
  terminology: {
    member: string;
    holder: string;
    admin: string;
    community?: string;
  };
}
```

### Example: SietchTheme Naming

```typescript
{
  serverNameTemplate: '{community} Sietch',
  categoryNames: {
    info: 'The Stillsuit',
    council: 'The Council of Naibs',
    general: 'The Sands',
    operations: 'The Spice Harvesters'
  },
  terminology: {
    member: 'Fremen',
    holder: 'Sietch Dweller',
    admin: 'Naib',
    community: 'Sietch'
  }
}
```

## Channel Template

```typescript
interface ChannelTemplate {
  categories: CategoryDefinition[];
}

interface CategoryDefinition {
  id: string;
  name: string;
  channels: ChannelDefinition[];
  tierRestriction?: string;
}

interface ChannelDefinition {
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'forum';
  readonly?: boolean;
  topic?: string;
  tierRestriction?: string;
}
```

### Example: Tier-Restricted Channel

```typescript
{
  id: 'council',
  name: 'The Council of Naibs',
  tierRestriction: 'naib',  // Only Naib tier can access
  channels: [
    { name: 'naib-council', type: 'text', topic: 'Naib discussions' },
    { name: 'naib-voice', type: 'voice' }
  ]
}
```

## Theme Registry

Use `ThemeRegistry` for theme management and access validation:

```typescript
import { themeRegistry } from '@/packages/core/services/ThemeRegistry';
import { basicTheme } from '@/packages/adapters/themes/BasicTheme';
import { sietchTheme } from '@/packages/adapters/themes/SietchTheme';

// Register themes
themeRegistry.register(basicTheme);
themeRegistry.register(sietchTheme);

// Check access
const result = themeRegistry.validateAccess('sietch', 'free');
// { allowed: false, reason: '...', requiredTier: 'premium' }

// Get available themes for subscription
const available = themeRegistry.getAvailableThemes('premium');
// [basicTheme, sietchTheme]

// Get theme with validation
const theme = themeRegistry.getWithValidation('sietch', 'premium');
```

## Creating a Custom Theme

### Step 1: Implement IThemeProvider

```typescript
import type {
  IThemeProvider,
  SubscriptionTier,
  TierConfig,
  BadgeConfig,
  NamingConfig,
  ChannelTemplate,
  TierResult,
  EarnedBadge,
  MemberContext
} from '@/packages/core/ports/IThemeProvider';

export class MyCustomTheme implements IThemeProvider {
  readonly themeId = 'my-custom';
  readonly themeName = 'My Custom Theme';
  readonly tier: SubscriptionTier = 'enterprise';

  getTierConfig(): TierConfig {
    return {
      tiers: [/* your tier definitions */],
      rankingStrategy: 'absolute'
    };
  }

  getBadgeConfig(): BadgeConfig {
    return {
      categories: ['tenure', 'achievement'],
      badges: [/* your badge definitions */]
    };
  }

  getNamingConfig(): NamingConfig {
    return {
      serverNameTemplate: '{community} Server',
      categoryNames: { /* ... */ },
      terminology: { /* ... */ }
    };
  }

  getChannelTemplate(): ChannelTemplate {
    return {
      categories: [/* your channel structure */]
    };
  }

  evaluateTier(rank: number, totalHolders?: number): TierResult {
    // Implement tier evaluation logic
  }

  evaluateBadges(member: MemberContext): EarnedBadge[] {
    // Implement badge evaluation logic
  }
}
```

### Step 2: Register the Theme

```typescript
import { themeRegistry } from '@/packages/core/services/ThemeRegistry';
import { MyCustomTheme } from './MyCustomTheme';

themeRegistry.register(new MyCustomTheme());
```

### Step 3: Export from themes index

```typescript
// src/packages/adapters/themes/index.ts
export { MyCustomTheme, createMyCustomTheme, myCustomTheme } from './MyCustomTheme';
```

## Available Themes

| Theme | Tier | Tiers | Badges | Description |
|-------|------|-------|--------|-------------|
| `basic` | free | 3 | 5 | Simple Gold/Silver/Bronze system |
| `sietch` | premium | 9 | 12 | Dune-inspired with BGT thresholds |

## Type Exports

All types are exported from `@/packages/core/ports/IThemeProvider`:

```typescript
export type {
  SubscriptionTier,
  RankingStrategy,
  TierDefinition,
  TierConfig,
  TierResult,
  BadgeCategory,
  BadgeCriteriaType,
  BadgeCriteria,
  BadgeDefinition,
  BadgeConfig,
  EarnedBadge,
  CategoryNames,
  Terminology,
  NamingConfig,
  ChannelType,
  ChannelDefinition,
  CategoryDefinition,
  ChannelTemplate,
  MemberContext,
  IThemeProvider
};
```
