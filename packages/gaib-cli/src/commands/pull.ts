/**
 * `gaib secrets pull --world <slug> --env <staging|prod> [--format <dotenv|json|raw>]`
 *
 * Per SDD §9.2 + §9.5. Never logs values; only counts + key names.
 */
import { Command, Option } from 'clipanion';
import * as t from 'typanion';

import { AwsSecretsClient, GaibSecretsError } from '../lib/aws.js';
import { formatSecrets } from '../lib/format.js';
import { deriveSecretId, resolveWorld } from '../lib/world-resolver.js';
import { ExitCodes, type Environment, type OutputFormat } from '../types.js';

export class SecretsPullCommand extends Command {
  static paths = [['secrets', 'pull']];

  static usage = Command.Usage({
    category: 'Secrets',
    description: 'Pull world secrets from AWS Secrets Manager',
    details: `
      Resolves <slug> against the freeside-worlds registry, fetches the
      world's per-environment secret from AWS Secrets Manager, and writes
      it to stdout in the requested format.

      Never logs secret values. Operator is responsible for stdout routing.
    `,
    examples: [
      ['Pull mibera prod as dotenv', '$0 secrets pull --world mibera --env prod --format dotenv'],
      ['Pull staging as json', '$0 secrets pull --world midi --env staging --format json'],
    ],
  });

  world = Option.String('--world', {
    required: true,
    description: 'World slug (e.g. mibera, midi)',
    validator: t.isString(),
  });

  env = Option.String('--env', {
    required: true,
    description: 'Target environment (staging | prod)',
    validator: t.isEnum(['staging', 'prod'] as const),
  });

  format = Option.String('--format', 'dotenv', {
    description: 'Output format (dotenv | json | raw)',
    validator: t.isEnum(['dotenv', 'json', 'raw'] as const),
  });

  region = Option.String('--region', {
    description: 'AWS region override (default: us-east-1 or AWS_REGION)',
  });

  registryRoot = Option.String('--registry-root', {
    description: 'Path to freeside-worlds registry/worlds dir (override)',
  });

  async execute(): Promise<number> {
    // 1. Resolve the world from the registry.
    const resolved = await resolveWorld({
      slug: this.world,
      registryRoot: this.registryRoot,
    });

    if (resolved.variant === 'missing') {
      this.context.stderr.write(
        `gaib: world '${this.world}' not found at ${resolved.searchedPath}\n`,
      );
      return ExitCodes.MISSING_WORLD;
    }
    if (resolved.variant === 'error') {
      this.context.stderr.write(`gaib: ${resolved.reason}\n`);
      return ExitCodes.SCHEMA_VIOLATION;
    }

    const declaredSecrets = resolved.world.secrets ?? [];

    // 2. Fetch the AWS secret.
    const aws = new AwsSecretsClient(this.region ? { region: this.region } : {});
    const secretId = deriveSecretId(this.world, this.env as Environment);

    let envVars: Record<string, string>;
    try {
      envVars = await aws.getJsonSecret(secretId);
    } catch (err) {
      if (err instanceof GaibSecretsError) {
        this.context.stderr.write(`gaib: ${err.message}\n`);
        return err.exitCode;
      }
      this.context.stderr.write(
        `gaib: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return ExitCodes.SCHEMA_VIOLATION;
    }

    // 3. Cross-check: every key the registry declares should exist in AWS.
    //    Surface missing keys to stderr (NOT values), but do not block — pull
    //    is a read; surfacing is the operator's signal to push or rotate.
    const missing: string[] = [];
    for (const sec of declaredSecrets) {
      if (!(sec.env_var in envVars)) missing.push(sec.env_var);
    }
    if (missing.length > 0) {
      this.context.stderr.write(
        `gaib: warning — ${missing.length} registry-declared key(s) absent in AWS: ${missing.join(', ')}\n`,
      );
    }

    // 4. Render to stdout.
    const out = formatSecrets({ envVars }, this.format as OutputFormat);
    this.context.stdout.write(out);

    // 5. Audit trail — count only, no values.
    this.context.stderr.write(
      `gaib: pulled ${Object.keys(envVars).length} key(s) from ${secretId}\n`,
    );

    return ExitCodes.SUCCESS;
  }
}
