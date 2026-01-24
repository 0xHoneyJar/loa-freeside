# Sietch Theme Builder Guide

This guide walks you through recreating the Sietch community theme using the WYSIWYG Theme Builder.

## Prerequisites

- Access to the Theme Builder at `https://your-staging-url` or `localhost:3001`
- API Key for authentication
- Understanding of your community's tier structure and branding

## Quick Start

1. Open the Theme Builder
2. Enter your API key when prompted
3. You'll see the editor with three panels:
   - **Left**: Component Palette (drag components from here)
   - **Center**: Canvas (drop components here)
   - **Right**: Properties Panel (configure selected components)

---

## Step 1: Configure Theme Branding

Click the **Branding** button in the toolbar to open the branding editor.

### Colors

Set up the Sietch color palette:

| Color | Hex Value | Purpose |
|-------|-----------|---------|
| Primary | `#3b82f6` | Main brand color (blue) |
| Secondary | `#6366f1` | Secondary actions (indigo) |
| Accent | `#f59e0b` | Highlights, CTAs (amber) |
| Background | `#ffffff` | Page background |
| Surface | `#f5f5f5` | Card backgrounds |
| Text | `#1f2937` | Primary text |

### Fonts

Configure typography:

- **Heading Font**: Inter, Weight 700
- **Body Font**: Inter, Weight 400

### Layout

- **Border Radius**: `md` (medium rounded corners)
- **Spacing**: `comfortable` (balanced padding)

---

## Step 2: Create Pages

The Sietch theme uses multiple pages. Create these in order:

### Page 1: Home

| Setting | Value |
|---------|-------|
| Name | Home |
| Slug | `home` |
| Layout | Full |
| Visibility | Public |

### Page 2: Members

| Setting | Value |
|---------|-------|
| Name | Members |
| Slug | `members` |
| Layout | Full |
| Visibility | Members |

### Page 3: Leaderboard

| Setting | Value |
|---------|-------|
| Name | Leaderboard |
| Slug | `leaderboard` |
| Layout | Full |
| Visibility | Public |

### Page 4: Gallery (Optional)

| Setting | Value |
|---------|-------|
| Name | Gallery |
| Slug | `gallery` |
| Layout | Full |
| Visibility | Gated |

---

## Step 3: Build the Home Page

### 3.1 Add Welcome Section

1. Drag a **Rich Text** component to the canvas
2. Configure in Properties Panel:
   - **Content**:
     ```markdown
     # Welcome to Sietch

     The premier Web3 community on Berachain. Connect your wallet to join the tribe.
     ```
   - **Alignment**: Center
   - **Max Width**: `lg`

### 3.2 Add Token Gate (Hero Section)

1. Drag a **Token Gate** component below the welcome text
2. Configure:
   - **Title**: "Enter the Sietch"
   - **Gate Type**: Token
   - **Contract**: Select your BGT contract binding
   - **Required Amount**: 6.9 (minimum tier)
   - **Locked Message**: "Hold at least 6.9 BGT to enter"
   - **Unlocked Message**: "Welcome, water bearer"

### 3.3 Add Community Stats

1. Drag a **Layout Container** component
2. Set direction to `horizontal`
3. Inside, add three **Profile Card** components configured as stat cards:
   - Total Members
   - BGT Locked
   - Active Naibs

---

## Step 4: Build the Members Page

### 4.1 Add Leaderboard

1. Navigate to the Members page
2. Drag a **Leaderboard** component
3. Configure:
   - **Title**: "Community Rankings"
   - **Data Source**: Points
   - **Max Entries**: 50
   - **Show Rank Numbers**: Yes
   - **Show Avatars**: Yes
   - **Show Rank Changes**: Yes

### 4.2 Add Member Grid

1. Drag a **Layout Container** below the leaderboard
2. Add multiple **Profile Card** components
3. Configure each to show:
   - Avatar
   - Wallet Address (truncated)
   - BGT Balance
   - Discord Roles
   - Community Stats

---

## Step 5: Build the Leaderboard Page

### 5.1 Full-Page Leaderboard

1. Drag a **Leaderboard** component
2. Configure for maximum visibility:
   - **Title**: "Sietch Leaderboard"
   - **Max Entries**: 100
   - **Refresh Interval**: 300 (5 minutes)
   - **Sort**: Descending

### 5.2 Tier Breakdown

Add **Rich Text** components explaining each tier:

```markdown
## Tier Structure

### Naib (Ranks 1-7)
Council members with governance rights. Gold tier.

### Fedaykin (Ranks 8-69)
Elite warriors of the Sietch. Royal Blue tier.

### Usul (1111+ BGT)
The chosen ones. Purple tier.

... (continue for all tiers)
```

---

## Step 6: Build the Gallery Page (Gated)

### 6.1 Configure Gate

1. Set page visibility to **Gated**
2. Configure gate:
   - **Gate Type**: Token
   - **Required Amount**: 420 (Sihaya tier minimum)

### 6.2 Add NFT Gallery

1. Drag an **NFT Gallery** component
2. Configure:
   - **Title**: "Sietch Collection"
   - **Layout**: Grid
   - **Columns**: 4
   - **Show Metadata**: Yes
   - **Show Owner**: Yes
   - **Max Items**: 100

---

## Component Reference

### Web3 Components

#### Token Gate
Gates content based on token holdings.

| Property | Type | Description |
|----------|------|-------------|
| title | string | Gate title |
| gateType | token/nft/multi | Type of gate |
| requiredAmount | number | Minimum tokens required |
| lockedMessage | string | Message when gate is locked |
| unlockedMessage | string | Message when unlocked |

#### NFT Gallery
Displays NFT collections.

| Property | Type | Description |
|----------|------|-------------|
| layout | grid/carousel/masonry | Display layout |
| columns | 2/3/4/6 | Number of columns |
| showMetadata | boolean | Show NFT metadata |
| showOwner | boolean | Show owner info |
| maxItems | number | Maximum items (1-100) |

#### Leaderboard
Shows community rankings.

| Property | Type | Description |
|----------|------|-------------|
| title | string | Leaderboard title |
| dataSource | points/tokens/nfts/api | Data source |
| maxEntries | number | Max entries (5-100) |
| showRankNumbers | boolean | Show rank numbers |
| showAvatars | boolean | Show user avatars |
| refreshInterval | number | Refresh rate (60-3600s) |

#### Profile Card
Displays member profiles.

| Property | Type | Description |
|----------|------|-------------|
| showAvatar | boolean | Display avatar |
| showWallet | boolean | Show wallet address |
| showBalance | boolean | Show token balance |
| showRoles | boolean | Show Discord roles |
| showStats | boolean | Show community stats |

### Content Components

#### Rich Text
Formatted markdown content.

| Property | Type | Description |
|----------|------|-------------|
| content | string | Markdown content |
| alignment | left/center/right | Text alignment |
| maxWidth | sm/md/lg/full | Content width |

### Layout Components

#### Layout Container
Groups and arranges components.

| Property | Type | Description |
|----------|------|-------------|
| direction | horizontal/vertical | Layout direction |
| gap | none/sm/md/lg | Spacing between items |
| padding | none/sm/md/lg | Internal padding |
| background | transparent/surface/primary/custom | Background color |
| borderRadius | none/sm/md/lg | Corner rounding |

---

## Sietch Tier Reference

For token gating, use these BGT thresholds:

| Tier | Requirement | Color |
|------|-------------|-------|
| Naib | Ranks 1-7 | Gold |
| Fedaykin | Ranks 8-69 | Royal Blue |
| Usul | 1111+ BGT | Purple |
| Sayyadina | 888+ BGT | Indigo |
| Mushtamal | 690+ BGT | Teal |
| Sihaya | 420+ BGT | Green |
| Qanat | 222+ BGT | Cyan |
| Ichwan | 69+ BGT | Blue |
| Hajra | 6.9+ BGT | Light Blue |

---

## Preview & Publish

### Preview Your Theme

1. Use the viewport selector (Desktop/Tablet/Mobile) to test responsiveness
2. Click **Preview** to see the live render
3. Test all token gates with different wallet states

### Publishing

1. Review all pages and components
2. Click **Publish** in the toolbar
3. Your theme will be deployed to the community site

### Version History

- Access version history from the toolbar
- Rollback to previous versions if needed
- Each publish creates a new version

---

## Troubleshooting

### Components Not Dragging
- Ensure you're dragging from the palette on the left
- Check that you're dropping on a valid drop zone (dashed border)

### Token Gate Not Working
- Verify contract binding is configured
- Check the required amount matches your tier structure
- Ensure Web3 connection is active

### Preview Not Updating
- Try refreshing the page
- Check browser console for errors
- Verify API connectivity

### API Key Issues
- Ensure the API key is valid
- Check that the key has theme builder permissions
- Contact admin if key is expired

---

## Best Practices

1. **Mobile First**: Design for mobile, then expand to desktop
2. **Clear Hierarchy**: Use headings and spacing to guide users
3. **Gate Strategically**: Don't over-gate content; balance exclusivity with accessibility
4. **Test Thoroughly**: Preview all pages across viewports before publishing
5. **Version Control**: Publish incrementally and use rollback if issues arise

---

## Support

For issues with the Theme Builder:
- Check the browser console for errors
- Review API responses in Network tab
- Contact the development team with reproduction steps
