const cron = require('node-cron');
const { config } = require('./config');
const { runDailyPost, runGiveawayPost, runReelPost } = require('./services/postJob');

/**
 * Schedules one recurring post job at the given cron expression. `slot`
 * (1 or 2) is passed through to runDailyPost so each scheduled time gets a
 * distinct post type rather than repeating the same style when two posts
 * land on the same day — see pickPostType in contentGenerator.js.
 */
function scheduleOne(cronExpression, label, slot) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for ${label}: "${cronExpression}"`);
  }

  console.log(
    `[scheduler] ${label} scheduled with cron "${cronExpression}" (timezone: ${config.timezone})`
  );

  cron.schedule(
    cronExpression,
    async () => {
      console.log(`[scheduler] Running ${label}...`);
      try {
        const result = await runDailyPost({ dryRun: false, slot });
        console.log(`[scheduler] ${label} complete:`, {
          headline: result.headline,
          errors: result.errors,
        });
      } catch (err) {
        console.error(`[scheduler] ${label} failed:`, err.message);
      }
    },
    { timezone: config.timezone }
  );
}

/**
 * Schedules the Reel post — this REPLACES what used to be Post #1's normal
 * image rotation (see startScheduler below: POST_CRON now runs this
 * instead of scheduleOne). Kept as its own function, separate from
 * scheduleOne, since a Reel takes meaningfully longer to produce and
 * publish (FFmpeg encoding, then Meta's much longer video processing time)
 * and logs a bit differently as a result — worth being able to tell apart
 * in the logs from a still-image post at a glance.
 */
function scheduleReel(cronExpression, label) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for ${label}: "${cronExpression}"`);
  }

  console.log(
    `[scheduler] ${label} (Reel) scheduled with cron "${cronExpression}" (timezone: ${config.timezone})`
  );

  cron.schedule(
    cronExpression,
    async () => {
      console.log(`[scheduler] Running ${label} (Reel)...`);
      try {
        const result = await runReelPost({ dryRun: false });
        console.log(`[scheduler] ${label} (Reel) complete:`, {
          headline: result.headline,
          errors: result.errors,
        });
      } catch (err) {
        console.error(`[scheduler] ${label} (Reel) failed:`, err.message);
      }
    },
    { timezone: config.timezone }
  );
}

/**
 * Schedules the giveaway post separately from scheduleOne above, since its
 * "nothing happened" outcome (no giveaway active) is expected and routine,
 * not an error — logging it the same way as a real post's success/failure
 * would make normal no-giveaway days look like something went wrong.
 */
function scheduleGiveaway(cronExpression) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for Giveaway post: "${cronExpression}"`);
  }

  console.log(
    `[scheduler] Giveaway post scheduled with cron "${cronExpression}" (timezone: ${config.timezone}) — only posts when a giveaway is currently active`
  );

  cron.schedule(
    cronExpression,
    async () => {
      console.log('[scheduler] Running Giveaway post check...');
      try {
        const result = await runGiveawayPost({ dryRun: false });
        if (result.skipped) {
          console.log('[scheduler] Giveaway post skipped — no active giveaway.');
        } else {
          console.log('[scheduler] Giveaway post complete:', {
            headline: result.headline,
            errors: result.errors,
          });
        }
      } catch (err) {
        console.error('[scheduler] Giveaway post failed:', err.message);
      }
    },
    { timezone: config.timezone }
  );
}

/**
 * Starts one or two scheduled posts per day. POST_CRON (slot 1, normally
 * 11am) now ALWAYS posts a Reel instead of the usual image rotation — see
 * scheduleReel above — replacing what used to run there. POST_CRON_2 still
 * runs the original image rotation (slot 2) at a different time — e.g. one
 * timed for Facebook's morning peak, another for Instagram's evening peak.
 * Set POST_CRON_2 to an empty string to go back to a single post per day.
 *
 * A third, independent slot (GIVEAWAY_POST_CRON) checks whether a giveaway
 * is currently active on the main website and, only if so, posts a
 * giveaway promo. It's safe to leave running year-round — on days with no
 * active giveaway it silently does nothing.
 */
function startScheduler() {
  scheduleReel(config.postCron, 'Post #1');

  if (config.postCron2 && config.postCron2.trim() !== '') {
    scheduleOne(config.postCron2, 'Post #2', 2);
  }

  if (config.giveawayPostCron && config.giveawayPostCron.trim() !== '') {
    scheduleGiveaway(config.giveawayPostCron);
  }
}

module.exports = { startScheduler };