---
name: staging_pre_launch
description: Staging environment is pre-launch — no devs on test network, no users. More wiggle room for infrastructure changes.
type: project
---

Staging environment is pre-launch as of 2026-03-17. No developers on the test network and no users yet.

**Why:** Platform infrastructure is still being stood up (cycle-046 Armitage ops). Services are deployed but not actively used.

**How to apply:** More tolerance for service disruption during terraform applies and deploys. Still practice good discipline (plan before apply, health checks) but don't need to be as cautious about rollback timing or maintenance windows. Can be bolder with infrastructure changes.
