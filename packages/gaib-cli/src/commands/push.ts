/**
 * `gaib secrets push --world <slug> --env <staging|prod> --from-file <path> [--confirm]`
 *
 * Per SDD §9.2: validates against the world's registry secrets list before
 * write. Refuses if file contains keys not declared in the registry.
 *
 * Per SDD §9.5: requires explicit `--confirm` for prod.
 */
import { readFile } from 'node:fs/promises';

import { Command, Option } from 'clipanion';
import * as t from 'typanion';

import { AwsSecretsClient, GaibSecretsError } from '../lib/aws.js';
import { parseDotenv } from '../lib/format.js';
import { deriveSecretId, resolveWorld } from '../lib/world-resolver.js';
import { ExitCodes, type Environment } from '../types.js';

export class SecretsPushCommand extends Command {
  static paths = [['secrets', 'push']];

  static usage = Command.Usage({
    category: 'Secrets',
    description: 'Push world secrets to AWS Secrets Manager from a dotenv file',
    details: `
      Reads a dotenv file, validates each key against the world's registry
      secrets[] list, and writes to AWS Secrets Manager. Refuses keys not
      declared in the registry.

      Prod pushes require an explicit --confirm flag.
    `,
    examples: [
      [
        'Push staging from .env.cutover (no --confirm needed)',
        '$0 secrets push --world mibera --env staging --from-file .env.cutover',
      ],
      [
        'Push prod with --confirm',
        '$0 secrets push --world mibera --env prod --from-file .env.rotated --confirm',
      ],
    ],
  });

  world = Option.String('--world', {
    required: true,
    description: 'World slug',
    validator: t.isString(),
  });

  env = Option.String('--env', {
    required: true,
    description: 'Target environment (staging | prod)',
    validator: t.isEnum(['staging', 'prod'] as const),
  });

  fromFile = Option.String('--from-file', {
    required: true,
    description: 'Path to dotenv file',
    validator: t.isString(),
  });

  confirm = Option.Boolean('--confirm', false, {
    description: 'Required for prod env',
  });

  region = Option.String('--region', {
    description: 'AWS region override',
  });

  registryRoot = Option.String('--registry-root', {
    description: 'Path to freeside-worlds registry/worlds dir (override)',
  });

  async execute(): Promise<number> {
    // 1. Prod gate.
    if (this.env === 'prod' && !this.confirm) {
      this.context.stderr.write(
        `gaib: --confirm is required for --env prod\n`,
      );
      return ExitCodes.BAD_INVOCATION;
    }

    // 2. Resolve the world.
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

    const declared = new Set(
      (resolved.world.secrets ?? []).map((s) => s.env_var),
    );
    if (declared.size === 0) {
      this.context.stderr.write(
        `gaib: world '${this.world}' has no registry-declared secrets — nothing to push against\n`,
      );
      return ExitCodes.SCHEMA_VIOLATION;
    }

    // 3. Read + parse the dotenv file.
    let raw: string;
    try {
      raw = await readFile(this.fromFile, 'utf8');
    } catch (err) {
      this.context.stderr.write(
        `gaib: failed to read ${this.fromFile}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return ExitCodes.BAD_INVOCATION;
    }
    const parsed = parseDotenv(raw);

    // 4. Validate against the registry.
    const undeclaredKeys = Object.keys(parsed).filter((k) => !declared.has(k));
    if (undeclaredKeys.length > 0) {
      this.context.stderr.write(
        `gaib: file contains ${undeclaredKeys.length} key(s) NOT declared in registry: ${undeclaredKeys.join(', ')}\n`,
      );
      this.context.stderr.write(
        `gaib: refusing push — declare in freeside-worlds/packages/registry/worlds/${this.world}.yaml first\n`,
      );
      return ExitCodes.SCHEMA_VIOLATION;
    }

    // 5. Push.
    const aws = new AwsSecretsClient(this.region ? { region: this.region } : {});
    const secretId = deriveSecretId(this.world, this.env as Environment);

    try {
      await aws.putJsonSecret(secretId, parsed);
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

    this.context.stderr.write(
      `gaib: pushed ${Object.keys(parsed).length} key(s) to ${secretId}\n`,
    );
    return ExitCodes.SUCCESS;
  }
}
