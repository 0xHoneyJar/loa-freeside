# Context: Issue #153 — World Container Hosting

## Source
https://github.com/0xHoneyJar/loa-freeside/issues/153

## Core Problem
Org pays $5/mo per world on Railway ($15/mo for 3, growing to $50/mo for 10). Want near-zero marginal cost by hosting on existing Freeside ECS cluster where expensive infra (ALB, NAT, DNS) is already paid for.

## What A World Is
- Single-process SvelteKit container
- One port (3000), one SQLite database file
- Environment variables for config + secrets
- Optional AI features (chat, scoring, classification)
- Template: 0xHoneyJar/world-template

## 4 Things Needed
1. World Hosting — run containers cheaply on existing cluster
2. AI Gateway — route model calls through Finn (centralized billing)
3. Deploy Pipeline — git push → container builds → deploys
4. World Provisioning — add one file, get a world

## First Wave Worlds
- rektdrop.0xhoneyjar.xyz — NFT loss calculator + daemon chat
- mibera.0xhoneyjar.xyz — identity mirror + marketplace
- aphive.0xhoneyjar.xyz — treasury dashboard for apDAO

## Open Questions
1. Storage for per-world SQLite on Fargate?
2. Scale to zero for idle worlds?
3. Minimal Finn deployment for AI routing?
4. Provisioning automation (Terraform module? Script?)
5. Cost ceiling per world?
6. Security isolation between worlds?

## Key Context
- Finn IS deployed on the cluster (running, healthy, with personality pipeline)
- DNS for *.0xhoneyjar.xyz is Route53 (managed by Freeside Terraform)
- ALB already handles host-based routing for Dixie
- Freeside already has deploy-staging.yml CI pattern
- Org is running out of funds — cost reduction is survival-critical
