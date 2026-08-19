/**
 * OpenTelemetry / Trigger.dev major-boundary compatibility guard.
 *
 * `@trigger.dev/core@3.x` and `@opentelemetry/sdk-node@0.52.x` both pin
 * `@opentelemetry/sdk-trace-node` to an EXACT 1.25.1 and call tracer-provider
 * APIs that OpenTelemetry removed in 2.x (`addSpanProcessor`,
 * `_getSpanExporter`). Forcing the trace SDK forward — e.g. to silence the
 * `npm audit` advisory on that chain — resolves cleanly and passes `npm ci`,
 * but makes `TracingSDK` throw at
 * `@trigger.dev/core/dist/commonjs/v3/otel/tracingSDK.js:83`, so every Trigger
 * task fails to boot. Nothing else in CI catches it: the break is a runtime
 * TypeError in a transitive dependency, not a type error or a test failure.
 *
 * That regression shipped once (e033078, reverted). These tests assert the
 * property directly from each consumer's own resolution position, so a future
 * override or lockfile drift fails here instead of in production.
 *
 * Origin: PR #428 review thread T68 / comment 5088281843.
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Resolve as the given package's own code would, honouring nested node_modules. */
function requireAsConsumer(consumerPkg: string) {
  const consumerDir = dirname(require.resolve(`${consumerPkg}/package.json`));
  // The path need not exist; createRequire only uses it as a resolution anchor.
  return createRequire(join(consumerDir, 'index.js'));
}

// The two packages that load `@opentelemetry/sdk-trace-node` at Trigger boot.
const CONSUMERS = ['@trigger.dev/core', '@opentelemetry/sdk-node'] as const;

describe('OpenTelemetry trace SDK stays on Trigger.dev-compatible 1.x', () => {
  it.each(CONSUMERS)(
    '%s resolves @opentelemetry/sdk-trace-node at major 1',
    (consumer) => {
      const req = requireAsConsumer(consumer);
      const { version } = req('@opentelemetry/sdk-trace-node/package.json');

      expect(
        version,
        `${consumer} resolves sdk-trace-node@${version}; it pins 1.25.1 exactly and ` +
          'calls APIs removed in 2.x. Do not override this across the major boundary.',
      ).toMatch(/^1\./);
    },
  );

  it.each(CONSUMERS)(
    '%s sees a NodeTracerProvider that still has addSpanProcessor',
    (consumer) => {
      const req = requireAsConsumer(consumer);
      const { NodeTracerProvider } = req('@opentelemetry/sdk-trace-node');

      // The exact call shape of tracingSDK.js:83 — a plain property check would
      // miss a provider that defines the method but rejects a 1.x SpanProcessor.
      const provider = new NodeTracerProvider({});
      expect(typeof provider.addSpanProcessor).toBe('function');

      const { BatchSpanProcessor } = req('@opentelemetry/sdk-trace-base');
      const noopExporter = { export: () => {}, shutdown: () => Promise.resolve() };

      expect(() =>
        provider.addSpanProcessor(new BatchSpanProcessor(noopExporter as never)),
      ).not.toThrow();
    },
  );

  it('sdk-node can construct the env-exporter provider it boots with', () => {
    // TracerProviderWithEnvExporters extends NodeTracerProvider and calls both
    // addSpanProcessor and _getSpanExporter in its constructor. Under a 2.x
    // provider this throws `TypeError: this._getSpanExporter is not a function`.
    const req = requireAsConsumer('@opentelemetry/sdk-node');
    const { TracerProviderWithEnvExporters } = req(
      '@opentelemetry/sdk-node/build/src/TracerProviderWithEnvExporter.js',
    );

    const previous = process.env.OTEL_TRACES_EXPORTER;
    process.env.OTEL_TRACES_EXPORTER = 'console';
    try {
      expect(() => new TracerProviderWithEnvExporters({})).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.OTEL_TRACES_EXPORTER;
      else process.env.OTEL_TRACES_EXPORTER = previous;
    }
  });
});
