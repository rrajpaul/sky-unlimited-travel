const { pool } = require('../db');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// "Has this scheduled slot already run today?" guard
// ---------------------------------------------------------------------------
//
// Without this, the same slot could post twice on one day: a Railway
// redeploy overlapping the cron time (old and new container both fire), two
// replicas running at once, or a restart mid-run.
//
// Each scheduled run first CLAIMS (slot, today's date in TIMEZONE) with an
// INSERT that only one process can win — the primary key makes it atomic,
// so even two containers firing in the same second can't both get it. If
// the run then fails before anything was published, the claim is released
// so a retry/redeploy later that day can still post.
//
// Manual /api/post-now style calls don't go through this on purpose: those
// are meant to post in addition to the schedule.

let ensureTablePromise = null;

function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS social_scheduled_runs (
           slot_key TEXT NOT NULL,
           run_date DATE NOT NULL,
           claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           PRIMARY KEY (slot_key, run_date)
         );`
      )
      .catch((err) => {
        ensureTablePromise = null; // let the next run try again
        throw err;
      });
  }
  return ensureTablePromise;
}

/** Today's date (YYYY-MM-DD) in the posting timezone, not the server's UTC. */
function todayInTimezone(date = new Date(), timeZone = config.timezone) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Tries to claim today's run for `slotKey`. Returns true if this process
 * should go ahead and post, false if the slot already ran today.
 *
 * Fails OPEN (returns true) if the database can't be reached, matching the
 * rest of the app's "never silently skip a day" behaviour.
 */
async function claimSlot(slotKey) {
  const runDate = todayInTimezone();
  try {
    await ensureTable();
    const { rowCount } = await pool.query(
      `INSERT INTO social_scheduled_runs (slot_key, run_date)
       VALUES ($1, $2)
       ON CONFLICT (slot_key, run_date) DO NOTHING`,
      [slotKey, runDate]
    );
    return rowCount === 1;
  } catch (err) {
    console.warn(
      `[runGuard] Could not check whether ${slotKey} already ran today (posting anyway):`,
      err.message
    );
    return true;
  }
}

/** Gives back today's claim, e.g. when the run failed before posting anything. */
async function releaseSlot(slotKey) {
  try {
    await pool.query(
      `DELETE FROM social_scheduled_runs WHERE slot_key = $1 AND run_date = $2`,
      [slotKey, todayInTimezone()]
    );
  } catch (err) {
    console.warn(`[runGuard] Could not release today's claim for ${slotKey}:`, err.message);
  }
}

module.exports = { claimSlot, releaseSlot, todayInTimezone };
