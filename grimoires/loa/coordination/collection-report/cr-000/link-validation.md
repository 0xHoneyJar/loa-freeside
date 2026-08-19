# CR-000 Primary-source link validation

**Probed at:** `2026-07-16T08:51:26Z`–`2026-07-16T08:53:29Z` (approx.)
**Method:** HTTP HEAD/GET status probes from this environment
**Authority for policy text:** grounded packet
`grimoires/loa/research/collection-report-cr000-source-packet.md`
(Exa search route unavailable — `EXA_API_KEY` absent)

## Discord documentation

| URL | Probe result | Notes |
|-----|--------------|-------|
| https://docs.discord.com/developers/events/gateway | `200` | Reachable |
| https://docs.discord.com/developers/events/gateway-events#request-guild-members | `200` | Reachable |
| https://docs.discord.com/developers/resources/guild#list-guild-members | `200` | Reachable |
| https://support-dev.discord.com/hc/en-us/articles/6205754771351-How-do-I-get-Privileged-Intents-for-my-bot | `403` | Bot/WAF block to this probe; text retained from grounded packet (updated 2026-06-11 per packet) |
| https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy | `403` | Same; text retained from grounded packet |
| https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service | `403` | Same; text retained from grounded packet |

## Candidate privacy-policy URL (not asserted as the app policy)

| URL | Probe result | Notes |
|-----|--------------|-------|
| https://0xhoneyjar.xyz/privacy | `308` → final `404` at https://www.0xhoneyjar.xyz/privacy | Does **not** establish a current public privacy policy |
| https://www.0xhoneyjar.xyz/privacy-policy | `404` | Not found |

Owners must supply the actual public privacy-policy URL in the checklist (D1).

## Workspace internal links

| Path | Exists |
|------|--------|
| `decision-record.md` | yes |
| `evidence-checklist.md` | yes |
| `pending-authority-record.yaml` | yes |
| `pending-authority-record.schema.json` | yes |
| `repository-evidence.md` | yes |
| `sources.md` | yes |
| `../task-manifest.yaml` (coordinator) | yes (coordinator root) |
| `grimoires/loa/research/collection-report-cr000-source-packet.md` | yes |
