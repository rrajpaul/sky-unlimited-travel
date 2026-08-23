// Location: server/vitest.config.js
const { defineConfig } = require('vite');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setupEnv.js'],
  },
});