// Location: server/vitest.config.mjs
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setupEnv.js'],

    // Run test FILES one at a time. The integration files create, TRUNCATE
    // and DROP the same giveaway tables in one shared Postgres database, so
    // in parallel (the default on a multi-core machine) one file's afterAll
    // DROP lands mid-run in the other — "relation giveaway_entries does not
    // exist". Setting this to false also forces maxWorkers/minWorkers to 1.
    //
    // NOTE: this is the Vitest 2.x option. The ROOT config runs Vitest
    // 0.34.6, where the equivalent is singleThread / minThreads / maxThreads
    // — those names don't exist here, and fileParallelism doesn't exist there.
    fileParallelism: false,
  },
});