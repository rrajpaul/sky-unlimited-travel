const cron = require('node-cron');
const { config } = require('./config');
const { runDailyPost, runGiveawayPost } = require('./services/postJob');

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
 * Starts one or two scheduled posts per day. POST_CRON is always active
 * (slot 1). POST_CRON_2 runs a second, independent post at a different time
 * (slot 2) — e.g. one timed for Facebook's morning peak, another for
 * Instagram's evening peak. Each fires as its own fully independent post
 * (its own AI-generated content, its own post type, its own image) — set
 * POST_CRON_2 to an empty string to go back to a single post per day.
 *
 * A third, independent slot (GIVEAWAY_POST_CRON) checks whether a giveaway
 * is currently active on the main website and, only if so, posts a
 * giveaway promo. It's safe to leave running year-round — on days with no
 * active giveaway it silently does nothing.
 */
function startScheduler() {
  scheduleOne(config.postCron, 'Post #1', 1);

  if (config.postCron2 && config.postCron2.trim() !== '') {
    scheduleOne(config.postCron2, 'Post #2', 2);
  }

  if (config.giveawayPostCron && config.giveawayPostCron.trim() !== '') {
    scheduleGiveaway(config.giveawayPostCron);
  }
}

module.exports = { startScheduler };