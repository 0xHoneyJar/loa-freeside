/**
 * Default + help command. clipanion auto-generates per-command help via
 * `Command.Usage`; this command provides the top-level overview.
 */
import { Command } from 'clipanion';

export class GaibHelpCommand extends Command {
  static paths = [Command.Default, ['help']];

  async execute(): Promise<number> {
    this.context.stdout.write(`gaib — sovereign secrets CLI

Usage:
  gaib secrets pull  --world <slug> --env <staging|prod> [--format dotenv|json|raw]
  gaib secrets push  --world <slug> --env <staging|prod> --from-file <path> [--confirm]
  gaib secrets help  [<command>]

Slugs come from freeside-worlds/packages/registry/worlds/<slug>.yaml.
Secrets are stored in AWS Secrets Manager under arrakis-{staging|production}-<slug>.

Authentication uses your existing AWS profile (AWS_PROFILE env or
~/.aws/credentials). No new IAM roles.

Exit codes:
  0  Success
  1  Unauthorized (AWS auth failure)
  2  Missing world (slug not in registry)
  3  Schema violation (key not declared, malformed JSON, etc.)
  4  Retryable network error (AWS throttle / 5xx)
  5  Bad invocation (missing required flag)

For per-command help:
  gaib secrets pull --help
  gaib secrets push --help
`);
    return 0;
  }
}
