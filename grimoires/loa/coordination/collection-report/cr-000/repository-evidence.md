# CR-000 Repository evidence audit (non-secret)

**Git tip audited:** `3782fd47e8a20cdaf6325621962bd0443e6781b8`
**Branch:** `coord/collection-report-coordinator-f09.10` (tracks `origin/main`)
**Rule:** Do not infer Developer Portal toggles, review approval, ownership, or
user counts from code or environment-variable names.

---

## 1. Discord application integration (code presence)

### 1.1 Sietch Discord service

`themes/sietch/src/services/discord.ts` constructs a `discord.js` `Client` and
logs in with `config.discord.botToken`.

Configured intents in that client:

- `Guilds`
- `GuildMembers`
- `GuildMessages`
- `GuildMessageReactions`
- `DirectMessages`
- `MessageContent`

### 1.2 Sietch worker

`themes/sietch/src/jobs/worker.ts` constructs a worker Discord client with:

- `Guilds`
- `GuildMembers`
- `GuildPresences`

Requires `DISCORD_BOT_TOKEN` to be configured for the worker service.

### 1.3 Platform ingestor

`apps/ingestor/src/client.ts` creates a zero-cache Discord client with:

- `Guilds`
- `GuildMembers`
- `GuildMessages`
- `MessageContent`

Partials include `GuildMember`. Member cache managers are set to `0` (no member
cache retention in-process).

### 1.4 Slash-command registration

`themes/sietch/src/discord/commands/index.ts` registers guild commands via
`Routes.applicationGuildCommands(clientId, config.discord.guildId)`.

`clientId` is a function argument — the repository does not hardcode a
production Application ID in this path.

### 1.5 Config seams (names only)

`themes/sietch/src/config.ts` reads Discord configuration from environment
variables including `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, channel IDs, and
role IDs.

**Non-inference:** presence of these variable names does not prove portal
intent state, ownership, verification, or live guild size.

---

## 2. Application ownership references

| Source | What it says | Ownership proof? |
|--------|--------------|------------------|
| `themes/sietch/docs/discord-setup.md` | Manual steps to create an application in Discord Developer Portal; name example “Sietch Bot” | No — setup guide |
| `themes/sietch/docs/ADMIN_SETUP_GUIDE.md` | References Developer Portal access for admins | No — ops guide |
| `packages/cli/discord-server.yaml` | IaC sample for “Arrakis Sandbox” with server id `1460247581312549049` | No — sandbox config, not production owner or user count |

**Application owner identity:** pending (private).

---

## 3. Configured intents vs portal approval

| Fact | Proven? |
|------|---------|
| Code requests `GatewayIntentBits.GuildMembers` in multiple clients | Yes |
| Setup doc tells humans to enable Server Members Intent in Portal | Yes (instructional) |
| Portal currently has Server Members Intent enabled | **Not proven** |
| Privileged-intent review approved for Gate Leak member+wallet use | **Not proven** |

Unauthorized privileged intent use can fail closed at Discord (`4014` per public
docs). Runtime success in some environments still would not equal CR-000 Go for
the proposed restricted purpose.

---

## 4. Guild / member scale

| Candidate signal | Assessment |
|------------------|-------------|
| Production guild-installed user count | Absent from repository |
| Sandbox server id in `packages/cli/discord-server.yaml` | Not a scale metric |
| SDD 50,000-member fixture requirement for capture proof | Design target for later CR-018 / release evidence — not a live count |

**Scale band vs Discord’s 10,000 guild-installed-user threshold:** pending.

---

## 5. Privacy policy references and data use

| Probe / source | Result |
|----------------|--------|
| In-repo “privacy” copy in Sietch embeds/docs | Product/community privacy language (e.g. no wallet addresses in public embeds); **not** a Discord Developer Terms privacy-policy URL for the bot application |
| HTTP follow of `https://0xhoneyjar.xyz/privacy` | Final status `404` at `https://www.0xhoneyjar.xyz/privacy` (2026-07-16 probe) |
| Policy text covering Gate Leak member+wallet join | **Not found** in this audit |

**Public privacy-policy URL for the Discord application:** pending.

Retention/deletion for restricted Gate Leak artifacts is specified as future
policy work in the collection-report SDD (CR-007B and related) — not ratified
here as CR-000 Go evidence.

---

## 6. Shadow Audit RoleSnapshot and Gateway boundaries

### 6.1 Current RoleSnapshot (implemented)

`packages/services/shadow-audit/src/role-snapshot.ts`:

- Schema fields: `source`, `community`, `captured_at`, `export_method`,
  `owner`, `freshness_threshold_seconds`, `entries[]`
- Entries may include `discord_user_id`, optional `wallet`, and `role_ids`
- Unmatched role-holders without wallets are flagged, not dropped

`packages/services/shadow-audit/src/role-source.ts`:

- Production adapter is **file-backed** (`ROLE_SNAPSHOT_PATH`)
- Missing path → `undefined` → external-mode refusal downstream
- Invalid file → throw (fail loud)

`packages/services/shadow-audit/DEPLOY.md`:

- Documents `ROLE_SNAPSHOT_PATH` and `AUDIT_K` (k-anonymity; `0` rejected)

### 6.2 Protocol output boundary

`packages/protocol/shadow-audit` audit output:

- Anonymous callers get k-anonymized aggregates
- Per-member records / comparison require authenticated community-bound callers
- Methodology includes `role_snapshot_at`

### 6.3 Planned Gateway-bound producer (SDD — not CR-000 approval)

Collection-report SDD states the future `discord_role_snapshot.v1` producer is
externally gated by:

- current bot verification
- approved privileged `GUILD_MEMBERS`
- guild-size limits
- Developer Terms/Policy for storing member data joined to wallet identity

and requires Gateway epoch/sequence completeness attestations.

**This repository audit does not show that Gateway-bound qualifying producer as
an authorized live T2 path.** Current dogfood RoleSnapshot is an export/file
port, not CR-000 Go.

---

## 7. What remains out of scope for repository evidence

- Live Developer Portal screenshots or exports
- Secrets, tokens, or `.env` contents (not read)
- Inventing a Go because code already requests `GuildMembers`
- Changing production bot permissions
