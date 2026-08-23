// Location: server/tests/setupEnv.js
//
// Runs once before any test file, per vitest.config.js's test.setupFiles.
// Loads server/.env.test so modules like utils/mailer.js (which reads
// AZURE_* env vars at require-time, not lazily) don't throw just from
// being imported during a test run.
const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });