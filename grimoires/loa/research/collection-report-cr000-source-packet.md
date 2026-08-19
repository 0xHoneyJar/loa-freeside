# CR-000 Discord policy source packet

Accessed: 2026-07-16

This packet contains current public-policy evidence only. It does not establish
the private state of the Freeside Discord application, record an owner
signature, or provide privacy/security approval.

## Primary Discord sources

- [Gateway intents](https://docs.discord.com/developers/events/gateway)
  - `GUILD_MEMBERS` is privileged.
  - It must be enabled in the Developer Portal.
  - Applications subject to review must be approved before using it.
  - Unauthorized privileged intent use can close the Gateway connection with
    code `4014`.
- [Gateway member requests](https://docs.discord.com/developers/events/gateway-events#request-guild-members)
  - Requesting the complete member list requires `GUILD_MEMBERS`.
  - Member chunks contain at most 1,000 members.
  - A request is limited to one guild ID.
- [Guild members REST API](https://docs.discord.com/developers/resources/guild#list-guild-members)
  - Listing guild members requires the `GUILD_MEMBERS` privileged intent.
  - A page contains at most 1,000 members.
- [Privileged intent access](https://support-dev.discord.com/hc/en-us/articles/6205754771351-How-do-I-get-Privileged-Intents-for-my-bot)
  - Discord updated this guidance on 2026-06-11.
  - Applications accessible to fewer than 10,000 guild-installed users can
    enable privileged intents in the Developer Portal without review.
  - At 10,000 users, review is required for continued access; Discord says the
    owner receives notice and has 90 days to apply.
  - Review asks for the intent, use case, and security/privacy information.
- [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
  - API data may only be used as necessary for stated functionality.
  - Discord API data may not be used to profile users, their identities, or
    their relationships.
  - Applications must respect user opt-out/removal and must not mine or scrape
    Discord data.
- [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
  - The application must maintain a public, current privacy policy.
  - API data must be updated or deleted when no longer necessary, requested by
    Discord, requested by the user, or required by law.
  - API data must be protected with encryption at rest and reasonable
    administrative, physical, and technical safeguards.
  - Material changes to reviewed functionality or API-data use require renewed
    App Review approval where applicable.

## Evidence still unavailable

- Application ID, team/application owner, and verification/review state.
- Current guild-installed user count under Discord's 2026 threshold.
- Whether `GUILD_MEMBERS` is enabled and, if review applies, approved.
- The exact Developer Portal use-case submission and any approval conditions.
- Current public privacy-policy URL and whether it describes the proposed use.
- Discord application owner signature.
- Privacy/security owner determination and signature.

## Safe interim interpretation

Public documentation establishes that the proposed workflow is technically
possible only with `GUILD_MEMBERS`, but it does not establish that the current
Freeside application is authorized for the proposed member-data-plus-wallet
purpose. Until the private evidence and signatures exist, restricted T2 remains
disabled. T0 recognition and T1 public preparation are unaffected.
