const { Pool } = require('pg');
const { config } = require('./config');

// Reuses the MAIN WEBSITE's existing Postgres database — this app only
// owns the social_post_history table within it (see
// services/historyStore.js), not the database itself.
//
// ssl: matches the exact convention already used in the main site's own
// db.js (NODE_ENV === 'production'), rather than inventing a different
// rule here — both apps talk to the same database, so they should decide
// whether to use SSL the same way. This means NODE_ENV=production needs to
// be set in this app's Railway environment too, same as it presumably
// already is for the main site's service.
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Fires for errors on idle clients in the pool (e.g. the DB restarting) —
  // logging here stops that from crashing the whole process, since Node
  // treats an unhandled 'error' event on an EventEmitter as fatal.
  console.error('[db] Unexpected error on idle Postgres client:', err.message);
});

module.exports = { pool };