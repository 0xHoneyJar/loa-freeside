# =============================================================================
# Midi (midi-interface / mibera-dimensions) — AWS Secrets Manager structure
# =============================================================================
# Defines the 5 runtime secrets the Midi ECS task resolves at start.
# Values are NOT populated by terraform — they're loaded via
# `scripts/load-midi-secrets.sh` which pulls from Vercel env and validates
# (non-empty + no placeholder) before calling aws secretsmanager put-secret-value.
#
# The key set here MUST be a superset of the keys referenced in
# world-midi.tf's `secrets = {...}` map. Mismatch → terraform plan error.
#
# Intentionally absent (by design):
#   - NEXT_PUBLIC_*       public-by-design, --build-arg only in CI
#                         (NEXT_PUBLIC_DYNAMIC_*, NEXT_PUBLIC_SUPABASE_*,
#                         NEXT_PUBLIC_SCORE_API_URL, NEXT_PUBLIC_BETA_*,
#                         NEXT_PUBLIC_GA_ID, NEXT_PUBLIC_UMAMI_WEBSITE_ID)
#   - BETA_DEV_BYPASS_WALLETS dev-only override; not loaded in prod
#
# Why fewer secrets than honeyroad (5 vs 23):
#   - Midi consumes Supabase as an external service (no DATABASE_URL)
#   - No Trigger.dev (background jobs)
#   - No Cloudinary (no media uploads from this surface)
#   - No OAuth (forum integration lives in honeyroad)
#   - No AWS_*_VM (no VM avatar/GIF/quiz uploads from this surface)
#   - No Dune API (analytics ingest lives elsewhere)
#
# Two surfaces, ONE Vercel project (prj_J6Q0SydniMeDWK0mARqRwUOqRrbn) — both
# midi-interface and mibera-dimensions repos deploy to the same Vercel project
# named "midi-interface". The world tf treats them as a single deployable surface.
#
# Related: 0xHoneyJar/loa-freeside (this repo's launch readiness)
# =============================================================================

locals {
  midi_secrets = toset([
    # Auth (Dynamic Labs server-side token for minified JWT support)
    "dynamic_auth_token",

    # Supabase service-role key (bypasses RLS for beta allowlist + admin reads)
    "supabase_service_role",

    # Score API integration (server-side; midi calls into score-api world)
    "score_api_url",
    "score_api_key",

    # Ruggy signal fan-out (ecosystem intelligence pipeline)
    "signals_api_key",
  ])
}

resource "aws_secretsmanager_secret" "midi" {
  for_each = local.midi_secrets

  name        = "arrakis/${var.environment}/worlds/midi/${each.key}"
  description = "Midi (midi-interface / mibera-dimensions) runtime secret — loaded via scripts/load-midi-secrets.sh"
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.common_tags, {
    World   = "midi"
    App     = "midi-interface"
    Purpose = each.key
  })
}
