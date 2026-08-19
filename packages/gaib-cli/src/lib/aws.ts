/**
 * Thin wrapper around AWS Secrets Manager for gaib-cli.
 *
 * Per SDD §9.4: uses existing AWS profile (`AWS_PROFILE` env or
 * `~/.aws/credentials`). NO new IAM roles.
 *
 * Per SDD §9.5: never logs secret VALUES. Caller is responsible for not
 * routing values to logs; this module logs only counts + key names.
 */
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import { ExitCodes, type ExitCode } from '../types.js';

export interface AwsClientOptions {
  region?: string;
}

export class GaibSecretsError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = 'GaibSecretsError';
  }
}

export class AwsSecretsClient {
  private readonly client: SecretsManagerClient;

  constructor(opts: AwsClientOptions = {}) {
    this.client = new SecretsManagerClient({
      region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
    });
  }

  /**
   * Fetch the JSON map stored at `SecretId`. Returns the parsed object.
   *
   * The convention in loa-freeside: each world has ONE secret (e.g.
   * `arrakis-production-mibera`) whose value is a JSON object mapping
   * env-var names to values.
   */
  async getJsonSecret(secretId: string): Promise<Record<string, string>> {
    let result;
    try {
      result = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        throw new GaibSecretsError(
          `Secrets Manager: secret '${secretId}' not found`,
          ExitCodes.MISSING_WORLD,
        );
      }
      throw classifyAwsError(err);
    }

    const raw = result.SecretString;
    if (!raw) {
      throw new GaibSecretsError(
        `Secrets Manager: secret '${secretId}' has no SecretString (binary?)`,
        ExitCodes.SCHEMA_VIOLATION,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new GaibSecretsError(
        `Secrets Manager: secret '${secretId}' is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
        ExitCodes.SCHEMA_VIOLATION,
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new GaibSecretsError(
        `Secrets Manager: secret '${secretId}' is not a JSON object`,
        ExitCodes.SCHEMA_VIOLATION,
      );
    }

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new GaibSecretsError(
          `Secrets Manager: secret '${secretId}' key '${k}' is not a string`,
          ExitCodes.SCHEMA_VIOLATION,
        );
      }
      out[k] = v;
    }
    return out;
  }

  /**
   * Overwrite the JSON map stored at `SecretId`. Caller has already validated
   * the contents against the world's registry. AWS Secrets Manager creates a
   * new version automatically — old versions remain accessible via VersionId
   * until rotation policy expires them.
   */
  async putJsonSecret(secretId: string, value: Record<string, string>): Promise<void> {
    try {
      await this.client.send(
        new PutSecretValueCommand({
          SecretId: secretId,
          SecretString: JSON.stringify(value),
        }),
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        throw new GaibSecretsError(
          `Secrets Manager: secret '${secretId}' not found (push expects existing secret; create via console or terraform)`,
          ExitCodes.MISSING_WORLD,
        );
      }
      throw classifyAwsError(err);
    }
  }
}

/**
 * Map AWS SDK errors onto gaib-cli's exit-code taxonomy.
 */
function classifyAwsError(err: unknown): GaibSecretsError {
  const name = (err as { name?: string }).name ?? '';
  const status =
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0;

  // Auth errors
  if (
    name === 'CredentialsProviderError' ||
    name === 'AccessDeniedException' ||
    name === 'UnrecognizedClientException' ||
    name === 'InvalidSignatureException' ||
    status === 401 ||
    status === 403
  ) {
    return new GaibSecretsError(
      `AWS auth failure: ${name || 'unknown'} (check AWS_PROFILE / ~/.aws/credentials)`,
      ExitCodes.UNAUTHORIZED,
    );
  }

  // Retryable transient
  if (
    name === 'ThrottlingException' ||
    name === 'ProvisionedThroughputExceededException' ||
    (status >= 500 && status < 600)
  ) {
    return new GaibSecretsError(
      `AWS retryable error: ${name || 'unknown'} (HTTP ${status})`,
      ExitCodes.RETRYABLE_NETWORK,
    );
  }

  // Anything else — bubble as schema-shape mismatch by default
  return new GaibSecretsError(
    `AWS unexpected error: ${name || (err instanceof Error ? err.message : String(err))}`,
    ExitCodes.SCHEMA_VIOLATION,
  );
}
