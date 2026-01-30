import { defineConfig } from '@trigger.dev/sdk/v3';

// Set build flag to skip config validation during Trigger.dev build
process.env.TRIGGER_BUILD = 'true';

export default defineConfig({
  project: 'proj_vbgtboyhcjpbpmjmgjip',
  runtime: 'node',
  logLevel: 'info',
  maxDuration: 300, // 5 minutes for eligibility sync
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ['./src/trigger'],
  build: {
    // Native modules and problematic packages must be external - not bundled by esbuild
    external: ['argon2', 'ioredis', 'better-sqlite3'],
  },
  // Ensure these packages are installed in the container
  additionalPackages: ['ioredis', 'argon2', 'better-sqlite3'],
});
